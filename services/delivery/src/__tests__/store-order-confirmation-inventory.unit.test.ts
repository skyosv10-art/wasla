import { describe, it, expect } from "vitest";
import { decideConfirmation } from "../domain/store-order-confirmation.js";
import { DeliveryError } from "../domain/errors.js";
import type { StoreOrder } from "../domain/model.js";

function makeOrder(overrides: Partial<StoreOrder> = {}): StoreOrder {
  return {
    orderId: "00000000-0000-4000-8000-000000000001",
    publicId: "WS-0000000001",
    customerRef: "WS-CUST-0001",
    storeId: "00000000-0000-4000-8000-000000000010",
    storeSlug: "test-store",
    fulfillmentState: "placed",
    paymentState: "authorized",
    paymentRef: "pay-ref-001",
    inventoryState: "reserved",
    inventoryRef: "res-ref-001",
    currencyCode: "SAR",
    itemsTotalMinorUnits: 1000,
    deliveryFeeMinorUnits: 0,
    totalMinorUnits: 1000,
    items: [],
    version: 1,
    ...overrides,
  } as StoreOrder;
}

describe("decideConfirmation — inventory gate (review 10/N)", () => {
  it("allows confirmation when payment authorized AND inventory reserved", () => {
    const order = makeOrder({
      paymentState: "authorized",
      inventoryState: "reserved",
    });
    const decision = decideConfirmation(order, "TRACE-1");
    expect(decision.fromFulfillmentState).toBe("placed");
  });

  it("rejects confirmation when payment authorized but inventory NOT reserved", () => {
    const order = makeOrder({
      paymentState: "authorized",
      inventoryState: "none",
    });
    try {
      decideConfirmation(order, "TRACE-2");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DeliveryError);
      expect((e as DeliveryError).code).toBe("DELIVERY_INVENTORY_NOT_RESERVED");
    }
  });

  it("rejects confirmation when inventory reserved but payment NOT authorized", () => {
    const order = makeOrder({
      paymentState: "pending",
      inventoryState: "reserved",
    });
    try {
      decideConfirmation(order, "TRACE-3");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DeliveryError);
      expect((e as DeliveryError).code).toBe("DELIVERY_PAYMENT_NOT_AUTHORIZED");
    }
  });

  it("rejects confirmation when neither payment nor inventory are ready", () => {
    const order = makeOrder({
      paymentState: "pending",
      inventoryState: "none",
    });
    try {
      decideConfirmation(order, "TRACE-4");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DeliveryError);
      expect((e as DeliveryError).code).toBe("DELIVERY_PAYMENT_NOT_AUTHORIZED");
    }
  });
});
