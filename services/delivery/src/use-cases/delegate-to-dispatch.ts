/**
 * delegateToDispatch — the delegation wire use case (ADR-026 §2.4, review 4/N).
 *
 * Orchestration, in an order the §4.6-2 invariant forces:
 *
 *   1. read the task — an already-bound task is an idempotent replay (the
 *      wire's job is done, whatever coarse state the mirror has reached
 *      since), an unknown task is DELIVERY_TASK_NOT_FOUND, and a task that is
 *      not `eligible` is DELIVERY_TRANSITION_NOT_ALLOWED. No external call
 *      happens before these local checks;
 *   2. ask dispatch for a job — DETERMINISTIC idempotency key (per task), so
 *      a crash between "dispatch created the job" and "delivery bound it"
 *      heals on retry: the same key returns the same job, never a second
 *      one. A requester failure is DELIVERY_DISPATCH_UNAVAILABLE and leaves
 *      ZERO local state — the task stays `eligible` and the caller retries;
 *   3. bind atomically — one transaction writes the ref, moves
 *      eligible→dispatch_requested, appends the ledger row (actor `system`,
 *      reason `dispatch_delegated`) and the `delivery.dispatch_requested`
 *      outbox event. A racing or retried caller that finds the SAME ref
 *      already bound gets `already_delegated`, not an error.
 *
 * What this use case does NOT guarantee (measured honestly): end-to-end
 * "no dispatch outcome can precede the bind". That depends on the future
 * ORD-/WS- bridge and the real adapter (deferred, risk-recorded). What it
 * DOES guarantee locally: the bind is atomic and retry-safe, and the
 * outbound command is idempotent per task — the two facts §4.6-2 needs from
 * the delivery side of the wire.
 */

import { DeliveryError } from "../domain/errors.js";
import {
  DELEGATION_SOURCE_STATE,
  DELEGATION_TARGET_STATE,
  deriveDelegationIdempotencyKey,
  isJobRefShapeValid,
} from "../domain/delegation.js";
import type {
  DelegationContext,
  DispatchJobRequestOutcome,
  DispatchJobRequester,
  TaskDelegationStore,
} from "../ports.js";

export interface DelegateToDispatchDeps {
  readonly requester: DispatchJobRequester;
  readonly store: TaskDelegationStore;
  /** Event-id source for the bind's outbox event (fresh per successful bind). */
  readonly ids: { uuid(): string };
  readonly clock: { now(): string };
}

export interface DelegateToDispatchInput {
  readonly taskId: string;
  readonly traceId?: string | null;
}

export type DelegateToDispatchResult =
  | { readonly outcome: "delegated"; readonly jobRef: string }
  | { readonly outcome: "already_delegated"; readonly jobRef: string };

export async function delegateToDispatch(
  deps: DelegateToDispatchDeps,
  input: DelegateToDispatchInput,
): Promise<DelegateToDispatchResult> {
  const traceId = input.traceId ?? null;

  // 1. Local checks first — no external call before they pass.
  const task = await deps.store.getTaskForDelegation(input.taskId);
  if (!task) {
    throw new DeliveryError(
      "DELIVERY_TASK_NOT_FOUND",
      `مهمّة التوصيل ${input.taskId} غير موجودة`,
      { traceId: traceId ?? undefined },
    );
  }
  if (task.dispatchJobRef !== null) {
    // Idempotent replay: the wire already ran. The task may have advanced
    // far past dispatch_requested via the mirror — that is the mirror's
    // business; the wire's business is done.
    return { outcome: "already_delegated", jobRef: task.dispatchJobRef };
  }
  if (task.state !== DELEGATION_SOURCE_STATE) {
    throw new DeliveryError(
      "DELIVERY_TRANSITION_NOT_ALLOWED",
      `التفويض يبدأ من ${DELEGATION_SOURCE_STATE} فقط — المهمّة في ${task.state}`,
      { traceId: traceId ?? undefined, details: { from: task.state, to: DELEGATION_TARGET_STATE } },
    );
  }

  // 2. The outbound command — deterministic key, crash-heal on retry.
  let outcome: DispatchJobRequestOutcome;
  try {
    outcome = await deps.requester.requestJob({
      taskId: task.taskId,
      orderId: task.orderId,
      idempotencyKey: deriveDelegationIdempotencyKey(task.taskId),
      traceId,
    });
  } catch (err) {
    // Zero local state changed — the task stays eligible; retry is the contract.
    // (The raw cause is logged by the caller; the contract error stays clean.)
    throw new DeliveryError(
      "DELIVERY_DISPATCH_UNAVAILABLE",
      "تعذّرَ تفويضُ dispatch — المهمّةُ تبقى في eligible ويُعادُ المحاولة",
      { traceId: traceId ?? undefined, details: { field: "dispatch_requester", actual: err instanceof Error ? err.message.slice(0, 64) : undefined } },
    );
  }
  if (!isJobRefShapeValid(outcome.jobRef)) {
    // The bridge returned garbage — treat as dependency failure, bind nothing.
    throw new DeliveryError(
      "DELIVERY_DISPATCH_UNAVAILABLE",
      "أعادَ جسرُ التفويضِ مرجعاً غيرَ صالحٍ للربط",
      { traceId: traceId ?? undefined, details: { field: "job_ref", expected: "1..128 chars", actual: JSON.stringify(outcome.jobRef).slice(0, 40) } },
    );
  }

  // 3. Atomic bind — one transaction, §4.6-2.
  const context: DelegationContext = {
    eventId: deps.ids.uuid(),
    occurredAt: deps.clock.now(),
    traceId,
  };
  const bind = await deps.store.bindDispatchJob(task.taskId, outcome.jobRef, context);
  return bind === "bound"
    ? { outcome: "delegated", jobRef: outcome.jobRef }
    : { outcome: "already_delegated", jobRef: outcome.jobRef };
}
