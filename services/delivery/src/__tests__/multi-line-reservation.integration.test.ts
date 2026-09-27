/**
 * M5-13M (CLM-0378 · ADR-026 ملحق M5-13M): طلبُ متجرٍ متعدِّدُ الأصنافِ على PostgreSQL حقيقيّ.
 *
 * العيب: `delivery_inventory_reservations` صفٌّ لكلِّ صنف، ومرجعُ حجزِ السوقِ واحدٌ للطلبِ
 * كلِّهِ؛ فكان `UNIQUE (marketplace_reservation_ref)` يُسقِطُ الصنفَ الثانيَ (`23505` → 500)
 * بعدَ أن خصمَ السوقُ الكميّات. واختباراتُ التكاملِ متعدِّدةُ الأصنافِ لم ترَهُ لأنَّها ركّبت
 * `FakeReservationStore` لا يكتبُ شيئاً. هنا **مخزنُ الحجوزاتِ هوَ `StoreOrderStore` نفسُهُ**.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DeliveryError } from "../domain/errors.js";
import { toStoreOrderResponse } from "../http/mappers.js";
import { StoreOrderStore } from "../infrastructure/store-order-store.js";
import type { IdempotencyIntent, InventoryReservationPort, ReleaseRequest, ReservationRequest } from "../ports.js";
import { cancelStoreOrder } from "../use-cases/cancel-store-order.js";
import { placeStoreOrder } from "../use-cases/place-store-order.js";
import { PG_ENABLED, resetData, setupPostgres } from "./pg-harness.js";
import { CUSTOMER_REF, FakeCatalog, PRODUCT_A, PRODUCT_B, STORE_SLUG, uuidSequence } from "./store-order-fakes.js";

const NOW = "2026-09-27T12:00:00.000Z";
const RUNBOOK = resolve(process.cwd(), "..", "..", "docs", "14-runbooks", "DELIVERY_UNRESERVED_ORDERS.md");
const DOWN_0005 = resolve(process.cwd(), "drizzle", "0005_reservation_ref_per_order.down.sql");

function placementIntent(key: string): IdempotencyIntent {
  return {
    key,
    route: "POST /store-orders",
    fingerprint: "a".repeat(64),
    responseStatus: 201,
    buildResponseBody: (order) => toStoreOrderResponse(order),
  };
}

/** منفذُ حجزٍ يُسجِّلُ ما طُلِبَ منهُ — ومرجعُهُ واحدٌ للطلبِ كما يفعلُ السوق. */
class RecordingReservationPort implements InventoryReservationPort {
  readonly reserved: ReservationRequest[] = [];
  readonly released: ReleaseRequest[] = [];
  async reserve(req: ReservationRequest) {
    this.reserved.push(req);
    return { reserved: true, reservationRef: `mkt-res-${req.orderPublicId}` };
  }
  async release(req: ReleaseRequest) {
    this.released.push(req);
    return { released: true };
  }
}

function sqlChunks(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.split("\n").some((l) => l.trim().length > 0 && !l.trimStart().startsWith("--")));
}

describe.skipIf(!PG_ENABLED)("M5-13M — multi-line store order reservations on PostgreSQL", () => {
  let pool: Pool;
  let close: () => Promise<void>;
  let store: StoreOrderStore;

  beforeAll(async () => {
    const fixture = await setupPostgres();
    pool = fixture.pool;
    close = fixture.close;
    store = new StoreOrderStore(pool);
  });
  afterAll(async () => close());
  beforeEach(async () => resetData(pool));

  const deps = (port: RecordingReservationPort) => ({
    catalogPort: new FakeCatalog(),
    writePort: store,
    readPort: store,
    reservationPort: port,
    reservationStore: store,
    newUuid: uuidSequence(Math.floor(Math.random() * 0xfffffff).toString(16).padStart(8, "0")),
    now: () => NOW,
  });

  const twoLines = {
    customer_ref: CUSTOMER_REF,
    store_slug: STORE_SLUG,
    items: [
      { product_id: PRODUCT_A, quantity: 2 },
      { product_id: PRODUCT_B, quantity: 3 },
    ],
    delivery_fee_minor_units: 500,
  };

  async function placeTwoLines(port: RecordingReservationPort) {
    const r = await placeStoreOrder(deps(port), twoLines, "trace-m513m");
    if (r.kind !== "applied") throw new Error("unexpected idempotent replay on placement");
    return r.order;
  }

  it("a two-line order is placed and reserved: two rows share the order's marketplace ref", async () => {
    const port = new RecordingReservationPort();
    const order = await placeTwoLines(port);

    expect(order.inventoryState).toBe("reserved");
    expect(port.reserved).toHaveLength(1);
    expect(port.reserved[0].items).toHaveLength(2);

    const rows = await pool.query<{ product_id: string; quantity_reserved: number; marketplace_reservation_ref: string; status: string }>(
      `SELECT product_id, quantity_reserved, marketplace_reservation_ref, status
         FROM delivery_inventory_reservations WHERE order_id = $1 ORDER BY product_id`,
      [order.orderId],
    );
    expect(rows.rows).toEqual([
      { product_id: PRODUCT_A, quantity_reserved: 2, marketplace_reservation_ref: `mkt-res-${order.publicId}`, status: "active" },
      { product_id: PRODUCT_B, quantity_reserved: 3, marketplace_reservation_ref: `mkt-res-${order.publicId}`, status: "active" },
    ]);
    const reservedEvents = await pool.query(
      `SELECT 1 FROM delivery_outbox WHERE aggregate_id = $1 AND event_type = 'store_order.inventory_reserved'`,
      [order.orderId],
    );
    expect(reservedEvents.rowCount).toBe(1);
  });

  it("cancelling a two-line order releases BOTH lines at the marketplace, once", async () => {
    const port = new RecordingReservationPort();
    const order = await placeTwoLines(port);
    const cancelled = await cancelStoreOrder(deps(port), order.publicId, "CUSTOMER_CHANGED_MIND", "trace-cancel");
    expect(cancelled.kind).toBe("applied");

    expect(port.released).toHaveLength(1);
    expect(port.released[0].reservationRef).toBe(`mkt-res-${order.publicId}`);
    expect([...port.released[0].items].sort((a, b) => a.productId.localeCompare(b.productId))).toEqual([
      { productId: PRODUCT_A, quantity: 2 },
      { productId: PRODUCT_B, quantity: 3 },
    ]);
    const statuses = await pool.query<{ status: string }>(
      `SELECT status FROM delivery_inventory_reservations WHERE order_id = $1`,
      [order.orderId],
    );
    expect(statuses.rows.map((r) => r.status)).toEqual(["released", "released"]);
    const after = await store.getOrderByPublicId(order.publicId);
    expect(after?.inventoryState).toBe("released");
  });

  it("a product cannot be reserved twice in one order — per-order uniqueness still holds", async () => {
    const port = new RecordingReservationPort();
    const order = await placeTwoLines(port);
    await expect(
      store.saveReservations(order.orderId, [
        {
          reservationId: "eeeeeeee-0000-4000-8000-000000000001",
          orderId: order.orderId,
          storeSlug: STORE_SLUG,
          productId: PRODUCT_A,
          sku: "SKU-dup",
          quantityReserved: 1,
          unitPriceMinorUnits: 100,
          marketplaceReservationRef: `mkt-res-${order.publicId}`,
          status: "active",
          reservedAt: NOW,
          traceId: null,
        },
      ]),
    ).rejects.toMatchObject({ code: "23505", constraint: "delivery_inventory_reservations_order_id_product_id_key" });
  });

  it("the catalog carries UNIQUE (order_id, product_id) and no UNIQUE on marketplace_reservation_ref alone", async () => {
    const r = await pool.query<{ conname: string; cols: string }>(
      `SELECT c.conname, string_agg(a.attname, ',' ORDER BY a.attname) AS cols
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = 'delivery_inventory_reservations'::regclass AND c.contype IN ('u','p')
        GROUP BY c.conname ORDER BY c.conname`,
    );
    expect(r.rows).toEqual([
      { conname: "delivery_inventory_reservations_order_id_product_id_key", cols: "order_id,product_id" },
      { conname: "delivery_inventory_reservations_pkey", cols: "reservation_id" },
    ]);
  });

  it("0005 down refuses while a multi-line order shares a ref — and succeeds once none does", async () => {
    const port = new RecordingReservationPort();
    await placeTwoLines(port);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let refused: unknown = null;
      try {
        for (const chunk of sqlChunks(DOWN_0005)) await client.query(chunk);
      } catch (e) {
        refused = e;
      }
      expect(String((refused as Error | null)?.message)).toMatch(/M5-13M rollback refused: 1 marketplace_reservation_ref/);
      await client.query("ROLLBACK");
      const rows = await pool.query(`SELECT count(*)::int AS n FROM delivery_inventory_reservations`);
      expect(rows.rows[0].n).toBe(2);

      // بلا تكرارٍ يمرُّ الترجعُ ويعودُ القيد — داخلَ معاملةٍ تُلغى كي لا يمسَّ بقيّةَ الملفّات.
      await client.query("BEGIN");
      await client.query(`DELETE FROM delivery_inventory_reservations`);
      for (const chunk of sqlChunks(DOWN_0005)) await client.query(chunk);
      const restored = await client.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'delivery_inventory_reservations_marketplace_reservation_ref_key'`,
      );
      expect(restored.rowCount).toBe(1);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("healing by retry: reserve unavailable on the first attempt → the SAME key's retry reserves the SAME order", async () => {
    const failing = new RecordingReservationPort();
    failing.reserve = async () => {
      throw new DeliveryError("DELIVERY_MARKETPLACE_UNAVAILABLE", "down", {});
    };
    const key = "m513m-heal-reserve-0001";
    await expect(placeStoreOrder(deps(failing), twoLines, "t-1", placementIntent(key))).rejects.toMatchObject({
      code: "DELIVERY_MARKETPLACE_UNAVAILABLE",
    });
    const stuck = await pool.query<{ public_id: string; inventory_state: string }>(`SELECT public_id, inventory_state FROM store_orders`);
    expect(stuck.rows).toHaveLength(1);
    expect(stuck.rows[0].inventory_state).toBe("none");

    const port = new RecordingReservationPort();
    const healed = await placeStoreOrder(deps(port), twoLines, "t-2", placementIntent(key));
    expect(healed.kind).toBe("applied");
    // the stored order — not a phantom id drawn for the retry — is the one reserved
    expect(port.reserved.map((r) => r.orderPublicId)).toEqual([stuck.rows[0].public_id]);
    const after = await pool.query<{ inventory_state: string }>(`SELECT inventory_state FROM store_orders`);
    expect(after.rows).toEqual([{ inventory_state: "reserved" }]);
    const rows = await pool.query(`SELECT 1 FROM delivery_inventory_reservations`);
    expect(rows.rowCount).toBe(2);

    // and a further retry is a plain replay: no new reserve, no new rows
    const again = await placeStoreOrder(deps(port), twoLines, "t-3", placementIntent(key));
    expect(again.kind).toBe("replayed");
    expect(port.reserved).toHaveLength(1);
  });

  it("healing by retry after rows were saved but the mirror failed: no duplicate rows, order becomes reserved", async () => {
    const port = new RecordingReservationPort();
    const key = "m513m-heal-mirror-0001";
    const flaky = deps(port);
    const realMirror = store.mirrorInventoryState.bind(store);
    let failOnce = true;
    const writePort = Object.create(store) as StoreOrderStore;
    writePort.mirrorInventoryState = async (w) => {
      if (failOnce) {
        failOnce = false;
        throw Object.assign(new Error("connection reset"), { code: "08006" });
      }
      return realMirror(w);
    };
    await expect(placeStoreOrder({ ...flaky, writePort }, twoLines, "t-1", placementIntent(key))).rejects.toThrow("connection reset");
    expect((await pool.query(`SELECT 1 FROM delivery_inventory_reservations`)).rowCount).toBe(2);

    const healed = await placeStoreOrder({ ...flaky, writePort }, twoLines, "t-2", placementIntent(key));
    expect(healed.kind).toBe("applied");
    expect((await pool.query(`SELECT 1 FROM delivery_inventory_reservations`)).rowCount).toBe(2);
    expect((await pool.query<{ inventory_state: string }>(`SELECT inventory_state FROM store_orders`)).rows).toEqual([
      { inventory_state: "reserved" },
    ]);
  });

  it("the runbook's detection query (read from the runbook itself) finds a stuck order and ignores healthy ones", async () => {
    const sqlBlock = /```sql\n(-- runbook:unreserved-orders\n[\s\S]*?)```/u.exec(readFileSync(RUNBOOK, "utf8"));
    expect(sqlBlock, "runbook SQL block missing").not.toBeNull();
    const query = sqlBlock![1];

    const healthy = await placeTwoLines(new RecordingReservationPort());
    const failing = new RecordingReservationPort();
    failing.reserve = async () => {
      throw new DeliveryError("DELIVERY_MARKETPLACE_UNAVAILABLE", "down", {});
    };
    await expect(placeStoreOrder(deps(failing), twoLines, "t-stuck")).rejects.toBeInstanceOf(DeliveryError);

    // fresh stuck order: inside the threshold → not reported yet
    expect((await pool.query(query)).rowCount).toBe(0);

    await pool.query(`UPDATE store_orders SET created_at = now() - interval '1 hour' WHERE inventory_state = 'none'`);
    await pool.query(`UPDATE store_orders SET created_at = now() - interval '1 hour' WHERE order_id = $1`, [healthy.orderId]);
    const found = await pool.query<{ public_id: string; active_reservation_rows: string }>(query);
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0].public_id).not.toBe(healthy.publicId);
    expect(found.rows[0].active_reservation_rows).toBe("0");
  });
});
