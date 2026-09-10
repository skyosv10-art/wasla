/**
 * Store-order Postgres integration tests (review 6/N).
 *
 * These run against a REAL PostgreSQL (`DATABASE_URL`), because the promises
 * this adapter makes are database promises: one transaction per command, an
 * outbox row per state change, a version check under `SELECT ... FOR UPDATE`,
 * and a public id from a sequence. A fake cannot fail the way a CHECK
 * constraint fails, and the constraints are half of the design.
 *
 * They SKIP without `DATABASE_URL` — see
 * `docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { PG_ENABLED, resetData, setupPostgres } from "./pg-harness.js";
import { StoreOrderStore } from "../infrastructure/store-order-store.js";
import { buildDeliveryHttpApp } from "../http/app.js";
import { FakeCatalog, FakeReservationPort, FakeReservationStore, CUSTOMER_REF, PRODUCT_A, PRODUCT_B, STORE_SLUG, uuidSequence } from "./store-order-fakes.js";
import { placeStoreOrder } from "../use-cases/place-store-order.js";
import { cancelStoreOrder } from "../use-cases/cancel-store-order.js";
import { isDeliveryError } from "../domain/errors.js";
import type { StoreOrder } from "../domain/model.js";

const NOW = "2026-09-10T10:00:00.000Z";

/**
 * Unwrap an "applied" outcome (review 7/N).
 *
 * These cases send no `Idempotency-Key`, so the use case can only answer
 * `applied`; a replay here would mean the adapter invented a key, and throwing
 * says so instead of letting `undefined` leak into an assertion.
 */
async function applyPlacement(...args: Parameters<typeof placeStoreOrder>): Promise<StoreOrder> {
  const result = await placeStoreOrder(...args);
  if (result.kind !== "applied") throw new Error("unexpected idempotent replay on placement");
  return result.order;
}

async function applyCancellation(...args: Parameters<typeof cancelStoreOrder>): Promise<StoreOrder> {
  const result = await cancelStoreOrder(...args);
  if (result.kind !== "applied") throw new Error("unexpected idempotent replay on cancellation");
  return result.order;
}


describe.skipIf(!PG_ENABLED)("store-order store — PostgreSQL", () => {
  let pool: Pool;
  let close: () => Promise<void>;
  let store: StoreOrderStore;

  beforeAll(async () => {
    const fixture = await setupPostgres();
    pool = fixture.pool;
    close = fixture.close;
    store = new StoreOrderStore(pool);
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetData(pool);
  });

  const deps = () => ({
    catalogPort: new FakeCatalog(),
    writePort: store,
    readPort: store,
    reservationPort: new FakeReservationPort(),
    reservationStore: new FakeReservationStore(),
    newUuid: uuidSequence(`${Math.floor(Math.random() * 0xfffffff).toString(16).padStart(8, "0")}`),
    now: () => NOW,
  });

  const placement = {
    customer_ref: CUSTOMER_REF,
    store_slug: STORE_SLUG,
    items: [
      { product_id: PRODUCT_A, quantity: 2 },
      { product_id: PRODUCT_B, quantity: 3 },
    ],
    delivery_fee_minor_units: 500,
  };

  it("issues public ids from the sequence, in WS- shape and never repeated", async () => {
    const a = await store.nextOrderPublicId();
    const b = await store.nextOrderPublicId();
    expect(a).toMatch(/^WS-[0-9]{10}$/);
    expect(b).not.toBe(a);
  });

  it("places an order writing rows, ledger and outbox in ONE transaction", async () => {
    const order = await applyPlacement(deps(), placement, "trace-1");

    const rows = await pool.query(
      `SELECT fulfillment_state, payment_state, items_total_minor_units,
              delivery_fee_minor_units, total_minor_units, version, placed_at
         FROM store_orders WHERE public_id = $1`,
      [order.publicId],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].fulfillment_state).toBe("placed");
    expect(Number(rows.rows[0].items_total_minor_units)).toBe(2750);
    expect(Number(rows.rows[0].total_minor_units)).toBe(3250);
    expect(rows.rows[0].placed_at).not.toBeNull();

    const items = await pool.query(
      `SELECT line_no, quantity, unit_price_minor_units, line_total_minor_units
         FROM store_order_items WHERE order_id = $1 ORDER BY line_no`,
      [order.orderId],
    );
    expect(items.rows.map((r) => Number(r.line_total_minor_units))).toEqual([2000, 750]);

    const ledger = await pool.query(
      `SELECT from_state, to_state, reason_code, actor_type
         FROM store_order_transitions WHERE order_id = $1`,
      [order.orderId],
    );
    expect(ledger.rows).toEqual([
      { from_state: "draft", to_state: "placed", reason_code: "CART_CONFIRMED", actor_type: "customer" },
    ]);

    const task = await pool.query(`SELECT state FROM delivery_tasks WHERE order_id = $1`, [order.orderId]);
    expect(task.rows[0].state).toBe("pending_eligibility");

    const outbox = await pool.query(
      `SELECT event_type, aggregate_type, trace_id FROM delivery_outbox ORDER BY outbox_id`,
    );
    expect(outbox.rows.map((r) => r.event_type)).toEqual([
      "store_order.created",
      "delivery.task_created",
    ]);
    expect(outbox.rows.every((r) => r.trace_id === "trace-1")).toBe(true);
  });

  it("reads back an order and its task by public id", async () => {
    const placed = await applyPlacement(deps(), placement, null);
    const read = await store.getOrderByPublicId(placed.publicId);
    expect(read?.totalMinorUnits).toBe(3250);
    expect(read?.items).toHaveLength(2);
    const task = await store.getTaskByOrderPublicId(placed.publicId);
    expect(task?.state).toBe("pending_eligibility");
    expect(await store.getOrderByPublicId("WS-0009999999")).toBeNull();
    expect(await store.getTaskByOrderPublicId("WS-0009999999")).toBeNull();
  });

  it("cancels an order, appends both ledger rows it owes, and bumps the version", async () => {
    const placed = await applyPlacement(deps(), placement, null);
    const cancelled = await applyCancellation(deps(), placed.publicId, "CUSTOMER_CHANGED_MIND", "trace-2");

    expect(cancelled.fulfillmentState).toBe("cancelled");
    expect(cancelled.version).toBe(2);

    const row = await pool.query(
      `SELECT cancelled_at, version FROM store_orders WHERE public_id = $1`,
      [placed.publicId],
    );
    expect(row.rows[0].cancelled_at).not.toBeNull();
    expect(Number(row.rows[0].version)).toBe(2);

    const ledger = await pool.query(
      `SELECT to_state, reason_code FROM store_order_transitions
        WHERE order_id = $1 ORDER BY transition_id`,
      [placed.orderId],
    );
    expect(ledger.rows.map((r) => r.to_state)).toEqual(["placed", "cancelled"]);
    expect(ledger.rows[1].reason_code).toBe("CUSTOMER_CHANGED_MIND");

    // The task keeps `pending_eligibility`: §3.3 publishes no edge from it and
    // the adapter invents none (declared in ADR-026 §4.9-1).
    const task = await pool.query(`SELECT state FROM delivery_tasks WHERE order_id = $1`, [placed.orderId]);
    expect(task.rows[0].state).toBe("pending_eligibility");

    const outbox = await pool.query(`SELECT event_type FROM delivery_outbox ORDER BY outbox_id`);
    expect(outbox.rows.map((r) => r.event_type)).toEqual([
      "store_order.created",
      "delivery.task_created",
      "store_order.fulfillment_state_changed",
    ]);
  });

  it("cancels the task too, with its own ledger row, when §3.3 has the edge", async () => {
    const placed = await applyPlacement(deps(), placement, null);
    await pool.query(`UPDATE delivery_tasks SET state = 'eligible' WHERE order_id = $1`, [placed.orderId]);

    await applyCancellation(deps(), placed.publicId, "DELIVERY_NOT_FEASIBLE", null);

    const task = await pool.query(
      `SELECT state, version FROM delivery_tasks WHERE order_id = $1`,
      [placed.orderId],
    );
    expect(task.rows[0].state).toBe("cancelled");
    expect(Number(task.rows[0].version)).toBe(2);

    const ledger = await pool.query(
      `SELECT from_state, to_state, actor_type FROM delivery_task_transitions WHERE task_id = $1`,
      [(await store.getTaskByOrderPublicId(placed.publicId))?.taskId],
    );
    expect(ledger.rows).toEqual([
      { from_state: "eligible", to_state: "cancelled", actor_type: "customer" },
    ]);
  });

  it("refuses a stale cancellation with DELIVERY_CONCURRENT_UPDATE and writes nothing", async () => {
    const placed = await applyPlacement(deps(), placement, null);
    // Someone else moved the order between the read and the write.
    await pool.query(
      `UPDATE store_orders SET fulfillment_state = 'confirmed', version = version + 1 WHERE order_id = $1`,
      [placed.orderId],
    );

    const before = await pool.query(`SELECT count(*)::int AS n FROM delivery_outbox`);
    try {
      await store.cancelOrder({
        orderId: placed.orderId,
        expectedVersion: 1, // stale on purpose
        fromFulfillmentState: "placed",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        taskCancellation: null,
        events: [],
        traceId: null,
      });
      expect.unreachable("a stale version must be refused");
    } catch (error) {
      expect(isDeliveryError(error) && error.code).toBe("DELIVERY_CONCURRENT_UPDATE");
    }
    const after = await pool.query(`SELECT count(*)::int AS n FROM delivery_outbox`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const row = await pool.query(`SELECT fulfillment_state FROM store_orders WHERE order_id = $1`, [
      placed.orderId,
    ]);
    expect(row.rows[0].fulfillment_state).toBe("confirmed");
  });

  it("rolls back the whole placement when one row violates a constraint", async () => {
    // A delivery fee the CHECK rejects (negative) reaches the DB only if the
    // domain is bypassed — which is exactly what this test does, to prove the
    // transaction boundary rather than the validator.
    const before = await pool.query(`SELECT count(*)::int AS n FROM store_orders`);
    await expect(
      store.placeOrder({
        order: {
          orderId: "eeeeeeee-0000-4000-8000-000000000001",
          publicId: "WS-0009999001",
          customerRef: CUSTOMER_REF,
          storeId: "cccccccc-0000-4000-8000-000000000003",
          storeSlug: STORE_SLUG,
          fulfillmentState: "placed",
          paymentState: "pending",
          paymentRef: null,
          inventoryState: "none",
          inventoryRef: null,
          currencyCode: "SAR",
          itemsTotalMinorUnits: 100,
          deliveryFeeMinorUnits: -1,
          totalMinorUnits: 99,
          items: [],
          version: 1,
        },
        task: {
          taskId: "eeeeeeee-0000-4000-8000-000000000002",
          orderId: "eeeeeeee-0000-4000-8000-000000000001",
          state: "pending_eligibility",
          ineligibilityReason: null,
          dispatchJobRef: null,
          courierRef: null,
          proof: null,
          version: 1,
        },
        events: [],
        traceId: null,
      }),
    ).rejects.toThrow();
    const after = await pool.query(`SELECT count(*)::int AS n FROM store_orders`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("serves the real HTTP boundary end to end over Postgres", async () => {
    const app = buildDeliveryHttpApp({
      readPort: store,
      writePort: store,
      catalogPort: new FakeCatalog(),
      reservationPort: new FakeReservationPort(),
      reservationStore: new FakeReservationStore(),
      newUuid: uuidSequence("ffffffff"),
      now: () => NOW,
    });

    const created = await app.fastify.inject({
      method: "POST",
      url: "/store-orders",
      headers: { "idempotency-key": "pg-e2e-placement-000001" },
      payload: placement,
    });
    expect(created.statusCode).toBe(201);
    const publicId = created.json().public_id;

    const read = await app.fastify.inject({ method: "GET", url: `/store-orders/${publicId}` });
    expect(read.statusCode).toBe(200);
    expect(read.json().total_minor_units).toBe(3250);

    const task = await app.fastify.inject({
      method: "GET",
      url: `/store-orders/${publicId}/delivery-task`,
    });
    expect(task.statusCode).toBe(200);
    expect(task.json().state).toBe("pending_eligibility");

    const cancelled = await app.fastify.inject({
      method: "POST",
      url: `/store-orders/${publicId}/cancellation`,
      headers: { "idempotency-key": "pg-e2e-cancellation-0001" },
      payload: { reason_code: "CUSTOMER_CHANGED_MIND" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().fulfillment_state).toBe("cancelled");

    const again = await app.fastify.inject({
      method: "POST",
      url: `/store-orders/${publicId}/cancellation`,
      // A DIFFERENT key: this is a new request, not a retry, so it must meet
      // the state machine and be refused — not replayed (review 7/N).
      headers: { "idempotency-key": "pg-e2e-cancellation-0002" },
      payload: { reason_code: "CUSTOMER_CHANGED_MIND" },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error_code).toBe("DELIVERY_CANCEL_NOT_ALLOWED");

    await app.close();
  });
});
