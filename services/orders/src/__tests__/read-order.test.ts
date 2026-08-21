/**
 * Reads, and the two invariants that make the audit trail believable:
 * one outbox event per history row, and one history row per status the order
 * ever held. Both are asserted over a long lifecycle rather than a single step,
 * because a drift of one row only becomes visible after several transitions.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  getOrderDetail,
  getOrderDetailByPublicId,
} from "../use-cases/read-order.js";
import { recordAssignment } from "../use-cases/manage-assignments.js";
import {
  createOrder,
  makeHarness,
  orderInStatus,
  publicId,
  type Harness,
} from "./harness.js";

let harness: Harness;

beforeEach(() => {
  harness = makeHarness();
});

describe("reading an order", () => {
  it("returns the order with its history and assignments in one answer", async () => {
    const orderId = await orderInStatus(harness, "in_progress");
    const detail = await getOrderDetail(harness, orderId);
    expect(detail.order.status).toBe("in_progress");
    expect(detail.statusHistory.length).toBeGreaterThan(1);
    expect(detail.assignments).toHaveLength(1);
    expect(detail.activeAssignment?.id).toBe(detail.order.activeAssignmentId);
  });

  it("returns no active assignment before one is accepted", async () => {
    const orderId = await orderInStatus(harness, "searching");
    await recordAssignment(harness, orderId, { driverPublicId: publicId(31) });
    const detail = await getOrderDetail(harness, orderId);
    expect(detail.assignments).toHaveLength(1);
    expect(detail.activeAssignment).toBeNull();
  });

  it("reads by the public id other services hold", async () => {
    const orderId = await createOrder(harness);
    const order = await harness.repository.findOrderById(orderId);
    const detail = await getOrderDetailByPublicId(harness, order!.orderPublicId);
    expect(detail.order.id).toBe(orderId);
  });

  it("reports a missing order by either identifier", async () => {
    await expect(
      getOrderDetail(harness, "00000000-0000-4000-8000-000000000404"),
    ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND", httpStatus: 404 });
    await expect(
      getOrderDetailByPublicId(harness, "ORD-0000009999"),
    ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND", httpStatus: 404 });
  });

  it("keeps history oldest first, so the trail reads forwards", async () => {
    const orderId = await orderInStatus(harness, "completed");
    const detail = await getOrderDetail(harness, orderId);
    const sequences = detail.statusHistory.map((row) => row.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(detail.statusHistory.at(-1)!.toStatus).toBe("completed");
  });
});

describe("outbox and audit stay in step", () => {
  it("emits exactly one status event per history row across a full lifecycle", async () => {
    const orderId = await orderInStatus(harness, "completed");
    const detail = await getOrderDetail(harness, orderId);
    const events = await harness.outbox.unread();
    const statusEvents = events.filter((e) => e.event_type === "order.status_changed");
    expect(statusEvents).toHaveLength(detail.statusHistory.length);
  });

  it("emits one created event and no more", async () => {
    const orderId = await orderInStatus(harness, "completed");
    expect(orderId).toBeTruthy();
    const events = await harness.outbox.unread();
    expect(events.filter((e) => e.event_type === "order.created")).toHaveLength(1);
  });

  it("gives every event a distinct id and one producer", async () => {
    await orderInStatus(harness, "completed");
    const events = await harness.outbox.unread();
    expect(new Set(events.map((e) => e.event_id)).size).toBe(events.length);
    expect(new Set(events.map((e) => e.producer))).toEqual(new Set(["orders-service"]));
  });

  it("orders events by their occurrence, never backwards", async () => {
    await orderInStatus(harness, "completed");
    const times = (await harness.outbox.unread()).map((e) => Date.parse(e.occurred_at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("addresses order events by public id and assignment events by assignment id", async () => {
    const orderId = await orderInStatus(harness, "assigned");
    const order = await harness.repository.findOrderById(orderId);
    for (const event of await harness.outbox.unread()) {
      if (event.aggregate.type === "order") {
        expect(event.aggregate.id).toBe(order!.orderPublicId);
      } else {
        expect(event.aggregate.id).toBe(order!.activeAssignmentId);
      }
    }
  });

  it("keeps orders isolated: one order's history never leaks into another", async () => {
    const first = await orderInStatus(harness, "searching");
    const second = await createOrder(harness);
    expect(await harness.repository.listStatusHistory(second)).toHaveLength(1);
    expect(await harness.repository.listStatusHistory(first)).toHaveLength(2);
  });
});
