/**
 * PostgresMarketplaceEventSource — reads `marketplace_outbox` rows AFTER a
 * checkpoint offset (ADR-025 §2.3, GAP-3). Read-only: the relay NEVER writes
 * to `marketplace_outbox` (no `markPublished`).
 *
 * Ordering is `commit_sequence` alone (RISK-0012 · ADR-057): assigned by the
 * marketplace's DEFERRED trigger at COMMIT under a per-table advisory lock, so
 * it follows commit order (and insertion order inside one transaction). The
 * old (created_at, outbox_id) tuple tied inside one transaction — `now()` is
 * the transaction start — and fell to a random UUID.
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
  last_commit_sequence: "0",
  last_outbox_id: "00000000-0000-0000-0000-000000000000",
  last_created_at: new Date(0).toISOString(),
};

export class PostgresMarketplaceEventSource implements MarketplaceEventSource {
  constructor(private readonly pool: Pool) {}

  async readAfter(checkpoint: RelayCheckpoint | null, limit: number): Promise<readonly MarketplaceOutboxRow[]> {
    const cp = checkpoint ?? ZERO_CHECKPOINT;
    // ORDER BY is table-qualified on purpose: the bare name would bind to the
    // `::text` output alias and sort lexicographically ('10' < '2') — measured
    // in the search leg before this fix (RISK-0012 · CLM-0416).
    const result = await this.pool.query<
      Pick<MarketplaceOutboxRow, "outbox_id" | "event_type" | "event_version" | "aggregate_type" | "aggregate_id" | "occurred_at" | "created_at" | "commit_sequence" | "trace_id"> & { payload: unknown }
    >(
      `SELECT outbox_id::text, event_type, event_version, aggregate_type, aggregate_id,
              payload, occurred_at::text AS occurred_at, created_at::text AS created_at,
              commit_sequence::text AS commit_sequence, trace_id::text AS trace_id
         FROM marketplace_outbox
        WHERE commit_sequence > $1::bigint
        ORDER BY marketplace_outbox.commit_sequence ASC
        LIMIT $2`,
      [cp.last_commit_sequence, limit],
    );
    return result.rows.map((r) => ({
      outbox_id: r.outbox_id,
      event_type: r.event_type as MarketplaceOutboxRow["event_type"],
      event_version: r.event_version,
      aggregate_type: r.aggregate_type,
      aggregate_id: r.aggregate_id,
      occurred_at: r.occurred_at,
      created_at: r.created_at,
      commit_sequence: r.commit_sequence,
      trace_id: r.trace_id,
      data: (r.payload ?? {}) as Record<string, unknown>,
    }));
  }
}
