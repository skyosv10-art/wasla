/**
 * Stop dispatching an order.
 *
 * Cancels the *dispatch job*, not the order. Dispatch does not own the order's
 * lifecycle (ADR-010), so it requests no order transition here: when the reason is
 * `ORDER_CANCELLED` the order engine has already moved on, and when it is
 * `DISPATCH_CANCELLED_BY_REQUESTER` the order may well continue by another route. A
 * cancel that also cancelled the order would make this endpoint a way to kill a
 * customer's order through a side door.
 *
 * Everything still open is closed with `JOB_CANCELLED`: the open offers first, then the
 * open wave, then the job. Bottom-up on purpose — a job marked cancelled above offers
 * that still read `offered` is a row set where the driver's app and the operator's
 * screen disagree about whether anyone is still being asked.
 */
import { jobCancelledEvent } from "../domain/events.js";
import { jobNotCancellable, jobNotFound } from "../domain/errors.js";
import { offerEngineKey } from "../domain/keys.js";
import type { DispatchJob } from "../domain/model.js";
import { isTerminalJobStatus } from "../domain/state-machine.js";
import {
  assertCancelReasonCode,
  assertIdempotencyKey,
  assertUuid,
  fingerprint,
} from "../domain/validation.js";
import type { DispatchDependencies } from "../ports.js";
import { classifyIdempotency } from "./idempotency.js";
import { OFFER_STATUS_TO_ASSIGNMENT_STATE, assertEngineApplied } from "./order-engine.js";

export interface CancelJobInput {
  readonly jobId: string;
  readonly reasonCode: string;
  readonly idempotencyKey: string;
  readonly traceId?: string;
}

export interface CancelJobResult {
  readonly job: DispatchJob;
  readonly cancelledOffers: number;
  readonly replayed: boolean;
}

export async function cancelDispatchJob(
  deps: DispatchDependencies,
  input: CancelJobInput,
): Promise<CancelJobResult> {
  const traceId = input.traceId;
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey, traceId);
  const jobId = assertUuid("job_id", input.jobId, traceId);
  const reasonCode = assertCancelReasonCode(input.reasonCode, traceId);
  const payloadFingerprint = fingerprint({ action: "cancel", jobId, reasonCode });

  const decision = await classifyIdempotency(
    deps.idempotency,
    idempotencyKey,
    payloadFingerprint,
    traceId,
  );

  const job = await deps.jobs.find(jobId);
  if (job === null) throw jobNotFound(traceId);
  if (decision === "replay") return { job, cancelledOffers: 0, replayed: true };
  if (isTerminalJobStatus(job.status)) throw jobNotCancellable(job.status, traceId);

  const now = deps.clock.now();
  const offers = await deps.offers.listForJob(job.id);
  let cancelledOffers = 0;
  for (const offer of offers) {
    if (offer.status !== "offered") continue;
    if (offer.orderAssignmentId !== null) {
      const resolved = await deps.orders.resolveAssignment({
        orderId: job.orderId,
        assignmentId: offer.orderAssignmentId,
        state: OFFER_STATUS_TO_ASSIGNMENT_STATE.cancelled,
        reasonCode: null,
        idempotencyKey: offerEngineKey(offer.id, "cancel"),
        traceId,
      });
      // An already-closed assignment is the state we wanted; only an unreachable engine
      // stops a cancellation, because leaving a live assignment behind would keep a
      // driver waiting for an order nobody is dispatching any more.
      if (resolved.outcome !== "rejected") assertEngineApplied(resolved, traceId);
    }
    await deps.offers.resolve(offer.id, {
      status: "cancelled",
      reasonCode: "JOB_CANCELLED",
      respondedAt: null,
      resolvedAt: now,
    });
    cancelledOffers += 1;
  }

  const openWave = await deps.waves.findOpenForJob(job.id);
  if (openWave !== null) {
    await deps.waves.updateStatus(openWave.id, "cancelled", "JOB_CANCELLED", now);
  }

  const cancelled = await deps.jobs.updateStatus(job.id, "cancelled", reasonCode, now);

  await deps.outbox.append(
    jobCancelledEvent(
      {
        job_id: cancelled.id,
        order_public_id: cancelled.orderPublicId,
        reason_code: reasonCode,
        cancelled_at: now,
      },
      { eventId: deps.ids.uuid(), occurredAt: now, traceId },
    ),
  );

  await deps.idempotency.remember(idempotencyKey, payloadFingerprint);

  return { job: cancelled, cancelledOffers, replayed: false };
}
