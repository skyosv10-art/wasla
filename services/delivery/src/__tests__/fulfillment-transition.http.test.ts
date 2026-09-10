/**
 * HTTP integration tests for the fulfillment-transition route (review 11/N).
 *
 * Drives the full fulfillment lifecycle through HTTP: place → confirm →
 * picking → picked → ready_for_delivery → handed_to_courier → delivered (with
 * proof). Asserts inventory state transitions and the consumed event.
 */

import { describe, expect, it } from "vitest";

import { buildDeliveryHttpApp } from "../http/app.js";
import {
  FakeCatalog,
  FakeReservationPort,
  FakeReservationStore,
  FakeStoreOrderStore,
  fixedOrder,
  uuidSequence,
} from "./store-order-fakes.js";

const NOW = "2026-09-11T01:00:00.000Z";

let idempotencyCounter = 0;
function idempotencyHeaders(): Record<string, string> {
  idempotencyCounter += 1;
  return { "idempotency-key": `ft-test-key-${String(idempotencyCounter).padStart(6, "0")}` };
}

function buildApp(options: { store?: FakeStoreOrderStore; catalog?: FakeCatalog | null } = {}) {
  const store = options.store ?? new FakeStoreOrderStore();
  const catalog = options.catalog === null ? undefined : (options.catalog ?? new FakeCatalog());
  const app = buildDeliveryHttpApp({
    readPort: store,
    writePort: store,
    catalogPort: catalog,
    reservationPort: new FakeReservationPort(),
    reservationStore: new FakeReservationStore(),
    newUuid: uuidSequence(),
    now: () => NOW,
  });
  return { app, store };
}

/** Seed a confirmed order directly in the store (bypassing HTTP placement). */
function seedConfirmedOrder(store: FakeStoreOrderStore) {
  const order = fixedOrder({
    fulfillmentState: "confirmed",
    paymentState: "authorized",
    paymentRef: "pay-ref-001",
    inventoryState: "reserved",
    inventoryRef: "fake-reservation-ref",
    version: 2,
  });
  store.seed(order);
  return order;
}

describe("fulfillment-transition HTTP route (review 11/N)", () => {
  it("transitions confirmed → picking (200)", async () => {
    const { app, store } = buildApp();
    const order = seedConfirmedOrder(store);

    const res = await app.fastify.inject({
      method: "POST",
      url: `/store-orders/${order.publicId}/fulfillment-transition`,
      headers: idempotencyHeaders(),
      payload: { to_state: "picking" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fulfillment_state).toBe("picking");
    await app.close();
  });

  it("transitions the full lifecycle to delivered with proof", async () => {
    const { app, store } = buildApp();
    const order = seedConfirmedOrder(store);
    const pid = order.publicId;
    const headers = () => idempotencyHeaders();

    // confirmed → picking
    await app.fastify.inject({
      method: "POST",
      url: `/store-orders/${pid}/fulfillment-transition`,
      headers: headers(),
      payload: { to_state: "picking" },
    });

    // picking → picked
    await app.fastify.inject({
      method: "POST",
      url: `/store-orders/${pid}/fulfillment-transition`,
      headers: headers(),
      payload: { to_state: "picked" },
    });

    // picked → ready_for_delivery
    await app.fastify.inject({
      method: "POST",
      url: `/store-orders/${pid}/fulfillment-transition`,
      headers: headers(),
      payload: { to_state: "ready_for_delivery" },
    });

    // ready_for_delivery → handed_to_courier
    await app.fastify.inject({
      method: "POST",
      url: `/store-orders/${pid}/fulfillment-transition`,
      headers: headers(),
      payload: { to_state: "handed_to_courier" },
    });

    // handed_to_courier → delivered (with proof)
    const res = await app.fastify.inject({
      method: "POST",
      url: `/store-orders/${pid}/fulfillment-transition`,
      headers: headers(),
      payload: {
        to_state: "delivered",
        proof_type: "otp",
        proof_ref: "OTP-987654",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fulfillment_state).toBe("delivered");
    // Inventory consumption is verified via the outbox event (the response
    // body intentionally does not expose inventory_state — §2.3)
    const consumedEvents = store.outbox.filter(
      (e: { event_type: string }) => e.event_type === "store_order.inventory_consumed",
    );
    expect(consumedEvents.length).toBe(1);
    await app.close();
  });

  it("rejects delivered without proof (409)", async () => {
    const { app, store } = buildApp();
    const order = seedConfirmedOrder(store);

    // Move to handed_to_courier first
    const states = ["picking", "picked", "ready_for_delivery", "handed_to_courier"];
    for (const state of states) {
      await app.fastify.inject({
        method: "POST",
        url: `/store-orders/${order.publicId}/fulfillment-transition`,
        headers: idempotencyHeaders(),
        payload: { to_state: state },
      });
    }

    // Try delivered without proof
    const res = await app.fastify.inject({
      method: "POST",
      url: `/store-orders/${order.publicId}/fulfillment-transition`,
      headers: idempotencyHeaders(),
      payload: { to_state: "delivered" },
    });

    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it("rejects illegal transition (409)", async () => {
    const { app, store } = buildApp();
    const order = seedConfirmedOrder(store);

    const res = await app.fastify.inject({
      method: "POST",
      url: `/store-orders/${order.publicId}/fulfillment-transition`,
      headers: idempotencyHeaders(),
      payload: { to_state: "delivered" },
    });

    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it("requires Idempotency-Key (400)", async () => {
    const { app, store } = buildApp();
    const order = seedConfirmedOrder(store);

    const res = await app.fastify.inject({
      method: "POST",
      url: `/store-orders/${order.publicId}/fulfillment-transition`,
      payload: { to_state: "picking" },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 404 for unknown order", async () => {
    const { app } = buildApp();

    const res = await app.fastify.inject({
      method: "POST",
      url: "/store-orders/WS-9999999999/fulfillment-transition",
      headers: idempotencyHeaders(),
      payload: { to_state: "picking" },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("emits store_order.inventory_consumed event on delivered", async () => {
    const { app, store } = buildApp();
    const order = seedConfirmedOrder(store);
    const pid = order.publicId;
    const headers = () => idempotencyHeaders();

    const states = ["picking", "picked", "ready_for_delivery", "handed_to_courier"];
    for (const state of states) {
      await app.fastify.inject({
        method: "POST",
        url: `/store-orders/${pid}/fulfillment-transition`,
        headers: headers(),
        payload: { to_state: state },
      });
    }

    await app.fastify.inject({
      method: "POST",
      url: `/store-orders/${pid}/fulfillment-transition`,
      headers: headers(),
      payload: {
        to_state: "delivered",
        proof_type: "otp",
        proof_ref: "OTP-CONSUMED-001",
      },
    });

    // Check the outbox for the inventory_consumed event
    const consumedEvents = store.outbox.filter(
      (e: { event_type: string }) => e.event_type === "store_order.inventory_consumed",
    );
    expect(consumedEvents.length).toBe(1);
    const event = consumedEvents[0] as { payload: { to_state: string; reason_code: string } };
    expect(event.payload.to_state).toBe("consumed");
    expect(event.payload.reason_code).toBe("INVENTORY_CONSUMED");
    await app.close();
  });

  it("replays the same response for the same idempotency key", async () => {
    const { app, store } = buildApp();
    const order = seedConfirmedOrder(store);
    const headers = { "idempotency-key": "ft-replay-key-001" };

    const res1 = await app.fastify.inject({
      method: "POST",
      url: `/store-orders/${order.publicId}/fulfillment-transition`,
      headers,
      payload: { to_state: "picking" },
    });

    const res2 = await app.fastify.inject({
      method: "POST",
      url: `/store-orders/${order.publicId}/fulfillment-transition`,
      headers,
      payload: { to_state: "picking" },
    });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res2.headers["idempotent-replay"]).toBe("true");
    await app.close();
  });
});
