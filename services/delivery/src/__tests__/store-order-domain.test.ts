/**
 * Pure-domain tests for placement and cancellation (review 6/N).
 *
 * The HTTP tests prove the boundary; these prove the decisions underneath it
 * without a server, so a failure names the arithmetic or the table rather
 * than a status code.
 */

import { describe, expect, it } from "vitest";

import { buildStoreOrderPlacement } from "../domain/store-order-placement.js";
import { decideCancellation } from "../domain/store-order-cancellation.js";
import { isDeliveryError } from "../domain/errors.js";
import { parseCancelBody, parseOrderPublicIdParam, parsePlaceStoreOrderBody } from "../http/requests.js";
import { CUSTOMER_REF, PRODUCT_A, PRODUCT_B, STORE_REF, fixedOrder, fixedTask } from "./store-order-fakes.js";

const IDENTITY = {
  orderId: "bbbbbbbb-0000-4000-8000-000000000002",
  taskId: "aaaaaaaa-0000-4000-8000-000000000001",
  publicId: "WS-0000000001" as const,
  storeId: "cccccccc-0000-4000-8000-000000000003",
};

const SNAPSHOTS = [
  { productId: PRODUCT_A, sku: "SKU-A", unitPriceMinorUnits: 1000 },
  { productId: PRODUCT_B, sku: "SKU-B", unitPriceMinorUnits: 250 },
];

function input(overrides: Partial<Parameters<typeof buildStoreOrderPlacement>[0]> = {}) {
  return {
    customer_ref: CUSTOMER_REF,
    store_public_id: STORE_REF,
    items: [{ product_id: PRODUCT_A, quantity: 2 }],
    delivery_fee_minor_units: 500,
    ...overrides,
  };
}

describe("placement builder — money and identity", () => {
  it("computes line totals and the order total in integer minor units", () => {
    const { order } = buildStoreOrderPlacement(
      input({
        items: [
          { product_id: PRODUCT_A, quantity: 2 },
          { product_id: PRODUCT_B, quantity: 3 },
        ],
      }),
      SNAPSHOTS,
      IDENTITY,
    );
    expect(order.items.map((i) => i.lineTotalMinorUnits)).toEqual([2000, 750]);
    expect(order.itemsTotalMinorUnits).toBe(2750);
    expect(order.totalMinorUnits).toBe(order.itemsTotalMinorUnits + order.deliveryFeeMinorUnits);
    // The schema CHECK asserts the same equality — one arithmetic, two guards.
    expect(order.totalMinorUnits).toBe(3250);
  });

  it("numbers lines from 1 and derives distinct uuid-shaped item ids", () => {
    const { order } = buildStoreOrderPlacement(
      input({
        items: [
          { product_id: PRODUCT_A, quantity: 1 },
          { product_id: PRODUCT_B, quantity: 1 },
        ],
      }),
      SNAPSHOTS,
      IDENTITY,
    );
    expect(order.items.map((i) => i.lineNo)).toEqual([1, 2]);
    const ids = order.items.map((i) => i.orderItemId);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  });

  it("is pure — the same inputs build byte-identical aggregates", () => {
    const a = buildStoreOrderPlacement(input(), SNAPSHOTS, IDENTITY);
    const b = buildStoreOrderPlacement(input(), SNAPSHOTS, IDENTITY);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("starts the order at placed and the task at pending_eligibility (§3.1 · §3.3)", () => {
    const { order, task } = buildStoreOrderPlacement(input(), SNAPSHOTS, IDENTITY);
    expect(order.fulfillmentState).toBe("placed");
    expect(order.paymentState).toBe("pending");
    expect(order.version).toBe(1);
    expect(task.state).toBe("pending_eligibility");
    expect(task.dispatchJobRef).toBeNull();
    expect(task.courierRef).toBeNull();
  });

  it("refuses a product with no catalog snapshot as validation, not dependency", () => {
    try {
      buildStoreOrderPlacement(input(), [SNAPSHOTS[1]], IDENTITY);
      expect.unreachable("a missing snapshot must throw");
    } catch (error) {
      expect(isDeliveryError(error) && error.code).toBe("DELIVERY_VALIDATION_FAILED");
      expect(isDeliveryError(error) && error.httpStatus).toBe(400);
    }
  });

  it("refuses a non-WS customer ref before any row is shaped", () => {
    try {
      buildStoreOrderPlacement(input({ customer_ref: "customer@example.com" }), SNAPSHOTS, IDENTITY);
      expect.unreachable("a leaked email must be a validation error");
    } catch (error) {
      expect(isDeliveryError(error) && error.code).toBe("DELIVERY_VALIDATION_FAILED");
    }
  });
});

describe("cancellation decision — the published tables decide", () => {
  it("allows cancellation from draft, placed, confirmed and ready_for_delivery (§3.1)", () => {
    for (const state of ["draft", "placed", "confirmed", "ready_for_delivery"] as const) {
      const decision = decideCancellation(
        fixedOrder({ fulfillmentState: state }),
        fixedTask(),
        "CUSTOMER_CHANGED_MIND",
      );
      expect(decision.fromFulfillmentState).toBe(state);
    }
  });

  it("refuses cancellation from picking, picked, handed_to_courier and delivered", () => {
    for (const state of ["picking", "picked", "handed_to_courier", "delivered"] as const) {
      try {
        decideCancellation(fixedOrder({ fulfillmentState: state }), fixedTask(), "CUSTOMER_CHANGED_MIND");
        expect.unreachable(`cancellation from ${state} must be refused`);
      } catch (error) {
        expect(isDeliveryError(error) && error.code).toBe("DELIVERY_CANCEL_NOT_ALLOWED");
        expect(isDeliveryError(error) && error.httpStatus).toBe(409);
      }
    }
  });

  it("carries a task edge ONLY where §3.3 publishes one", () => {
    const withEdge = ["eligible", "dispatch_requested", "driver_assigned"] as const;
    for (const state of withEdge) {
      const decision = decideCancellation(fixedOrder(), fixedTask({ state }), "CUSTOMER_CHANGED_MIND");
      expect(decision.taskCancellation).toEqual({ taskId: fixedTask().taskId, fromState: state });
    }
    // The declared gap (ADR-026 §4.9-1): a just-placed order's task has no edge.
    const noEdge = decideCancellation(fixedOrder(), fixedTask(), "CUSTOMER_CHANGED_MIND");
    expect(noEdge.taskCancellation).toBeNull();
  });

  it("tolerates an order with no task at all", () => {
    const decision = decideCancellation(fixedOrder(), null, "CUSTOMER_CHANGED_MIND");
    expect(decision.taskCancellation).toBeNull();
  });
});

describe("request parsing — no silent coercion", () => {
  it("refuses a string quantity, a null fee and a non-object body", () => {
    const base = {
      customer_ref: CUSTOMER_REF,
      store_public_id: STORE_REF,
      items: [{ product_id: PRODUCT_A, quantity: 1 }],
      delivery_fee_minor_units: 0,
    };
    expect(() => parsePlaceStoreOrderBody({ ...base, items: [{ product_id: PRODUCT_A, quantity: "1" }] })).toThrow();
    expect(() => parsePlaceStoreOrderBody({ ...base, delivery_fee_minor_units: null })).toThrow();
    expect(() => parsePlaceStoreOrderBody({ ...base, delivery_fee_minor_units: 1.5 })).toThrow();
    expect(() => parsePlaceStoreOrderBody("not an object")).toThrow();
    expect(() => parsePlaceStoreOrderBody({ ...base, items: "all of them" })).toThrow();
    expect(parsePlaceStoreOrderBody(base).delivery_fee_minor_units).toBe(0);
  });

  it("accepts only WS-shaped path refs", () => {
    expect(parseOrderPublicIdParam({ orderPublicId: "WS-0000000001" })).toBe("WS-0000000001");
    for (const bad of ["ORD-0000000001", "WS-1", "WS-00000000012", "ws-0000000001", ""]) {
      expect(() => parseOrderPublicIdParam({ orderPublicId: bad })).toThrow();
    }
  });

  it("accepts only the closed cancel-reason catalog", () => {
    expect(parseCancelBody({ reason_code: "PAYMENT_FAILED" })).toBe("PAYMENT_FAILED");
    expect(() => parseCancelBody({ reason_code: "payment_failed" })).toThrow();
    expect(() => parseCancelBody({})).toThrow();
  });
});
