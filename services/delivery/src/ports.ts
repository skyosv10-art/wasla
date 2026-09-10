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
import type { DelegatableTask } from "./domain/delegation.js";

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

/* ════════════════════════════════════════════════════════════════════════
 * Dispatch delegation — the COMMAND side of ADR-026 §2.4 (review 4/N).
 * Deliberately NOT part of TaskMirrorStore: that port is relay consumption
 * (dispatch_outbox → mirror); this is the sending direction (task → dispatch
 * job). Separate seams, separate fakes, same Postgres class may implement
 * both — the responsibilities stay distinguishable at the type level.
 * ════════════════════════════════════════════════════════════════════════ */

/** Context of a delegation write — same shape as MirrorContext, own name. */
export interface DelegationContext {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly traceId: string | null;
}

/**
 * The outbound command port — delivery asks dispatch to own the matching.
 *
 * Delivery-owned fields ONLY: the command must not smuggle ORD- assumptions
 * (ADR-026 §4.6-1 — dispatch is ORD-keyed, store orders are WS-). The real
 * adapter (HTTP, composition root — deferred §4.2) bridges to dispatch's
 * create-job contract behind the pending architectural decision recorded in
 * the risk register; until then the port is tested with a fake.
 */
export interface DispatchJobRequester {
  /**
   * Request a dispatch job for an eligible task. MUST be idempotent per
   * `idempotencyKey` (the key is deterministic per task — domain/delegation.ts).
   * Throws on transport/dependency failure — the caller maps nothing, keeps
   * zero local state, and retries.
   */
  requestJob(command: DispatchDelegationCommand): Promise<DispatchJobRequestOutcome>;
}

export interface DispatchDelegationCommand {
  readonly taskId: string;
  /** The store order this task delivers — a delivery-owned opaque ref. */
  readonly orderId: string;
  /** Deterministic (domain/delegation.ts) — crash-heal depends on it. */
  readonly idempotencyKey: string;
  readonly traceId: string | null;
}

export interface DispatchJobRequestOutcome {
  /** The dispatch job's opaque ref — the ONLY legal join (§4.6-1), 1..128 chars. */
  readonly jobRef: string;
  /** True when dispatch remembered the key and returned the original job. */
  readonly replayed: boolean;
}

/**
 * The delivery-owned side of the bind — ONE transaction (ADR-026 §4.6-2):
 * `dispatch_job_ref` + eligible→dispatch_requested + transition ledger row
 * (actor `system`) + the `delivery.dispatch_requested` outbox event.
 *
 * Contract errors (DeliveryError):
 *  - DELIVERY_TRANSITION_NOT_ALLOWED — the task is not `eligible` anymore,
 *  - DELIVERY_CONCURRENT_UPDATE — a DIFFERENT jobRef is already bound,
 *  and a raw throw means rollback — nothing survives a mid-bind crash.
 */
export interface TaskDelegationStore {
  /** The task as the wire sees it — null when unknown. */
  getTaskForDelegation(taskId: string): Promise<DelegatableTask | null>;
  /**
   * Atomically bind the job and move eligible→dispatch_requested.
   * `already_bound` (same ref, idempotent) is NOT an error — the deterministic
   * idempotency key makes a racing or retried caller ask for the same job.
   */
  bindDispatchJob(taskId: string, jobRef: string, context: DelegationContext): Promise<"bound" | "already_bound">;
}

/* ════════════════════════════════════════════════════════════════════════
 * Marketplace inventory consumer (ADR-026 §2.3 — "inventory is read via the
 * agreed boundary, no writing to marketplace tables, delivery stores
 * snapshots not balances"). The relay reads `marketplace_outbox` rows of type
 * `marketplace.inventory_adjusted` and projects them into
 * `delivery_inventory_observations` — a snapshot, never a balance.
 * ════════════════════════════════════════════════════════════════════════ */

import type {
  InventoryAdjustedData,
  InventoryConsumedStatus,
  InventoryRelayCheckpoint,
  MarketplaceOutboxRow,
} from "./domain/marketplace-inventory-events.js";

/** Reads `marketplace_outbox` rows of type `marketplace.inventory_adjusted` AFTER a checkpoint. */
export interface MarketplaceInventoryEventSource {
  /** Read up to `limit` marketplace outbox rows strictly after the checkpoint (or from zero). */
  readAfter(checkpoint: InventoryRelayCheckpoint | null, limit: number): Promise<readonly MarketplaceOutboxRow[]>;
}

/**
 * The delivery-owned state the inventory relay writes — observation snapshots
 * + consumed ledger + checkpoint, ALL atomic where the relay needs them.
 *
 * `observeInventoryAdjustment` is guarded by `adjustment_sequence`: an older
 * adjustment is `skipped_stale` (the snapshot never regresses); a newer one
 * upserts the observation. This is the inventory equivalent of the dispatch
 * relay's per-task watermark — but per (store_id, product_id).
 */
export interface InventoryObservationStore {
  /* ── checkpoint (delivery-owned) ── */
  getInventoryCheckpoint(consumerId: string): Promise<InventoryRelayCheckpoint | null>;
  writeInventoryCheckpoint(consumerId: string, checkpoint: InventoryRelayCheckpoint): Promise<void>;

  /* ── consumed-event ledger (idempotency) ── */
  getInventoryConsumed(eventId: string): Promise<{ status: InventoryConsumedStatus; attempt_count: number } | null>;
  markInventoryConsumed(
    eventId: string,
    row: Pick<MarketplaceOutboxRow, "event_type" | "aggregate_type" | "aggregate_id">,
    status: InventoryConsumedStatus,
    attemptCount: number,
    lastError?: string | null,
  ): Promise<void>;

  /* ── the inventory snapshot ── */
  /**
   * Upsert the observation for (store_id, product_id), guarded by sequence.
   * Returns `"applied"` when the observation was updated, or `"skipped_stale"`
   * when the incoming adjustment_sequence is older than the current one.
   */
  observeInventoryAdjustment(data: InventoryAdjustedData, context: MirrorContext): Promise<"applied" | "skipped_stale">;

  /* ── replay / rebuild ── */
  /** Clear observations + consumed ledger + checkpoint (NOT delivery_outbox). */
  clearInventoryObservations(): Promise<void>;
}
