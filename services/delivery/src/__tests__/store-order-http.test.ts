/**
 * Delivery HTTP boundary tests (review 6/N) — the contract as executable
 * assertions.
 *
 * These tests exist to catch the failures a reading of the code does not: the
 * error body field is `error_code` (not search's `code`), a refused
 * cancellation is 409 and not 200, an unknown error is 500 and not 503, and a
 * missing catalog port refuses placement instead of inventing a price.
 */

import { describe, expect, it } from "vitest";

import { buildDeliveryHttpApp } from "../http/app.js";
import { DeliveryError } from "../domain/errors.js";
import {
  CUSTOMER_REF,
  FakeCatalog,
  FakeReadinessProbe,
  FakeStoreOrderStore,
  PRODUCT_A,
  PRODUCT_B,
  STORE_SLUG,
  fixedOrder,
  fixedTask,
  uuidSequence,
} from "./store-order-fakes.js";

const NOW = "2026-09-10T10:00:00.000Z";

/**
 * A fresh, valid `Idempotency-Key` per request (review 7/N).
 *
 * Both writes now REQUIRE the header, so every pre-existing case gets a unique
 * one: a shared constant would make the second placement in a file a replay of
 * the first and quietly turn an assertion about creation into an assertion
 * about caching.
 */
let idempotencyCounter = 0;
function idempotencyHeaders(): Record<string, string> {
  idempotencyCounter += 1;
  return { "idempotency-key": `http-test-key-${String(idempotencyCounter).padStart(6, "0")}` };
}


function buildApp(options: { store?: FakeStoreOrderStore; catalog?: FakeCatalog | null } = {}) {
  const store = options.store ?? new FakeStoreOrderStore();
  const catalog = options.catalog === null ? undefined : (options.catalog ?? new FakeCatalog());
  const app = buildDeliveryHttpApp({
    readPort: store,
    writePort: store,
    catalogPort: catalog,
    newUuid: uuidSequence(),
    now: () => NOW,
  });
  return { app, store };
}

describe("delivery HTTP — liveness", () => {
  it("GET /delivery/health answers ok with no dependency", async () => {
    const { app } = buildApp({ catalog: null });
    const res = await app.fastify.inject({ method: "GET", url: "/delivery/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("GET /delivery/health stays a pure liveness answer — it never probes", async () => {
    // A read port that explodes: liveness must still say ok, because the
    // process IS alive. Conflating the two is how a database blip restarts
    // every pod at once.
    const app = buildDeliveryHttpApp({
      readPort: {
        getOrderByPublicId: async () => {
          throw new Error("database down");
        },
        getTaskByOrderPublicId: async () => null,
        findIdempotentResponse: async () => null,
      },
      writePort: new FakeStoreOrderStore(),
      newUuid: uuidSequence(),
      now: () => NOW,
    });
    const res = await app.fastify.inject({ method: "GET", url: "/delivery/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });
});

describe("delivery HTTP — readiness (§4.10-2)", () => {
  it("200 ready when the probed database answers, with the catalog gap declared", async () => {
    const store = new FakeStoreOrderStore();
    const app = buildDeliveryHttpApp({
      readPort: store,
      writePort: store,
      catalogPort: new FakeCatalog(),
      readinessPort: new FakeReadinessProbe([{ name: "database", ok: true }]),
      newUuid: uuidSequence(),
      now: () => NOW,
    });
    const res = await app.fastify.inject({ method: "GET", url: "/delivery/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "ready",
      checks: [{ name: "database", ok: true }],
      // المراجعةُ 8/N: المنفذُ موصولٌ هنا، والجاهزيّةُ **لا تسبرُهُ** — ففراغُ
      // `not_claimed` كانَ سيُقرأُ «تحقّقنا من السوقِ» ولم يتحقّقْ أحدٌ.
      not_claimed: ["marketplace_catalog_not_probed"],
    });
    await app.close();
  });

  it("503 unavailable with the failure reason when the probe fails", async () => {
    const store = new FakeStoreOrderStore();
    const app = buildDeliveryHttpApp({
      readPort: store,
      writePort: store,
      readinessPort: new FakeReadinessProbe([{ name: "database", ok: false, detail: "unreachable" }]),
      newUuid: uuidSequence(),
      now: () => NOW,
    });
    const res = await app.fastify.inject({ method: "GET", url: "/delivery/ready" });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe("unavailable");
    expect(body.checks).toEqual([{ name: "database", ok: false, detail: "unreachable" }]);
    // منفذٌ غيرُ موصولٍ في هذا التركيبِ: يُعلَنُ ولا يُقاسُ (RISK-0030).
    expect(body.not_claimed).toEqual(["marketplace_catalog_not_wired"]);
    await app.close();
  });

  it("503 with probe_not_wired rather than a green answer when no probe is injected", async () => {
    const { app } = buildApp();
    const res = await app.fastify.inject({ method: "GET", url: "/delivery/ready" });
    // "No checks failed" must never be reachable by performing no checks.
    expect(res.statusCode).toBe(503);
    expect(res.json().checks).toEqual([{ name: "database", ok: false, detail: "probe_not_wired" }]);
    await app.close();
  });
});

describe("delivery HTTP — idempotency (§4.10-1)", () => {
  const placement = {
    customer_ref: CUSTOMER_REF,
    store_slug: STORE_SLUG,
    items: [{ product_id: PRODUCT_A, quantity: 1 }],
    delivery_fee_minor_units: 500,
  };
  const KEY = "idem-http-000000000001";

  it("400s a placement with no Idempotency-Key — the header is required", async () => {
    const { app } = buildApp();
    const res = await app.fastify.inject({ method: "POST", url: "/store-orders", payload: placement });
    expect(res.statusCode).toBe(400);
    expect(res.json().error_code).toBe("DELIVERY_VALIDATION_FAILED");
    await app.close();
  });

  it("400s a key that is too short or carries illegal characters", async () => {
    const { app } = buildApp();
    for (const key of ["short", "has spaces in it here", "معرّفٌ-عربيٌّ-طويلٌ-جدًّا"]) {
      const res = await app.fastify.inject({
        method: "POST",
        url: "/store-orders",
        headers: { "idempotency-key": key },
        payload: placement,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error_code).toBe("DELIVERY_VALIDATION_FAILED");
    }
    await app.close();
  });

  it("replays the first response — one order, same body, Idempotent-Replay: true", async () => {
    const { app, store } = buildApp();
    const first = await app.fastify.inject({
      method: "POST",
      url: "/store-orders",
      headers: { "idempotency-key": KEY },
      payload: placement,
    });
    expect(first.statusCode).toBe(201);
    expect(first.headers["idempotent-replay"]).toBeUndefined();

    const retry = await app.fastify.inject({
      method: "POST",
      url: "/store-orders",
      headers: { "idempotency-key": KEY },
      payload: placement,
    });
    expect(retry.statusCode).toBe(201);
    expect(retry.headers["idempotent-replay"]).toBe("true");
    expect(retry.json()).toEqual(first.json());
    // The whole point: the retry created NOTHING.
    expect(store.orders.size).toBe(1);
    await app.close();
  });

  it("409s the same key sent with a different body — one key, one request", async () => {
    const { app, store } = buildApp();
    await app.fastify.inject({
      method: "POST",
      url: "/store-orders",
      headers: { "idempotency-key": KEY },
      payload: placement,
    });
    const res = await app.fastify.inject({
      method: "POST",
      url: "/store-orders",
      headers: { "idempotency-key": KEY },
      // Same key, different quantity — a client bug, not a retry.
      payload: { ...placement, items: [{ product_id: PRODUCT_A, quantity: 9 }] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error_code).toBe("DELIVERY_IDEMPOTENCY_KEY_REUSED");
    expect(store.orders.size).toBe(1);
    await app.close();
  });

  it("replays a cancellation retry instead of answering DELIVERY_INVALID_TRANSITION", async () => {
    const store = new FakeStoreOrderStore();
    store.seed(fixedOrder({ fulfillmentState: "placed" }), fixedTask({ state: "eligible" }));
    const { app } = buildApp({ store });
    const url = "/store-orders/WS-0000000001/cancellation";
    const first = await app.fastify.inject({
      method: "POST",
      url,
      headers: { "idempotency-key": KEY },
      payload: { reason_code: "CUSTOMER_CHANGED_MIND" },
    });
    expect(first.statusCode).toBe(200);

    const retry = await app.fastify.inject({
      method: "POST",
      url,
      headers: { "idempotency-key": KEY },
      payload: { reason_code: "CUSTOMER_CHANGED_MIND" },
    });
    // Without the read-side pre-check this would be 409 INVALID_TRANSITION,
    // because `cancelled → cancelled` is not an edge (§3.1).
    expect(retry.statusCode).toBe(200);
    expect(retry.headers["idempotent-replay"]).toBe("true");
    expect(retry.json()).toEqual(first.json());
    await app.close();
  });

  it("keeps a placement key and a cancellation key from colliding by route", async () => {
    const store = new FakeStoreOrderStore();
    store.seed(fixedOrder({ fulfillmentState: "placed" }), fixedTask({ state: "eligible" }));
    const { app } = buildApp({ store });
    await app.fastify.inject({
      method: "POST",
      url: "/store-orders/WS-0000000001/cancellation",
      headers: { "idempotency-key": KEY },
      payload: { reason_code: "CUSTOMER_CHANGED_MIND" },
    });
    // The same key on the OTHER route is a different request: the fingerprint
    // includes the route, so this is a reuse conflict — never a silent replay
    // of a cancellation body as a placement response.
    const res = await app.fastify.inject({
      method: "POST",
      url: "/store-orders",
      headers: { "idempotency-key": KEY },
      payload: placement,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error_code).toBe("DELIVERY_IDEMPOTENCY_KEY_REUSED");
    await app.close();
  });
});

describe("delivery HTTP — placement", () => {
  it("POST /store-orders returns 201 with totals computed from catalog prices", async () => {
    const { app, store } = buildApp();
    const res = await app.fastify.inject({
      method: "POST",
      headers: idempotencyHeaders(),
      url: "/store-orders",
      payload: {
        customer_ref: CUSTOMER_REF,
        store_slug: STORE_SLUG,
        items: [
          { product_id: PRODUCT_A, quantity: 2 },
          { product_id: PRODUCT_B, quantity: 3 },
        ],
        delivery_fee_minor_units: 500,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // 2×1000 + 3×250 = 2750, + 500 fee = 3250. Prices came from the catalog.
    expect(body.items_total_minor_units).toBe(2750);
    expect(body.total_minor_units).toBe(3250);
    expect(body.fulfillment_state).toBe("placed");
    expect(body.payment_state).toBe("pending");
    expect(body.public_id).toMatch(/^WS-[0-9]{10}$/);
    // The response NEVER carries the internal marketplace store uuid (§2.6).
    expect(body).not.toHaveProperty("store_id");
    // Both events were built in the domain and handed to the store together.
    expect(store.outbox.map((e) => e.event_type)).toEqual([
      "store_order.created",
      "delivery.task_created",
    ]);
    await app.close();
  });

  it("refuses placement with 503 when no catalog port is wired — never invents a price", async () => {
    const { app } = buildApp({ catalog: null });
    const res = await app.fastify.inject({
      method: "POST",
      headers: idempotencyHeaders(),
      url: "/store-orders",
      payload: {
        customer_ref: CUSTOMER_REF,
        store_slug: STORE_SLUG,
        items: [{ product_id: PRODUCT_A, quantity: 1 }],
        delivery_fee_minor_units: 0,
      },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error_code).toBe("DELIVERY_MARKETPLACE_UNAVAILABLE");
    await app.close();
  });

  it("rejects a caller-supplied price as an unknown field is ignored but the total stays catalog-derived", async () => {
    const { app } = buildApp();
    const res = await app.fastify.inject({
      method: "POST",
      headers: idempotencyHeaders(),
      url: "/store-orders",
      payload: {
        customer_ref: CUSTOMER_REF,
        store_slug: STORE_SLUG,
        items: [{ product_id: PRODUCT_A, quantity: 1, unit_price_minor_units: 1 }],
        delivery_fee_minor_units: 0,
      },
    });
    expect(res.statusCode).toBe(201);
    // The smuggled price is NOT honoured — the catalog price (1000) wins.
    expect(res.json().items_total_minor_units).toBe(1000);
    await app.close();
  });

  it("400s a non-integer quantity instead of coercing it", async () => {
    const { app } = buildApp();
    const res = await app.fastify.inject({
      method: "POST",
      headers: idempotencyHeaders(),
      url: "/store-orders",
      payload: {
        customer_ref: CUSTOMER_REF,
        store_slug: STORE_SLUG,
        items: [{ product_id: PRODUCT_A, quantity: "2" }],
        delivery_fee_minor_units: 0,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error_code).toBe("DELIVERY_VALIDATION_FAILED");
    await app.close();
  });

  it("400s a missing delivery fee — absent is not zero", async () => {
    const { app } = buildApp();
    const res = await app.fastify.inject({
      method: "POST",
      headers: idempotencyHeaders(),
      url: "/store-orders",
      payload: {
        customer_ref: CUSTOMER_REF,
        store_slug: STORE_SLUG,
        items: [{ product_id: PRODUCT_A, quantity: 1 }],
      },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("409s an unorderable store (DELIVERY_INELIGIBLE), 400s an unknown one", async () => {
    const closed = buildApp({
      catalog: new FakeCatalog({ storeId: "cccccccc-0000-4000-8000-000000000003", orderable: false }),
    });
    const payload = {
      customer_ref: CUSTOMER_REF,
      store_slug: STORE_SLUG,
      items: [{ product_id: PRODUCT_A, quantity: 1 }],
      delivery_fee_minor_units: 0,
    };
    const res = await closed.app.fastify.inject({ method: "POST", url: "/store-orders", payload, headers: idempotencyHeaders() });
    expect(res.statusCode).toBe(409);
    expect(res.json().error_code).toBe("DELIVERY_INELIGIBLE");
    await closed.app.close();

    const unknown = buildApp({ catalog: new FakeCatalog(null) });
    const res2 = await unknown.app.fastify.inject({ method: "POST", url: "/store-orders", payload, headers: idempotencyHeaders() });
    expect(res2.statusCode).toBe(400);
    expect(res2.json().error_code).toBe("DELIVERY_VALIDATION_FAILED");
    await unknown.app.close();
  });

  it("400s a product that is not in the store's catalog — not a 503", async () => {
    const { app } = buildApp({ catalog: new FakeCatalog(undefined, {}) });
    const res = await app.fastify.inject({
      method: "POST",
      headers: idempotencyHeaders(),
      url: "/store-orders",
      payload: {
        customer_ref: CUSTOMER_REF,
        store_slug: STORE_SLUG,
        items: [{ product_id: PRODUCT_A, quantity: 1 }],
        delivery_fee_minor_units: 0,
      },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("delivery HTTP — reads", () => {
  it("GET /store-orders/{id} returns the order, 404 for an unknown ref", async () => {
    const store = new FakeStoreOrderStore();
    store.seed(fixedOrder(), fixedTask());
    const { app } = buildApp({ store });

    const found = await app.fastify.inject({ method: "GET", url: "/store-orders/WS-0000000001" });
    expect(found.statusCode).toBe(200);
    expect(found.json().public_id).toBe("WS-0000000001");

    const missing = await app.fastify.inject({ method: "GET", url: "/store-orders/WS-0000009999" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error_code).toBe("DELIVERY_ORDER_NOT_FOUND");
    await app.close();
  });

  it("400s a malformed public id before it reaches the store", async () => {
    const { app } = buildApp();
    const res = await app.fastify.inject({ method: "GET", url: "/store-orders/ORD-1" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("distinguishes a missing TASK from a missing ORDER", async () => {
    const store = new FakeStoreOrderStore();
    store.seed(fixedOrder()); // order without a task
    const { app } = buildApp({ store });

    const noTask = await app.fastify.inject({
      method: "GET",
      url: "/store-orders/WS-0000000001/delivery-task",
    });
    expect(noTask.statusCode).toBe(404);
    expect(noTask.json().error_code).toBe("DELIVERY_TASK_NOT_FOUND");

    const noOrder = await app.fastify.inject({
      method: "GET",
      url: "/store-orders/WS-0000009999/delivery-task",
    });
    expect(noOrder.json().error_code).toBe("DELIVERY_ORDER_NOT_FOUND");
    await app.close();
  });

  it("the task response carries no name, phone or coordinate — opaque refs only (§2.6)", async () => {
    const store = new FakeStoreOrderStore();
    store.seed(fixedOrder(), fixedTask({ state: "driver_assigned", courierRef: CUSTOMER_REF }));
    const { app } = buildApp({ store });
    const res = await app.fastify.inject({
      method: "GET",
      url: "/store-orders/WS-0000000001/delivery-task",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().courier_ref).toMatch(/^WS-[0-9]{10}$/);
    expect(JSON.stringify(res.json())).not.toMatch(/phone|latitude|longitude|address|email/i);
    await app.close();
  });
});

describe("delivery HTTP — cancellation", () => {
  it("cancels a placed order and answers 200 with the new version", async () => {
    const store = new FakeStoreOrderStore();
    store.seed(fixedOrder(), fixedTask());
    const { app } = buildApp({ store });
    const res = await app.fastify.inject({
      method: "POST",
      headers: idempotencyHeaders(),
      url: "/store-orders/WS-0000000001/cancellation",
      payload: { reason_code: "CUSTOMER_CHANGED_MIND" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().fulfillment_state).toBe("cancelled");
    expect(res.json().version).toBe(2);
    // The task stays `pending_eligibility`: §3.3 publishes no edge from it,
    // and the boundary does not invent one (ADR-026 §4.9-1).
    expect(store.tasks.get("WS-0000000001")?.state).toBe("pending_eligibility");
    expect(store.outbox.map((e) => e.event_type)).toEqual([
      "store_order.fulfillment_state_changed",
    ]);
    await app.close();
  });

  it("cancels the task too when §3.3 publishes the edge (eligible → cancelled)", async () => {
    const store = new FakeStoreOrderStore();
    store.seed(fixedOrder(), fixedTask({ state: "eligible" }));
    const { app } = buildApp({ store });
    const res = await app.fastify.inject({
      method: "POST",
      headers: idempotencyHeaders(),
      url: "/store-orders/WS-0000000001/cancellation",
      payload: { reason_code: "CUSTOMER_CHANGED_MIND" },
    });
    expect(res.statusCode).toBe(200);
    expect(store.tasks.get("WS-0000000001")?.state).toBe("cancelled");
    expect(store.outbox.map((e) => e.event_type)).toEqual([
      "store_order.fulfillment_state_changed",
      "delivery.task_cancelled",
    ]);
    await app.close();
  });

  it("409s a cancellation from picking — §3.1 has no such edge", async () => {
    const store = new FakeStoreOrderStore();
    store.seed(fixedOrder({ fulfillmentState: "picking" }), fixedTask());
    const { app } = buildApp({ store });
    const res = await app.fastify.inject({
      method: "POST",
      headers: idempotencyHeaders(),
      url: "/store-orders/WS-0000000001/cancellation",
      payload: { reason_code: "CUSTOMER_CHANGED_MIND" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error_code).toBe("DELIVERY_CANCEL_NOT_ALLOWED");
    // Nothing was written: a refusal is not a half-cancellation.
    expect(store.outbox).toHaveLength(0);
    await app.close();
  });

  it("409s a second cancellation of an already cancelled order", async () => {
    const store = new FakeStoreOrderStore();
    store.seed(fixedOrder({ fulfillmentState: "cancelled" }), fixedTask());
    const { app } = buildApp({ store });
    const res = await app.fastify.inject({
      method: "POST",
      headers: idempotencyHeaders(),
      url: "/store-orders/WS-0000000001/cancellation",
      payload: { reason_code: "CUSTOMER_CHANGED_MIND" },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it("400s a reason code outside the closed catalog", async () => {
    const store = new FakeStoreOrderStore();
    store.seed(fixedOrder(), fixedTask());
    const { app } = buildApp({ store });
    const res = await app.fastify.inject({
      method: "POST",
      headers: idempotencyHeaders(),
      url: "/store-orders/WS-0000000001/cancellation",
      payload: { reason_code: "BECAUSE_I_SAID_SO" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error_code).toBe("DELIVERY_VALIDATION_FAILED");
    await app.close();
  });

  it("404s cancellation of an unknown order", async () => {
    const { app } = buildApp();
    const res = await app.fastify.inject({
      method: "POST",
      headers: idempotencyHeaders(),
      url: "/store-orders/WS-0000009999/cancellation",
      payload: { reason_code: "CUSTOMER_CHANGED_MIND" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("delivery HTTP — the error contract itself", () => {
  it("every error body is {error_code, message, trace_id} — not search's {code}", async () => {
    const { app } = buildApp();
    const res = await app.fastify.inject({ method: "GET", url: "/store-orders/WS-0000009999" });
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(["error_code", "message", "trace_id"]);
    expect(body).not.toHaveProperty("code");
    expect(body.trace_id).toMatch(/[0-9a-f-]{36}/);
  });

  it("an unclassified failure is 500 DELIVERY_INTERNAL_ERROR, never 503", async () => {
    // A read port that explodes with a plain Error — a defect, not an outage.
    const app = buildDeliveryHttpApp({
      readPort: {
        getOrderByPublicId: async () => {
          throw new Error("boom");
        },
        getTaskByOrderPublicId: async () => null,
        findIdempotentResponse: async () => null,
      },
      writePort: new FakeStoreOrderStore(),
      newUuid: uuidSequence(),
      now: () => NOW,
    });
    const res = await app.fastify.inject({ method: "GET", url: "/store-orders/WS-0000000001" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error_code).toBe("DELIVERY_INTERNAL_ERROR");
    await app.close();
  });

  it("a declared dependency failure stays 503 — the fallback did not swallow it", async () => {
    const app = buildDeliveryHttpApp({
      readPort: {
        getOrderByPublicId: async () => {
          throw new DeliveryError("DELIVERY_MARKETPLACE_UNAVAILABLE", "تعذَّرَ السوقُ");
        },
        getTaskByOrderPublicId: async () => null,
        findIdempotentResponse: async () => null,
      },
      writePort: new FakeStoreOrderStore(),
      newUuid: uuidSequence(),
      now: () => NOW,
    });
    const res = await app.fastify.inject({ method: "GET", url: "/store-orders/WS-0000000001" });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});
