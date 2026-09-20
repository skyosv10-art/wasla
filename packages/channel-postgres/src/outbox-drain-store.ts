/**
 * `OutboxDrainStore` adapter for `channel_outbox` — closes G7 (ADR-042 pattern).
 *
 * The channel outbox (`channel_outbox` table in `packages/channel-core/contracts/schema.sql`)
 * is a package-level outbox. `PostgresChannelOutbox` implements the append-only
 * `OutboxPort`; this drain store implements the consumer side of the shared
 * `@wasla/outbox` contract: claim, deliver, mark published.
 *
 * ## What this table does NOT have
 *
 * `channel_outbox` has no `attempts` or `last_error` columns (G3 is closed by
 * design for relay-consumed outboxes — ADR-043; this table is drain-consumed
 * but is package-level, so retry columns were never added). `recordDeliveryFailure`
 * is therefore not implemented: a failed delivery stays in `DrainReport.failed`
 * (in-memory) and the row remains `published_at IS NULL`, so it will be re-claimed
 * on the next drain pass.
 *
 * `id` is the event UUID (the PK doubles as the event id), so `OutboxRecord.id`
 * and `OutboxRecord.eventId` are the same value.
 *
 * Scope: package · channel-postgres
 * Last Updated: 2026-09-20
 * Status: Active
 * Related Code: @wasla/outbox · ADR-042 · ADR-043
 */

import { sql } from "drizzle-orm";

import type { OutboxDrainStore, OutboxRecord } from "@wasla/outbox";

/**
 * Rows from `execute` — shape varies between Drizzle runner versions.
 */
function rowsOf(result: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(result)) return result as readonly Record<string, unknown>[];
  const rows = (result as { rows?: unknown }).rows;
  if (Array.isArray(rows)) return rows as readonly Record<string, unknown>[];
  return [];
}

/**
 * Drain store for `channel_outbox` on PostgreSQL via Drizzle.
 *
 * Constructed with a transaction (`tx`) from `ChannelDb.transaction()`, so that
 * claim + deliver + mark-published run in one transaction (SKIP LOCKED holds
 * until commit).
 */
export class ChannelOutboxDrainStore implements OutboxDrainStore {
  constructor(
    private readonly tx: { execute(query: ReturnType<typeof sql>): Promise<unknown> },
  ) {}

  async claimUnpublished(limit: number): Promise<readonly OutboxRecord[]> {
    const claimed = await this.tx.execute(sql`
      SELECT id,
             event_type,
             event_version,
             aggregate_type,
             aggregate_id,
             payload,
             occurred_at,
             trace_id
        FROM channel_outbox
       WHERE published_at IS NULL
       ORDER BY occurred_at ASC, id ASC
       LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
    `);

    return rowsOf(claimed).map((row) => ({
      id: String(row["id"]),
      eventId: String(row["id"]),
      eventType: String(row["event_type"]),
      eventVersion: String(row["event_version"]),
      aggregateType: String(row["aggregate_type"]),
      aggregateId: String(row["aggregate_id"]),
      payload: row["payload"],
      occurredAt: String(row["occurred_at"]),
      traceId: row["trace_id"] ? String(row["trace_id"]) : null,
      attempts: 0,
    }));
  }

  async markPublished(id: string, publishedAt: string): Promise<boolean> {
    const updated = await this.tx.execute(sql`
      UPDATE channel_outbox
         SET published_at = ${publishedAt}
       WHERE id = ${id}
         AND published_at IS NULL
      RETURNING id
    `);
    return rowsOf(updated).length === 1;
  }

  /**
   * Not implemented: `channel_outbox` has no `attempts`/`last_error` columns.
   * A failed delivery stays in `DrainReport.failed` and the row is re-claimed
   * on the next drain pass.
   */
}
