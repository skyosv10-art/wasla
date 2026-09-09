/**
 * Dispatch delegation — the COMMAND side of ADR-026 §2.4 (review 4/N).
 *
 * The relay (relay.ts) is the consuming side: dispatch_outbox → coarse mirror.
 * This module is the sending side: an `eligible` task asks dispatch to own the
 * fine-grained matching (waves · offers · timeouts) and binds the answer.
 *
 * The referential rule that shapes everything here (ADR-026 §4.6-1):
 * dispatch jobs are keyed by ORD-… refs owned by services/orders; store
 * orders are WS-…. The two sides share NO matching key — the ONLY link is
 * `delivery_tasks.dispatch_job_ref`, written once, here, by the delegation
 * wire. The ordering invariant (§4.6-2): the bind MUST commit before any
 * projectable dispatch outcome (assignment/exhaustion/cancellation) is
 * consumed — an outcome arriving for an unbound task is terminally
 * `ignored_foreign` with no way back. The wire's shape honors this:
 *
 *   1. a DETERMINISTIC idempotency key derived from the task, so a crash
 *      between "dispatch created the job" and "delivery bound it" heals on
 *      retry — the same key returns the same job, never a second one;
 *   2. the bind is ONE local transaction (ref + eligible→dispatch_requested
 *      + ledger row + `delivery.dispatch_requested` event) — a crash mid-bind
 *      leaves nothing;
 *   3. `dispatch.job_created` itself is a benign terminal no-op in the mirror
 *      (dispatch-mirror.ts), so the creation event racing the bind is safe —
 *      only OUTCOMES are order-sensitive.
 *
 * What this module does NOT decide: the ORD-/WS- bridge. Dispatch's
 * create-job contract requires an ORD- public id and an orders-engine
 * transition; a WS- store order satisfies neither. The real
 * `DispatchJobRequester` adapter (HTTP, composition root — deferred §4.2)
 * depends on that architectural decision, recorded as a risk, not smuggled
 * here as an assumption.
 */

import type { DeliveryTaskState } from "@wasla/contracts-delivery";

/** The ledger reason for the delegation edge (state-machine.ts, ADR-026 §3.3). */
export const DISPATCH_DELEGATION_LEDGER_REASON = "dispatch_delegated" as const;

/** The only state the wire may delegate from (ADR-026 §3.3). */
export const DELEGATION_SOURCE_STATE: DeliveryTaskState = "eligible";

/** The state the bind moves the task to (ADR-026 §3.3). */
export const DELEGATION_TARGET_STATE: DeliveryTaskState = "dispatch_requested";

/**
 * Deterministic idempotency key — same task, same key, forever.
 *
 * A retry after a crash between "dispatch created the job" and "delivery
 * bound it" MUST return the original job, or the wire would orphan the first
 * job behind a second one. Determinism is the guarantee; the shape is the
 * adapter's to bridge (dispatch's key rules are its contract, not ours).
 */
export function deriveDelegationIdempotencyKey(taskId: string): string {
  return `delivery-delegation:${taskId}:v1`;
}

/** The narrow task view the delegation decision needs — no store leakage. */
export interface DelegatableTask {
  readonly taskId: string;
  readonly orderId: string;
  readonly state: DeliveryTaskState;
  readonly dispatchJobRef: string | null;
}

/** The mutable companion the in-memory fake keeps (production code reads only). */
export interface MutableDelegatableTask extends DelegatableTask {
  state: DeliveryTaskState;
  dispatchJobRef: string | null;
}

/** Schema truth (delivery_tasks CHECK): a job ref is 1..128 chars, or null. */
export function isJobRefShapeValid(jobRef: string): boolean {
  return jobRef.length >= 1 && jobRef.length <= 128;
}
