/**
 * Relay infrastructure ports (ADR-026 §2.4 — the coarse mirror's consumer).
 * The relay depends on these abstractions, not on dispatch internals or a
 * specific DB driver — the same boundary decision as ADR-025 §2.3:
 *
 *  - `DispatchEventSource`: reads `dispatch_outbox` rows AFTER a checkpoint
 *    (occurred_at, event_id). Read-only: the relay NEVER writes to
 *    `dispatch_outbox` (no `published_at`) — progress is delivery-owned.
 *  - `TaskMirrorStore`: the delivery-owned state the mirror writes — task
 *    state + transition ledger + `delivery_outbox` event + consumed ledger +
 *    checkpoint, ALL in one atomic `applyMirrorTransition`. Tested with an
 *    in-memory fake; a Postgres adapter arrives with the integration review
 *    (ADR-026 §4.2/§4.3 — declared deferral).
 *
 * Referential rule (review 2/N finding): dispatch jobs are keyed by ORD- ids
 * owned by services/orders. The ONLY link to a delivery task is
 * `dispatch_job_ref`, bound by the (deferred) delegation wire — which MUST
 * bind before any projectable outcome is emitted, or the relay terminally
 * consumes that outcome as `ignored_foreign`.
 */

import type { DispatchOutboxRow, RelayCheckpoint, ConsumedStatus } from "./domain/consumed-events.js";
import type { MirrorTransition } from "./domain/dispatch-mirror.js";

export interface DispatchEventSource {
  /** Read up to `limit` dispatch outbox rows strictly after the checkpoint (or from zero). */
  readAfter(checkpoint: RelayCheckpoint | null, limit: number): Promise<readonly DispatchOutboxRow[]>;
}

/** Context of the dispatch row that caused a mirror transition. */
export interface MirrorContext {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly traceId: string | null;
}

export interface TaskMirrorStore {
  /* ── checkpoint (delivery-owned) ── */
  getCheckpoint(consumerId: string): Promise<RelayCheckpoint | null>;
  writeCheckpoint(consumerId: string, checkpoint: RelayCheckpoint): Promise<void>;

  /* ── the coarse mirror ── */
  /** The task bound to a dispatch job, if any — the only legal join. */
  getTaskByJobRef(jobId: string): Promise<readonly { taskId: string; state: string; lastDispatchEvent: RelayCheckpoint | null }[]>;
  /**
   * Atomically: advance task state (+courier/assignedAt), append the
   * `delivery_task_transitions` row (actor dispatch), append the mirror's
   * `delivery.*` event to `delivery_outbox`, advance the task's dispatch
   * watermark. Must be idempotent per (task, eventId).
   */
  applyMirrorTransition(taskId: string, transition: MirrorTransition, context: MirrorContext): Promise<void>;
  /**
   * Record a terminally-consumed non-transition (ignored/stale/foreign) so
   * the task's dispatch watermark advances without a state change.
   */
  recordConsumedNoOp(taskId: string, context: MirrorContext): Promise<void>;

  /* ── consumed-event ledger (idempotency) ── */
  getConsumed(eventId: string): Promise<{ status: ConsumedStatus; attempt_count: number } | null>;
  markConsumed(
    eventId: string,
    row: Pick<DispatchOutboxRow, "event_type" | "aggregate_type" | "aggregate_id">,
    status: ConsumedStatus,
    attemptCount: number,
    lastError?: string | null,
  ): Promise<void>;

  /* ── replay / rebuild ── */
  /** Clear mirror state + consumed ledger + checkpoint (NOT delivery_outbox). */
  clearMirrorState(): Promise<void>;
}
