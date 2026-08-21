/**
 * Phase 06 Exit Gate — «an order lives its whole lifecycle in the engine, and no
 * order ever reaches a state the published table forbids».
 *
 * One file, because the gate is one question. Everything it touches is real: the
 * Customer Core and the Order Engine are separate listeners, the handover between
 * them is the **production** `HttpOrderIntakePort`, identity and geography are
 * real services, and with `ORDER_DATABASE_URL` set the engine's store is
 * Postgres. Nothing is stubbed except the two things Phase 06 does not own: the
 * channel (absent — Phase 04 proved a bot can produce the intent) and matching
 * (absent by decision — ADR-010: the engine records an assignment, it does not
 * decide one).
 *
 * What the gate asserts, and why each one belongs in a gate rather than a unit test:
 *
 *   1. **The handover is real.** A customer intent becomes an order in the engine
 *      through the shipped adapter, and the reference the customer stored is the
 *      one the engine answers to. Two services, one order, no shared memory.
 *   2. **The full journey.** published → searching → offered → accepted →
 *      assigned → driver_en_route → arrived → in_progress → completed, over HTTP,
 *      with the assignment recorded and accepted the way Phase 07 will record it.
 *   3. **Every transition left a trace.** The audit trail is complete, ordered and
 *      starts with the birth row — the property a partial write would break.
 *   4. **The full table, both directions (441 pairs).** For each of the 21
 *      statuses: every one of the 21 possible targets is attempted over HTTP. The
 *      72 published edges must succeed and the other 369 must be refused with
 *      `ORDER_ILLEGAL_TRANSITION` — and, crucially, the order must still be where
 *      it was. A refusal that changed the state would be worse than an acceptance.
 *   5. **The boundary has not drifted.** What the Customer Core actually sends is
 *      exactly what the engine's published `OrderIntakeRequest` requires — checked
 *      against the contract file at runtime, not against a copy of it.
 *   6. **Idempotency holds across the chain.** A replayed customer key yields the
 *      same engine reference and no second order.
 *   7. **Owner scoping holds at the engine.** Another customer's order answers 404,
 *      never 403 — the read route must not become an existence oracle for a
 *      sequential id.
 *   8. **Refusals are shaped, not accidental.** A guarded edge without an accepted
 *      assignment is refused; an unknown reason code is refused; a write without an
 *      idempotency key is refused.
 *   9. **`/health` tells the truth on both sides** of the handover.
 *
 * Written for whoever arrives at Phase 07: the numbers below are the contract you
 * inherit, and the assignment calls here are the shape your matcher must produce.
 */

import {
  ORDER_STATUSES,
  type OrderStatus,
} from "@wasla/contracts-order";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  isTransitionAllowed,
  ORDER_TRANSITION_COUNT,
  ORDER_TRANSITION_SPACE,
  transitionRule,
} from "@wasla/orders-service";
import { toOrderIntakeRequestDto } from "@wasla/customers-service";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  attemptTransition,
  bindAcceptedAssignment,
  callCustomers,
  callEngine,
  currentStatus,
  driveTo,
  handOverOrder,
  needsAssignment,
  nextKey,
  onboardCustomer,
  orderBody,
  orderInStatus,
  readHistory,
  readOrder,
  startGate,
  type GateContext,
} from "../harness.js";

let gate: GateContext;
let customer: string;

beforeAll(async () => {
  gate = await startGate();
  customer = await onboardCustomer(gate);
  // Announced, because a green run means nothing until you know which store it
  // ran against.
  console.log(`[phase06-gate] engine persistence = ${gate.persistence}`);
});

afterAll(async () => {
  await gate?.close();
});

describe("1. the handover is real", () => {
  it("turns a customer intent into an order in the engine, addressable by both sides", async () => {
    const order = await handOverOrder(gate, customer, { traceId: "trace-gate-06-1" });

    expect(order.orderPublicId).toMatch(/^ORD-\d{10}$/);

    // The customer's own row carries the engine's reference…
    const stored = await callCustomers(gate, {
      method: "GET",
      path: `/customers/${customer}/order-requests/${order.orderRequestId}`,
    });
    expect(stored.status).toBe(200);
    expect(stored.body).toMatchObject({
      status: "submitted",
      order_public_id: order.orderPublicId,
    });

    // …and the engine answers to it, as the same customer, in the initial state.
    const read = await readOrder(gate, order);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({
      order_public_id: order.orderPublicId,
      customer_public_id: customer,
      status: "published",
    });
  });

  it("records the birth of the order as an event, not only as a row", async () => {
    const order = await handOverOrder(gate, customer);
    const events = await gate.engineEvents();
    const created = events.filter(
      (event) =>
        event.event_type === "order.created" &&
        event.aggregate.id === order.orderPublicId,
    );
    expect(created).toHaveLength(1);
  });
});

describe("2. the full journey, over HTTP", () => {
  const JOURNEY: OrderStatus[] = [
    "searching",
    "offered",
    "accepted",
    "assigned",
    "driver_en_route",
    "arrived",
    "in_progress",
    "completed",
  ];

  it("walks published → completed and ends in a terminal state", async () => {
    const order = await handOverOrder(gate, customer);
    const seen: OrderStatus[] = [];

    for (const next of JOURNEY) {
      // `accepted` is guarded: the engine refuses it until an offer to a driver
      // has been recorded AND accepted. Phase 07 will make this call for real.
      if (next === "accepted") await bindAcceptedAssignment(gate, order);
      const response = await attemptTransition(gate, order, next);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ status: next });
      seen.push(await currentStatus(gate, order));
    }

    expect(seen).toEqual(JOURNEY);

    // Terminal means terminal: nothing may leave `completed` except the two
    // published edges, and none of them goes back into the journey.
    const back = await attemptTransition(gate, order, "in_progress");
    expect(back.status).toBe(409);
    expect(back.body.code).toBe("ORDER_ILLEGAL_TRANSITION");
    expect(await currentStatus(gate, order)).toBe("completed");
  });

  it("leaves a complete, ordered audit trail beginning with the birth row", async () => {
    const order = await handOverOrder(gate, customer);
    await driveTo(gate, order, "completed");

    const history = await readHistory(gate, order);
    expect(history.status).toBe(200);
    const items = history.body.items as { to_status: string; sequence: number }[];

    // The walk is the shortest legal one, so the trail is the birth row plus one
    // row per step — asserted as a shape, not as a hard-coded length, because the
    // published table is what decides how long the shortest walk is.
    expect(items[0]).toMatchObject({ to_status: "published", sequence: 1 });
    expect(items[items.length - 1]).toMatchObject({ to_status: "completed" });
    expect(items.map((item) => item.sequence)).toEqual(
      items.map((_item, index) => index + 1),
    );
  });

  it("keeps the dispute and review path open after completion", async () => {
    const order = await handOverOrder(gate, customer);
    await driveTo(gate, order, "completed");

    const disputed = await attemptTransition(gate, order, "payment_disputed");
    expect(disputed.status).toBe(200);
    const review = await attemptTransition(gate, order, "under_review");
    expect(review.status).toBe(200);
    const cleared = await attemptTransition(gate, order, "completed");
    expect(cleared.status).toBe(200);
    expect(await currentStatus(gate, order)).toBe("completed");
  });
});

describe("3. the whole transition table, over HTTP (441 pairs)", () => {
  it("accepts exactly the published edges and refuses every other pair", async () => {
    expect(ORDER_TRANSITION_SPACE).toBe(ORDER_STATUSES.length * ORDER_STATUSES.length);

    let allowed = 0;
    let refused = 0;

    for (const from of ORDER_STATUSES) {
      // One order parked in `from`, reused for every refusal: a refusal must not
      // change the state, so the same order can be asked 21 questions. Each
      // ACCEPTED edge gets its own fresh order, because it really moves.
      const parked = await orderInStatus(gate, customer, from);
      expect(await currentStatus(gate, parked)).toBe(from);

      for (const to of ORDER_STATUSES) {
        if (isTransitionAllowed(from, to)) {
          const order = await orderInStatus(gate, customer, from);
          if (needsAssignment(to)) await bindAcceptedAssignment(gate, order);
          const response = await attemptTransition(gate, order, to);
          expect(
            response.status,
            `${from} → ${to} is published but was refused: ${JSON.stringify(response.body)}`,
          ).toBe(200);
          expect(await currentStatus(gate, order)).toBe(to);
          allowed += 1;
        } else {
          const response = await attemptTransition(gate, parked, to);
          expect(
            response.status,
            `${from} → ${to} is not in the table but was accepted`,
          ).toBe(409);
          expect(response.body.code).toBe("ORDER_ILLEGAL_TRANSITION");
          // The property that matters more than the status code.
          expect(await currentStatus(gate, parked)).toBe(from);
          refused += 1;
        }
      }
    }

    expect(allowed).toBe(ORDER_TRANSITION_COUNT);
    expect(allowed + refused).toBe(ORDER_TRANSITION_SPACE);
    expect(allowed).toBe(72);
    expect(refused).toBe(369);
  });

  it("refuses a self-transition for every status — no state may re-enter itself", async () => {
    for (const status of ORDER_STATUSES) {
      expect(isTransitionAllowed(status, status)).toBe(false);
    }
  });
});

/**
 * What the shipped mapper actually puts on the wire, for the two checks below.
 *
 * Built once, from the same input the use case builds: the boundary this section
 * examines is the mapper's OUTPUT against the engine's published contract text.
 * Types cannot see that drift — both sides import the DTO type from the same
 * package, so a renamed field renames on both sides and compiles.
 */
const DRIFT_DTO = toOrderIntakeRequestDto({
  orderRequestId: "22222222-2222-4222-8222-222222222222",
  customerPublicId: "WS-0000000001",
  orderType: "ride",
  vehicleClass: "sedan",
  priceMode: "customer_offer",
  offeredPrice: { amountMinor: 2500, currency: "SAR" },
  stops: [
    {
      kind: "pickup",
      sequence: 1,
      zoneId: "66666666-6666-4666-8666-666666666666",
      label: null,
      source: "map",
      savedPlaceId: null,
      coordinates: null,
    },
    {
      kind: "dropoff",
      sequence: 2,
      zoneId: "77777777-7777-4777-8777-777777777777",
      label: null,
      source: "map",
      savedPlaceId: null,
      coordinates: null,
    },
  ],
  shipment: null,
  notes: null,
  requestedAt: "2026-01-01T00:00:00.000Z",
  idempotencyKey: "gate-drift-key",
});

/** The engine's `OrderIntakeRequest`, read from the contract file itself. */
function intakeSchemaText(): string {
  const yml = readFileSync(
    resolve(process.cwd(), "../../services/orders/contracts/api.openapi.yml"),
    "utf-8",
  );
  return yml.slice(yml.indexOf("    OrderIntakeRequest:"));
}

describe("4. the handover boundary has not drifted", () => {
  it("sends every field the engine's contract requires", () => {
    // Parsed from the contract rather than compared against a list kept here: a
    // copy would agree with itself forever. `@wasla/contracts-order` already
    // guards the two *documents* against each other; this guards the runtime
    // object the shipped mapper produces, which no document check can see.
    const line = intakeSchemaText()
      .split("\n")
      .find((row) => row.trim().startsWith("required:"));
    if (!line) throw new Error("OrderIntakeRequest has no required list in the contract");
    const required = line
      .slice(line.indexOf("[") + 1, line.indexOf("]"))
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);

    expect(required.length).toBeGreaterThan(0);
    for (const field of required) {
      expect(Object.keys(DRIFT_DTO), `missing required field ${field}`).toContain(field);
    }
  });

  it("sends nothing but snake_case keys the engine publishes", () => {
    // A camelCase key would be dropped on the floor by the engine and the order
    // created without it — silently. That is the failure a wire check exists for.
    const properties = intakeSchemaText();
    const published = new Set<string>();
    for (const row of properties.slice(properties.indexOf("      properties:")).split("\n").slice(1)) {
      // Property names sit at exactly eight spaces of indentation; anything
      // shallower means the schema ended.
      if (/^ {8}[a-z_]+:/.test(row)) published.add(row.trim().split(":")[0]!);
      else if (/^ {0,7}\S/.test(row)) break;
    }

    expect(published.size).toBeGreaterThan(0);
    for (const key of Object.keys(DRIFT_DTO)) {
      expect(key, `${key} is not snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
      expect([...published], `the engine does not publish ${key}`).toContain(key);
    }
  });
});


describe("5. the promises that hold across the whole chain", () => {
  it("gives a replayed customer key the same engine reference and no second order", async () => {
    const body = orderBody();
    const key = nextKey("gate-replay");

    const first = await callCustomers(gate, {
      method: "POST",
      path: `/customers/${customer}/order-requests`,
      body,
      idempotencyKey: key,
    });
    const second = await callCustomers(gate, {
      method: "POST",
      path: `/customers/${customer}/order-requests`,
      body,
      idempotencyKey: key,
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.order_public_id).toBe(first.body.order_public_id);
    expect(second.body.id).toBe(first.body.id);
  });

  it("answers 404, never 403, for another customer's order", async () => {
    const order = await handOverOrder(gate, customer);
    const other = await onboardCustomer(gate);

    const read = await callEngine(gate, {
      method: "GET",
      path: `/orders/${order.orderPublicId}`,
      customerScope: other,
    });
    expect(read.status).toBe(404);
    expect(read.body.code).toBe("ORDER_NOT_FOUND");

    const history = await callEngine(gate, {
      method: "GET",
      path: `/orders/${order.orderPublicId}/history`,
      customerScope: other,
    });
    expect(history.status).toBe(404);
  });

  it("refuses a guarded edge while no assignment is accepted", async () => {
    const order = await orderInStatus(gate, customer, "offered");
    const response = await attemptTransition(gate, order, "accepted");

    // 422, not 409: the request is well-formed and the edge itself is published —
    // what is missing is a fact about the world, which is `unprocessable`.
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("ORDER_ASSIGNMENT_REQUIRED");
    expect(await currentStatus(gate, order)).toBe("offered");
  });

  it("refuses a reason code outside the catalog (422) and a write with no key (400)", async () => {
    const order = await handOverOrder(gate, customer);

    const unknownReason = await callEngine(gate, {
      method: "POST",
      path: `/orders/${order.orderPublicId}/transitions`,
      body: { to_status: "searching", actor_type: "system", reason_code: "MOOD_CHANGED" },
      idempotencyKey: nextKey("gate-reason"),
    });
    expect(unknownReason.status).toBe(422);
    expect(unknownReason.body.code).toBe("ORDER_REASON_CODE_UNKNOWN");

    const noKey = await callEngine(gate, {
      method: "POST",
      path: `/orders/${order.orderPublicId}/transitions`,
      body: { to_status: "searching", actor_type: "system" },
    });
    // There is no dedicated code for a missing key: the catalog is closed, and a
    // missing mandatory header is a validation failure like any other.
    expect(noKey.status).toBe(400);
    expect(noKey.body.code).toBe("ORDER_VALIDATION_FAILED");

    expect(await currentStatus(gate, order)).toBe("published");
  });

  it("uses the actor the published table names for each edge", async () => {
    // Not authorization — Phase 06 has none — but the shape rule the schema also
    // enforces: `system` carries no actor ref, anyone else must carry one.
    const rule = transitionRule("published", "customer_cancelled");
    expect(rule?.expectedActor).toBe("customer");

    const order = await handOverOrder(gate, customer);
    const response = await callEngine(gate, {
      method: "POST",
      path: `/orders/${order.orderPublicId}/transitions`,
      body: {
        to_status: "customer_cancelled",
        reason_code: rule?.typicalReason,
        actor_type: "customer",
      },
      idempotencyKey: nextKey("gate-actor"),
    });

    // 422, not 400: the body is well-formed and every value is in its catalog —
    // what is wrong is the combination, which only the domain can judge.
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("ORDER_ACTOR_REF_REQUIRED");
    expect(await currentStatus(gate, order)).toBe("published");
  });
});

describe("6. both sides report their health honestly", () => {
  it("the engine says ok only with durable storage", async () => {
    const health = await callEngine(gate, { method: "GET", path: "/health" });
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({
      service: "orders-service",
      persistence: gate.persistence,
      status: gate.persistence === "postgres" ? "ok" : "degraded",
    });
  });

  it("the Customer Core says ok because a real engine is wired", async () => {
    const health = await callCustomers(gate, { method: "GET", path: "/health" });
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({
      service: "customers-service",
      order_intake: "configured",
      status: "ok",
    });
  });
});
