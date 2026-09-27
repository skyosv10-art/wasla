/**
 * M5-13M (CLM-0378 · ADR-026 ملحق M5-13M): طلبٌ بصنفَينِ على السوقِ الحقيقيِّ والتوصيلِ الحقيقيِّ.
 *
 * قبلَ M5-13M: السوقُ يخصمُ الصنفَينِ بمرجعٍ واحدٍ للطلب، ثمَّ يُسقِطُ
 * `UNIQUE (marketplace_reservation_ref)` الصفَّ الثانيَ في دفترِ الحجوزاتِ ⇒ `500`، والطلبُ
 * `placed` بمخزونٍ `none` والكميّاتُ مخصومةٌ. هنا يُقاسُ الإصلاحُ على السلكِ:
 * `201` بمخزونٍ `reserved`، صفّانِ بمرجعٍ واحدٍ، والكميّتانِ مخصومتانِ فعلاً في السوقِ،
 * ثمَّ الإلغاءُ يُعيدُ الكميّتَينِ بالضبطِ — وإعادةُ الإلغاءِ بنفسِ المفتاحِ تُطابقُ الجوابَ الأوّلَ.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CATEGORY,
  CUSTOMER,
  DELIVERY_FEE_MINOR_UNITS,
  MODERATOR,
  OWNER,
  PG_ENABLED,
  STORE_SLUG,
  UNIT_PRICE_MINOR_UNITS,
  callDelivery,
  callMarketplace,
  nextKey,
  resetData,
  seedLeafCategory,
  startGate,
  type GateContext,
} from "../harness.js";

const STOCK = 9;

describe.skipIf(!PG_ENABLED)("M5-13M · طلبٌ متعدِّدُ الأصنافِ عبرَ السوقِ والتوصيلِ الحقيقيَّينِ", () => {
  let gate: GateContext;

  beforeAll(async () => {
    gate = await startGate();
  });
  beforeEach(async () => {
    await resetData(gate.pool);
    await seedLeafCategory(gate.stores);
  });
  afterAll(async () => {
    await gate?.close();
  });

  async function market(method: "GET" | "POST", path: string, body?: Record<string, unknown>, keyPrefix?: string) {
    return callMarketplace(gate.marketplaceBaseUrl, {
      method,
      path,
      ...(body ? { body } : {}),
      ...(keyPrefix ? { idempotencyKey: nextKey(keyPrefix) } : {}),
    });
  }

  async function openStore(): Promise<void> {
    const registered = await market(
      "POST",
      "/stores",
      { owner_public_id: OWNER, store_slug: STORE_SLUG, title_ar: "إلكترونيّات المدينة", category_slug: CATEGORY },
      "m513m-register",
    );
    expect(registered.status, registered.text).toBe(201);
    const requested = await market("POST", `/stores/${STORE_SLUG}/review-requests`, { requested_by_public_id: OWNER }, "m513m-review");
    expect(requested.status, requested.text).toBe(201);
    const approved = await market(
      "POST",
      `/stores/${STORE_SLUG}/decisions`,
      { decision: "approved", actor_type: "moderator", actor_public_id: MODERATOR },
      "m513m-store-decide",
    );
    expect(approved.status, approved.text).toBe(201);
  }

  async function publish(sku: string, price: number): Promise<string> {
    const created = await market(
      "POST",
      `/stores/${STORE_SLUG}/products`,
      { sku, title_ar: `منتج ${sku}`, category_slug: CATEGORY, price_minor_units: price, currency_code: "SAR", created_by_public_id: OWNER },
      "m513m-product",
    );
    expect(created.status, created.text).toBe(201);
    const productId = created.body.product_id as string;
    const moderated = await market(
      "POST",
      `/products/${productId}/decisions`,
      { decision: "approved", actor_type: "moderator", actor_public_id: MODERATOR },
      "m513m-product-decide",
    );
    expect(moderated.status, moderated.text).toBe(201);
    const stocked = await market(
      "POST",
      `/products/${productId}/inventory`,
      { quantity_delta: STOCK, reason_code: "restock", actor_public_id: OWNER },
      "m513m-inventory",
    );
    expect(stocked.status, stocked.text).toBe(201);
    const published = await market("POST", `/products/${productId}/publish`, { actor_public_id: OWNER }, "m513m-publish");
    expect(published.status, published.text).toBe(200);
    return productId;
  }

  async function onHand(productId: string): Promise<number> {
    const read = await market("GET", `/products/${productId}`);
    expect(read.status, read.text).toBe(200);
    return read.body.quantity_on_hand as number;
  }

  async function inventoryState(orderId: string): Promise<string> {
    const r = await gate.pool.query<{ inventory_state: string }>(
      `SELECT inventory_state FROM store_orders WHERE order_id = $1`,
      [orderId],
    );
    return r.rows[0].inventory_state;
  }

  it("صنفانِ ⇒ 201 `reserved`، صفّانِ بمرجعٍ واحدٍ، والإلغاءُ يُعيدُ الكميّتَينِ بالضبطِ", async () => {
    await openStore();
    const a = await publish("SKU-M513M-A", UNIT_PRICE_MINOR_UNITS);
    const b = await publish("SKU-M513M-B", 1250);

    const placed = await callDelivery(gate, {
      method: "POST",
      path: "/store-orders",
      body: {
        customer_ref: CUSTOMER,
        store_slug: STORE_SLUG,
        items: [
          { product_id: a, quantity: 2 },
          { product_id: b, quantity: 3 },
        ],
        delivery_fee_minor_units: DELIVERY_FEE_MINOR_UNITS,
      },
      idempotencyKey: nextKey("m513m-place"),
    });
    expect(placed.status, placed.text).toBe(201);
    expect(placed.body.items_total_minor_units).toBe(2 * UNIT_PRICE_MINOR_UNITS + 3 * 1250);
    const publicId = placed.body.public_id as string;
    const orderId = placed.body.order_id as string;
    expect(await inventoryState(orderId)).toBe("reserved");

    // الخصمُ حقيقيٌّ في السوقِ — لا مُدَّعى في التوصيل.
    expect(await onHand(a)).toBe(STOCK - 2);
    expect(await onHand(b)).toBe(STOCK - 3);

    const rows = await gate.pool.query<{ product_id: string; quantity_reserved: number; marketplace_reservation_ref: string; status: string }>(
      `SELECT product_id, quantity_reserved, marketplace_reservation_ref, status
         FROM delivery_inventory_reservations WHERE order_id = $1`,
      [orderId],
    );
    expect(rows.rowCount).toBe(2);
    expect(new Set(rows.rows.map((r) => r.marketplace_reservation_ref)).size).toBe(1);
    expect(Object.fromEntries(rows.rows.map((r) => [r.product_id, r.quantity_reserved]))).toEqual({ [a]: 2, [b]: 3 });
    expect(rows.rows.every((r) => r.status === "active")).toBe(true);

    const cancelKey = nextKey("m513m-cancel");
    const cancel = await callDelivery(gate, {
      method: "POST",
      path: `/store-orders/${publicId}/cancellation`,
      body: { reason_code: "CUSTOMER_CHANGED_MIND" },
      idempotencyKey: cancelKey,
    });
    expect(cancel.status, cancel.text).toBe(200);
    expect(cancel.body.fulfillment_state).toBe("cancelled");
    expect(await inventoryState(orderId)).toBe("released");

    expect(await onHand(a)).toBe(STOCK);
    expect(await onHand(b)).toBe(STOCK);

    const released = await gate.pool.query<{ status: string }>(
      `SELECT status FROM delivery_inventory_reservations WHERE order_id = $1`,
      [orderId],
    );
    expect(released.rows.map((r) => r.status)).toEqual(["released", "released"]);

    // الإعادةُ بنفسِ المفتاحِ تُطابقُ الجوابَ الأوّلَ حرفاً ولا تُطلِقُ مرّةً ثانيةً.
    const replay = await callDelivery(gate, {
      method: "POST",
      path: `/store-orders/${publicId}/cancellation`,
      body: { reason_code: "CUSTOMER_CHANGED_MIND" },
      idempotencyKey: cancelKey,
    });
    expect(replay.status, replay.text).toBe(200);
    expect(replay.body).toEqual(cancel.body);
    expect(await onHand(a)).toBe(STOCK);
    expect(await onHand(b)).toBe(STOCK);
  });
});
