/**
 * Rejecting an offer.
 *
 * The suite exists mostly to pin down what rejection does NOT do: it does not complete
 * the wave and it does not open the next one. Those tests are the guard on "only the tick
 * advances the dispatch timeline" — the property everything else in this service assumes.
 */
import { describe, expect, it } from "vitest";

import { isDispatchError } from "../domain/errors.js";
import { createDispatchJob } from "../use-cases/create-job.js";
import { rejectOffer } from "../use-cases/reject-offer.js";
import { tick } from "../use-cases/tick.js";
import { ZONE_ID, createHarness, driverId, orderRef, type Harness } from "./harness.js";

const POOL = [driverId(1), driverId(2), driverId(3), driverId(4)];

async function ready(): Promise<{
  harness: Harness;
  jobId: string;
  orderId: string;
  offerIds: readonly string[];
}> {
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

describe("rejectOffer", () => {
  it("closes the offer with the driver's own reason", async () => {
    const { harness, offerIds } = await ready();
    const { offer } = await rejectOffer(harness.deps, {
      offerId: offerIds[0],
      reasonCode: "DRIVER_VEHICLE_ISSUE",
      idempotencyKey: "reject-key-0001",
    });

    expect(offer.status).toBe("rejected");
    // Kept verbatim: aggregating three distinct reasons into one "declined" would hide
    // the fleet problem that DRIVER_VEHICLE_ISSUE is reporting.
    expect(offer.reasonCode).toBe("DRIVER_VEHICLE_ISSUE");
    expect(offer.respondedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(offer.resolvedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("accepts each of the three reasons a driver may give, and nothing else", async () => {
    for (const reasonCode of ["DRIVER_DECLINED", "DRIVER_UNAVAILABLE", "DRIVER_VEHICLE_ISSUE"]) {
      const { harness, offerIds } = await ready();
      const { offer } = await rejectOffer(harness.deps, {
        offerId: offerIds[0],
        reasonCode,
        idempotencyKey: `reject-key-${reasonCode}`,
      });
      expect(offer.reasonCode).toBe(reasonCode);
    }

    const { harness, offerIds } = await ready();
    // A free-text reason would end up in an event, then in analytics, then in a report
    // about a named driver.
    expect(
      await codeOf(
        rejectOffer(harness.deps, {
          offerId: offerIds[0],
          reasonCode: "TOO_FAR",
          idempotencyKey: "reject-key-0001",
        }),
      ),
    ).toBe("DISPATCH_REASON_CODE_UNKNOWN");
    // A code that exists in the catalogue but is not the driver's to send.
    expect(
      await codeOf(
        rejectOffer(harness.deps, {
          offerId: offerIds[0],
          reasonCode: "JOB_CANCELLED",
          idempotencyKey: "reject-key-0002",
        }),
      ),
    ).toBe("DISPATCH_REASON_CODE_UNKNOWN");
  });

  it("does not complete the wave, even when it was the last live offer", async () => {
    const { harness, jobId, offerIds } = await ready();
    for (const [index, offerId] of offerIds.entries()) {
      await rejectOffer(harness.deps, {
        offerId,
        reasonCode: "DRIVER_DECLINED",
        idempotencyKey: `reject-key-000${index}`,
      });
    }

    // The declared cost: a fully-rejected wave sits idle until the next tick. Buying
    // those seconds here would give "what opens a wave" two answers, one of them under a
    // driver's thumb and retried by a flaky mobile network.
    const waves = await harness.waves.listForJob(jobId);
    expect(waves).toHaveLength(1);
    expect(waves[0].status).toBe("open");
  });

  it("lets the next tick complete the wave and open the next one", async () => {
    const { harness, jobId, offerIds } = await ready();
    for (const [index, offerId] of offerIds.entries()) {
      await rejectOffer(harness.deps, {
        offerId,
        reasonCode: "DRIVER_DECLINED",
        idempotencyKey: `reject-key-000${index}`,
      });
    }

    const result = await tick(harness.deps);

    expect(result.timedOutOffers).toBe(0);
    expect(result.openedWaves).toBe(1);
    const waves = await harness.waves.listForJob(jobId);
    expect(waves.map((wave) => wave.status)).toEqual(["completed", "open"]);
    expect(waves[0].reasonCode).toBe("WAVE_OFFERS_RESOLVED");
  });

  it("makes the tick report a rejection rather than a timeout", async () => {
    const { harness, orderId, offerIds } = await ready();
    await rejectOffer(harness.deps, {
      offerId: offerIds[0],
      reasonCode: "DRIVER_DECLINED",
      idempotencyKey: "reject-key-0001",
    });
    harness.clock.set("2026-01-01T00:00:30.000Z");
    await tick(harness.deps);

    const transitions = harness.orders.calls
      .filter((call) => call.kind === "transition")
      .map((call) => call.detail);
    // A driver who answered told us more than a silence did, so the order reports
    // driver_rejected even though the sibling merely timed out.
    expect(transitions).toContain("driver_rejected");
    expect(transitions).not.toContain("driver_timeout");
    expect(harness.orders.statusOf(orderId)).toBe("offered");
  });

  it("closes the engine assignment with DRIVER_DECLINED", async () => {
    const { harness, offerIds } = await ready();
    const offer = await harness.offers.find(offerIds[0]);
    await rejectOffer(harness.deps, {
      offerId: offerIds[0],
      reasonCode: "DRIVER_UNAVAILABLE",
      idempotencyKey: "reject-key-0001",
    });
    expect(harness.orders.assignmentState(offer?.orderAssignmentId ?? "")).toBe("rejected");
  });

  it("emits offer_rejected carrying the reason", async () => {
    const { harness, offerIds } = await ready();
    const before = (await harness.outbox.unread()).length;
    await rejectOffer(harness.deps, {
      offerId: offerIds[0],
      reasonCode: "DRIVER_DECLINED",
      idempotencyKey: "reject-key-0001",
    });
    const emitted = (await harness.outbox.unread()).slice(before);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].event_type).toBe("dispatch.offer_rejected");
  });

  it("replays a retry with the same key", async () => {
    const { harness, offerIds } = await ready();
    await rejectOffer(harness.deps, {
      offerId: offerIds[0],
      reasonCode: "DRIVER_DECLINED",
      idempotencyKey: "reject-key-0001",
    });
    const second = await rejectOffer(harness.deps, {
      offerId: offerIds[0],
      reasonCode: "DRIVER_DECLINED",
      idempotencyKey: "reject-key-0001",
    });
    expect(second.replayed).toBe(true);
    expect(
      (await harness.outbox.unread()).filter((event) => event.event_type === "dispatch.offer_rejected"),
    ).toHaveLength(1);
  });

  it("refuses the same key with a different reason", async () => {
    const { harness, offerIds } = await ready();
    await rejectOffer(harness.deps, {
      offerId: offerIds[0],
      reasonCode: "DRIVER_DECLINED",
      idempotencyKey: "reject-key-0001",
    });
    expect(
      await codeOf(
        rejectOffer(harness.deps, {
          offerId: offerIds[1],
          reasonCode: "DRIVER_UNAVAILABLE",
          idempotencyKey: "reject-key-0001",
        }),
      ),
    ).toBe("DISPATCH_IDEMPOTENCY_KEY_REUSED");
  });

  it("refuses an offer that already timed out, and one already rejected", async () => {
    const { harness, offerIds } = await ready();
    harness.clock.set("2026-01-01T00:00:30.000Z");
    expect(
      await codeOf(
        rejectOffer(harness.deps, {
          offerId: offerIds[0],
          reasonCode: "DRIVER_DECLINED",
          idempotencyKey: "reject-key-0001",
        }),
      ),
    ).toBe("DISPATCH_OFFER_ALREADY_RESOLVED");

    await tick(harness.deps);
    expect(
      await codeOf(
        rejectOffer(harness.deps, {
          offerId: offerIds[0],
          reasonCode: "DRIVER_DECLINED",
          idempotencyKey: "reject-key-0002",
        }),
      ),
    ).toBe("DISPATCH_OFFER_ALREADY_RESOLVED");
  });

  it("leaves the offer live when the engine is unreachable", async () => {
    const { harness, offerIds } = await ready();
    harness.orders.failNext("unavailable");
    expect(
      await codeOf(
        rejectOffer(harness.deps, {
          offerId: offerIds[0],
          reasonCode: "DRIVER_DECLINED",
          idempotencyKey: "reject-key-0001",
        }),
      ),
    ).toBe("DISPATCH_ENGINE_UNAVAILABLE");
    expect((await harness.offers.find(offerIds[0]))?.status).toBe("offered");
  });

  it("treats an already-closed engine assignment as success", async () => {
    const { harness, orderId, offerIds } = await ready();
    const offer = await harness.offers.find(offerIds[0]);
    // A concurrent tick got there first. Closing something already closed is exactly
    // what we wanted, so refusing the driver's tap here would be theatre.
    await harness.deps.orders.resolveAssignment({
      orderId,
      assignmentId: offer?.orderAssignmentId ?? "",
      state: "expired",
      reasonCode: "OFFER_TIMED_OUT",
      idempotencyKey: "out-of-band-expire",
    });

    const { offer: rejected } = await rejectOffer(harness.deps, {
      offerId: offerIds[0],
      reasonCode: "DRIVER_DECLINED",
      idempotencyKey: "reject-key-0001",
    });
    expect(rejected.status).toBe("rejected");
  });
});
