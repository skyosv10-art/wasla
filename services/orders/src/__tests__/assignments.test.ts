/**
 * Assignments: a log of Phase 07's decisions.
 *
 * The tests here defend the boundary as much as the behaviour: the engine must
 * accept any driver reference without inspecting it (otherwise Phase 07 cannot
 * be built independently), and must NOT move the order's status on acceptance
 * (otherwise there exists one status change that bypassed the table).
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  recordAssignment,
  resolveAssignment,
} from "../use-cases/manage-assignments.js";
import { transitionOrder } from "../use-cases/transition-order.js";
import {
  bindAcceptedAssignment,
  makeHarness,
  orderInStatus,
  publicId,
  type Harness,
} from "./harness.js";

let harness: Harness;

beforeEach(() => {
  harness = makeHarness();
});

describe("recording an offer", () => {
  it("stores it as offered, numbered from one", async () => {
    const orderId = await orderInStatus(harness, "searching");
    const assignment = await recordAssignment(harness, orderId, {
      driverPublicId: publicId(11),
    });
    expect(assignment).toMatchObject({
      sequence: 1,
      state: "offered",
      driverPublicId: "WS-0000000011",
      acceptedAt: null,
      rejectedAt: null,
      expiredAt: null,
      cancelledAt: null,
    });
  });

  it("does not touch the order's status", async () => {
    const orderId = await orderInStatus(harness, "searching");
    await recordAssignment(harness, orderId, { driverPublicId: publicId(11) });
    const order = await harness.repository.findOrderById(orderId);
    expect(order!.status).toBe("searching");
    expect(order!.activeAssignmentId).toBeNull();
  });

  it("accepts any well-formed driver reference without looking it up", async () => {
    const orderId = await orderInStatus(harness, "searching");
    const assignment = await recordAssignment(harness, orderId, {
      driverPublicId: publicId(999999),
    });
    expect(assignment.driverPublicId).toBe("WS-0000999999");
  });

  it("refuses a malformed driver reference", async () => {
    const orderId = await orderInStatus(harness, "searching");
    await expect(
      recordAssignment(harness, orderId, { driverPublicId: "driver-7" }),
    ).rejects.toMatchObject({ code: "ORDER_VALIDATION_FAILED", httpStatus: 400 });
  });

  it("numbers successive offers in order", async () => {
    const orderId = await orderInStatus(harness, "searching");
    const first = await recordAssignment(harness, orderId, { driverPublicId: publicId(11) });
    await resolveAssignment(harness, orderId, {
      assignmentId: first.id,
      state: "rejected",
      reasonCode: "DRIVER_DECLINED",
    });
    const second = await recordAssignment(harness, orderId, { driverPublicId: publicId(12) });
    expect(second.sequence).toBe(2);
  });

  it("refuses offering the same order to the same driver twice", async () => {
    const orderId = await orderInStatus(harness, "searching");
    await recordAssignment(harness, orderId, { driverPublicId: publicId(11) });
    await expect(
      recordAssignment(harness, orderId, { driverPublicId: publicId(11) }),
    ).rejects.toMatchObject({ code: "ORDER_ASSIGNMENT_DUPLICATE", httpStatus: 409 });
  });

  it("refuses a new offer while a driver is already bound", async () => {
    const orderId = await orderInStatus(harness, "assigned");
    await expect(
      recordAssignment(harness, orderId, { driverPublicId: publicId(13) }),
    ).rejects.toMatchObject({ code: "ORDER_ASSIGNMENT_FORBIDDEN", httpStatus: 422 });
  });

  it("reports a missing order", async () => {
    await expect(
      recordAssignment(harness, "00000000-0000-4000-8000-000000000404", {
        driverPublicId: publicId(11),
      }),
    ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND", httpStatus: 404 });
  });

  it("emits assignment_offered addressed by the assignment id", async () => {
    const orderId = await orderInStatus(harness, "searching");
    const assignment = await recordAssignment(harness, orderId, {
      driverPublicId: publicId(11),
    });
    const event = (await harness.outbox.unread()).at(-1)!;
    expect(event.event_type).toBe("order.assignment_offered");
    expect(event.aggregate).toEqual({ type: "order_assignment", id: assignment.id });
  });
});

describe("resolving an offer", () => {
  it("binds an accepted offer to the order without moving its status", async () => {
    const orderId = await orderInStatus(harness, "offered");
    const assignmentId = await bindAcceptedAssignment(harness, orderId);
    const order = await harness.repository.findOrderById(orderId);
    expect(order!.activeAssignmentId).toBe(assignmentId);
    expect(order!.status).toBe("offered");
  });

  it("stamps only the timestamp its state names", async () => {
    const orderId = await orderInStatus(harness, "searching");
    const offer = await recordAssignment(harness, orderId, { driverPublicId: publicId(11) });
    harness.clock.advance(5);
    const resolved = await resolveAssignment(harness, orderId, {
      assignmentId: offer.id,
      state: "expired",
      reasonCode: "OFFER_TIMED_OUT",
    });
    expect(resolved.expiredAt).toBe("2026-01-01T00:00:06.000Z");
    expect(resolved.acceptedAt).toBeNull();
    expect(resolved.rejectedAt).toBeNull();
    expect(resolved.cancelledAt).toBeNull();
  });

  it("refuses to resolve the same offer twice", async () => {
    const orderId = await orderInStatus(harness, "searching");
    const offer = await recordAssignment(harness, orderId, { driverPublicId: publicId(11) });
    await resolveAssignment(harness, orderId, {
      assignmentId: offer.id,
      state: "rejected",
      reasonCode: "DRIVER_DECLINED",
    });
    await expect(
      resolveAssignment(harness, orderId, {
        assignmentId: offer.id,
        state: "accepted",
        reasonCode: null,
      }),
    ).rejects.toMatchObject({ code: "ORDER_ASSIGNMENT_ALREADY_RESOLVED", httpStatus: 409 });
  });

  it("refuses a reason outside the closed catalog", async () => {
    const orderId = await orderInStatus(harness, "searching");
    const offer = await recordAssignment(harness, orderId, { driverPublicId: publicId(11) });
    await expect(
      resolveAssignment(harness, orderId, {
        assignmentId: offer.id,
        state: "rejected",
        reasonCode: "HE_WAS_ASLEEP" as never,
      }),
    ).rejects.toMatchObject({ code: "ORDER_REASON_CODE_UNKNOWN", httpStatus: 422 });
  });

  it("reports an assignment that does not belong to the order", async () => {
    const orderId = await orderInStatus(harness, "searching");
    await expect(
      resolveAssignment(harness, orderId, {
        assignmentId: "00000000-0000-4000-8000-000000000404",
        state: "accepted",
        reasonCode: null,
      }),
    ).rejects.toMatchObject({ code: "ORDER_ASSIGNMENT_NOT_FOUND", httpStatus: 404 });
  });

  it("refuses to rewrite an accepted record: backing out is a transition", async () => {
    const orderId = await orderInStatus(harness, "offered");
    const assignmentId = await bindAcceptedAssignment(harness, orderId);
    // §6: an offer is resolved once. A driver who backs out after accepting is
    // recorded as `driver_cancelled` on the ORDER, so the acceptance stays in the
    // history instead of being overwritten.
    await expect(
      resolveAssignment(harness, orderId, {
        assignmentId,
        state: "cancelled",
        reasonCode: "DRIVER_UNAVAILABLE",
      }),
    ).rejects.toMatchObject({ code: "ORDER_ASSIGNMENT_ALREADY_RESOLVED", httpStatus: 409 });
    const assignment = await harness.repository.findAssignment(orderId, assignmentId);
    expect(assignment!.state).toBe("accepted");
  });

  it("records a driver backing out as an order transition", async () => {
    const orderId = await orderInStatus(harness, "assigned");
    const result = await transitionOrder(harness, orderId, {
      toStatus: "driver_cancelled",
      reasonCode: "DRIVER_VEHICLE_ISSUE",
      actorType: "driver",
      actorRef: publicId(1),
    });
    expect(result.order.status).toBe("driver_cancelled");
    expect(result.historyEntry.reasonCode).toBe("DRIVER_VEHICLE_ISSUE");
  });

  it("emits assignment_resolved carrying the resolution and its reason", async () => {
    const orderId = await orderInStatus(harness, "searching");
    const offer = await recordAssignment(harness, orderId, { driverPublicId: publicId(11) });
    await resolveAssignment(harness, orderId, {
      assignmentId: offer.id,
      state: "rejected",
      reasonCode: "DRIVER_DECLINED",
    });
    const event = (await harness.outbox.unread()).at(-1)!;
    expect(event.event_type).toBe("order.assignment_resolved");
    expect(event.data).toMatchObject({
      assignment_state: "rejected",
      reason_code: "DRIVER_DECLINED",
      sequence: 1,
    });
  });
});

describe("a rejection does not end the order", () => {
  it("leaves the order alive and returnable to the search", async () => {
    const orderId = await orderInStatus(harness, "offered");
    const offer = await recordAssignment(harness, orderId, { driverPublicId: publicId(21) });
    await resolveAssignment(harness, orderId, {
      assignmentId: offer.id,
      state: "rejected",
      reasonCode: "DRIVER_DECLINED",
    });
    await transitionOrder(harness, orderId, {
      toStatus: "driver_rejected",
      reasonCode: "DRIVER_DECLINED",
      actorType: "driver",
      actorRef: publicId(21),
    });
    await transitionOrder(harness, orderId, {
      toStatus: "searching",
      reasonCode: "SEARCH_RESUMED",
      actorType: "system",
      actorRef: null,
    });
    const order = await harness.repository.findOrderById(orderId);
    expect(order!.status).toBe("searching");
  });

  it("lets a second driver be offered the same order", async () => {
    const orderId = await orderInStatus(harness, "searching");
    const first = await recordAssignment(harness, orderId, { driverPublicId: publicId(21) });
    await resolveAssignment(harness, orderId, {
      assignmentId: first.id,
      state: "rejected",
      reasonCode: "DRIVER_DECLINED",
    });
    const second = await recordAssignment(harness, orderId, { driverPublicId: publicId(22) });
    expect(second.state).toBe("offered");
    expect((await harness.repository.listAssignments(orderId))).toHaveLength(2);
  });
});
