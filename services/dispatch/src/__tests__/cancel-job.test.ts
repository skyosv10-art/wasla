/**
 * Cancelling a dispatch job, and reading one back.
 *
 * The load-bearing assertion in this file is a negative one: cancelling dispatch must not
 * cancel the order. Dispatch does not own the order's lifecycle (ADR-010), and an endpoint
 * that killed the customer's order as a side effect would be a side door into it.
 */
import { describe, expect, it } from "vitest";

import { isDispatchError } from "../domain/errors.js";
import { acceptOffer } from "../use-cases/accept-offer.js";
import { cancelDispatchJob } from "../use-cases/cancel-job.js";
import { createDispatchJob } from "../use-cases/create-job.js";
import { listDispatchOffers, readDispatchJob } from "../use-cases/read-job.js";
import { tick } from "../use-cases/tick.js";
import { ZONE_ID, createHarness, driverId, orderRef, type Harness } from "./harness.js";

const POOL = [driverId(1), driverId(2), driverId(3), driverId(4)];

async function seed(harness: Harness, index = 1): Promise<{ jobId: string; orderId: string }> {
  const ref = orderRef(index);
  harness.orders.seedOrder(ref.orderId);
  const { job } = await createDispatchJob(harness.deps, {
    orderId: ref.orderId,
    orderPublicId: ref.orderPublicId,
    zoneId: ZONE_ID,
    orderType: "ride",
    vehicleClass: "sedan",
    idempotencyKey: `create-key-000${index}`,
  });
  return { jobId: job.id, orderId: ref.orderId };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (isDispatchError(error)) return error.code;
    throw error;
  }
  throw new Error("expected a DispatchError, but the call succeeded");
}

describe("cancelDispatchJob", () => {
  it("cancels a job that has not been dispatched yet", async () => {
    const harness = createHarness();
    const { jobId } = await seed(harness);

    const result = await cancelDispatchJob(harness.deps, {
      jobId,
      reasonCode: "DISPATCH_CANCELLED_BY_REQUESTER",
      idempotencyKey: "cancel-key-0001",
    });

    expect(result.job.status).toBe("cancelled");
    expect(result.job.statusReasonCode).toBe("DISPATCH_CANCELLED_BY_REQUESTER");
    // A terminal job always carries a reason; the schema's check constraint says so, and
    // the in-memory store enforces it by the same name.
    expect(result.job.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.cancelledOffers).toBe(0);
  });

  it("keeps the requester's reason instead of flattening it", async () => {
    const harness = createHarness();
    const { jobId } = await seed(harness);
    const { job } = await cancelDispatchJob(harness.deps, {
      jobId,
      reasonCode: "ORDER_CANCELLED",
      idempotencyKey: "cancel-key-0001",
    });
    // "The customer cancelled" and "an operator stopped dispatching" are different
    // stories, and only the stored code can still tell them apart a week later.
    expect(job.statusReasonCode).toBe("ORDER_CANCELLED");
  });

  it("closes the open offers and the open wave, bottom-up", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const { jobId } = await seed(harness);
    await tick(harness.deps);

    const result = await cancelDispatchJob(harness.deps, {
      jobId,
      reasonCode: "DISPATCH_CANCELLED_BY_REQUESTER",
      idempotencyKey: "cancel-key-0001",
    });

    expect(result.cancelledOffers).toBe(2);
    const offers = await harness.offers.listForJob(jobId);
    expect(offers.map((offer) => offer.status)).toEqual(["cancelled", "cancelled"]);
    expect(offers.every((offer) => offer.reasonCode === "JOB_CANCELLED")).toBe(true);
    // Nobody answered, so `responded_at` stays null even though the offer is closed.
    expect(offers.every((offer) => offer.respondedAt === null)).toBe(true);

    const waves = await harness.waves.listForJob(jobId);
    expect(waves[0].status).toBe("cancelled");
    expect(waves[0].reasonCode).toBe("JOB_CANCELLED");
  });

  it("releases the drivers' assignments in the order engine", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const { jobId } = await seed(harness);
    await tick(harness.deps);
    const offers = await harness.offers.listForJob(jobId);

    await cancelDispatchJob(harness.deps, {
      jobId,
      reasonCode: "DISPATCH_CANCELLED_BY_REQUESTER",
      idempotencyKey: "cancel-key-0001",
    });

    // A live assignment left behind is a driver's app still counting down on an order
    // nobody is dispatching any more.
    for (const offer of offers) {
      expect(harness.orders.assignmentState(offer.orderAssignmentId ?? "")).toBe("cancelled");
    }
  });

  it("does not touch the order's status", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const { jobId, orderId } = await seed(harness);
    await tick(harness.deps);
    const before = harness.orders.statusOf(orderId);

    await cancelDispatchJob(harness.deps, {
      jobId,
      reasonCode: "DISPATCH_CANCELLED_BY_REQUESTER",
      idempotencyKey: "cancel-key-0001",
    });

    // ADR-010: the order engine owns the order. The order may well continue by another
    // route, and cancelling it here would be dispatch overreaching into a decision that
    // belongs to the customer and to `orders`.
    expect(harness.orders.statusOf(orderId)).toBe(before);
    const transitions = harness.orders.calls.filter((call) => call.kind === "transition");
    expect(transitions.map((call) => call.detail)).not.toContain("customer_cancelled");
  });

  it("emits exactly one job_cancelled event", async () => {
    const harness = createHarness();
    const { jobId } = await seed(harness);
    const before = (await harness.outbox.unread()).length;
    await cancelDispatchJob(harness.deps, {
      jobId,
      reasonCode: "ORDER_CANCELLED",
      idempotencyKey: "cancel-key-0001",
    });
    const emitted = (await harness.outbox.unread()).slice(before);
    // Cancelling a wave and cancelling offers have no events of their own in
    // `events.json`; the job-level event is the whole story a subscriber needs.
    expect(emitted).toHaveLength(1);
    expect(emitted[0].event_type).toBe("dispatch.job_cancelled");
  });

  it("replays a retry and keeps one event", async () => {
    const harness = createHarness();
    const { jobId } = await seed(harness);
    await cancelDispatchJob(harness.deps, {
      jobId,
      reasonCode: "ORDER_CANCELLED",
      idempotencyKey: "cancel-key-0001",
    });
    const second = await cancelDispatchJob(harness.deps, {
      jobId,
      reasonCode: "ORDER_CANCELLED",
      idempotencyKey: "cancel-key-0001",
    });

    // Without this, a retried cancellation would raise JOB_NOT_CANCELLABLE and a caller
    // whose first request timed out would be told its own success was an error.
    expect(second.replayed).toBe(true);
    expect(second.job.status).toBe("cancelled");
    expect(
      (await harness.outbox.unread()).filter((event) => event.event_type === "dispatch.job_cancelled"),
    ).toHaveLength(1);
  });

  it("refuses a job that is already finished", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const { jobId } = await seed(harness);
    await tick(harness.deps);
    const offers = await harness.offers.listForJob(jobId);
    await acceptOffer(harness.deps, { offerId: offers[0].id, idempotencyKey: "accept-key-0001" });

    expect(
      await codeOf(
        cancelDispatchJob(harness.deps, {
          jobId,
          reasonCode: "DISPATCH_CANCELLED_BY_REQUESTER",
          idempotencyKey: "cancel-key-0001",
        }),
      ),
    ).toBe("DISPATCH_JOB_NOT_CANCELLABLE");
  });

  it("refuses the codes that are not a requester's to send", async () => {
    const harness = createHarness();
    const { jobId } = await seed(harness);
    for (const reasonCode of ["DRIVER_DECLINED", "OFFER_ACCEPTED", "NOT_A_CODE"]) {
      expect(
        await codeOf(
          cancelDispatchJob(harness.deps, { jobId, reasonCode, idempotencyKey: "cancel-key-0001" }),
        ),
      ).toBe("DISPATCH_REASON_CODE_UNKNOWN");
    }
  });

  it("refuses an unknown job", async () => {
    const harness = createHarness();
    expect(
      await codeOf(
        cancelDispatchJob(harness.deps, {
          jobId: "00000000-0000-4000-8000-999999999999",
          reasonCode: "ORDER_CANCELLED",
          idempotencyKey: "cancel-key-0001",
        }),
      ),
    ).toBe("DISPATCH_JOB_NOT_FOUND");
  });

  it("leaves everything open when the engine is unreachable", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const { jobId } = await seed(harness);
    await tick(harness.deps);
    harness.orders.failNext("timeout");

    expect(
      await codeOf(
        cancelDispatchJob(harness.deps, {
          jobId,
          reasonCode: "ORDER_CANCELLED",
          idempotencyKey: "cancel-key-0001",
        }),
      ),
    ).toBe("DISPATCH_ORDER_ENGINE_TIMEOUT");

    // A half-cancelled job is worse than an uncancelled one, so the retry with the same
    // key finds the job exactly as it was.
    const job = await harness.jobs.find(jobId);
    expect(job?.status).toBe("dispatching");
    const offers = await harness.offers.listForJob(jobId);
    expect(offers.every((offer) => offer.status === "offered")).toBe(true);
  });
});

describe("reads", () => {
  it("returns the job as stored, and mutates nothing", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const { jobId } = await seed(harness);
    await tick(harness.deps);
    // Past every offer deadline: the read must still not resolve anything, or the
    // counters in TickResult would depend on how often somebody opened a screen.
    harness.clock.set("2026-01-01T00:00:45.000Z");

    const job = await readDispatchJob(harness.deps, { jobId });

    expect(job.id).toBe(jobId);
    expect(job.status).toBe("dispatching");
    const offers = await harness.offers.listForJob(jobId);
    expect(offers.every((offer) => offer.status === "offered")).toBe(true);
    expect(harness.orders.calls.filter((call) => call.kind === "resolve")).toHaveLength(0);
  });

  it("lists the offers oldest-first across waves", async () => {
    const harness = createHarness();
    harness.matching.setPool(POOL);
    const { jobId } = await seed(harness);
    await tick(harness.deps);
    harness.clock.set("2026-01-01T00:00:30.000Z");
    await tick(harness.deps);

    const offers = await listDispatchOffers(harness.deps, { jobId });

    expect(offers).toHaveLength(4);
    // Wave order visible without the client sorting by a timestamp it may format
    // differently.
    expect(offers.map((offer) => offer.offeredAt)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:30.000Z",
      "2026-01-01T00:00:30.000Z",
    ]);
  });

  it("refuses an unknown job instead of returning an empty list", async () => {
    const harness = createHarness();
    expect(
      await codeOf(readDispatchJob(harness.deps, { jobId: "00000000-0000-4000-8000-999999999999" })),
    ).toBe("DISPATCH_JOB_NOT_FOUND");
    // "no offers yet" and "no such job" are different facts; a client that cannot tell
    // them apart retries forever against a typo.
    expect(
      await codeOf(
        listDispatchOffers(harness.deps, { jobId: "00000000-0000-4000-8000-999999999999" }),
      ),
    ).toBe("DISPATCH_JOB_NOT_FOUND");
    expect(await codeOf(listDispatchOffers(harness.deps, { jobId: "not-a-uuid" }))).toBe(
      "DISPATCH_VALIDATION_FAILED",
    );
  });
});
