/**
 * PostgresDispatchEventSource — reads `dispatch_outbox` rows AFTER a
 * checkpoint (ADR-026 §2.4, review 3/N). Read-only: the relay NEVER writes
 * to `dispatch_outbox` (no `published_at`) — progress is delivery-owned
 * (`delivery_relay_checkpoint` + the task watermark), mirroring ADR-025 §2.3.
 *
 * Ordering is `commit_sequence` alone (RISK-0012 · ADR-057): assigned by the
 * producer's DEFERRED trigger at COMMIT under a per-table advisory lock, so it
 * follows commit order. The next batch reads strictly after the checkpoint's
 * `last_commit_sequence`. The old (occurred_at, event_id) tuple tied inside one
 * transaction and fell to a random UUID.
 */

import type { Pool } from "pg";
import type { DispatchEventSource } from "../ports.js";
import type { DispatchOutboxRow, RelayCheckpoint } from "../domain/consumed-events.js";

const ZERO_CHECKPOINT: RelayCheckpoint = {
  last_commit_sequence: "0",
  last_occurred_at: new Date(0).toISOString(),
  last_event_id: "00000000-0000-0000-0000-000000000000",
};

export class PostgresDispatchEventSource implements DispatchEventSource {
  constructor(private readonly pool: Pool) {}

  async readAfter(checkpoint: RelayCheckpoint | null, limit: number): Promise<readonly DispatchOutboxRow[]> {
    const cp = checkpoint ?? ZERO_CHECKPOINT;
    // ORDER BY is table-qualified on purpose: the bare name would bind to the
    // `::text` output alias and sort lexicographically ('10' < '2') — measured
    // in the search leg before this fix (RISK-0012 · CLM-0416).
    const result = await this.pool.query<
      Pick<DispatchOutboxRow, "event_id" | "event_type" | "event_version" | "aggregate_type" | "aggregate_id" | "trace_id"> &
      { payload: unknown; occurred_at: Date; commit_sequence: string }
    >(
      `SELECT event_id::text, event_type, event_version, aggregate_type, aggregate_id,
              payload, occurred_at, commit_sequence::text AS commit_sequence, trace_id
         FROM dispatch_outbox
        WHERE commit_sequence > $1::bigint
        ORDER BY dispatch_outbox.commit_sequence ASC
        LIMIT $2`,
      [cp.last_commit_sequence, limit],
    );
    return result.rows.map((r) => ({
      event_id: r.event_id,
      event_type: r.event_type as DispatchOutboxRow["event_type"],
      event_version: r.event_version,
      aggregate_type: r.aggregate_type,
      aggregate_id: r.aggregate_id,
      // ISO-8601 دائماً: المحرّكُ يقارنُ الطوابعَ معجميّاً كسلاسل (relay.isAfter)،
      // وصيغةُ `::text` في PostgreSQL ("2026-09-09 10:00:00+00") تنكسر أمامَ ISO.
      occurred_at: r.occurred_at.toISOString(),
      commit_sequence: r.commit_sequence,
      trace_id: r.trace_id,
      data: (r.payload ?? {}) as Record<string, unknown>,
    }));
  }
}
