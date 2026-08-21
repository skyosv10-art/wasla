/**
 * HTTP layer tests for the Order Engine service (MR 4/6).
 *
 * Everything runs through `app.inject`: no port is bound and no socket is opened.
 * The in-memory adapters are injected through `createDirectRunner`, exactly where
 * the bootstrap injects `PostgresOrderRunner`, so what is exercised here is the
 * real composition and not a test-only variant.
 *
 * What is asserted is only what THIS layer owns: wire translation, status codes,
 * header rules, owner scoping and the error envelope. The lifecycle rules
 * themselves are already proven against the use cases (the 441-pair sweep and the
 * 72-edge table in MR 2/6) and against both adapters (port conformance, MR 3/6);
 * re-asserting them here would duplicate coverage without adding a guarantee.
 *
 * Assertions are on stable error **codes**, never on the Arabic copy: the message
 * is for a human and may be reworded, the code is the contract.
 */

import { describe, expect, it } from "vitest";

import { createOrderApp } from "../../http/app.js";
import { requireIdempotencyKey } from "../../http/requests.js";
import { createDirectRunner } from "../../runner.js";
import {
  bindAcceptedAssignment,
  createOrder,
  driveTo,
  makeHarness,
  orderInStatus,
  publicId,
  type Harness,
} from "../harness.js";

const CUSTOMER = publicId(1);
const OTHER_CUSTOMER = publicId(2);
const DRIVER = publicId(500);
const KEY = "idem-key-0001";

interface Fixture {
  harness: Harness;
  app: ReturnType<typeof createOrderApp>;
}

function fixture(
  health?: Parameters<typeof createOrderApp>[0]["health"],
): Fixture {
  const harness = makeHarness();
  const app = createOrderApp({
    runner: createDirectRunner(harness),
    ...(health === undefined ? {} : { health }),
  });
  return { harness, app };
}

/** Wire (snake_case) body for a valid ride intake. */
function intakeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_request_id: "22222222-2222-4222-8222-222222222222",
    customer_public_id: CUSTOMER,
    order_type: "ride",
    vehicle_class: "sedan",
    price_mode: "customer_offer",
    offered_price: { amount_minor: 2500, currency: "SAR" },
    stops: [
      { kind: "pickup", zone_id: "66666666-6666-4666-8666-666666666666", source: "map" },
      { kind: "dropoff", zone_id: "77777777-7777-4777-8777-777777777777", source: "map" },
    ],
    requested_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function post(app: Fixture["app"], url: string, body: unknown, key: string | null = KEY) {
  return app.inject({
    method: "POST",
    url,
    payload: body as never,
    headers: key === null ? {} : { "idempotency-key": key },
  });
}

describe("GET /health", () => {
  it("reports degraded while only the in-memory adapters are wired", async () => {
    const { app } = fixture();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "degraded",
      service: "orders-service",
      persistence: "memory",
    });
  });

  it("reports ok only with durable persistence", async () => {
    const { app } = fixture({ persistence: "postgres" });
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.json()).toMatchObject({ status: "ok", persistence: "postgres" });
  });
});

describe("POST /orders/intake", () => {
  it("accepts a fresh order with 201 and returns only the public id", async () => {
    const { app } = fixture();
    const response = await post(app, "/orders/intake", intakeBody());

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.order_public_id).toMatch(/^ORD-\d{10}$/);
    expect(typeof body.accepted_at).toBe("string");
    // The engine's internal id is NOT part of the answer: the caller addresses
    // the order by its public id (ADR-010) and must not learn a second handle.
    expect(body).toEqual({
      order_public_id: body.order_public_id,
      accepted_at: body.accepted_at,
    });
  });

  it("answers 200 with the SAME public id when the key is replayed", async () => {
    const { app } = fixture();
    const first = await post(app, "/orders/intake", intakeBody());
    const replay = await post(app, "/orders/intake", intakeBody());

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().order_public_id).toBe(first.json().order_public_id);
  });

  it("refuses the same key with a different body (409 reuse)", async () => {
    const { app } = fixture();
    await post(app, "/orders/intake", intakeBody());
    const response = await post(
      app,
      "/orders/intake",
      intakeBody({ order_request_id: "33333333-3333-4333-8333-333333333333" }),
    );

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("ORDER_IDEMPOTENCY_KEY_REUSED");
  });

  it("refuses a request id already ingested under another key (409)", async () => {
    const { app } = fixture();
    await post(app, "/orders/intake", intakeBody());
    const response = await post(app, "/orders/intake", intakeBody(), "idem-key-0002");

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("ORDER_REQUEST_ALREADY_INGESTED");
  });

  it("requires the Idempotency-Key header", async () => {
    const { app } = fixture();
    const response = await post(app, "/orders/intake", intakeBody(), null);

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("ORDER_VALIDATION_FAILED");
  });

  it("refuses a key shorter than the contract's minimum", async () => {
    const { app } = fixture();
    const response = await post(app, "/orders/intake", intakeBody(), "short");

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("ORDER_VALIDATION_FAILED");
  });

  it("refuses a body key that contradicts the header key", async () => {
    const { app } = fixture();
    const response = await post(
      app,
      "/orders/intake",
      intakeBody({ idempotency_key: "a-different-key" }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("ORDER_VALIDATION_FAILED");
  });

  it("maps malformed JSON to the validation code, not to a 500", async () => {
    const { app } = fixture();
    const response = await app.inject({
      method: "POST",
      url: "/orders/intake",
      payload: "{not json",
      headers: { "idempotency-key": KEY, "content-type": "application/json" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("ORDER_VALIDATION_FAILED");
  });

  it("refuses an unknown enum member at the edge (400, never carried inward)", async () => {
    const { app } = fixture();
    const response = await post(app, "/orders/intake", intakeBody({ vehicle_class: "boat" }));

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("ORDER_VALIDATION_FAILED");
    // The envelope carries no field name (the contract's ErrorResponse is
    // `{code, message, trace_id}`), so the offending field is named in the
    // human-readable message and in the log, never in a structured field the
    // caller could start branching on.
    expect(response.json().message).toContain("vehicle_class");
  });

  it("surfaces the price-mode rule as 422, not 400", async () => {
    const { app } = fixture();
    const response = await post(
      app,
      "/orders/intake",
      intakeBody({ price_mode: "negotiable" }),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("ORDER_PRICE_MODE_MISMATCH");
  });

  it("surfaces the stops rule as 422", async () => {
    const { app } = fixture();
    const response = await post(
      app,
      "/orders/intake",
      intakeBody({
        stops: [
          { kind: "pickup", zone_id: "66666666-6666-4666-8666-666666666666", source: "map" },
        ],
      }),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("ORDER_STOPS_INVALID");
  });

  it("surfaces the shipment placement rule as 422 for a ride", async () => {
    const { app } = fixture();
    const response = await post(
      app,
      "/orders/intake",
      intakeBody({ shipment: { shipment_type: "parcel", weight_kg: 3 } }),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("ORDER_SHIPMENT_NOT_ALLOWED");
  });

  it("refuses an unknown shipment type at the edge (400)", async () => {
    const { app } = fixture();
    const response = await post(
      app,
      "/orders/intake",
      intakeBody({
        order_type: "delivery",
        shipment: { shipment_type: "livestock" },
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("ORDER_VALIDATION_FAILED");
    expect(response.json().message).toContain("shipment_type");
  });

  it("refuses notes longer than the column allows with 400, not a 503", async () => {
    const { app } = fixture();
    const response = await post(app, "/orders/intake", intakeBody({ notes: "ن".repeat(301) }));

    // The DB CHECK on `notes` had no domain counterpart before this MR, so a
    // 301-character note was a constraint violation surfacing as 503 on Postgres
    // and a success in memory. Both adapters now refuse it identically.
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("ORDER_VALIDATION_FAILED");
  });
});

describe("GET /orders/{orderId}", () => {
  it("returns the order to its owner, addressed by internal id", async () => {
    const { harness, app } = fixture();
    const orderId = await createOrder(harness);

    const response = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
      headers: { "x-customer-public-id": CUSTOMER },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: orderId,
      status: "published",
      customer_public_id: CUSTOMER,
    });
  });

  it("accepts the public id the intake response returned", async () => {
    const { app } = fixture();
    const created = await post(app, "/orders/intake", intakeBody());
    const publicOrderId = created.json().order_public_id;

    const response = await app.inject({
      method: "GET",
      url: `/orders/${publicOrderId}`,
      headers: { "x-customer-public-id": CUSTOMER },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().order_public_id).toBe(publicOrderId);
  });

  it("answers 404 — never 403 — for another customer's order", async () => {
    const { harness, app } = fixture();
    const orderId = await createOrder(harness);

    const response = await app.inject({
      method: "GET",
      url: `/orders/${orderId}`,
      headers: { "x-customer-public-id": OTHER_CUSTOMER },
    });

    // 403 would confirm the order exists and turn the sequential public id into
    // an existence oracle. The answer must be indistinguishable from a miss.
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("ORDER_NOT_FOUND");
  });

  it("requires the owner scope header", async () => {
    const { harness, app } = fixture();
    const orderId = await createOrder(harness);

    const response = await app.inject({ method: "GET", url: `/orders/${orderId}` });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("ORDER_VALIDATION_FAILED");
  });

  it("refuses an orderId that is neither a uuid nor a public id", async () => {
    const { app } = fixture();
    const response = await app.inject({
      method: "GET",
      url: "/orders/not-an-id",
      headers: { "x-customer-public-id": CUSTOMER },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("ORDER_VALIDATION_FAILED");
  });

  it("answers 404 for a well-formed but unknown id", async () => {
    const { app } = fixture();
    const response = await app.inject({
      method: "GET",
      url: "/orders/99999999-9999-4999-8999-999999999999",
      headers: { "x-customer-public-id": CUSTOMER },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("ORDER_NOT_FOUND");
  });
});

describe("GET /orders/{orderId}/history", () => {
  it("returns the audit trail oldest first, including the birth row", async () => {
    const { harness, app } = fixture();
    const orderId = await orderInStatus(harness, "offered");

    const response = await app.inject({
      method: "GET",
      url: `/orders/${orderId}/history`,
      headers: { "x-customer-public-id": CUSTOMER },
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items as Array<Record<string, unknown>>;
    expect(items.map((item) => item.to_status)).toEqual([
      "published",
      "searching",
      "offered",
    ]);
    expect(items.map((item) => item.sequence)).toEqual([1, 2, 3]);
  });

  it("hides another customer's history behind the same 404", async () => {
    const { harness, app } = fixture();
    const orderId = await createOrder(harness);

    const response = await app.inject({
      method: "GET",
      url: `/orders/${orderId}/history`,
      headers: { "x-customer-public-id": OTHER_CUSTOMER },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("ORDER_NOT_FOUND");
  });
});

describe("POST /orders/{orderId}/transitions", () => {
  it("performs a legal transition and returns the updated order", async () => {
    const { harness, app } = fixture();
    const orderId = await createOrder(harness);

    const response = await post(app, `/orders/${orderId}/transitions`, {
      to_status: "searching",
      actor_type: "system",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: orderId, status: "searching" });
  });

  it("refuses a pair absent from the table with 409", async () => {
    const { harness, app } = fixture();
    const orderId = await createOrder(harness);

    const response = await post(app, `/orders/${orderId}/transitions`, {
      to_status: "completed",
      actor_type: "driver",
      actor_ref: DRIVER,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("ORDER_ILLEGAL_TRANSITION");
  });

  it("refuses an unknown status with 400 — an invented state is not a conflict", async () => {
    const { harness, app } = fixture();
    const orderId = await createOrder(harness);

    const response = await post(app, `/orders/${orderId}/transitions`, {
      to_status: "teleported",
      actor_type: "system",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("ORDER_VALIDATION_FAILED");
  });

  it("requires a reason code for a terminal state (422)", async () => {
    const { harness, app } = fixture();
    const orderId = await createOrder(harness);

    const response = await post(app, `/orders/${orderId}/transitions`, {
      to_status: "customer_cancelled",
      actor_type: "customer",
      actor_ref: CUSTOMER,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("ORDER_REASON_CODE_REQUIRED");
  });

  it("requires an actor ref for a human actor (422)", async () => {
    const { harness, app } = fixture();
    const orderId = await createOrder(harness);

    const response = await post(app, `/orders/${orderId}/transitions`, {
      to_status: "customer_cancelled",
      reason_code: "CUSTOMER_CHANGED_MIND",
      actor_type: "customer",
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("ORDER_ACTOR_REF_REQUIRED");
  });

  it("forbids an actor ref for the system actor (422)", async () => {
    const { harness, app } = fixture();
    const orderId = await createOrder(harness);

    const response = await post(app, `/orders/${orderId}/transitions`, {
      to_status: "searching",
      actor_type: "system",
      actor_ref: CUSTOMER,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("ORDER_ACTOR_REF_FORBIDDEN");
  });

  it("refuses `accepted` while no accepted assignment is bound (422)", async () => {
    const { harness, app } = fixture();
    const orderId = await createOrder(harness);
    await driveTo(harness, orderId, "offered");

    const response = await post(app, `/orders/${orderId}/transitions`, {
      to_status: "accepted",
      actor_type: "driver",
      actor_ref: DRIVER,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("ORDER_ASSIGNMENT_REQUIRED");
  });

  it("requires the Idempotency-Key header on a transition too", async () => {
    const { harness, app } = fixture();
    const orderId = await createOrder(harness);

    const response = await post(
      app,
      `/orders/${orderId}/transitions`,
      { to_status: "searching", actor_type: "system" },
      null,
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("ORDER_VALIDATION_FAILED");
  });

  it("answers 404 for an unknown order before looking at the body", async () => {
    const { app } = fixture();
    const response = await post(
      app,
      "/orders/99999999-9999-4999-8999-999999999999/transitions",
      { to_status: "searching", actor_type: "system" },
    );

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("ORDER_NOT_FOUND");
  });
});

describe("assignment endpoints", () => {
  it("records an offer with 201 and exposes it as the active assignment", async () => {
    const { harness, app } = fixture();
    const orderId = await orderInStatus(harness, "offered");

    const created = await post(app, `/orders/${orderId}/assignments`, {
      driver_public_id: DRIVER,
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      order_id: orderId,
      driver_public_id: DRIVER,
      assignment_state: "offered",
    });
  });

  it("refuses a second live offer to the same driver with 409", async () => {
    const { harness, app } = fixture();
    const orderId = await orderInStatus(harness, "offered");
    await post(app, `/orders/${orderId}/assignments`, { driver_public_id: DRIVER });

    const duplicate = await post(app, `/orders/${orderId}/assignments`, {
      driver_public_id: DRIVER,
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("ORDER_ASSIGNMENT_DUPLICATE");
  });

  it("refuses a driver reference that is not a WASLA public id", async () => {
    const { harness, app } = fixture();
    const orderId = await orderInStatus(harness, "offered");

    const response = await post(app, `/orders/${orderId}/assignments`, {
      driver_public_id: "driver-7",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("ORDER_VALIDATION_FAILED");
  });

  it("accepting an offer through PATCH unlocks the driver-bound transition", async () => {
    const { harness, app } = fixture();
    const orderId = await orderInStatus(harness, "offered");
    const created = await post(app, `/orders/${orderId}/assignments`, {
      driver_public_id: DRIVER,
    });
    const assignmentId = created.json().id;

    const accepted = await app.inject({
      method: "PATCH",
      url: `/orders/${orderId}/assignments/${assignmentId}`,
      payload: { assignment_state: "accepted" },
      headers: { "idempotency-key": KEY },
    });

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ id: assignmentId, assignment_state: "accepted" });

    // The proof that the resolution was recorded is not the response body: it is
    // that the guarded edge now passes.
    const moved = await post(app, `/orders/${orderId}/transitions`, {
      to_status: "accepted",
      actor_type: "driver",
      actor_ref: DRIVER,
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({
      status: "accepted",
      active_assignment: { id: assignmentId },
    });
  });

  it("refuses to resolve the same assignment twice with 409", async () => {
    const { harness, app } = fixture();
    const orderId = await orderInStatus(harness, "offered");
    const assignmentId = await bindAcceptedAssignment(harness, orderId);

    const response = await app.inject({
      method: "PATCH",
      url: `/orders/${orderId}/assignments/${assignmentId}`,
      payload: { assignment_state: "rejected", reason_code: "DRIVER_DECLINED" },
      headers: { "idempotency-key": KEY },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("ORDER_ASSIGNMENT_ALREADY_RESOLVED");
  });

  it("answers 404 for an assignment that does not belong to the order", async () => {
    const { harness, app } = fixture();
    const orderId = await orderInStatus(harness, "offered");

    const response = await app.inject({
      method: "PATCH",
      url: `/orders/${orderId}/assignments/99999999-9999-4999-8999-999999999999`,
      payload: { assignment_state: "accepted" },
      headers: { "idempotency-key": KEY },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("ORDER_ASSIGNMENT_NOT_FOUND");
  });

  it("refuses `offered` as a resolution (400) — it is where an offer starts", async () => {
    const { harness, app } = fixture();
    const orderId = await orderInStatus(harness, "offered");
    const created = await post(app, `/orders/${orderId}/assignments`, {
      driver_public_id: DRIVER,
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/orders/${orderId}/assignments/${created.json().id}`,
      payload: { assignment_state: "offered" },
      headers: { "idempotency-key": KEY },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("ORDER_VALIDATION_FAILED");
    expect(response.json().message).toContain("assignment_state");
  });

  it("refuses a reason code outside the catalog (422)", async () => {
    const { harness, app } = fixture();
    const orderId = await orderInStatus(harness, "offered");
    const created = await post(app, `/orders/${orderId}/assignments`, {
      driver_public_id: DRIVER,
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/orders/${orderId}/assignments/${created.json().id}`,
      payload: { assignment_state: "rejected", reason_code: "MOOD_CHANGED" },
      headers: { "idempotency-key": KEY },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("ORDER_REASON_CODE_UNKNOWN");
  });
});

describe("the envelope itself", () => {
  it("echoes x-request-id as the trace id of the error", async () => {
    const { app } = fixture();
    const response = await app.inject({
      method: "GET",
      url: "/orders/99999999-9999-4999-8999-999999999999",
      headers: { "x-customer-public-id": CUSTOMER, "x-request-id": "trace-http-1" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().trace_id).toBe("trace-http-1");
  });

  it("refuses an over-long request id instead of storing it", async () => {
    const { app } = fixture();
    const response = await post(app, "/orders/intake", intakeBody(), KEY).then(() =>
      app.inject({
        method: "POST",
        url: "/orders/intake",
        payload: intakeBody() as never,
        headers: { "idempotency-key": "idem-key-0009", "x-request-id": "t".repeat(129) },
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("ORDER_VALIDATION_FAILED");
  });

  it("refuses a repeated header rather than guessing which value counts", () => {
    // Asserted against the header reader directly: `app.inject` folds repeated
    // headers into one comma-joined string, so the duplicate can only be
    // presented to the code that is meant to refuse it — which is the code a
    // real proxy would hand two values to.
    expect(() =>
      requireIdempotencyKey({ "idempotency-key": [KEY, "idem-key-0002"] }),
    ).toThrowError(/Idempotency-Key/);
  });

  it("does NOT dress an unknown route up as a missing order", async () => {
    const { app } = fixture();
    const response = await app.inject({ method: "GET", url: "/orders/nope/extra/deep" });

    expect(response.statusCode).toBe(404);
    // A routing miss is not a domain answer: mapping it to ORDER_NOT_FOUND would
    // make a typo in a path look like a customer's order having vanished.
    expect(response.json().code).not.toBe("ORDER_NOT_FOUND");
  });

  it("carries a trace id into the audit row, not only into the response", async () => {
    const { harness, app } = fixture();
    const orderId = await createOrder(harness);

    await app.inject({
      method: "POST",
      url: `/orders/${orderId}/transitions`,
      payload: { to_status: "searching", actor_type: "system" },
      headers: { "idempotency-key": KEY, "x-request-id": "trace-http-2" },
    });

    const history = await harness.repository.listStatusHistory(orderId);
    expect(history.at(-1)?.traceId).toBe("trace-http-2");
  });
});
