/**
 * PostgresMarketplaceEventSource — reads `marketplace_outbox` rows AFTER a
 * checkpoint offset (ADR-025 §2.3, GAP-3). Read-only: the relay NEVER writes
 * to `marketplace_outbox` (no `markPublished`).
 *
 * Ordering is by (created_at, outbox_id) — the same tuple the marketplace's
 * `listUnpublished` uses. The checkpoint stores the last terminal (created_at,
 * outbox_id); the next batch reads strictly after it.
 */

import type { Pool } from "pg";
import type {
  MarketplaceEventSource,
} from "../ports.js";
import type {
  MarketplaceOutboxRow,
  RelayCheckpoint,
} from "../domain/consumed-events.js";

const ZERO_CHECKPOINT: RelayCheckpoint = {
  last_outbox_id: "00000000-0000-0000-0000-000000000000",
  last_created_at: new Date(0).toISOString(),
};

export class PostgresMarketplaceEventSource implements MarketplaceEventSource {
  constructor(private readonly pool: Pool) {}

  async readAfter(checkpoint: RelayCheckpoint | null, limit: number): Promise<readonly MarketplaceOutboxRow[]> {
    const cp = checkpoint ?? ZERO_CHECKPOINT;
    const result = await this.pool.query<
      Pick<MarketplaceOutboxRow, "outbox_id" | "event_type" | "event_version" | "aggregate_type" | "aggregate_id" | "occurred_at" | "created_at"> & { payload: unknown }
    >(
      `SELECT outbox_id::text, event_type, event_version, aggregate_type, aggregate_id,
              payload, occurred_at::text AS occurred_at, created_at::text AS created_at
         FROM marketplace_outbox
        WHERE (created_at, outbox_id) > ($1::timestamptz, $2::uuid)
        ORDER BY created_at ASC, outbox_id ASC
        LIMIT $3`,
      [cp.last_created_at, cp.last_outbox_id, limit],
    );
    return result.rows.map((r) => ({
      outbox_id: r.outbox_id,
      event_type: r.event_type as MarketplaceOutboxRow["event_type"],
      event_version: r.event_version,
      aggregate_type: r.aggregate_type,
      aggregate_id: r.aggregate_id,
      occurred_at: r.occurred_at,
      created_at: r.created_at,
      data: (r.payload ?? {}) as Record<string, unknown>,
    }));
  }
}
