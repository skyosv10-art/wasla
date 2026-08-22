/**
 * A driver rejects an offer.
 *
 * Deliberately the smallest write in the service: it closes one offer and stops. It
 * does **not** complete the wave and it does **not** open the next one, even when it
 * was the last open offer of the wave. That work belongs to the tick, so that "what
 * opens a wave" has exactly one answer.
 *
 * The price is real and accepted: a fully-rejected wave sits idle until the next tick,
 * which costs the customer up to one tick interval. The alternative buys those seconds
 * by letting an HTTP request advance the dispatch timeline, and then two code paths
 * open waves — one of them under a driver's thumb, retried by a flaky mobile network.
 *
 * The reason code comes from a closed set of three. A free-text reason would end up in
 * an event, in analytics, and eventually in a report about a named driver.
 */
import { isDue } from "../domain/deadlines.js";
import { offerRejectedEvent } from "../domain/events.js";
import { jobNotFound, offerAlreadyResolved, offerNotFound } from "../domain/errors.js";
import { offerEngineKey } from "../domain/keys.js";
import type { DispatchJob, DispatchOffer } from "../domain/model.js";
import {
  assertDriverRejectionReasonCode,
  assertIdempotencyKey,
  assertUuid,
  fingerprint,
} from "../domain/validation.js";
import type { DispatchDependencies } from "../ports.js";
import { classifyIdempotency } from "./idempotency.js";
import {
  OFFER_STATUS_TO_ASSIGNMENT_STATE,
  ORDER_REASON_DRIVER_DECLINED,
  assertEngineApplied,
} from "./order-engine.js";

export interface RejectOfferInput {
  readonly offerId: string;
  readonly reasonCode: string;
  readonly idempotencyKey: string;
  readonly traceId?: string;
}

export interface RejectOfferResult {
  readonly offer: DispatchOffer;
  readonly job: DispatchJob;
  readonly replayed: boolean;
}

export async function rejectOffer(
  deps: DispatchDependencies,
  input: RejectOfferInput,
): Promise<RejectOfferResult> {
  const traceId = input.traceId;
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey, traceId);
  const offerId = assertUuid("offer_id", input.offerId, traceId);
  const reasonCode = assertDriverRejectionReasonCode(input.reasonCode, traceId);
  const payloadFingerprint = fingerprint({ action: "reject", offerId, reasonCode });

  const decision = await classifyIdempotency(
    deps.idempotency,
    idempotencyKey,
    payloadFingerprint,
    traceId,
  );

  const offer = await deps.offers.find(offerId);
  if (offer === null) throw offerNotFound(traceId);
  const job = await deps.jobs.find(offer.jobId);
  if (job === null) throw jobNotFound(traceId);
  if (decision === "replay") return { offer, job, replayed: true };

  if (offer.status !== "offered") throw offerAlreadyResolved(offer.status, traceId);
  const now = deps.clock.now();
  // Same rule as acceptance: past the stored deadline the answer is no longer the
  // driver's to give. Refusing both keeps one explanation for "why was my tap ignored".
  if (isDue(offer.expiresAt, now)) throw offerAlreadyResolved("timed_out", traceId);

  if (offer.orderAssignmentId !== null) {
    const resolved = await deps.orders.resolveAssignment({
      orderId: job.orderId,
      assignmentId: offer.orderAssignmentId,
      state: OFFER_STATUS_TO_ASSIGNMENT_STATE.rejected,
      reasonCode: ORDER_REASON_DRIVER_DECLINED,
      idempotencyKey: offerEngineKey(offer.id, "reject"),
      traceId,
    });
    // A refusal from the engine here means that assignment is already closed, which is
    // exactly the state we were asking for; only an unreachable engine is an error.
    if (resolved.outcome !== "rejected") assertEngineApplied(resolved, traceId);
  }

  const rejected = await deps.offers.resolve(offer.id, {
    status: "rejected",
    reasonCode,
    respondedAt: now,
    resolvedAt: now,
  });

  await deps.outbox.append(
    offerRejectedEvent(
      {
        job_id: job.id,
        offer_id: rejected.id,
        driver_public_id: rejected.driverPublicId,
        reason_code: reasonCode,
        rejected_at: now,
      },
      { eventId: deps.ids.uuid(), occurredAt: now, traceId },
    ),
  );

  await deps.idempotency.remember(idempotencyKey, payloadFingerprint);

  return { offer: rejected, job, replayed: false };
}
