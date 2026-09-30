/**
 * PostgresMarketplaceInventoryEventSource — reads `marketplace_outbox` rows
 * of type `marketplace.inventory_adjusted` AFTER a checkpoint (ADR-026 §2.3).
 * Read-only: the relay NEVER writes to `marketplace_outbox` (no
 * `published_at`) — progress is delivery-owned
 * (`delivery_inventory_relay_checkpoint`), mirroring ADR-025 §2.3.
 *
 * The marketplace_outbox table uses `outbox_id` as the event_id (UUID PK).
 * The payload column contains the data fields directly (NOT wrapped in an
 * envelope). The trace_id column does not exist in marketplace_outbox —
 * the relay maps it to null.
 *
 * Ordering is `commit_sequence` alone (RISK-0012 · ADR-057): assigned by the
 * producer's DEFERRED trigger at COMMIT under a per-table advisory lock, so it
 * follows commit order. The next batch reads strictly after `last_commit_sequence`.
 */

import type { Pool } from "pg";
import type { MarketplaceInventoryEventSource } from "../ports.js";
import type { MarketplaceOutboxRow, InventoryRelayCheckpoint } from "../domain/marketplace-inventory-events.js";

const ZERO_CHECKPOINT: InventoryRelayCheckpoint = {
  last_commit_sequence: "0",
  last_occurred_at: new Date(0).toISOString(),
  last_event_id: "00000000-0000-0000-0000-000000000000",
};

export class PostgresMarketplaceInventoryEventSource implements MarketplaceInventoryEventSource {
  constructor(private readonly pool: Pool) {}

  async readAfter(checkpoint: InventoryRelayCheckpoint | null, limit: number): Promise<readonly MarketplaceOutboxRow[]> {
    const cp = checkpoint ?? ZERO_CHECKPOINT;
    // ORDER BY is table-qualified on purpose: the bare name would bind to the
    // `::text` output alias and sort lexicographically ('10' < '2') — measured
    // in the search leg before this fix (RISK-0012 · CLM-0416).
    const result = await this.pool.query<
      Pick<MarketplaceOutboxRow, "event_type" | "event_version" | "aggregate_type" | "aggregate_id"> &
      { outbox_id: string; payload: unknown; occurred_at: Date; commit_sequence: string }
    >(
      `SELECT outbox_id::text, event_type, event_version, aggregate_type, aggregate_id,
              payload, occurred_at, commit_sequence::text AS commit_sequence
         FROM marketplace_outbox
        WHERE event_type = 'marketplace.inventory_adjusted'
          AND commit_sequence > $1::bigint
        ORDER BY marketplace_outbox.commit_sequence ASC
        LIMIT $2`,
      [cp.last_commit_sequence, limit],
    );
    return result.rows.map((r) => ({
      event_id: r.outbox_id,
      event_type: r.event_type as MarketplaceOutboxRow["event_type"],
      event_version: r.event_version,
      aggregate_type: r.aggregate_type,
      aggregate_id: r.aggregate_id,
      // ISO دائماً: المحرّكُ يقارنُ الطوابعَ معجميّاً كسلاسل (relay.isAfter)،
      // وصيغةُ `::text` في PostgreSQL تنكسر أمامَ ISO.
      occurred_at: r.occurred_at.toISOString(),
      commit_sequence: r.commit_sequence,
      trace_id: null,
      data: (r.payload ?? {}) as Record<string, unknown>,
    }));
  }
}
