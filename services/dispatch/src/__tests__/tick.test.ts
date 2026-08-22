/**
 * The tick.
 *
 * The most important suite in the MR: this is the only component that moves time, so
 * every timeout, every wave and every escalation in production is one of these paths.
 * The tests drive a hand-moved clock, which is why they can assert what happens at
 * exactly a deadline instead of "usually".
 */
import { describe, expect, it } from "vitest";

import { isDispatchError } from "../domain/errors.js";
import { createDispatchJob } from "../use-cases/create-job.js";
import { tick } from "../use-cases/tick.js";
import { ZONE_ID, createHarness, driverId, orderRef, type Harness } from "./harness.js";

const POOL = [driverId(1), driverId(2), driverId(3), driverId(4), driverId(5), driverId(6)];

async function seed(harness: Harness, index = 1): Promise<string> {
  const ref = orderRef(index);
  harness.orders.seedOrder(ref.orderId);
  const { job } = await createDispatchJob(harness.deps, {
    orderId: ref.orderId,
    orderPublicId: ref.orderPublicId,
    zoneId: ZONE_ID,
    orderType: "ride",
    vehicleClass: "sedan",
    idempotencyKey: `create-key-${index}0000`,
  });
  return job.id;
}

async function statusesOf(harness: Harness, jobId: string): Promise<string[]> {
  const offers = await harness.offers.listForJob(jobId);
  return offers.map((offer) => offer.status);
}

describe("tick — opening the first wave", () => {
  it("opens wave 1 with the snapshot wave size and moves the job to dispatching", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const jobId = await seed(harness);

    const result = await tick(harness.deps);

    expect(result.openedWaves).toBe(1);
    expect(result.timedOutOffers).toBe(0);
    expect((await harness.jobs.find(jobId))?.status).toBe("dispatching");
    const offers = await harness.offers.listForJob(jobId);
    expect(offers).toHaveLength(2);
    expect(offers.every((offer) => offer.status === "offered")).toBe(true);
    expect(offers[0].expiresAt).toBe("2026-01-01T00:00:30.000Z");
  });

  it("tells the order engine the order is now offered", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const ref = orderRef(1);
    await seed(harness);
    await tick(harness.deps);
    expect(harness.orders.statusOf(ref.orderId)).toBe("offered");
  });

  it("registers an assignment for every offer before writing the offer row", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const jobId = await seed(harness);
    await tick(harness.deps);

    const offers = await harness.offers.listForJob(jobId);
    // An offer row is our promise that a driver was asked; it must not exist unless the
    // engine agreed the driver may be asked.
    expect(offers.every((offer) => offer.orderAssignmentId !== null)).toBe(true);
    expect(harness.orders.calls.filter((call) => call.kind === "register")).toHaveLength(2);
  });

  it("does nothing on a second tick at the same instant", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const jobId = await seed(harness);
    await tick(harness.deps);
    const before = await statusesOf(harness, jobId);

    const second = await tick(harness.deps);

    // Idempotence is structural: every step is guarded by the state it reads, so there
    // is no cursor to get wrong and no double-offering to prevent.
    expect(second).toMatchObject({
      openedWaves: 0,
      timedOutOffers: 0,
      escalatedJobs: 0,
      exhaustedJobs: 0,
      deferredJobs: 0,
    });
    expect(await statusesOf(harness, jobId)).toEqual(before);
    expect(await harness.waves.countForJob(jobId)).toBe(1);
  });

  it("asks matching only for the wave size, excluding nobody on the first wave", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    await seed(harness);
    await tick(harness.deps);
    expect(harness.matching.requests[0]).toMatchObject({
      zoneId: ZONE_ID,
      serviceKind: "ride",
      vehicleClass: "sedan",
      limit: 2,
      excludedDriverPublicIds: [],
    });
  });
});

describe("tick — offer deadlines", () => {
  it("leaves an offer alive one millisecond before its deadline", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const jobId = await seed(harness);
    await tick(harness.deps);

    harness.clock.set("2026-01-01T00:00:29.999Z");
    const result = await tick(harness.deps);

    expect(result.timedOutOffers).toBe(0);
    expect(await statusesOf(harness, jobId)).toEqual(["offered", "offered"]);
  });

  it("times an offer out at exactly its deadline", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const jobId = await seed(harness);
    await tick(harness.deps);

    harness.clock.set("2026-01-01T00:00:30.000Z");
    const result = await tick(harness.deps);

    expect(result.timedOutOffers).toBe(2);
    const offers = await harness.offers.listForJob(jobId);
    const timedOut = offers.filter((offer) => offer.status === "timed_out");
    expect(timedOut).toHaveLength(2);
    // The schema's timestamp matrix: nobody answered, so `responded_at` stays null and
    // "how many drivers actually answered" remains a countable number.
    expect(timedOut.every((offer) => offer.respondedAt === null)).toBe(true);
    expect(timedOut.every((offer) => offer.resolvedAt === "2026-01-01T00:00:30.000Z")).toBe(true);
    expect(timedOut.every((offer) => offer.reasonCode === "OFFER_TIMED_OUT")).toBe(true);
  });

  it("completes the exhausted wave and opens the next one in the same tick", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const jobId = await seed(harness);
    await tick(harness.deps);
    harness.clock.set("2026-01-01T00:00:30.000Z");

    const result = await tick(harness.deps);

    expect(result.openedWaves).toBe(1);
    const waves = await harness.waves.listForJob(jobId);
    expect(waves.map((wave) => wave.status)).toEqual(["completed", "open"]);
    expect(waves[0].reasonCode).toBe("WAVE_OFFERS_RESOLVED");
    expect(waves[0].completedAt).toBe("2026-01-01T00:00:30.000Z");
    expect(waves[1].completedAt).toBeNull();
  });

  it("never re-offers a driver who already had an offer for this job", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const jobId = await seed(harness);
    await tick(harness.deps);
    const firstWave = (await harness.offers.listForJob(jobId)).map((offer) => offer.driverPublicId);

    harness.clock.set("2026-01-01T00:00:30.000Z");
    await tick(harness.deps);

    expect(harness.matching.requests[1].excludedDriverPublicIds).toEqual(firstWave);
    const all = (await harness.offers.listForJob(jobId)).map((offer) => offer.driverPublicId);
    // ux_dispatch_offers_job_driver, from the driver's point of view: being asked again
    // about the ride you just declined is the fastest way to lose a driver's trust.
    expect(new Set(all).size).toBe(all.length);
  });

  it("moves the order through the transient status that names what happened", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const ref = orderRef(1);
    await seed(harness);
    await tick(harness.deps);
    harness.clock.set("2026-01-01T00:00:30.000Z");
    await tick(harness.deps);

    const transitions = harness.orders.calls
      .filter((call) => call.kind === "transition")
      .map((call) => call.detail);
    // searching (create) → offered (wave 1) → driver_timeout → searching → offered (wave 2)
    expect(transitions).toEqual(["searching", "offered", "driver_timeout", "searching", "offered"]);
    expect(harness.orders.statusOf(ref.orderId)).toBe("offered");
  });

  it("keeps at most one open wave at any moment", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const jobId = await seed(harness);
    for (let minute = 0; minute < 4; minute += 1) {
      await tick(harness.deps);
      harness.clock.advanceSeconds(30);
      const waves = await harness.waves.listForJob(jobId);
      expect(waves.filter((wave) => wave.status === "open").length).toBeLessThanOrEqual(1);
    }
  });
});

describe("tick — escalation and exhaustion", () => {
  it("escalates after the wave budget is spent, and not before", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const jobId = await seed(harness);

    for (let wave = 0; wave < 3; wave += 1) {
      await tick(harness.deps);
      expect((await harness.jobs.find(jobId))?.status).toBe("dispatching");
      harness.clock.advanceSeconds(30);
    }
    const result = await tick(harness.deps);

    expect(result.escalatedJobs).toBe(1);
    const job = await harness.jobs.find(jobId);
    expect(job?.status).toBe("escalated_community");
    expect(job?.statusReasonCode).toBe("ALL_WAVES_EXHAUSTED");
    expect(await harness.waves.countForJob(jobId)).toBe(3);
    expect(await harness.offers.listForJob(jobId)).toHaveLength(6);
  });

  it("keeps the order searching while the community is asked", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const ref = orderRef(1);
    const jobId = await seed(harness);
    for (let wave = 0; wave < 4; wave += 1) {
      await tick(harness.deps);
      harness.clock.advanceSeconds(30);
    }
    expect((await harness.jobs.find(jobId))?.status).toBe("escalated_community");
    // A human being asked is still a search. A terminal order status here would tell the
    // customer we gave up while we are in fact still trying.
    expect(harness.orders.statusOf(ref.orderId)).toBe("searching");
  });

  it("escalates immediately when the zone is empty, burning the budget in one tick", async () => {
    const harness = createHarness();
    harness.matching.setPool([]);
    const jobId = await seed(harness);

    const result = await tick(harness.deps);

    // An empty answer is valid, not an error — and waiting 30s per empty wave would keep
    // a customer watching a spinner for something that cannot happen.
    expect(result.openedWaves).toBe(3);
    expect(result.escalatedJobs).toBe(1);
    expect((await harness.jobs.find(jobId))?.status).toBe("escalated_community");
    const waves = await harness.waves.listForJob(jobId);
    expect(waves.map((wave) => wave.reasonCode)).toEqual([
      "NO_DRIVER_AVAILABLE",
      "NO_DRIVER_AVAILABLE",
      "NO_DRIVER_AVAILABLE",
    ]);
    expect(await harness.offers.listForJob(jobId)).toHaveLength(0);
  });

  it("exhausts the job when the escalation window expires", async () => {
    const harness = createHarness();
    harness.matching.setPool([]);
    const ref = orderRef(1);
    const jobId = await seed(harness);
    await tick(harness.deps);

    harness.clock.set("2026-01-01T00:03:29.999Z");
    expect((await tick(harness.deps)).exhaustedJobs).toBe(0);

    harness.clock.set("2026-01-01T00:03:30.000Z");
    const result = await tick(harness.deps);

    expect(result.exhaustedJobs).toBe(1);
    const job = await harness.jobs.find(jobId);
    expect(job?.status).toBe("exhausted");
    expect(job?.statusReasonCode).toBe("NO_DRIVER_AVAILABLE");
    expect(harness.orders.statusOf(ref.orderId)).toBe("no_driver_found");
  });

  it("stops looking at a job once it is terminal", async () => {
    const harness = createHarness();
    harness.matching.setPool([]);
    await seed(harness);
    await tick(harness.deps);
    harness.clock.set("2026-01-01T00:03:30.000Z");
    await tick(harness.deps);
    const callsBefore = harness.orders.calls.length;

    const result = await tick(harness.deps);

    expect(result).toMatchObject({ openedWaves: 0, escalatedJobs: 0, exhaustedJobs: 0 });
    expect(harness.orders.calls).toHaveLength(callsBefore);
  });

  it("escalates instead of opening a late wave once the automatic window has closed", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const jobId = await seed(harness);
    await tick(harness.deps);

    // The tick caller was down for 90 seconds. The stored ceiling is what stops us from
    // starting a fresh 30-second wave long after the customer stopped watching.
    harness.clock.set("2026-01-01T00:02:00.000Z");
    const result = await tick(harness.deps);

    expect(result.timedOutOffers).toBe(2);
    expect(result.openedWaves).toBe(0);
    expect(result.escalatedJobs).toBe(1);
    expect((await harness.jobs.find(jobId))?.status).toBe("escalated_community");
    expect(await harness.waves.countForJob(jobId)).toBe(1);
  });

  it("collapses the whole lifecycle in one tick after a long outage", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const jobId = await seed(harness);
    await tick(harness.deps);

    // Both stored deadlines are in the past by now (90s and 210s). Escalating and then
    // exhausting in a single tick is the honest reading: the customer's whole waiting
    // budget was spent while nothing was running, and pretending otherwise would put a
    // job back in front of community drivers minutes after the customer gave up.
    harness.clock.set("2026-01-01T00:05:00.000Z");
    const result = await tick(harness.deps);

    expect(result.escalatedJobs).toBe(1);
    expect(result.exhaustedJobs).toBe(1);
    expect((await harness.jobs.find(jobId))?.status).toBe("exhausted");
  });

  it("still asks one machine wave when the window closed before any wave opened", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const jobId = await seed(harness);

    harness.clock.set("2026-01-01T00:02:00.000Z");
    const result = await tick(harness.deps);

    // `pending → escalated_community` does not exist in the table, and this is why: we do
    // not hand an order to humans without having asked a single machine wave. The cost is
    // that a very late first wave runs past the stored ceiling by one offer timeout —
    // accepted, and recorded in DISPATCH_CORE_DOMAIN §9.
    expect(result.openedWaves).toBe(1);
    expect(result.escalatedJobs).toBe(0);
    expect(await harness.offers.listForJob(jobId)).toHaveLength(2);

    harness.clock.set("2026-01-01T00:02:30.000Z");
    const next = await tick(harness.deps);
    expect(next.timedOutOffers).toBe(2);
    expect(next.escalatedJobs).toBe(1);
    expect(await harness.waves.countForJob(jobId)).toBe(1);
  });
});

describe("tick — failure containment", () => {
  it("defers a job whose candidate lookup failed, leaving its rows untouched", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const jobId = await seed(harness);
    harness.matching.failWith("unavailable");

    const result = await tick(harness.deps);

    expect(result.deferredJobs).toBe(1);
    expect(result.openedWaves).toBe(0);
    // Matching is asked BEFORE the wave row is inserted, so a failure leaves no empty
    // open wave — which the partial unique index would make permanent.
    expect(await harness.waves.countForJob(jobId)).toBe(0);
    expect((await harness.jobs.find(jobId))?.status).toBe("pending");

    const recovered = await tick(harness.deps);
    expect(recovered.openedWaves).toBe(1);
    expect(recovered.deferredJobs).toBe(0);
  });

  it("defers a job whose candidate answer broke its contract", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const jobId = await seed(harness);
    harness.matching.enqueueRaw({
      decisionId: "decision-x",
      rulesetVersion: 1,
      evaluatedAt: "2026-01-01T00:00:00.000Z",
      // Three candidates for a wave size of two: acting on it would offer the order to
      // more drivers than the ruleset allows.
      candidates: [
        { driverPublicId: driverId(1), rank: 1 },
        { driverPublicId: driverId(2), rank: 2 },
        { driverPublicId: driverId(3), rank: 3 },
      ],
      emptyReasonCode: null,
    });

    const result = await tick(harness.deps);

    expect(result.deferredJobs).toBe(1);
    expect(await harness.waves.countForJob(jobId)).toBe(0);
  });

  it("defers a job whose engine is unreachable mid-wave, then recovers", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const jobId = await seed(harness);
    harness.orders.failNext("unavailable");

    const result = await tick(harness.deps);

    expect(result.deferredJobs).toBe(1);
    // The wave row already exists: it is inserted before the offers so that a job is
    // never left in `pending` while offers are out. The declared cost is a wave that can
    // be smaller than the wave size — recorded in DISPATCH_CORE_DOMAIN §9.
    expect(await harness.waves.countForJob(jobId)).toBe(1);
    expect(await harness.offers.listForJob(jobId)).toHaveLength(0);
    expect((await harness.jobs.find(jobId))?.status).toBe("dispatching");

    const recovered = await tick(harness.deps);
    expect(recovered.deferredJobs).toBe(0);
    expect((await harness.waves.listForJob(jobId))[0].status).toBe("completed");
  });

  it("keeps one broken job from stopping the others", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const broken = await seed(harness, 1);
    const healthy = await seed(harness, 2);
    harness.matching.failWith("unavailable");

    const result = await tick(harness.deps);

    expect(result.deferredJobs).toBe(1);
    expect(result.openedWaves).toBe(1);
    expect(await harness.waves.countForJob(broken)).toBe(0);
    expect(await harness.waves.countForJob(healthy)).toBe(1);
  });

  it("does not swallow a genuine bug", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    await seed(harness);
    harness.matching.failHard();

    // Deferring a `TypeError` would hide a broken deploy behind a counter nobody reads.
    await expect(tick(harness.deps)).rejects.toBeInstanceOf(TypeError);
  });

  it("skips a driver the engine refuses without failing the wave", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const jobId = await seed(harness);
    harness.orders.forbidDriver(driverId(1));

    const result = await tick(harness.deps);

    expect(result.openedWaves).toBe(1);
    const offers = await harness.offers.listForJob(jobId);
    expect(offers.map((offer) => offer.driverPublicId)).toEqual([driverId(2)]);
  });

  it("reports engine failures as DispatchErrors, never as raw errors", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    await seed(harness);
    harness.matching.failWith("timeout");
    const result = await tick(harness.deps);
    expect(result.deferredJobs).toBe(1);
    // Sanity: the fake really did throw a domain error, which is the adapter contract.
    harness.matching.failWith("timeout");
    await expect(
      harness.deps.matching.candidates({
        zoneId: ZONE_ID,
        serviceKind: "ride",
        vehicleClass: "sedan",
        limit: 1,
        excludedDriverPublicIds: [],
      }),
    ).rejects.toSatisfy(isDispatchError);
  });
});
