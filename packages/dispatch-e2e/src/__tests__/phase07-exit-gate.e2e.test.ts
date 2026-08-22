/**
 * Phase 07 Exit Gate — Matching & Dispatch MVP.
 *
 * One question: **«can a real order find a real driver — offer by offer, wave by
 * wave — across six independent services over real HTTP, and never reach a state any
 * of their published tables forbids?»**
 *
 * Four scenarios, each one an end that must be reachable and provable:
 *
 *   1. **A driver is found.** intake → job → wave 1 → the driver rejects → wave 2
 *      excludes them → the next driver accepts → the order is `accepted` and bound to
 *      that driver, and matching's availability projection says `busy`.
 *   2. **A driver goes silent.** The offer's deadline is crossed by moving the injected
 *      clock, the tick times it out, and the next wave opens without a sleep anywhere.
 *   3. **Nobody is available.** The wave budget is spent, the job escalates to the
 *      community with the order still `searching`, and only after the escalation window
 *      does the job become `exhausted` and the order `no_driver_found`.
 *   4. **Two drivers, one order.** With a wave of two, the winner is `accepted` and the
 *      loser is `superseded` — never `rejected`, because they never said no.
 *
 * The suite asserts through public HTTP only: dispatch's own routes, matching's
 * candidacy routes, and the engine's order and history reads. Nothing reaches into a
 * store, because a gate that reads the database it is verifying can pass while the API
 * that everyone actually uses is broken.
 *
 * What this file does NOT prove, by declaration: the customer store's atomicity
 * (Phase 04's gate) and the order engine's transition sweep (Phase 06's gate). Both
 * run in memory here on purpose — see `harness.ts` and
 * docs/12-testing/PHASE07_EXIT_GATE_E2E.md.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  callDispatch,
  createJob,
  openOffers,
  orderStatus,
  orderStatusTrail,
  placeOrder,
  readCandidacy,
  readJob,
  readOffers,
  readOrder,
  seedDriver,
  startGate,
  tick,
  type GateContext,
} from "../harness.js";

/** Two drivers, identical on every filter, so ranking may pick either. */
const DRIVER_ONE = "WS-0700000001";
const DRIVER_TWO = "WS-0700000002";

describe("Phase 07 exit gate · dispatch finds a driver over real HTTP", () => {
  let gate: GateContext;

  afterEach(async () => {
    await gate?.close();
  });

  it("يقود الطلب من التسليم إلى القبول: موجة، رفض، موجة تستثني الرافض، ثم قبول", async () => {
    gate = await startGate();
    await seedDriver(gate, DRIVER_ONE);
    await seedDriver(gate, DRIVER_TWO);

    // --- the order exists because a customer asked for it --------------------
    const order = await placeOrder(gate);
    expect(await orderStatus(gate, order)).toBe("published");

    // --- the job: created `pending`, and the engine agrees to search ---------
    const job = await createJob(gate, order);
    expect(job.status).toBe("pending");
    // create-job moved the order itself: a job that exists for an order the engine
    // will not search for would be a promise nobody can keep.
    expect(await orderStatus(gate, order)).toBe("searching");
    const jobId = job.id as string;

    // --- wave 1: only a tick opens it ---------------------------------------
    const first = await tick(gate);
    expect(first.status).toBe(200);
    expect(first.body.opened_waves).toBe(1);
    expect((await readJob(gate, jobId)).status).toBe("dispatching");

    const waveOne = await openOffers(gate, jobId);
    expect(waveOne).toHaveLength(1);
    const rejecter = waveOne[0].driver_public_id as string;
    expect([DRIVER_ONE, DRIVER_TWO]).toContain(rejecter);
    // The offer is out, so the engine says so too.
    expect(await orderStatus(gate, order)).toBe("offered");

    // --- the driver says no --------------------------------------------------
    const rejected = await callDispatch(gate, {
      method: "POST",
      path: `/dispatch/offers/${waveOne[0].id as string}/reject`,
      idempotencyKey: "gate-reject-000001",
      body: { reason_code: "DRIVER_DECLINED" },
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe("rejected");
    // A rejection closes one offer and nothing else: the next wave is the tick's job,
    // so a driver tapping «no» can never open a wave from inside a request.
    expect(await openOffers(gate, jobId)).toHaveLength(0);

    // --- wave 2: the rejecter is excluded, by matching, not by us ------------
    const second = await tick(gate);
    expect(second.body.opened_waves).toBe(1);
    const waveTwo = await openOffers(gate, jobId);
    expect(waveTwo).toHaveLength(1);
    const winner = waveTwo[0].driver_public_id as string;
    expect(winner).not.toBe(rejecter);

    // The order went back to the search and out again — the engine's own audit.
    const trail = await orderStatusTrail(gate, order);
    expect(trail).toEqual([
      "published",
      "searching",
      "offered",
      "driver_rejected",
      "searching",
      "offered",
    ]);

    // --- the winner accepts --------------------------------------------------
    const accepted = await callDispatch(gate, {
      method: "POST",
      path: `/dispatch/offers/${waveTwo[0].id as string}/accept`,
      idempotencyKey: "gate-accept-000001",
      body: {},
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe("accepted");

    // --- the three services now agree on one driver -------------------------
    expect((await readJob(gate, jobId)).status).toBe("assigned");
    const finalOrder = await readOrder(gate, order);
    expect(finalOrder.status).toBe("accepted");
    // The engine bound the driver from its own assignment log, not from a request.
    expect((finalOrder.active_assignment as Record<string, unknown>).driver_public_id).toBe(winner);
    // Matching's projection was refreshed, so the winner stops being a candidate.
    expect((await readCandidacy(gate, winner)).availability_state).toBe("busy");
    // The rejecter was not punished with unavailability: they said no to one order.
    expect((await readCandidacy(gate, rejecter)).availability_state).toBe("available");

    // --- the trail dispatch published ---------------------------------------
    // `offer_sent` precedes `wave_opened` on purpose: the wave event carries
    // `offer_count`, so it is only truthful once every offer in the wave exists. A
    // consumer therefore learns of the offers first and of the round they belong to
    // immediately after — never a wave announcing a count it does not yet have.
    const events = (await gate.dispatchEvents()).map((event) => event.event_type);
    expect(events).toEqual([
      "dispatch.job_created",
      "dispatch.offer_sent",
      "dispatch.wave_opened",
      "dispatch.offer_rejected",
      "dispatch.offer_sent",
      "dispatch.wave_opened",
      "dispatch.offer_accepted",
    ]);

    // --- the tick is observable ---------------------------------------------
    const health = await callDispatch(gate, { method: "GET", path: "/health" });
    expect(health.status).toBe(200);
    expect(health.body.last_tick_at).toBe(gate.clock.now());
  });

  it("يُنهي عرضاً صامتاً بانقضاء المهلة عبر ساعة مُحقونة، بلا انتظار حقيقي", async () => {
    gate = await startGate();
    await seedDriver(gate, DRIVER_ONE);
    await seedDriver(gate, DRIVER_TWO);
    const order = await placeOrder(gate);
    const jobId = (await createJob(gate, order)).id as string;

    await tick(gate);
    const silent = (await openOffers(gate, jobId))[0];
    const silentDriver = silent.driver_public_id as string;

    // Before the deadline nothing is due: a tick is not a timer.
    gate.clock.advanceSeconds(29);
    const early = await tick(gate);
    expect(early.body.timed_out_offers).toBe(0);
    expect(early.body.opened_waves).toBe(0);
    expect((await openOffers(gate, jobId))[0].id).toBe(silent.id);

    // One second past it, the same call resolves the offer and opens the next wave.
    gate.clock.advanceSeconds(2);
    const late = await tick(gate);
    expect(late.body.timed_out_offers).toBe(1);
    expect(late.body.opened_waves).toBe(1);

    const offers = await readOffers(gate, jobId);
    const timedOut = offers.find((offer) => offer.id === silent.id);
    expect(timedOut?.status).toBe("timed_out");
    // Nobody answered, so `responded_at` stays null: silence is not an answer.
    expect(timedOut?.responded_at).toBeNull();

    const live = await openOffers(gate, jobId);
    expect(live).toHaveLength(1);
    expect(live[0].driver_public_id).not.toBe(silentDriver);

    // The engine recorded the timeout as its own status, then went back to searching.
    expect(await orderStatusTrail(gate, order)).toEqual([
      "published",
      "searching",
      "offered",
      "driver_timeout",
      "searching",
      "offered",
    ]);

    // A deadline that has passed is refused even before a tick marks it — but this one
    // is already resolved, so the driver is told exactly that.
    const tooLate = await callDispatch(gate, {
      method: "POST",
      path: `/dispatch/offers/${silent.id as string}/accept`,
      idempotencyKey: "gate-late-000001",
      body: {},
    });
    expect(tooLate.status).toBe(409);
    expect(tooLate.body.code).toBe("DISPATCH_OFFER_ALREADY_RESOLVED");
  });

  it("يُصعِّد إلى المجتمع بلا مرشّحين ثم يُعلن النفاد بعد نافذة التصعيد", async () => {
    gate = await startGate();
    // No candidacy rows at all: matching answers with an empty set and a reason.
    const order = await placeOrder(gate);
    const job = await createJob(gate, order);
    const jobId = job.id as string;

    // One tick spends the whole budget: three empty waves, then escalation. The loop
    // does not stop at one wave because nothing is pending — an empty wave is resolved
    // the moment it opens, and a job that could progress must progress in this tick.
    const escalation = await tick(gate);
    expect(escalation.body.opened_waves).toBe(3);
    expect(escalation.body.escalated_jobs).toBe(1);
    expect(escalation.body.exhausted_jobs).toBe(0);

    const escalated = await readJob(gate, jobId);
    expect(escalated.status).toBe("escalated_community");
    expect(escalated.status_reason_code).toBe("ALL_WAVES_EXHAUSTED");
    // Escalation is not failure: the order is still being searched for, by people now.
    expect(await orderStatus(gate, order)).toBe("searching");
    expect(await openOffers(gate, jobId)).toHaveLength(0);

    // The window is stored, not scheduled: `expires_at` is the whole wave budget
    // (3 × 30s) and `escalation_expires_at` is that ceiling plus 120s, so the job is
    // due at exactly +210s from creation. Asserted from the row rather than from a
    // number written twice.
    expect(escalated.expires_at).toBe("2026-08-22T09:01:30.000Z");
    expect(escalated.escalation_expires_at).toBe("2026-08-22T09:03:30.000Z");

    // One second before it, nothing happens no matter how often the tick runs.
    gate.clock.advanceSeconds(209);
    expect((await tick(gate)).body.exhausted_jobs).toBe(0);
    expect((await readJob(gate, jobId)).status).toBe("escalated_community");

    // On it — a deadline that has exactly arrived has arrived — the search ends, and
    // the order learns why.
    gate.clock.advanceSeconds(1);
    const exhausted = await tick(gate);
    expect(exhausted.body.exhausted_jobs).toBe(1);

    const dead = await readJob(gate, jobId);
    expect(dead.status).toBe("exhausted");
    expect(dead.status_reason_code).toBe("NO_DRIVER_AVAILABLE");
    expect(await orderStatus(gate, order)).toBe("no_driver_found");
    expect(await orderStatusTrail(gate, order)).toEqual([
      "published",
      "searching",
      "no_driver_found",
    ]);

    const events = (await gate.dispatchEvents()).map((event) => event.event_type);
    expect(events).toEqual([
      "dispatch.job_created",
      "dispatch.wave_opened",
      "dispatch.wave_opened",
      "dispatch.wave_opened",
      "dispatch.escalated",
      "dispatch.job_exhausted",
    ]);
  });

  it("موجة بعرضين: يفوز واحد ويُغلق الآخر superseded لا rejected", async () => {
    gate = await startGate({ rules: { waveSize: 2 } });
    await seedDriver(gate, DRIVER_ONE);
    await seedDriver(gate, DRIVER_TWO);
    const order = await placeOrder(gate);
    const jobId = (await createJob(gate, order)).id as string;

    await tick(gate);
    const offers = await openOffers(gate, jobId);
    expect(offers).toHaveLength(2);

    const accepted = await callDispatch(gate, {
      method: "POST",
      path: `/dispatch/offers/${offers[0].id as string}/accept`,
      idempotencyKey: "gate-race-000001",
      body: {},
    });
    expect(accepted.status).toBe(200);

    const settled = await readOffers(gate, jobId);
    const winner = settled.find((offer) => offer.id === offers[0].id);
    const loser = settled.find((offer) => offer.id === offers[1].id);
    expect(winner?.status).toBe("accepted");
    expect(winner?.reason_code).toBe("OFFER_ACCEPTED");
    // The loser never said no, and an acceptance-rate report must never read this as one.
    expect(loser?.status).toBe("superseded");
    expect(loser?.reason_code).toBe("OFFER_SUPERSEDED");
    expect(loser?.responded_at).toBeNull();

    expect((await readJob(gate, jobId)).status).toBe("assigned");
    expect(await orderStatus(gate, order)).toBe("accepted");

    // Nine events are declared and none of them is «offer superseded»: the loser is
    // closed with a reason code, not with an event nobody contracted for.
    const events = (await gate.dispatchEvents()).map((event) => event.event_type);
    expect(events.filter((type) => type === "dispatch.offer_sent")).toHaveLength(2);
    expect(events.filter((type) => type === "dispatch.offer_accepted")).toHaveLength(1);
    expect(events).not.toContain("dispatch.offer_rejected");
  });
});

describe("Phase 07 exit gate · the run is unambiguous about what it proved", () => {
  let gate: GateContext;

  beforeEach(async () => {
    gate = await startGate();
  });

  afterEach(async () => {
    await gate.close();
  });

  it("يُصرِّح بمخزنه: /health يقول postgres عند رفع البوابة و memory دونه", async () => {
    for (const url of [gate.matchingUrl, gate.dispatchUrl]) {
      const health = await fetch(`${url}/health`);
      expect(health.status).toBe(200);
      const body = (await health.json()) as Record<string, unknown>;
      // A service that lost its rows on restart must not read `ok`, and a run that
      // cannot say which store it used proves nothing about either.
      expect(body.persistence).toBe(gate.persistence);
      expect(body.status).toBe(gate.persistence === "postgres" ? "ok" : "degraded");
    }
  });
});
