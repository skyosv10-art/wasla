/**
 * The tick — the only place where time moves.
 *
 * There is no background loop in this service, no `setTimeout`, no cron inside the
 * process. Every job, wave and offer stores the instant it becomes due, and a caller
 * (Phase 09) invokes this use case; it compares stored deadlines to one injected
 * clock reading and writes whatever has become true. That is why a restart cannot
 * lose a timeout: there was never anything in memory to lose.
 *
 * Order of work per job, from MATCHING_DISPATCH §6:
 *   1. offers whose deadline arrived → `timed_out`
 *   2. a wave whose offers are all resolved → `completed`, then the next wave if the
 *      budget allows
 *   3. the wave budget or the automatic window exhausted → `escalated_community`
 *   4. the escalation window expired → `exhausted`, and the order → `no_driver_found`
 *
 * Idempotence is structural, not counted: every step is guarded by the state it
 * reads, so calling the tick twice with the same clock reading performs the second
 * pass as a series of no-ops. There is no "last processed" cursor to get wrong.
 *
 * Failures are contained per job. A matching adapter that is down, or an order engine
 * that is unreachable, defers *that job* to the next tick and leaves its rows exactly
 * as they were; the other jobs still progress. And a job cannot be held forever by a
 * broken port, because `expires_at` is a stored ceiling: once it passes, the job stops
 * trying new waves and escalates to the community instead.
 */
import { computeOfferDeadline, isDue } from "../domain/deadlines.js";
import {
  escalatedEvent,
  jobExhaustedEvent,
  offerSentEvent,
  offerTimedOutEvent,
  waveOpenedEvent,
} from "../domain/events.js";
import { isDispatchError, matchingResultInvalid } from "../domain/errors.js";
import { orderTransitionKey, offerEngineKey } from "../domain/keys.js";
import type { DispatchJob, DispatchOffer, DispatchReasonCode, DispatchWave } from "../domain/model.js";
import { DRIVER_PUBLIC_ID_PATTERN } from "../domain/model.js";
import { isTerminalOfferStatus } from "../domain/state-machine.js";
import type { CandidateRequest, CandidateResult, DispatchDependencies } from "../ports.js";
import {
  OFFER_STATUS_TO_ASSIGNMENT_STATE,
  ORDER_REASON_ALL_CANDIDATES_DECLINED,
  ORDER_REASON_DRIVER_DECLINED,
  ORDER_REASON_OFFER_TIMED_OUT,
  ORDER_REASON_SEARCH_RESUMED,
  ORDER_STATUS_DRIVER_REJECTED,
  ORDER_STATUS_DRIVER_TIMEOUT,
  ORDER_STATUS_NO_DRIVER_FOUND,
  ORDER_STATUS_OFFERED,
  ORDER_STATUS_SEARCHING,
  classifyEngineResult,
} from "./order-engine.js";

export interface TickInput {
  readonly traceId?: string;
}

/**
 * What one tick did.
 *
 * The first five fields are the `TickResult` contract. `deferredJobs` is domain-only
 * and dropped by the mapper: it exists so a caller can alarm on "the tick keeps
 * deferring" instead of watching four counters stay at zero with no explanation.
 */
export interface TickOutcome {
  readonly tickAt: string;
  readonly timedOutOffers: number;
  readonly openedWaves: number;
  readonly escalatedJobs: number;
  readonly exhaustedJobs: number;
  readonly deferredJobs: number;
}

interface Counters {
  timedOutOffers: number;
  openedWaves: number;
  escalatedJobs: number;
  exhaustedJobs: number;
  deferredJobs: number;
}

/**
 * A safety bound on the per-job loop.
 *
 * A job may legitimately move several times in one tick — a zone with no drivers can
 * burn its whole wave budget and escalate immediately, which is the right answer when
 * there is nobody to wait for. The bound exists so a logic bug becomes a job that
 * stops progressing rather than a tick that never returns.
 */
const MAX_STEPS_PER_JOB = (maxWaves: number): number => maxWaves * 2 + 4;

export async function tick(deps: DispatchDependencies, input: TickInput = {}): Promise<TickOutcome> {
  const tickAt = deps.clock.now();
  const counters: Counters = {
    timedOutOffers: 0,
    openedWaves: 0,
    escalatedJobs: 0,
    exhaustedJobs: 0,
    deferredJobs: 0,
  };

  const jobs = await deps.jobs.listActive();
  for (const active of jobs) {
    let job: DispatchJob | null = active;
    let deferred = false;
    const limit = MAX_STEPS_PER_JOB(active.rules.maxWaves);
    for (let step = 0; step < limit; step += 1) {
      if (job === null) break;
      let moved: StepResult;
      try {
        moved = await advanceJob(deps, job, tickAt, counters, input.traceId);
      } catch (error) {
        // A domain error here is one job's problem: a matching answer that broke its
        // contract, or a race with a concurrent tick. Other jobs still get their turn,
        // and this job's stored deadlines are untouched.
        if (!isDispatchError(error)) throw error;
        moved = "deferred";
      }
      if (moved === "deferred") {
        deferred = true;
        break;
      }
      if (moved === "idle") break;
      job = await deps.jobs.find(job.id);
    }
    if (deferred) counters.deferredJobs += 1;
  }

  return {
    tickAt,
    timedOutOffers: counters.timedOutOffers,
    openedWaves: counters.openedWaves,
    escalatedJobs: counters.escalatedJobs,
    exhaustedJobs: counters.exhaustedJobs,
    deferredJobs: counters.deferredJobs,
  };
}

/** `moved` = something changed, run again. `idle` = nothing due. `deferred` = a port failed. */
type StepResult = "moved" | "idle" | "deferred";

/**
 * One state move, or none.
 *
 * Deliberately one move per call rather than a cascade inside a single function: the
 * caller re-reads the job from the repository between moves, so every step sees the
 * row as it actually is and not as an in-memory guess that a concurrent tick may have
 * already invalidated.
 */
async function advanceJob(
  deps: DispatchDependencies,
  job: DispatchJob,
  now: string,
  counters: Counters,
  traceId?: string,
): Promise<StepResult> {
  if (job.status === "assigned" || job.status === "exhausted" || job.status === "cancelled") {
    return "idle";
  }

  const timedOut = await timeOutDueOffers(deps, job, now, counters, traceId);
  if (timedOut !== "idle") return timedOut;

  const openWave = await deps.waves.findOpenForJob(job.id);
  if (openWave !== null) {
    const offers = await deps.offers.listForWave(openWave.id);
    const allResolved = offers.every((offer) => isTerminalOfferStatus(offer.status));
    if (!allResolved) return "idle";
    return await completeWave(deps, job, openWave, offers, now, traceId);
  }

  if (job.status === "escalated_community") {
    if (!isDue(job.escalationExpiresAt, now)) return "idle";
    return await exhaustJob(deps, job, now, counters, traceId);
  }

  const wavesUsed = await deps.waves.countForJob(job.id);
  // The automatic window is a ceiling on ADDITIONAL waves, never on the first one: we
  // do not hand an order to humans without having asked at least one machine wave,
  // even if the tick that should have asked was late.
  const budgetSpent = wavesUsed >= job.rules.maxWaves;
  const windowClosed = wavesUsed >= 1 && isDue(job.expiresAt, now);
  if (budgetSpent || windowClosed) {
    return await escalateJob(deps, job, now, counters, traceId);
  }
  return await openNextWave(deps, job, wavesUsed + 1, now, counters, traceId);
}

/** Step 1: offers whose stored deadline arrived. */
async function timeOutDueOffers(
  deps: DispatchDependencies,
  job: DispatchJob,
  now: string,
  counters: Counters,
  traceId?: string,
): Promise<StepResult> {
  const offers = await deps.offers.listForJob(job.id);
  const due = offers.filter((offer) => offer.status === "offered" && isDue(offer.expiresAt, now));
  if (due.length === 0) return "idle";

  for (const offer of due) {
    // The engine first: an assignment we believe is closed while the engine still
    // holds it open is the one state nobody can reconcile from the outside.
    if (offer.orderAssignmentId !== null) {
      const resolved = await deps.orders.resolveAssignment({
        orderId: job.orderId,
        assignmentId: offer.orderAssignmentId,
        state: OFFER_STATUS_TO_ASSIGNMENT_STATE.timed_out,
        reasonCode: ORDER_REASON_OFFER_TIMED_OUT,
        idempotencyKey: offerEngineKey(offer.id, "timeout"),
        traceId,
      });
      if (classifyEngineResult(resolved) === "deferred") return "deferred";
      // A rejection here means the engine already closed that assignment — which is
      // the outcome we wanted. Recording our own row is still correct.
    }
    await deps.offers.resolve(offer.id, {
      status: "timed_out",
      reasonCode: "OFFER_TIMED_OUT",
      respondedAt: null,
      resolvedAt: now,
    });
    await deps.outbox.append(
      offerTimedOutEvent(
        {
          job_id: job.id,
          offer_id: offer.id,
          driver_public_id: offer.driverPublicId,
          reason_code: "OFFER_TIMED_OUT",
          timed_out_at: now,
        },
        { eventId: deps.ids.uuid(), occurredAt: now, traceId },
      ),
    );
    counters.timedOutOffers += 1;
  }
  return "moved";
}

/** Step 2: a wave whose offers are all resolved. */
async function completeWave(
  deps: DispatchDependencies,
  job: DispatchJob,
  wave: DispatchWave,
  offers: readonly DispatchOffer[],
  now: string,
  traceId?: string,
): Promise<StepResult> {
  // Keyed by wave number, so wave 2's transitions are not swallowed as retries of
  // wave 1's — the engine would otherwise stop reflecting that anyone is still asked.
  const sequence = wave.waveNumber;
  if (offers.length > 0) {
    // Move the order out of `offered` through the transient status that names what
    // actually happened, then back to `searching`. A rejection is reported in
    // preference to a timeout: a driver who answered told us more than a silence did.
    const rejected = offers.some((offer) => offer.status === "rejected");
    const transient = rejected ? ORDER_STATUS_DRIVER_REJECTED : ORDER_STATUS_DRIVER_TIMEOUT;
    const transientReason = rejected ? ORDER_REASON_DRIVER_DECLINED : ORDER_REASON_OFFER_TIMED_OUT;
    const toTransient = await deps.orders.transitionOrder({
      orderId: job.orderId,
      to: transient,
      reasonCode: transientReason,
      idempotencyKey: orderTransitionKey(job.id, transient, sequence),
      traceId,
    });
    if (classifyEngineResult(toTransient) === "deferred") return "deferred";

    const toSearching = await deps.orders.transitionOrder({
      orderId: job.orderId,
      to: ORDER_STATUS_SEARCHING,
      reasonCode: ORDER_REASON_SEARCH_RESUMED,
      idempotencyKey: orderTransitionKey(job.id, ORDER_STATUS_SEARCHING, sequence),
      traceId,
    });
    if (classifyEngineResult(toSearching) === "deferred") return "deferred";
  }

  const reasonCode: DispatchReasonCode = offers.length === 0 ? "NO_DRIVER_AVAILABLE" : "WAVE_OFFERS_RESOLVED";
  await deps.waves.updateStatus(wave.id, "completed", reasonCode, now);
  return "moved";
}

/** Step 2b: open the next wave, after asking matching who is in it. */
async function openNextWave(
  deps: DispatchDependencies,
  job: DispatchJob,
  waveNumber: number,
  now: string,
  counters: Counters,
  traceId?: string,
): Promise<StepResult> {
  const excludedDriverPublicIds = await deps.offers.listOfferedDriverIds(job.id);
  const request: CandidateRequest = {
    zoneId: job.zoneId,
    serviceKind: job.orderType,
    vehicleClass: job.vehicleClass,
    limit: job.rules.waveSize,
    excludedDriverPublicIds,
  };
  // Matching is asked BEFORE the wave row exists. If it fails, there is no empty open
  // wave left behind — and an empty open wave would block the job forever, because the
  // partial unique index allows only one and nothing would ever close it.
  const result = await deps.matching.candidates(request);
  assertCandidateResult(result, request, traceId);

  // Computed before the wave is written, because the row stores it: the deadline is
  // one instant shared by the round and by every offer inside it.
  const expiresAt = computeOfferDeadline(now, job.rules);
  const wave = await deps.waves.insert({
    id: deps.ids.uuid(),
    jobId: job.id,
    waveNumber,
    openedAt: now,
    expiresAt,
  });
  counters.openedWaves += 1;
  // Written before the offers, not after: a job left in `pending` while offers are out
  // is a row that contradicts itself, and a deferral mid-wave would freeze it there.
  if (job.status === "pending") {
    await deps.jobs.updateStatus(job.id, "dispatching", null, now);
  }

  const sent: DispatchOffer[] = [];
  for (const candidate of result.candidates) {
    const offerId = deps.ids.uuid();
    // Register the assignment first: the offer row is our promise that a driver was
    // asked, and it must not exist before the engine agrees the driver may be asked.
    const registered = await deps.orders.registerOffer({
      orderId: job.orderId,
      driverPublicId: candidate.driverPublicId,
      idempotencyKey: offerEngineKey(offerId, "register"),
      traceId,
    });
    if (classifyEngineResult(registered) === "deferred") return "deferred";
    if (registered.outcome === "rejected") {
      // The engine refused this one driver — another order already holds them, or the
      // order left the assignable window. Skip the driver; the wave is still valid.
      continue;
    }
    const offer = await deps.offers.insert({
      id: offerId,
      jobId: job.id,
      waveId: wave.id,
      driverPublicId: candidate.driverPublicId,
      orderAssignmentId: registered.assignmentId ?? null,
      offeredAt: now,
      expiresAt,
    });
    sent.push(offer);
    await deps.outbox.append(
      offerSentEvent(
        {
          job_id: job.id,
          offer_id: offer.id,
          wave_id: wave.id,
          driver_public_id: offer.driverPublicId,
          expires_at: offer.expiresAt,
        },
        { eventId: deps.ids.uuid(), occurredAt: now, traceId },
      ),
    );
  }

  await deps.outbox.append(
    waveOpenedEvent(
      {
        job_id: job.id,
        wave_id: wave.id,
        wave_number: wave.waveNumber,
        offer_count: sent.length,
        // Read back from the stored row, so the instant a consumer receives is the
        // instant the database holds rather than a second copy of the same sum.
        expires_at: wave.expiresAt,
      },
      { eventId: deps.ids.uuid(), occurredAt: now, traceId },
    ),
  );

  if (sent.length > 0) {
    const offered = await deps.orders.transitionOrder({
      orderId: job.orderId,
      to: ORDER_STATUS_OFFERED,
      reasonCode: null,
      idempotencyKey: orderTransitionKey(job.id, ORDER_STATUS_OFFERED, waveNumber),
      traceId,
    });
    if (classifyEngineResult(offered) === "deferred") return "deferred";
  }

  return "moved";
}

/** Step 3: the automatic window is over; ask the community. */
async function escalateJob(
  deps: DispatchDependencies,
  job: DispatchJob,
  now: string,
  counters: Counters,
  traceId?: string,
): Promise<StepResult> {
  // The order stays `searching` on purpose: a human being asked is still a search, and
  // moving the order to a terminal status here would tell the customer we gave up
  // while we are in fact still trying.
  await deps.jobs.updateStatus(job.id, "escalated_community", "ALL_WAVES_EXHAUSTED", now);
  await deps.outbox.append(
    escalatedEvent(
      {
        job_id: job.id,
        order_public_id: job.orderPublicId,
        zone_id: job.zoneId,
        reason_code: "ALL_WAVES_EXHAUSTED",
        escalation_expires_at: job.escalationExpiresAt,
      },
      { eventId: deps.ids.uuid(), occurredAt: now, traceId },
    ),
  );
  counters.escalatedJobs += 1;
  return "moved";
}

/** Step 4: even the community did not answer in time. */
async function exhaustJob(
  deps: DispatchDependencies,
  job: DispatchJob,
  now: string,
  counters: Counters,
  traceId?: string,
): Promise<StepResult> {
  const transition = await deps.orders.transitionOrder({
    orderId: job.orderId,
    to: ORDER_STATUS_NO_DRIVER_FOUND,
    reasonCode: ORDER_REASON_ALL_CANDIDATES_DECLINED,
    idempotencyKey: orderTransitionKey(job.id, ORDER_STATUS_NO_DRIVER_FOUND, 0),
    traceId,
  });
  if (classifyEngineResult(transition) === "deferred") return "deferred";

  await deps.jobs.updateStatus(job.id, "exhausted", "NO_DRIVER_AVAILABLE", now);
  await deps.outbox.append(
    jobExhaustedEvent(
      {
        job_id: job.id,
        order_public_id: job.orderPublicId,
        reason_code: "NO_DRIVER_AVAILABLE",
        exhausted_at: now,
      },
      { eventId: deps.ids.uuid(), occurredAt: now, traceId },
    ),
  );
  counters.exhaustedJobs += 1;
  return "moved";
}

/**
 * Validate matching's answer against the request we made.
 *
 * An empty list is **valid** — it is how "nobody is available in this zone" arrives,
 * and it leads to escalation, not to an error. What is invalid is an answer that
 * cannot be acted on: a malformed driver id, the same driver twice, a driver we
 * explicitly excluded, more candidates than the wave size, or an empty list with no
 * reason code. Each of those would otherwise become a broken offer, and a driver who
 * already declined being asked again.
 */
export function assertCandidateResult(
  result: CandidateResult,
  request: CandidateRequest,
  traceId?: string,
): void {
  if (result.candidates.length > request.limit) {
    throw matchingResultInvalid(`at most ${request.limit} candidates`, traceId);
  }
  if (result.candidates.length === 0 && result.emptyReasonCode === null) {
    throw matchingResultInvalid("empty_reason_code when there are no candidates", traceId);
  }
  if (result.candidates.length > 0 && result.emptyReasonCode !== null) {
    throw matchingResultInvalid("empty_reason_code only when there are no candidates", traceId);
  }
  const seen = new Set<string>();
  const excluded = new Set(request.excludedDriverPublicIds);
  for (const candidate of result.candidates) {
    if (!DRIVER_PUBLIC_ID_PATTERN.test(candidate.driverPublicId)) {
      throw matchingResultInvalid("driver_public_id matching WS-##########", traceId);
    }
    if (seen.has(candidate.driverPublicId)) {
      throw matchingResultInvalid("distinct candidates", traceId);
    }
    if (excluded.has(candidate.driverPublicId)) {
      throw matchingResultInvalid("no excluded driver in the answer", traceId);
    }
    seen.add(candidate.driverPublicId);
  }
}
