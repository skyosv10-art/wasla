/**
 * A driver accepts an offer.
 *
 * The only path in this service where a *person* is waiting for the answer, which
 * decides three things about it:
 *
 * 1. It does not wait for a tick. An acceptance is a decision, not a deadline, so the
 *    job becomes `assigned` in this call.
 * 2. The order engine is called before we write. If the engine refuses, this driver did
 *    not win, and an offer marked `accepted` locally while the engine holds someone
 *    else's assignment is the one inconsistency nobody can repair from the outside.
 * 3. A race is decided by the engine, not by an `if`. Two drivers tapping accept in
 *    the same millisecond both reach the engine; the engine refuses the second with
 *    `ORDER_ASSIGNMENT_FORBIDDEN`, and that refusal is how the loser learns they lost
 *    — closed as `superseded`, never as "rejected", because they never said no.
 *
 * Engine call order: the assignment first, then the order's own status. This is the
 * order the engine's own contract dictates, and it is the opposite of what this file
 * did until the Phase 07 exit gate ran it against the real engine (MR 6/6).
 *
 * `offered → accepted` is a driver-bound status, so `transitionOrder` refuses it with
 * `ORDER_ASSIGNMENT_REQUIRED` unless an **accepted** record already exists in the
 * order's assignment log: the engine reads the winning driver from that log and binds
 * it in the SAME UPDATE that moves the status, because `ck_orders_assignment_matches_status`
 * forbids an `offered` order that already carries an active assignment (ADR-010 §4 and
 * §7). Resolving the assignment first is therefore not an optimisation — it is the only
 * sequence the engine accepts. Asking for the status first made every acceptance fail
 * with `DISPATCH_ORDER_ENGINE_REJECTED`; the in-memory fake accepted it because it
 * modelled the transition table but not the assignment coupling, so the fake was taught
 * the rule in the same MR.
 *
 * Resolving the assignment first also puts the authoritative race decision before any
 * write of ours: the loser is refused with `ORDER_ASSIGNMENT_FORBIDDEN` while nothing
 * local has moved. The declared cost is the reverse window — an accepted record whose
 * status move then fails (engine down, or the order left `offered` meanwhile). The offer
 * stays `offered` and the tick keeps owning the job, so no driver is told they won; the
 * stale accepted record is written down as a debt in
 * docs/12-testing/PHASE07_EXIT_GATE_E2E.md rather than hidden here.
 *
 * An offer whose stored deadline has passed is refused even if no tick has marked it
 * `timed_out` yet. The alternative — honouring it — would make the answer depend on
 * whether a background caller happened to run, and by then the next wave may already
 * be open. The cost is that the row still reads `offered` until the next tick; the
 * deadline is in every representation of the offer, so both sides can already see
 * which side of it we are on.
 */
import { isDue } from "../domain/deadlines.js";
import { offerAcceptedEvent } from "../domain/events.js";
import {
  jobNotDispatchable,
  jobNotFound,
  offerAlreadyResolved,
  offerNotFound,
  offerSuperseded,
} from "../domain/errors.js";
import { offerEngineKey, orderTransitionKey } from "../domain/keys.js";
import type { DispatchJob, DispatchOffer } from "../domain/model.js";
import { assertIdempotencyKey, assertUuid, fingerprint } from "../domain/validation.js";
import type { DispatchDependencies } from "../ports.js";
import { classifyIdempotency } from "./idempotency.js";
import {
  OFFER_STATUS_TO_ASSIGNMENT_STATE,
  ORDER_STATUS_ACCEPTED,
  assertEngineApplied,
  isRaceRejection,
} from "./order-engine.js";

export interface AcceptOfferInput {
  readonly offerId: string;
  readonly idempotencyKey: string;
  readonly traceId?: string;
}

export interface AcceptOfferResult {
  readonly offer: DispatchOffer;
  readonly job: DispatchJob;
  /**
   * Whether matching's availability projection was refreshed.
   *
   * Reported rather than thrown: a driver who accepted must not be told the
   * acceptance failed because a projection was slow. Reported rather than swallowed:
   * a silent best-effort call is one nobody ever notices has been failing for a week.
   */
  readonly availabilitySynced: boolean;
  readonly replayed: boolean;
}

export async function acceptOffer(
  deps: DispatchDependencies,
  input: AcceptOfferInput,
): Promise<AcceptOfferResult> {
  const traceId = input.traceId;
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey, traceId);
  const offerId = assertUuid("offer_id", input.offerId, traceId);
  const payloadFingerprint = fingerprint({ action: "accept", offerId });

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

  if (decision === "replay") {
    return { offer, job, availabilitySynced: true, replayed: true };
  }

  if (offer.status !== "offered") throw offerAlreadyResolved(offer.status, traceId);
  // A job that is no longer looking for a driver cannot gain one. Checked explicitly so
  // the caller gets a 422 that names the job's status, instead of a repository error
  // about an illegal transition.
  if (job.status !== "dispatching" && job.status !== "escalated_community") {
    throw jobNotDispatchable(job.status, traceId);
  }
  const now = deps.clock.now();
  if (isDue(offer.expiresAt, now)) throw offerAlreadyResolved("timed_out", traceId);

  // The race is decided here, before anything of ours has moved.
  if (offer.orderAssignmentId !== null) {
    const resolved = await deps.orders.resolveAssignment({
      orderId: job.orderId,
      assignmentId: offer.orderAssignmentId,
      state: OFFER_STATUS_TO_ASSIGNMENT_STATE.accepted,
      reasonCode: null,
      idempotencyKey: offerEngineKey(offer.id, "accept"),
      traceId,
    });
    if (isRaceRejection(resolved)) {
      // Another driver already holds this order. Close this offer honestly and tell the
      // app it was superseded — not "rejected", which would follow the driver into
      // every acceptance-rate report they are later judged by.
      await deps.offers.resolve(offer.id, {
        status: "superseded",
        reasonCode: "OFFER_SUPERSEDED",
        respondedAt: null,
        resolvedAt: now,
      });
      throw offerSuperseded(traceId);
    }
    assertEngineApplied(resolved, traceId);
  }

  // Now the status can move: the engine has an accepted record to bind.
  const transition = await deps.orders.transitionOrder({
    orderId: job.orderId,
    to: ORDER_STATUS_ACCEPTED,
    reasonCode: null,
    idempotencyKey: orderTransitionKey(job.id, ORDER_STATUS_ACCEPTED, 0),
    traceId,
  });
  // Still nothing of ours has been mutated, so a refusal here leaves the offer `offered`
  // and the tick owning the job's progress.
  assertEngineApplied(transition, traceId);

  // The unique-accepted-per-job index is the real guard; this call raises
  // DISPATCH_OFFER_SUPERSEDED when it fires, so a race lost inside our own store reads
  // exactly like a race lost inside the engine.
  const accepted = await deps.offers.resolve(offer.id, {
    status: "accepted",
    reasonCode: "OFFER_ACCEPTED",
    respondedAt: now,
    resolvedAt: now,
  });

  // Siblings of the same wave lose. They are closed with a reason code and no event:
  // `events.json` declares nine events and none of them is "offer superseded", and
  // inventing a tenth here would break the very contract the drift guard protects.
  const siblings = await deps.offers.listForWave(offer.waveId);
  for (const sibling of siblings) {
    if (sibling.id === offer.id || sibling.status !== "offered") continue;
    if (sibling.orderAssignmentId !== null) {
      await deps.orders.resolveAssignment({
        orderId: job.orderId,
        assignmentId: sibling.orderAssignmentId,
        state: OFFER_STATUS_TO_ASSIGNMENT_STATE.superseded,
        reasonCode: null,
        idempotencyKey: offerEngineKey(sibling.id, "supersede"),
        traceId,
      });
    }
    await deps.offers.resolve(sibling.id, {
      status: "superseded",
      reasonCode: "OFFER_SUPERSEDED",
      respondedAt: null,
      resolvedAt: now,
    });
  }

  await deps.waves.updateStatus(offer.waveId, "completed", "OFFER_ACCEPTED", now);
  const assigned = await deps.jobs.updateStatus(job.id, "assigned", "OFFER_ACCEPTED", now);

  await deps.outbox.append(
    offerAcceptedEvent(
      {
        job_id: job.id,
        offer_id: accepted.id,
        driver_public_id: accepted.driverPublicId,
        reason_code: "OFFER_ACCEPTED",
        accepted_at: now,
      },
      { eventId: deps.ids.uuid(), occurredAt: now, traceId },
    ),
  );

  let availabilitySynced = true;
  try {
    await deps.matching.markUnavailable(accepted.driverPublicId, "OFFER_ACCEPTED", now);
  } catch {
    // Left stale on purpose. Matching's freshness filter is fail-closed, so a row that
    // stops being refreshed drops out of evaluations instead of producing a phantom
    // candidate — the failure degrades toward not offering, never toward double-booking.
    availabilitySynced = false;
  }

  await deps.idempotency.remember(idempotencyKey, payloadFingerprint);

  return { offer: accepted, job: assigned, availabilitySynced, replayed: false };
}
