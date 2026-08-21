/**
 * HTTP layer tests for the Customer Core service (MR 4/6).
 *
 * Everything runs through `app.inject`: no port is bound, no socket is opened,
 * and the in-memory adapters are injected exactly as the bootstrap injects the
 * Postgres ones. What is asserted here is only what this layer owns —
 * wire-shape translation, status codes, headers and the error envelope. The
 * business rules themselves are already proven against the use cases
 * (customer-profile / saved-places / order-request-* suites) and against both
 * adapters (port-conformance), so they are not re-asserted; only their exposure
 * through HTTP is.
 *
 * Assertions are on stable error **codes**, never on the Arabic message copy.
 */

import { describe, expect, it } from "vitest";

import { createCustomerApp } from "../../http/app.js";
import { UnavailableOrderIntake } from "../../infrastructure/in-memory.js";
import {
  CUSTOMER,
  OTHER_CUSTOMER,
  ZONE_A,
  ZONE_B,
  ZONE_INACTIVE,
  ZONE_UNKNOWN,
  makeContext,
  seedProfile,
  type TestContext,
} from "../helpers.js";

const KEY = "idem-key-0001";

/** Wire (snake_case) body for a valid ride request. */
function rideBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_type: "ride",
    vehicle_class: "sedan",
    price_mode: "customer_offer",
    offered_price: { amount_minor: 1500, currency: "SAR" },
    stops: [
      { kind: "pickup", zone_id: ZONE_A, source: "map" },
      { kind: "dropoff", zone_id: ZONE_B, source: "text_search" },
    ],
    notes: "الاتصال قبل الوصول",
    ...overrides,
  };
}

interface Harness {
  ctx: TestContext;
  app: ReturnType<typeof createCustomerApp>;
}

async function harness(
  options: Parameters<typeof makeContext>[0] & {
    seed?: boolean;
    health?: Parameters<typeof createCustomerApp>[0]["health"];
  } = {},
): Promise<Harness> {
  const { seed = true, health, ...contextOptions } = options;
  const ctx = makeContext(contextOptions);
  if (seed) await seedProfile(ctx);
  const app = createCustomerApp({
    deps: ctx,
    ...(health === undefined ? {} : { health }),
  });
  return { ctx, app };
}

describe("GET /health", () => {
  it("reports degraded while no order-engine adapter is wired", async () => {
    const { app } = await harness({ seed: false });
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "degraded",
      service: "customers-service",
      persistence: "memory",
      order_intake: "unconfigured",
    });
  });

  it("reports ok only when persistence and intake are both wired", async () => {
    const { app } = await harness({
      seed: false,
      health: { persistence: "postgres", orderIntake: "configured" },
    });
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      persistence: "postgres",
      order_intake: "configured",
    });
  });
});

describe("profile endpoints", () => {
  it("returns 404 with a stable code for a customer without a profile", async () => {
    const { app } = await harness({ seed: false });
    const response = await app.inject({
      method: "GET",
      url: `/customers/${CUSTOMER}/profile`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("CUSTOMER_PROFILE_NOT_FOUND");
  });

  it("rejects a malformed public id before touching any port", async () => {
    const { app } = await harness({ seed: false });
    const response = await app.inject({
      method: "GET",
      url: "/customers/WS-123/profile",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("CUSTOMER_INVALID_PUBLIC_ID");
  });

  it("creates with 201 and updates with 200 on the same path", async () => {
    const { app } = await harness({ seed: false });

    const created = await app.inject({
      method: "PUT",
      url: `/customers/${CUSTOMER}/profile`,
      payload: { display_name: "أبو محمد", preferred_locale: "ar" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      wasla_public_id: CUSTOMER,
      display_name: "أبو محمد",
      preferred_locale: "ar",
      status: "active",
    });

    const updated = await app.inject({
      method: "PUT",
      url: `/customers/${CUSTOMER}/profile`,
      payload: { preferred_locale: "en" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().preferred_locale).toBe("en");
    // An absent key means «leave as is» — the display name survives the update.
    expect(updated.json().display_name).toBe("أبو محمد");
  });

  it("distinguishes an absent key from an explicit null", async () => {
    const { app } = await harness();

    const cleared = await app.inject({
      method: "PUT",
      url: `/customers/${CUSTOMER}/profile`,
      payload: { display_name: null },
    });

    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().display_name).toBeNull();
  });

  it("returns 404 when the identity does not exist", async () => {
    const { app } = await harness({ seed: false });
    const response = await app.inject({
      method: "PUT",
      url: "/customers/WS-9999999999/profile",
      payload: { display_name: "طيف" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("CUSTOMER_IDENTITY_NOT_FOUND");
  });

  it("returns 404 for a default zone that does not exist", async () => {
    const { app } = await harness({ seed: false });
    const response = await app.inject({
      method: "PUT",
      url: `/customers/${CUSTOMER}/profile`,
      payload: { default_zone_id: ZONE_UNKNOWN },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("CUSTOMER_ZONE_NOT_FOUND");
  });
});

describe("saved-place endpoints", () => {
  it("lists places with the policy limit and the display zone path", async () => {
    const { app } = await harness();

    await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/places`,
      headers: { "idempotency-key": KEY },
      payload: { label: "البيت", zone_id: ZONE_A, address_text: "شارع قربان" },
    });

    const response = await app.inject({
      method: "GET",
      url: `/customers/${CUSTOMER}/places`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.limit).toBe(20);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      label: "البيت",
      zone_id: ZONE_A,
      zone_path: "المدينة المنورة / العزيزية",
      address_text: "شارع قربان",
    });
  });

  it("creates with 201 and replays the same key with 200", async () => {
    const { app, ctx } = await harness();
    const payload = { label: "البيت", zone_id: ZONE_A };

    const created = await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/places`,
      headers: { "idempotency-key": KEY },
      payload,
    });
    expect(created.statusCode).toBe(201);

    const replayed = await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/places`,
      headers: { "idempotency-key": KEY },
      payload,
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json().id).toBe(created.json().id);
    // One row, one event: a replay is not a second creation.
    expect(await ctx.repo.countPlaces(CUSTOMER)).toBe(1);
  });

  it("rejects a write with no Idempotency-Key header", async () => {
    const { app } = await harness();
    const response = await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/places`,
      payload: { label: "البيت", zone_id: ZONE_A },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("CUSTOMER_MISSING_IDEMPOTENCY_KEY");
  });

  it("returns 409 when the same key carries a different payload", async () => {
    const { app } = await harness();
    const headers = { "idempotency-key": KEY };

    await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/places`,
      headers,
      payload: { label: "البيت", zone_id: ZONE_A },
    });
    const conflict = await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/places`,
      headers,
      payload: { label: "العمل", zone_id: ZONE_B },
    });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("CUSTOMER_IDEMPOTENCY_KEY_REUSED");
  });

  it("returns 409 for a duplicate label regardless of letter case", async () => {
    const { app } = await harness();

    await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/places`,
      headers: { "idempotency-key": "idem-key-aaaa" },
      payload: { label: "Home", zone_id: ZONE_A },
    });
    const conflict = await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/places`,
      headers: { "idempotency-key": "idem-key-bbbb" },
      payload: { label: "home", zone_id: ZONE_B },
    });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("CUSTOMER_PLACE_LABEL_TAKEN");
  });

  it("deletes with 204 and answers 404 for a place of another customer", async () => {
    const { app, ctx } = await harness();
    await seedProfile(ctx, OTHER_CUSTOMER);

    const created = await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/places`,
      headers: { "idempotency-key": KEY },
      payload: { label: "البيت", zone_id: ZONE_A },
    });
    const placeId = created.json().id;

    const foreign = await app.inject({
      method: "DELETE",
      url: `/customers/${OTHER_CUSTOMER}/places/${placeId}`,
    });
    // Owner-scoped: another customer's id is a 404, never a 403 (ADR-009).
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().code).toBe("CUSTOMER_PLACE_NOT_FOUND");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/customers/${CUSTOMER}/places/${placeId}`,
    });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe("");

    const again = await app.inject({
      method: "DELETE",
      url: `/customers/${CUSTOMER}/places/${placeId}`,
    });
    expect(again.statusCode).toBe(404);
  });
});

describe("order-request preview", () => {
  it("validates and echoes the request without writing anything", async () => {
    const { app, ctx } = await harness();

    const response = await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/order-requests/preview`,
      payload: rideBody(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      valid: true,
      order_type: "ride",
      vehicle_class: "sedan",
      price_mode: "customer_offer",
      offered_price: { amount_minor: 1500, currency: "SAR" },
    });
    expect(body.stops.map((stop: { sequence: number }) => stop.sequence)).toEqual([1, 2]);
    expect(body.stops[0].zone_path).toBe("المدينة المنورة / العزيزية");
    // No write, no handover, no event.
    expect(await ctx.repo.listOrderRequests(CUSTOMER)).toHaveLength(0);
    expect(ctx.intake.received).toHaveLength(0);
    expect(await ctx.outbox.unread()).toHaveLength(0);
  });

  it("reports non-blocking warnings instead of refusing the request", async () => {
    const { app } = await harness();

    const response = await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/order-requests/preview`,
      payload: rideBody({
        price_mode: "negotiable",
        offered_price: null,
        stops: [
          { kind: "pickup", zone_id: ZONE_A, source: "map" },
          { kind: "dropoff", zone_id: ZONE_A, source: "map" },
        ],
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().warnings).toEqual([
      "same_zone_pickup_and_dropoff",
      "no_price_offered",
    ]);
  });

  it.each([
    [
      "CUSTOMER_PRICE_MODE_MISMATCH",
      422,
      rideBody({ price_mode: "negotiable" }),
    ],
    [
      "CUSTOMER_MULTI_STOP_NOT_SUPPORTED",
      422,
      rideBody({
        stops: [
          { kind: "pickup", zone_id: ZONE_A, source: "map" },
          { kind: "dropoff", zone_id: ZONE_B, source: "map" },
          { kind: "dropoff", zone_id: ZONE_A, source: "map" },
        ],
      }),
    ],
    [
      "CUSTOMER_SHIPMENT_NOT_ALLOWED_FOR_RIDE",
      422,
      rideBody({ shipment: { shipment_type: "parcel" } }),
    ],
    [
      "CUSTOMER_ZONE_INACTIVE",
      409,
      rideBody({
        stops: [
          { kind: "pickup", zone_id: ZONE_INACTIVE, source: "map" },
          { kind: "dropoff", zone_id: ZONE_B, source: "map" },
        ],
      }),
    ],
    [
      "CUSTOMER_ZONE_NOT_FOUND",
      404,
      rideBody({
        stops: [
          { kind: "pickup", zone_id: ZONE_UNKNOWN, source: "map" },
          { kind: "dropoff", zone_id: ZONE_B, source: "map" },
        ],
      }),
    ],
    ["CUSTOMER_INVALID_REQUEST_BODY", 400, rideBody({ vehicle_class: "hovercraft" })],
    ["CUSTOMER_INVALID_REQUEST_BODY", 400, rideBody({ stops: "not-an-array" })],
  ])("maps %s to HTTP %i", async (code, status, payload) => {
    const { app } = await harness();
    const response = await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/order-requests/preview`,
      payload,
    });

    expect(response.statusCode).toBe(status);
    expect(response.json().code).toBe(code);
  });
});

describe("order-request submission", () => {
  it("creates with 201 and hands the request to the engine", async () => {
    const { app, ctx } = await harness();

    const response = await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/order-requests`,
      headers: { "idempotency-key": KEY },
      payload: rideBody(),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      wasla_public_id: CUSTOMER,
      status: "submitted",
      order_type: "ride",
    });
    expect(body.order_public_id).toBeTruthy();

    // The handover carried the customer's key and the same stops.
    expect(ctx.intake.received).toHaveLength(1);
    expect(ctx.intake.lastRequest?.idempotencyKey).toBe(KEY);
    expect(ctx.intake.lastRequest?.stops.map((stop) => stop.zoneId)).toEqual([
      ZONE_A,
      ZONE_B,
    ]);
  });

  it("replays the same key with 200 and no second handover", async () => {
    const { app, ctx } = await harness();
    const headers = { "idempotency-key": KEY };

    const first = await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/order-requests`,
      headers,
      payload: rideBody(),
    });
    const second = await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/order-requests`,
      headers,
      payload: rideBody(),
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(ctx.intake.received).toHaveLength(1);
  });

  it("rejects a submission with no Idempotency-Key header", async () => {
    const { app } = await harness();
    const response = await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/order-requests`,
      payload: rideBody(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("CUSTOMER_MISSING_IDEMPOTENCY_KEY");
  });

  it("fails closed with 503 and still stores the request", async () => {
    const { app, ctx } = await harness({ orderIntake: new UnavailableOrderIntake() });

    const response = await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/order-requests`,
      headers: { "idempotency-key": KEY },
      payload: rideBody(),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("CUSTOMER_ORDER_INTAKE_UNAVAILABLE");

    // The customer's intent is visible, not lost: a stored row plus a failure
    // event — the whole point of fail-closed (ADR-009 §53).
    const list = await app.inject({
      method: "GET",
      url: `/customers/${CUSTOMER}/order-requests`,
    });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0].status).toBe("submission_failed");
    expect(
      (await ctx.outbox.unread()).map((event) => event.event_type),
    ).toContain("customer.order_request.submission_failed");
  });

  it("returns 409 for a suspended profile", async () => {
    const { app, ctx } = await harness();
    const profile = await ctx.repo.findProfile(CUSTOMER);
    await ctx.repo.saveProfile({ ...profile!, status: "suspended" });

    const response = await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/order-requests`,
      headers: { "idempotency-key": KEY },
      payload: rideBody(),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("CUSTOMER_PROFILE_SUSPENDED");
  });
});

describe("order-request reads", () => {
  it("returns one request and scopes it to its owner", async () => {
    const { app } = await harness();
    const created = await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/order-requests`,
      headers: { "idempotency-key": KEY },
      payload: rideBody(),
    });
    const id = created.json().id;

    const mine = await app.inject({
      method: "GET",
      url: `/customers/${CUSTOMER}/order-requests/${id}`,
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().id).toBe(id);
    expect(mine.json().stops[0].zone_path).toBe("المدينة المنورة / العزيزية");

    const foreign = await app.inject({
      method: "GET",
      url: `/customers/${OTHER_CUSTOMER}/order-requests/${id}`,
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().code).toBe("CUSTOMER_ORDER_REQUEST_NOT_FOUND");
  });

  it("rejects a limit outside the published bounds instead of clamping it", async () => {
    const { app } = await harness();

    for (const limit of ["0", "51", "abc"]) {
      const response = await app.inject({
        method: "GET",
        url: `/customers/${CUSTOMER}/order-requests?limit=${limit}`,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("CUSTOMER_INVALID_REQUEST_BODY");
    }

    const accepted = await app.inject({
      method: "GET",
      url: `/customers/${CUSTOMER}/order-requests?limit=5`,
    });
    expect(accepted.statusCode).toBe(200);
  });
});

describe("error envelope", () => {
  it("carries a caller-supplied x-request-id as trace_id", async () => {
    const { app } = await harness({ seed: false });
    const response = await app.inject({
      method: "GET",
      url: `/customers/${CUSTOMER}/profile`,
      headers: { "x-request-id": "trace-abc" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().trace_id).toBe("trace-abc");
  });

  it("propagates the caller correlation id into the events it produces", async () => {
    const { app, ctx } = await harness({ seed: false });

    await app.inject({
      method: "PUT",
      url: `/customers/${CUSTOMER}/profile`,
      headers: { "x-request-id": "trace-xyz" },
      payload: { display_name: "أبو محمد" },
    });

    const events = await ctx.outbox.unread();
    expect(events).toHaveLength(1);
    expect(events[0]?.trace_id).toBe("trace-xyz");
  });

  it("answers a body that is not JSON with 400, not 503", async () => {
    const { app } = await harness();
    const response = await app.inject({
      method: "POST",
      url: `/customers/${CUSTOMER}/order-requests/preview`,
      headers: { "content-type": "application/json" },
      payload: "{ not json",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("CUSTOMER_INVALID_REQUEST_BODY");
  });

  it("leaves an unknown route as a transport 404, not a customer code", async () => {
    const { app } = await harness({ seed: false });
    const response = await app.inject({ method: "GET", url: "/customers/unknown" });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBeUndefined();
  });
});
