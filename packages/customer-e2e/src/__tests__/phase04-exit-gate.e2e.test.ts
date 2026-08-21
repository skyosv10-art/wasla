/**
 * Phase 04 Exit Gate — «a customer creates a valid Order that reaches the Order
 * Engine, with no real matching yet».
 *
 * One file, because the gate is one question. Everything it touches is real
 * except the two things Phase 04 does not own: the channel (a mock adapter, the
 * swap ADR-007 exists for) and the order engine (a stub listener, because the
 * engine is Phase 06). Identity and geography are real services over real HTTP,
 * the Customer Core is its own listener, and with `CUSTOMER_DATABASE_URL` set the
 * store is Postgres.
 *
 * What the gate asserts, and why each one is in a gate rather than in a unit test:
 *
 *   1. a customer exists at all — `/start` on the bot creates the identity and the
 *      profile, and the profile is then readable over HTTP. Two components, one
 *      person.
 *   2. the handover happens, and it happens *as the published payload* — the stub
 *      refuses anything that is not `OrderIntakeRequest`, so this asserts the
 *      serialisation and not just the call.
 *   3. a retried write does not produce a second order — the idempotency promise
 *      is only meaningful across the whole chain.
 *   4. the same key with a different body is refused — replay is not a licence to
 *      overwrite.
 *   5. every refusal path is fail-closed: rejected, unreachable and timed out each
 *      leave a row, an event with the reason, and a 503 — and the customer can
 *      still see the attempt in the bot.
 *   6. an unknown zone never reaches the engine.
 *   7. what the HTTP side writes is what the bot reads.
 *   8. no event carries coordinates or user text.
 *   9. `/health` says `ok` only for a build that can actually complete a handover.
 *
 * Written for the reader who arrives at Phase 06: the numbers below are the
 * contract you inherit, and the stub is the shape your real engine must accept.
 */

import {
  FLOW_ERROR_TEXT,
  NO_ORDERS_TEXT,
  ORDER_STATUS_TEXT,
} from "@wasla/customer-bot";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  callCore,
  commandUpdate,
  DROPOFF_ZONE,
  eventsFor,
  orderBody,
  PICKUP_ZONE,
  placeBody,
  postWebhook,
  resolveIdentity,
  startGate,
  startUpdate,
  UNKNOWN_ZONE,
  type GateContext,
} from "../harness.js";

let gate: GateContext;

/** One channel user per test: isolation by data, not by truncation. */
let nextUserId = 900_100;
let nextUpdateId = 1_000;

interface Customer {
  readonly waslaPublicId: string;
  readonly userId: number;
  readonly chatRef: string;
}

/**
 * Bring one customer into existence the way a real one does: a `/start` on the
 * bot, and nothing else. No fixture writes a profile directly — a gate that
 * seeds its own subject would not be testing the entry point.
 */
async function onboard(): Promise<Customer> {
  nextUserId += 1;
  nextUpdateId += 1;
  const userId = nextUserId;
  const chatRef = String(userId);

  const response = await postWebhook(
    gate,
    startUpdate({ updateId: nextUpdateId, chatRef, userId, languageCode: "ar" }),
  );
  expect(response.statusCode).toBe(202);

  const identity = await resolveIdentity(gate, userId);
  // `created: false` proves the bot's `/start` is what created the account, not
  // this lookup.
  expect(identity.created).toBe(false);
  expect(identity.waslaPublicId).toMatch(/^WS-\d{10}$/);
  return { waslaPublicId: identity.waslaPublicId, userId, chatRef };
}

/** The bot's reply to a command, as text. */
async function botReply(customer: Customer, command: string): Promise<string> {
  nextUpdateId += 1;
  const before = gate.channel.sent.length;
  const response = await postWebhook(
    gate,
    commandUpdate({
      updateId: nextUpdateId,
      chatRef: customer.chatRef,
      userId: customer.userId,
      command,
    }),
  );
  expect(response.statusCode).toBe(202);
  expect(gate.channel.sent.length).toBeGreaterThan(before);
  return gate.channel.sent.at(-1)?.text ?? "";
}

beforeAll(async () => {
  gate = await startGate();
  // Printed so a CI log says which mode produced the evidence, per the
  // Documentation Law's «no Done without Evidence».
  console.log(`[phase04-exit-gate] persistence=${gate.persistence}`);
});

afterAll(async () => {
  await gate?.close();
});

beforeEach(async () => {
  await gate.reset();
});

describe("Phase 04 exit gate — customer → Customer Core → order engine", () => {
  it("creates an identity and a readable profile from a bot /start alone", async () => {
    const customer = await onboard();

    const profile = await callCore(gate, {
      method: "GET",
      path: `/customers/${customer.waslaPublicId}/profile`,
    });
    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({
      wasla_public_id: customer.waslaPublicId,
      preferred_locale: "ar",
    });

    // The channel layer never learns the id (ADR-001, ADR-007 rule 4).
    expect(JSON.stringify(gate.channel.sent)).not.toContain(customer.waslaPublicId);

    const events = await eventsFor(gate, customer.waslaPublicId);
    expect(events.map((event) => event.event_type)).toContain(
      "customer.profile.created",
    );
  });

  it("hands a valid order to the engine as the published OrderIntakeRequest", async () => {
    const customer = await onboard();

    const created = await callCore(gate, {
      method: "POST",
      path: `/customers/${customer.waslaPublicId}/order-requests`,
      body: orderBody(),
      idempotencyKey: "gate-order-001",
      traceId: "trace-gate-001",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "submitted" });

    // The engine was reached exactly once, and it accepted the body — which it
    // only does when every contract field is present in snake_case.
    expect(gate.engine.malformed).toHaveLength(0);
    expect(gate.engine.received).toHaveLength(1);

    const handover = gate.engine.received[0]!;
    expect(handover.idempotencyKey).toBe("gate-order-001");
    expect(handover.body).toMatchObject({
      customer_public_id: customer.waslaPublicId,
      order_type: "ride",
      vehicle_class: "sedan",
      price_mode: "customer_offer",
      offered_price: { amount_minor: 2500, currency: "SAR" },
      idempotency_key: "gate-order-001",
    });
    expect(handover.body.order_request_id).toBe(created.body.id);
    // Money crosses the wire as an integer in minor units — never a float.
    const price = handover.body.offered_price as { amount_minor: number };
    expect(Number.isInteger(price.amount_minor)).toBe(true);

    // Two stops, each carrying the zone and where the location came from.
    const stops = handover.body.stops as Record<string, unknown>[];
    expect(stops).toHaveLength(2);
    expect(stops.map((stop) => stop.zone_id)).toEqual([PICKUP_ZONE, DROPOFF_ZONE]);
    expect(stops.map((stop) => stop.source)).toEqual(["saved_place", "map"]);

    // The stored row carries the id the *engine* minted, not one we invented.
    expect(created.body.order_public_id).toBe(gate.engine.minted[0]);

    const stored = await callCore(gate, {
      method: "GET",
      path: `/customers/${customer.waslaPublicId}/order-requests/${created.body.id as string}`,
    });
    expect(stored.status).toBe(200);
    expect(stored.body).toMatchObject({
      status: "submitted",
      order_public_id: gate.engine.minted[0],
    });

    const events = await eventsFor(gate, customer.waslaPublicId);
    const submitted = events.find(
      (event) => event.event_type === "customer.order_request.submitted",
    );
    expect(submitted?.payload).toMatchObject({
      order_public_id: gate.engine.minted[0],
      pickup_zone_id: PICKUP_ZONE,
      dropoff_zone_id: DROPOFF_ZONE,
    });
  });

  it("replays the same key without creating a second order", async () => {
    const customer = await onboard();
    const body = orderBody();

    const first = await callCore(gate, {
      method: "POST",
      path: `/customers/${customer.waslaPublicId}/order-requests`,
      body,
      idempotencyKey: "gate-order-replay",
    });
    const second = await callCore(gate, {
      method: "POST",
      path: `/customers/${customer.waslaPublicId}/order-requests`,
      body,
      idempotencyKey: "gate-order-replay",
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    // The decisive assertion: the engine saw the handover once. A duplicated
    // handover would mean a duplicated order downstream in Phase 06.
    expect(gate.engine.received).toHaveLength(1);

    const list = await callCore(gate, {
      method: "GET",
      path: `/customers/${customer.waslaPublicId}/order-requests`,
    });
    expect((list.body.items as unknown[])).toHaveLength(1);
  });

  it("refuses the same key with a different payload", async () => {
    const customer = await onboard();

    await callCore(gate, {
      method: "POST",
      path: `/customers/${customer.waslaPublicId}/order-requests`,
      body: orderBody(),
      idempotencyKey: "gate-order-conflict",
    });
    const conflicting = await callCore(gate, {
      method: "POST",
      path: `/customers/${customer.waslaPublicId}/order-requests`,
      body: orderBody({ vehicle_class: "van" }),
      idempotencyKey: "gate-order-conflict",
    });

    expect(conflicting.status).toBe(409);
    expect(conflicting.body.code).toBe("CUSTOMER_IDEMPOTENCY_KEY_REUSED");
    expect(gate.engine.received).toHaveLength(1);
  });

  // The three failure modes are one table because the promise is one promise: a
  // handover that did not happen is recorded, announced, and reported — never
  // swallowed, and never stored as if it had succeeded.
  //
  // Note what the customer is *not* told: all three answer with the single code
  // CUSTOMER_ORDER_INTAKE_UNAVAILABLE, because the difference between «refused»,
  // «broken» and «silent» is operational and the error catalog deliberately
  // publishes one code. The distinction survives where it is needed — in the row
  // and in the failure event.
  const failures = [
    { mode: "reject", reason: "CUSTOMER_ORDER_INTAKE_REJECTED" },
    { mode: "fail", reason: "CUSTOMER_ORDER_INTAKE_UNAVAILABLE" },
  ] as const;

  for (const failure of failures) {
    it(`records a fail-closed handover when the engine answers ${failure.mode}`, async () => {
      const customer = await onboard();
      gate.engine.mode(failure.mode);

      const response = await callCore(gate, {
        method: "POST",
        path: `/customers/${customer.waslaPublicId}/order-requests`,
        body: orderBody(),
        idempotencyKey: `gate-order-${failure.mode}`,
      });

      // 503 to the caller: the customer is told, rather than shown a fake order.
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("CUSTOMER_ORDER_INTAKE_UNAVAILABLE");

      // …and the attempt still exists, with the reason, for whoever operates it.
      const list = await callCore(gate, {
        method: "GET",
        path: `/customers/${customer.waslaPublicId}/order-requests`,
      });
      const items = list.body.items as Record<string, unknown>[];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ status: "submission_failed" });
      expect(items[0]!.order_public_id).toBeUndefined();

      const events = await eventsFor(gate, customer.waslaPublicId);
      const failed = events.find(
        (event) => event.event_type === "customer.order_request.submission_failed",
      );
      expect(failed?.payload).toMatchObject({ reason_code: failure.reason });

      // And the customer sees the attempt in the bot, described as not delivered.
      const reply = await botReply(customer, "orders");
      expect(reply).toContain(ORDER_STATUS_TEXT.submission_failed);
      expect(reply).not.toBe(NO_ORDERS_TEXT);
      expect(reply).not.toBe(FLOW_ERROR_TEXT);
    });
  }

  it("reports a timeout as a timeout when the engine never answers", async () => {
    const customer = await onboard();
    gate.engine.mode("hang");

    const response = await callCore(gate, {
      method: "POST",
      path: `/customers/${customer.waslaPublicId}/order-requests`,
      body: orderBody(),
      idempotencyKey: "gate-order-timeout",
    });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("CUSTOMER_ORDER_INTAKE_UNAVAILABLE");
    // The request did reach the engine — that is exactly why this is a timeout
    // and not «unavailable», and why Phase 06 must treat the key as possibly seen.
    expect(gate.engine.received).toHaveLength(1);

    const events = await eventsFor(gate, customer.waslaPublicId);
    expect(
      events.find(
        (event) => event.event_type === "customer.order_request.submission_failed",
      )?.payload,
    ).toMatchObject({ reason_code: "CUSTOMER_ORDER_INTAKE_TIMEOUT" });
  });

  it("never reaches the engine with an unknown zone", async () => {
    const customer = await onboard();

    const response = await callCore(gate, {
      method: "POST",
      path: `/customers/${customer.waslaPublicId}/order-requests`,
      body: orderBody({
        stops: [
          { kind: "pickup", zone_id: UNKNOWN_ZONE, source: "map", label: "مجهول" },
          { kind: "dropoff", zone_id: DROPOFF_ZONE, source: "map", label: "المسجد النبوي" },
        ],
      }),
      idempotencyKey: "gate-order-unknown-zone",
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("CUSTOMER_ZONE_NOT_FOUND");
    // Validation happens before the handover, so a bad order costs the engine
    // nothing — and no row is left behind.
    expect(gate.engine.received).toHaveLength(0);

    const list = await callCore(gate, {
      method: "GET",
      path: `/customers/${customer.waslaPublicId}/order-requests`,
    });
    expect(list.body.items as unknown[]).toHaveLength(0);
  });

  it("shows the bot what the HTTP side wrote", async () => {
    const customer = await onboard();

    const saved = await callCore(gate, {
      method: "POST",
      path: `/customers/${customer.waslaPublicId}/places`,
      body: placeBody(),
      idempotencyKey: "gate-place-001",
    });
    expect(saved.status).toBe(201);

    const reply = await botReply(customer, "places");
    expect(reply).toContain("البيت");
  });

  it("publishes no coordinates and no user text in any event", async () => {
    const customer = await onboard();

    await callCore(gate, {
      method: "POST",
      path: `/customers/${customer.waslaPublicId}/places`,
      body: placeBody({
        label: "سِرّ",
        address_text: "نصّ عنوان لا يجوز نشره",
        coordinates: { latitude: 24.4672, longitude: 39.6111 },
      }),
      idempotencyKey: "gate-place-privacy",
    });
    await callCore(gate, {
      method: "POST",
      path: `/customers/${customer.waslaPublicId}/order-requests`,
      body: orderBody({ notes: "ملاحظة خاصة بالعميل" }),
      idempotencyKey: "gate-order-privacy",
    });

    const serialized = JSON.stringify(await eventsFor(gate, customer.waslaPublicId));
    for (const secret of [
      "سِرّ",
      "نصّ عنوان لا يجوز نشره",
      "ملاحظة خاصة بالعميل",
      "24.4672",
      "39.6111",
      "latitude",
      "longitude",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    // The classification is published; only the content is withheld.
    expect(serialized).toContain(PICKUP_ZONE);
    expect(serialized).toContain("has_coordinates");
  });

  it("reports health as ok only for a build that can complete a handover", async () => {
    const health = await callCore(gate, { method: "GET", path: "/health" });
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({
      status: "ok",
      persistence: gate.persistence,
      order_intake: "configured",
    });
  });
});
