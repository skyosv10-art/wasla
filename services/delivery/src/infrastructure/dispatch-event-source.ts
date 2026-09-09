/**
 * PostgresDispatchEventSource — reads `dispatch_outbox` rows AFTER a
 * checkpoint (ADR-026 §2.4, review 3/N). Read-only: the relay NEVER writes
 * to `dispatch_outbox` (no `published_at`) — progress is delivery-owned
 * (`delivery_relay_checkpoint` + the task watermark), mirroring ADR-025 §2.3.
 *
 * Ordering is (occurred_at, event_id) — the same tuple the checkpoint stores.
 * The next batch reads strictly after the last terminal checkpoint.
 */

import type { Pool } from "pg";
import type { DispatchEventSource } from "../ports.js";
import type { DispatchOutboxRow, RelayCheckpoint } from "../domain/consumed-events.js";

const ZERO_CHECKPOINT: RelayCheckpoint = {
  last_occurred_at: new Date(0).toISOString(),
  last_event_id: "00000000-0000-0000-0000-000000000000",
};

export class PostgresDispatchEventSource implements DispatchEventSource {
  constructor(private readonly pool: Pool) {}

  async readAfter(checkpoint: RelayCheckpoint | null, limit: number): Promise<readonly DispatchOutboxRow[]> {
    const cp = checkpoint ?? ZERO_CHECKPOINT;
    const result = await this.pool.query<
      Pick<DispatchOutboxRow, "event_id" | "event_type" | "event_version" | "aggregate_type" | "aggregate_id" | "trace_id"> &
      { payload: unknown; occurred_at: Date }
    >(
      `SELECT event_id::text, event_type, event_version, aggregate_type, aggregate_id,
              payload, occurred_at, trace_id
         FROM dispatch_outbox
        WHERE (occurred_at, event_id) > ($1::timestamptz, $2::uuid)
        ORDER BY occurred_at ASC, event_id ASC
        LIMIT $3`,
      [cp.last_occurred_at, cp.last_event_id, limit],
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
      trace_id: r.trace_id,
      data: (r.payload ?? {}) as Record<string, unknown>,
    }));
  }
}
