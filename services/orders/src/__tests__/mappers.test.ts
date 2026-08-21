/**
 * Mapping between the domain shape and the published wire shape.
 *
 * Tested as a round trip wherever a round trip is meaningful: a field that
 * survives domain → wire → domain unchanged cannot have been silently renamed or
 * dropped by a contract regeneration. The asymmetric cases (a half coordinate
 * pair, an unknown reason code) are tested individually, because those are where
 * mapping has to make a judgement rather than copy.
 */

import type { OrderIntakeRequest, TransitionRequest } from "@wasla/contracts-order";
import { describe, expect, it } from "vitest";

import {
  assignmentToWire,
  intakeCommandFromWire,
  orderToWire,
  statusHistoryEntryToWire,
  stopFromWire,
  stopToWire,
  transitionCommandFromWire,
} from "../mappers.js";
import { intakeCommand, makeHarness, orderInStatus, publicId } from "./harness.js";
import { getOrderDetail } from "../use-cases/read-order.js";

const wireIntake: OrderIntakeRequest = {
  order_request_id: "11111111-1111-4111-8111-111111111111",
  customer_public_id: publicId(1),
  order_type: "delivery",
  vehicle_class: "van",
  price_mode: "customer_offer",
  offered_price: { amount_minor: 4500, currency: "SAR" },
  stops: [
    {
      kind: "pickup",
      zone_id: "66666666-6666-4666-8666-666666666666",
      label: "المستودع",
      source: "manual_zone",
      saved_place_id: null,
      latitude: 24.4686,
      longitude: 39.6142,
    },
    {
      kind: "dropoff",
      zone_id: "77777777-7777-4777-8777-777777777777",
      label: null,
      source: "map",
      saved_place_id: null,
      latitude: null,
      longitude: null,
    },
  ],
  shipment: { shipment_type: "parcel", description: "صندوق", weight_kg: 12.5 },
  notes: "اتصل عند الوصول",
  requested_at: "2026-01-01T00:00:00.000Z",
};

describe("intake mapping", () => {
  it("translates every field into the domain shape", () => {
    const command = intakeCommandFromWire(wireIntake, { idempotencyKey: "key-1" });
    expect(command).toMatchObject({
      orderRequestId: wireIntake.order_request_id,
      customerPublicId: wireIntake.customer_public_id,
      orderType: "delivery",
      vehicleClass: "van",
      priceMode: "customer_offer",
      offeredPrice: { amountMinor: 4500, currency: "SAR" },
      notes: "اتصل عند الوصول",
      requestedAt: "2026-01-01T00:00:00.000Z",
      idempotencyKey: "key-1",
    });
    expect(command.shipment).toEqual({
      shipmentType: "parcel",
      description: "صندوق",
      weightKg: 12.5,
    });
  });

  it("keeps a complete coordinate pair and drops a half one", () => {
    expect(stopFromWire(wireIntake.stops[0]!).coordinates).toEqual({
      latitude: 24.4686,
      longitude: 39.6142,
    });
    expect(
      stopFromWire({ ...wireIntake.stops[0]!, longitude: null }).coordinates,
    ).toBeNull();
  });

  it("round-trips a stop unchanged", () => {
    const stop = stopFromWire(wireIntake.stops[0]!);
    expect(stopFromWire(stopToWire(stop))).toEqual(stop);
  });

  it("carries an absent optional field as null, never as undefined", () => {
    const command = intakeCommandFromWire(
      { ...wireIntake, notes: undefined, shipment: undefined, offered_price: undefined },
      { idempotencyKey: "key-2" },
    );
    expect(command.notes).toBeNull();
    expect(command.shipment).toBeNull();
    expect(command.offeredPrice).toBeNull();
  });
});

describe("transition mapping", () => {
  it("translates the request and defaults an absent reason to null", () => {
    const wire: TransitionRequest = { to_status: "searching", actor_type: "system" };
    expect(transitionCommandFromWire(wire)).toEqual({
      toStatus: "searching",
      reasonCode: null,
      actorType: "system",
      actorRef: null,
      idempotencyKey: undefined,
      traceId: undefined,
    });
  });

  it("passes a catalog reason through", () => {
    const wire: TransitionRequest = {
      to_status: "expired",
      actor_type: "system",
      reason_code: "SEARCH_WINDOW_EXPIRED",
    };
    expect(transitionCommandFromWire(wire).reasonCode).toBe("SEARCH_WINDOW_EXPIRED");
  });

  it("refuses a reason outside the catalog at the boundary", () => {
    const wire = {
      to_status: "expired",
      actor_type: "system",
      reason_code: "MADE_UP",
    } as unknown as TransitionRequest;
    expect(() => transitionCommandFromWire(wire)).toThrowError(
      expect.objectContaining({ code: "ORDER_REASON_CODE_UNKNOWN" }) as Error,
    );
  });
});

describe("outbound mapping", () => {
  it("flattens money and nests the active assignment", async () => {
    const harness = makeHarness();
    const orderId = await orderInStatus(harness, "assigned");
    const detail = await getOrderDetail(harness, orderId);
    const wire = orderToWire(detail.order, detail.activeAssignment);
    expect(wire.offered_price).toEqual({ amount_minor: 2500, currency: "SAR" });
    expect(wire.active_assignment?.assignment_state).toBe("accepted");
    expect(wire.status).toBe("assigned");
    expect(wire.order_public_id).toMatch(/^ORD-\d{10}$/);
  });

  it("emits null, not an absent key, for an unset optional", async () => {
    const harness = makeHarness();
    const orderId = await orderInStatus(harness, "searching");
    const detail = await getOrderDetail(harness, orderId);
    const wire = orderToWire(detail.order, null);
    expect(wire.active_assignment).toBeNull();
    expect(wire.shipment).toBeNull();
    expect(wire.notes).toBeNull();
    expect("active_assignment" in wire).toBe(true);
  });

  it("maps an audit row to the published entry", async () => {
    const harness = makeHarness();
    const orderId = await orderInStatus(harness, "searching");
    const detail = await getOrderDetail(harness, orderId);
    const wire = statusHistoryEntryToWire(detail.statusHistory[0]!);
    expect(wire).toEqual({
      sequence: 1,
      from_status: null,
      to_status: "published",
      reason_code: null,
      actor_type: "system",
      actor_ref: null,
      occurred_at: detail.statusHistory[0]!.occurredAt,
      trace_id: null,
    });
  });

  it("maps an assignment with only its own timestamp set", async () => {
    const harness = makeHarness();
    const orderId = await orderInStatus(harness, "accepted");
    const detail = await getOrderDetail(harness, orderId);
    const wire = assignmentToWire(detail.assignments[0]!);
    expect(wire.assignment_state).toBe("accepted");
    expect(wire.accepted_at).not.toBeNull();
    expect(wire.rejected_at).toBeNull();
    expect(wire.expired_at).toBeNull();
    expect(wire.cancelled_at).toBeNull();
  });

  it("maps the two stops in order", async () => {
    const harness = makeHarness();
    const orderId = await orderInStatus(harness, "searching");
    const detail = await getOrderDetail(harness, orderId);
    const wire = orderToWire(detail.order, null);
    expect(wire.stops.map((stop) => stop.kind)).toEqual(["pickup", "dropoff"]);
    expect(wire.stops[1]!.latitude).toBeNull();
  });

  it("never leaks the idempotency key or the payload fingerprint", async () => {
    const harness = makeHarness();
    const orderId = await orderInStatus(harness, "searching");
    const detail = await getOrderDetail(harness, orderId);
    const wire = orderToWire(detail.order, null) as Record<string, unknown>;
    expect(Object.keys(wire)).not.toContain("idempotency_key");
    expect(Object.keys(wire)).not.toContain("payload_fingerprint");
  });

  it("mirrors the fields the intake command declares", () => {
    const domainKeys = Object.keys(intakeCommand()).sort();
    expect(domainKeys).toEqual(
      [
        "customerPublicId",
        "idempotencyKey",
        "notes",
        "offeredPrice",
        "orderRequestId",
        "orderType",
        "priceMode",
        "requestedAt",
        "shipment",
        "stops",
        "vehicleClass",
      ].sort(),
    );
  });
});
