/**
 * Accepting an offer.
 *
 * The only path where a person is waiting for the answer, and the only one that can be
 * lost to a race. Both halves are tested: the winner's rows, and — more importantly —
 * the loser's, because "how the losing driver is recorded" is the difference between a
 * fair acceptance-rate report and an unfair one.
 */
import { describe, expect, it } from "vitest";

import { isDispatchError } from "../domain/errors.js";
import { acceptOffer } from "../use-cases/accept-offer.js";
import { createDispatchJob } from "../use-cases/create-job.js";
import { tick } from "../use-cases/tick.js";
import { ZONE_ID, createHarness, driverId, orderRef, type Harness } from "./harness.js";

const POOL = [driverId(1), driverId(2), driverId(3), driverId(4)];

interface Ready {
  readonly harness: Harness;
  readonly jobId: string;
  readonly orderId: string;
  readonly offerIds: readonly string[];
}

/** A job with wave 1 open and two live offers — the state every accept starts from. */
async function ready(): Promise<Ready> {
  const harness = createHarness();
  harness.matching.setPool(POOL);
  const ref = orderRef(1);
  harness.orders.seedOrder(ref.orderId);
  const { job } = await createDispatchJob(harness.deps, {
    orderId: ref.orderId,
    orderPublicId: ref.orderPublicId,
    zoneId: ZONE_ID,
    orderType: "ride",
    vehicleClass: "sedan",
    idempotencyKey: "create-key-0001",
  });
  await tick(harness.deps);
  const offers = await harness.offers.listForJob(job.id);
  return { harness, jobId: job.id, orderId: ref.orderId, offerIds: offers.map((offer) => offer.id) };
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

describe("acceptOffer — the winner", () => {
  it("assigns the job without waiting for a tick", async () => {
    const { harness, jobId, offerIds } = await ready();

    const result = await acceptOffer(harness.deps, {
      offerId: offerIds[0],
      idempotencyKey: "accept-key-0001",
    });

    expect(result.offer.status).toBe("accepted");
    expect(result.offer.reasonCode).toBe("OFFER_ACCEPTED");
    // An acceptance is a decision, not a deadline: making the driver wait for a
    // background caller would mean they have accepted a ride the app does not show.
    expect(result.job.status).toBe("assigned");
    expect(result.job.statusReasonCode).toBe("OFFER_ACCEPTED");
    expect((await harness.jobs.find(jobId))?.status).toBe("assigned");
  });

  it("records both timestamps, because a person answered", async () => {
    const { harness, offerIds } = await ready();
    const { offer } = await acceptOffer(harness.deps, {
      offerId: offerIds[0],
      idempotencyKey: "accept-key-0001",
    });
    expect(offer.respondedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(offer.resolvedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("closes the wave and supersedes the siblings", async () => {
    const { harness, jobId, offerIds } = await ready();
    await acceptOffer(harness.deps, { offerId: offerIds[0], idempotencyKey: "accept-key-0001" });

    const offers = await harness.offers.listForJob(jobId);
    const sibling = offers.find((offer) => offer.id === offerIds[1]);
    expect(sibling?.status).toBe("superseded");
    expect(sibling?.reasonCode).toBe("OFFER_SUPERSEDED");
    // Nobody asked them anything, so `responded_at` stays null.
    expect(sibling?.respondedAt).toBeNull();

    const waves = await harness.waves.listForJob(jobId);
    expect(waves[0].status).toBe("completed");
    expect(waves[0].reasonCode).toBe("OFFER_ACCEPTED");
  });

  it("tells the order engine before writing anything of its own", async () => {
    const { harness, orderId, offerIds } = await ready();
    await acceptOffer(harness.deps, { offerId: offerIds[0], idempotencyKey: "accept-key-0001" });

    expect(harness.orders.statusOf(orderId)).toBe("accepted");
    const kinds = harness.orders.calls.map((call) => `${call.kind}:${call.detail}`);
    // The order's status first (idempotent), then the assignment (the race decision).
    expect(kinds).toContain("transition:accepted");
    expect(kinds).toContain("resolve:accepted");
    expect(kinds.indexOf("transition:accepted")).toBeLessThan(kinds.indexOf("resolve:accepted"));
  });

  it("cancels the siblings' assignments in the engine too", async () => {
    const { harness, offerIds } = await ready();
    const sibling = await harness.offers.find(offerIds[1]);
    await acceptOffer(harness.deps, { offerId: offerIds[0], idempotencyKey: "accept-key-0001" });
    // A live assignment left behind would keep the losing driver's app counting down on a
    // ride somebody else is already driving.
    expect(harness.orders.assignmentState(sibling?.orderAssignmentId ?? "")).toBe("cancelled");
  });

  it("emits offer_accepted and no event for the supersession", async () => {
    const { harness, offerIds } = await ready();
    const before = (await harness.outbox.unread()).length;
    await acceptOffer(harness.deps, { offerId: offerIds[0], idempotencyKey: "accept-key-0001" });

    const emitted = (await harness.outbox.unread()).slice(before);
    // `events.json` declares nine events, and none of them is "offer superseded".
    // Inventing a tenth here would break the contract the drift guard protects.
    expect(emitted).toHaveLength(1);
    expect(emitted[0].event_type).toBe("dispatch.offer_accepted");
  });

  it("refreshes the driver's availability in matching", async () => {
    const { harness, offerIds } = await ready();
    const accepted = await harness.offers.find(offerIds[0]);
    const result = await acceptOffer(harness.deps, {
      offerId: offerIds[0],
      idempotencyKey: "accept-key-0001",
    });
    expect(result.availabilitySynced).toBe(true);
    expect(harness.matching.unavailable).toEqual([accepted?.driverPublicId]);
  });

  it("still accepts when the availability refresh fails, and says so", async () => {
    const { harness, offerIds } = await ready();
    harness.matching.breakAvailability();

    const result = await acceptOffer(harness.deps, {
      offerId: offerIds[0],
      idempotencyKey: "accept-key-0001",
    });

    // A driver who accepted must not be told it failed because a projection was slow —
    // and the failure must not vanish either.
    expect(result.offer.status).toBe("accepted");
    expect(result.availabilitySynced).toBe(false);
  });

  it("replays a retry with the same key", async () => {
    const { harness, offerIds } = await ready();
    const first = await acceptOffer(harness.deps, {
      offerId: offerIds[0],
      idempotencyKey: "accept-key-0001",
    });
    const second = await acceptOffer(harness.deps, {
      offerId: offerIds[0],
      idempotencyKey: "accept-key-0001",
    });
    expect(second.replayed).toBe(true);
    expect(second.offer.status).toBe(first.offer.status);
    expect(
      (await harness.outbox.unread()).filter((event) => event.event_type === "dispatch.offer_accepted"),
    ).toHaveLength(1);
  });
});

describe("acceptOffer — the loser", () => {
  it("supersedes an offer the engine refuses, and never calls it rejected", async () => {
    const { harness, jobId, orderId, offerIds } = await ready();
    const winner = await harness.offers.find(offerIds[1]);
    // The other driver's request reached the engine first, before either request had
    // written a local row — the exact interleaving a database transaction cannot prevent.
    await harness.deps.orders.resolveAssignment({
      orderId,
      assignmentId: winner?.orderAssignmentId ?? "",
      state: "accepted",
      reasonCode: null,
      idempotencyKey: "out-of-band-accept",
    });

    expect(
      await codeOf(
        acceptOffer(harness.deps, { offerId: offerIds[0], idempotencyKey: "accept-key-0001" }),
      ),
    ).toBe("DISPATCH_OFFER_SUPERSEDED");

    const offer = await harness.offers.find(offerIds[0]);
    // Not `rejected`: this driver never said no, and "declined" would follow them into
    // every acceptance-rate report they are judged by.
    expect(offer?.status).toBe("superseded");
    expect(offer?.reasonCode).toBe("OFFER_SUPERSEDED");
    expect(offer?.respondedAt).toBeNull();
    // The job is not ours to assign — the winner's own request does that.
    expect((await harness.jobs.find(jobId))?.status).toBe("dispatching");
  });

  it("refuses a second acceptance for the same job", async () => {
    const { harness, offerIds } = await ready();
    await acceptOffer(harness.deps, { offerId: offerIds[0], idempotencyKey: "accept-key-0001" });
    expect(
      await codeOf(
        acceptOffer(harness.deps, { offerId: offerIds[1], idempotencyKey: "accept-key-0002" }),
      ),
    ).toBe("DISPATCH_OFFER_ALREADY_RESOLVED");
  });
});

describe("acceptOffer — refusals", () => {
  it("refuses an offer whose deadline has passed, without mutating it", async () => {
    const { harness, offerIds } = await ready();
    harness.clock.set("2026-01-01T00:00:30.000Z");

    expect(
      await codeOf(
        acceptOffer(harness.deps, { offerId: offerIds[0], idempotencyKey: "accept-key-0001" }),
      ),
    ).toBe("DISPATCH_OFFER_ALREADY_RESOLVED");

    // The tick stays the single writer of `timed_out`; the row reads `offered` until it
    // runs, and the deadline is in every representation of the offer.
    const offer = await harness.offers.find(offerIds[0]);
    expect(offer?.status).toBe("offered");
    expect(offer?.resolvedAt).toBeNull();
  });

  it("refuses an offer that no longer exists", async () => {
    const { harness } = await ready();
    expect(
      await codeOf(
        acceptOffer(harness.deps, {
          offerId: "00000000-0000-4000-8000-999999999999",
          idempotencyKey: "accept-key-0001",
        }),
      ),
    ).toBe("DISPATCH_OFFER_NOT_FOUND");
  });

  it("validates the offer id and the key before reading anything", async () => {
    const { harness } = await ready();
    expect(
      await codeOf(acceptOffer(harness.deps, { offerId: "nope", idempotencyKey: "accept-key-0001" })),
    ).toBe("DISPATCH_VALIDATION_FAILED");
    expect(
      await codeOf(acceptOffer(harness.deps, { offerId: "nope", idempotencyKey: "short" })),
    ).toBe("DISPATCH_VALIDATION_FAILED");
  });

  it("refuses when the engine will not move the order", async () => {
    const { harness, orderId, offerIds } = await ready();
    // The order left the offerable window entirely — cancelled by the customer, say.
    harness.orders.seedOrder(orderId, "customer_cancelled");

    expect(
      await codeOf(
        acceptOffer(harness.deps, { offerId: offerIds[0], idempotencyKey: "accept-key-0001" }),
      ),
    ).toBe("DISPATCH_ORDER_ENGINE_REJECTED");
    // Nothing was written: the order transition is attempted before any mutation.
    expect((await harness.offers.find(offerIds[0]))?.status).toBe("offered");
  });

  it("reports an unreachable engine as retryable and leaves the offer live", async () => {
    const { harness, offerIds } = await ready();
    harness.orders.failNext("unavailable");
    expect(
      await codeOf(
        acceptOffer(harness.deps, { offerId: offerIds[0], idempotencyKey: "accept-key-0001" }),
      ),
    ).toBe("DISPATCH_ENGINE_UNAVAILABLE");
    expect((await harness.offers.find(offerIds[0]))?.status).toBe("offered");
  });

  it("refuses to assign a job that is no longer dispatching", async () => {
    const { harness, jobId, offerIds } = await ready();
    await harness.jobs.updateStatus(jobId, "cancelled", "ORDER_CANCELLED", "2026-01-01T00:00:01.000Z");
    expect(
      await codeOf(
        acceptOffer(harness.deps, { offerId: offerIds[0], idempotencyKey: "accept-key-0001" }),
      ),
    ).toBe("DISPATCH_JOB_NOT_DISPATCHABLE");
  });
});
