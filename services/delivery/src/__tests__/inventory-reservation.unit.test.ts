import { describe, it, expect } from "vitest";
import {
  reservationIdempotencyKey,
  releaseIdempotencyKey,
  buildReservationLine,
  buildReservationCommand,
  canReserveInventory,
  canReleaseInventory,
  isInventoryReserved,
} from "../domain/inventory-reservation.js";
import type { StoreOrder, StoreOrderItem } from "../domain/model.js";

function makeItem(overrides: Partial<StoreOrderItem> = {}): StoreOrderItem {
  return {
    orderItemId: "00000000-0000-4000-8000-000000000100",
    lineNo: 1,
    productId: "00000000-0000-4000-8000-000000000200",
    sku: "SKU-001",
    quantity: 2,
    unitPriceMinorUnits: 500,
    lineTotalMinorUnits: 1000,
    ...overrides,
  } as StoreOrderItem;
}

function makeOrder(overrides: Partial<StoreOrder> = {}): StoreOrder {
  return {
    orderId: "00000000-0000-4000-8000-000000000001",
    publicId: "WS-0000000001",
    customerRef: "WS-CUST-0001",
    storeId: "00000000-0000-4000-8000-000000000010",
    storeSlug: "test-store",
    fulfillmentState: "placed",
    paymentState: "pending",
    paymentRef: null,
    inventoryState: "none",
    inventoryRef: null,
    currencyCode: "SAR",
    itemsTotalMinorUnits: 1000,
    deliveryFeeMinorUnits: 0,
    totalMinorUnits: 1000,
    items: [makeItem()],
    version: 1,
    ...overrides,
  } as StoreOrder;
}

describe("reservationIdempotencyKey", () => {
  it("derives a deterministic key from orderPublicId", () => {
    const key1 = reservationIdempotencyKey("WS-0000000001");
    const key2 = reservationIdempotencyKey("WS-0000000001");
    expect(key1).toBe(key2);
  });

  it("produces different keys for different orders", () => {
    const key1 = reservationIdempotencyKey("WS-0000000001");
    const key2 = reservationIdempotencyKey("WS-0000000002");
    expect(key1).not.toBe(key2);
  });

  it("produces a non-empty string", () => {
    const key = reservationIdempotencyKey("WS-0000000001");
    expect(key.length).toBeGreaterThan(0);
  });
});

describe("releaseIdempotencyKey", () => {
  it("derives a deterministic key from orderPublicId", () => {
    const key1 = releaseIdempotencyKey("WS-0000000001");
    const key2 = releaseIdempotencyKey("WS-0000000001");
    expect(key1).toBe(key2);
  });

  it("produces a different key from the reservation key", () => {
    const reserveKey = reservationIdempotencyKey("WS-0000000001");
    const releaseKey = releaseIdempotencyKey("WS-0000000001");
    expect(reserveKey).not.toBe(releaseKey);
  });
});

describe("buildReservationLine", () => {
  it("builds a reservation line from an order item", () => {
    const item = makeItem();
    const line = buildReservationLine(item);
    expect(line.productId).toBe(item.productId);
    expect(line.quantity).toBe(item.quantity);
  });
});

describe("buildReservationCommand", () => {
  it("builds a reservation command for all order items", () => {
    const order = makeOrder();
    const cmd = buildReservationCommand(order);
    expect(cmd.orderPublicId).toBe(order.publicId);
    expect(cmd.storeSlug).toBe(order.storeSlug);
    expect(cmd.items).toHaveLength(1);
    expect(cmd.items[0]!.productId).toBe(order.items[0]!.productId);
    expect(cmd.items[0]!.quantity).toBe(order.items[0]!.quantity);
  });
});

describe("canReserveInventory", () => {
  it("returns true when state is none", () => {
    expect(canReserveInventory("none")).toBe(true);
  });

  it("returns true when state is reserving", () => {
    expect(canReserveInventory("reserving")).toBe(true);
  });

  it("returns false when state is reserved", () => {
    expect(canReserveInventory("reserved")).toBe(false);
  });

  it("returns false when state is released", () => {
    expect(canReserveInventory("released")).toBe(false);
  });

  it("returns false when state is consumed", () => {
    expect(canReserveInventory("consumed")).toBe(false);
  });
});

describe("canReleaseInventory", () => {
  it("returns true when state is reserved", () => {
    expect(canReleaseInventory("reserved")).toBe(true);
  });

  it("returns false when state is none", () => {
    expect(canReleaseInventory("none")).toBe(false);
  });

  it("returns true when state is released (idempotent release)", () => {
    expect(canReleaseInventory("released")).toBe(true);
  });
});

describe("isInventoryReserved", () => {
  it("returns true when state is reserved", () => {
    expect(isInventoryReserved("reserved")).toBe(true);
  });

  it("returns false when state is none", () => {
    expect(isInventoryReserved("none")).toBe(false);
  });

  it("returns false when state is released", () => {
    expect(isInventoryReserved("released")).toBe(false);
  });
});
