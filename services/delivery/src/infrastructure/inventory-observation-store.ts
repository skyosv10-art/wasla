/**
 * PostgresInventoryObservationStore — the delivery-owned state the inventory
 * relay writes (ADR-026 §2.3). Everything an observation touches happens in
 * ONE transaction:
 *
 *   delivery_inventory_observations (upsert, guarded by sequence)
 *
 * …so a crash mid-observe leaves NOTHING behind — proven on real Postgres in
 * `marketplace-inventory.integration.test.ts` (rollback test).
 *
 * Idempotency, two layers (port contract: "idempotent per event_id"):
 *   1. the consumed ledger (`delivery_inventory_relay_consumed_events`) —
 *      a terminally-consumed event is never re-processed;
 *   2. the sequence guard — an older redelivered adjustment is
 *      `skipped_stale` before it can regress the snapshot.
 *
 * Read-only towards marketplace: this store NEVER writes to
 * `marketplace_outbox` (no `published_at`) — same boundary rule as ADR-025
 * §2.3.
 */

import type { Pool, PoolClient } from "pg";
import type {
  InventoryAdjustedData,
  InventoryConsumedStatus,
  MarketplaceOutboxRow,
  InventoryRelayCheckpoint,
} from "../domain/marketplace-inventory-events.js";
import type { InventoryObservationStore, MirrorContext } from "../ports.js";

export class PostgresInventoryObservationStore implements InventoryObservationStore {
  constructor(private readonly pool: Pool) {}

  /* ── checkpoint (delivery-owned) ── */

  async getInventoryCheckpoint(consumerId: string): Promise<InventoryRelayCheckpoint | null> {
    const r = await this.pool.query<{ last_occurred_at: Date; last_event_id: string }>(
      `SELECT last_occurred_at, last_event_id::text
         FROM delivery_inventory_relay_checkpoint WHERE consumer_id = $1`,
      [consumerId],
    );
    // ISO دائماً — المحرّكُ يقارنُ معجميّاً (relay.isAfter) وصيغةُ `::text` تنكسر أمامَها.
    return r.rows.length
      ? { last_occurred_at: r.rows[0].last_occurred_at.toISOString(), last_event_id: r.rows[0].last_event_id }
      : null;
  }

  async writeInventoryCheckpoint(consumerId: string, checkpoint: InventoryRelayCheckpoint): Promise<void> {
    await this.pool.query(
      `INSERT INTO delivery_inventory_relay_checkpoint (consumer_id, last_occurred_at, last_event_id)
       VALUES ($1, $2::timestamptz, $3::uuid)
       ON CONFLICT (consumer_id)
       DO UPDATE SET last_occurred_at = EXCLUDED.last_occurred_at,
                     last_event_id = EXCLUDED.last_event_id,
                     updated_at = now()`,
      [consumerId, checkpoint.last_occurred_at, checkpoint.last_event_id],
    );
  }

  /* ── consumed-event ledger (idempotency) ── */

  async getInventoryConsumed(eventId: string): Promise<{ status: InventoryConsumedStatus; attempt_count: number } | null> {
    const r = await this.pool.query<{ consumed_status: InventoryConsumedStatus; attempt_count: number }>(
      `SELECT consumed_status, attempt_count FROM delivery_inventory_relay_consumed_events WHERE event_id = $1::uuid`,
      [eventId],
    );
    return r.rows.length ? { status: r.rows[0].consumed_status, attempt_count: r.rows[0].attempt_count } : null;
  }

  async markInventoryConsumed(
    eventId: string,
    row: Pick<MarketplaceOutboxRow, "event_type" | "aggregate_type" | "aggregate_id">,
    status: InventoryConsumedStatus,
    attemptCount: number,
    lastError?: string | null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO delivery_inventory_relay_consumed_events
         (event_id, event_type, aggregate_type, aggregate_id, consumed_status, attempt_count, last_error)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (event_id)
       DO UPDATE SET consumed_status = EXCLUDED.consumed_status,
                     attempt_count = EXCLUDED.attempt_count,
                     last_error = EXCLUDED.last_error,
                     updated_at = now()`,
      [eventId, row.event_type, row.aggregate_type, row.aggregate_id, status, attemptCount, lastError ?? null],
    );
  }

  /* ── the inventory snapshot ── */

  async observeInventoryAdjustment(data: InventoryAdjustedData, context: MirrorContext): Promise<"applied" | "skipped_stale"> {
    return this.withTransaction(async (tx) => {
      // Lock the existing observation row (if any) — FOR UPDATE prevents a
      // concurrent observer from racing the sequence check.
      const existing = await tx.query<{ last_adjustment_sequence: number }>(
        `SELECT last_adjustment_sequence
           FROM delivery_inventory_observations
          WHERE store_id = $1::uuid AND product_id = $2::uuid
          FOR UPDATE`,
        [data.store_id, data.product_id],
      );

      // Sequence guard: an older adjustment never regresses the snapshot.
      if (existing.rows.length > 0) {
        const currentSeq = existing.rows[0].last_adjustment_sequence;
        if (data.adjustment_sequence <= currentSeq) {
          return "skipped_stale";
        }
      }

      // Upsert the observation — the snapshot is the LATEST adjustment seen.
      await tx.query(
        `INSERT INTO delivery_inventory_observations
           (store_id, product_id, last_adjustment_id, last_marketplace_event_id,
            last_adjustment_sequence, observed_quantity_after, last_quantity_delta,
            last_reason_code, occurred_for, observed_at, trace_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9::timestamptz, now(), $10)
         ON CONFLICT (store_id, product_id)
         DO UPDATE SET last_adjustment_id = EXCLUDED.last_adjustment_id,
                       last_marketplace_event_id = EXCLUDED.last_marketplace_event_id,
                       last_adjustment_sequence = EXCLUDED.last_adjustment_sequence,
                       observed_quantity_after = EXCLUDED.observed_quantity_after,
                       last_quantity_delta = EXCLUDED.last_quantity_delta,
                       last_reason_code = EXCLUDED.last_reason_code,
                       occurred_for = EXCLUDED.occurred_for,
                       observed_at = now(),
                       trace_id = EXCLUDED.trace_id`,
        [
          data.store_id,
          data.product_id,
          data.adjustment_id,
          context.eventId,
          data.adjustment_sequence,
          data.quantity_after,
          data.quantity_delta,
          data.reason_code,
          data.occurred_for,
          context.traceId,
        ],
      );
      return "applied";
    });
  }

  /* ── replay / rebuild ── */

  async clearInventoryObservations(): Promise<void> {
    await this.withTransaction(async (tx) => {
      await tx.query(`DELETE FROM delivery_inventory_observations`);
      await tx.query(`DELETE FROM delivery_inventory_relay_consumed_events`);
      await tx.query(`DELETE FROM delivery_inventory_relay_checkpoint`);
    });
  }

  /* ── internals ── */

  private async withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
