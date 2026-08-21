/**
 * Shared setup for the Phase 06 Exit Gate suite.
 *
 * The gate asks one question: **«can a customer's validated intent become an
 * order in the engine, live its whole lifecycle, and never reach a state the
 * published table forbids — over real HTTP, through the production adapter?»**
 *
 * Everything here is real, and that is the point of a gate:
 *
 *   - the **Order Engine** is its own listener, built through its own
 *     `createOrderApp` over the same `OrderRunner` seam the bootstrap uses;
 *   - the **Customer Core** is its own listener, built through `createCustomerApp`;
 *   - the handover between them is the **production** `HttpOrderIntakePort`
 *     imported from `@wasla/customers-service` — not a copy of it. A gate that
 *     drove a copy would keep passing while the shipped adapter drifted, which is
 *     precisely the failure a gate exists to prevent (and it is why
 *     `packages/customer-e2e` owns its own frozen stub instead: that gate signed
 *     off Phase 04 and must keep answering the Phase 04 question, unchanged);
 *   - **identity** and **geography** are real services on real ports, so the
 *     Customer Core's own `HttpIdentityLookupPort` and `HttpGeographyPort` speak
 *     HTTP exactly as deployed.
 *
 * What is NOT real, declared rather than hidden:
 *
 *   1. **The customer store is in-memory, always.** Phase 04's gate already
 *      proves the customer row and its stops commit on Postgres, and repeating
 *      that here would make this gate fail for a reason that has nothing to do
 *      with the order engine. `ORDER_DATABASE_URL` lifts the **engine** onto
 *      Postgres, because the engine's atomicity is what this phase owns.
 *   2. **No channel and no bot.** Phase 06 is not entered from a chat: the
 *      customer's intent arrives at the Customer Core over HTTP, and Phase 04's
 *      gate already proves a bot can produce it.
 *   3. **No matching.** ADR-010: the engine *records* an assignment, it does not
 *      decide one. Every assignment here is recorded by the suite, which is what
 *      Phase 07 will do for real.
 *
 * Why `ORDER_DATABASE_URL` and not `DATABASE_URL`: `DATABASE_URL` is the channel
 * store set (Phase 03) and the engine's own integration jobs. A separate name
 * keeps this gate's database its own, so a failure here is never a collision with
 * another job's schema.
 *
 * Reasoning in docs/12-testing/PHASE06_EXIT_GATE_E2E.md.
 */

import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import type { OrderStatus } from "@wasla/contracts-order";
import {
  createCustomerApp,
  CryptoIdGenerator as CustomerIdGenerator,
  HttpGeographyPort,
  HttpIdentityLookupPort,
  HttpOrderIntakePort,
  InMemoryCustomerRepository,
  InMemoryOutbox as InMemoryCustomerOutbox,
  SystemClock as CustomerClock,
  type UseCaseDeps,
} from "@wasla/customers-service";
import {
  createGeographyApp,
  CryptoIdGenerator as GeoIdGenerator,
  InMemoryGeographyRepository,
  InMemoryIdentityLookupPort as GeoIdentityLookup,
  InMemoryOutbox as InMemoryGeoOutbox,
  SAUDI_FIXTURE_IDS,
  SystemClock as GeoClock,
} from "@wasla/geography-service";
import {
  createIdentityApp,
  CryptoIdGenerator as IdentityIdGenerator,
  InMemoryIdentityRepository,
  InMemoryOutbox as InMemoryIdentityOutbox,
  InMemoryPublicIdSequence,
  SystemClock as IdentityClock,
} from "@wasla/identity-service";
import {
  allowedTargets,
  createDirectRunner,
  createOrderApp,
  createOrderDb,
  CryptoIdGenerator as OrderIdGenerator,
  InMemoryOrderPublicIdGenerator,
  InMemoryOrderRepository,
  InMemoryOutbox as InMemoryOrderOutbox,
  PostgresOrderOutbox,
  PostgresOrderRunner,
  SystemClock as OrderClock,
  transitionRule,
  type OrderDomainEvent,
  type OrderRunner,
  type Outbox as OrderOutbox,
} from "@wasla/orders-service";
import { Pool } from "pg";

/** Postgres mode is opt-in for the ENGINE; the gate itself is not opt-in. */
export const ORDER_DATABASE_URL = process.env.ORDER_DATABASE_URL;

/** Two active zones from the Saudi fixture — a real hierarchy, not a stub. */
export const PICKUP_ZONE = SAUDI_FIXTURE_IDS.zoneHaraEast;
export const DROPOFF_ZONE = SAUDI_FIXTURE_IDS.zoneQubaNorth;

/** Reverse dependency order — the same order as the contract's rollback block. */
const ORDER_TABLES = [
  "order_outbox",
  "order_assignments",
  "order_status_history",
  "order_stops",
  "orders",
] as const;

/** The canonical DDL, read from the contract rather than duplicated here. */
const ORDER_SCHEMA_SQL = resolve(
  process.cwd(),
  "../../services/orders/contracts/schema.sql",
);

export interface GateContext {
  /** Base URL of the Customer Core (a real listener). */
  readonly customerUrl: string;
  /** Base URL of the Order Engine (a real listener). */
  readonly ordersUrl: string;
  /** Base URL of identity, to mint a real `wasla_public_id`. */
  readonly identityUrl: string;
  /** `postgres` or `memory` — for the ENGINE. Reported so a run is unambiguous. */
  readonly persistence: "postgres" | "memory";
  /** Everything the engine appended, whichever store is in play. */
  engineEvents(): Promise<OrderDomainEvent[]>;
  close(): Promise<void>;
}

/** Start the gate: four listeners, one engine store set. */
export async function startGate(): Promise<GateContext> {
  // --- identity: a real service on an ephemeral port ------------------------
  const identityApp = createIdentityApp({
    deps: {
      repo: new InMemoryIdentityRepository(),
      outbox: new InMemoryIdentityOutbox(),
      publicIdSeq: new InMemoryPublicIdSequence(),
      clock: new IdentityClock(),
      idGen: new IdentityIdGenerator(),
    },
    logger: false,
  });
  await identityApp.listen({ port: 0, host: "127.0.0.1" });
  const identityUrl = `http://127.0.0.1:${(identityApp.server.address() as AddressInfo).port}`;

  // --- geography: a real service over the Saudi fixture ---------------------
  const geoApp = createGeographyApp({
    deps: {
      repo: new InMemoryGeographyRepository(),
      outbox: new InMemoryGeoOutbox(),
      clock: new GeoClock(),
      idGen: new GeoIdGenerator(),
      identityLookup: new GeoIdentityLookup(),
    },
    logger: false,
  });
  await geoApp.listen({ port: 0, host: "127.0.0.1" });
  const geographyUrl = `http://127.0.0.1:${(geoApp.server.address() as AddressInfo).port}`;

  // --- the Order Engine, wired exactly as its bootstrap wires it ------------
  let pool: Pool | null = null;
  let runner: OrderRunner;
  let readEvents: () => Promise<OrderDomainEvent[]>;
  const orderClock = new OrderClock();
  const orderIds = new OrderIdGenerator();

  if (ORDER_DATABASE_URL) {
    const created = createOrderDb({ connectionString: ORDER_DATABASE_URL, max: 4 });
    pool = created.pool;
    await pool.query(`DROP TABLE IF EXISTS ${ORDER_TABLES.join(", ")} CASCADE`);
    await pool.query(await readFile(ORDER_SCHEMA_SQL, "utf-8"));
    runner = new PostgresOrderRunner(created.db, { clock: orderClock, ids: orderIds });
    const outbox: OrderOutbox = new PostgresOrderOutbox(created.db);
    readEvents = () => outbox.unread();
  } else {
    const outbox = new InMemoryOrderOutbox();
    runner = createDirectRunner({
      repository: new InMemoryOrderRepository(),
      outbox,
      clock: orderClock,
      ids: orderIds,
      publicIds: new InMemoryOrderPublicIdGenerator(),
    });
    readEvents = () => outbox.unread();
  }

  const ordersApp = createOrderApp({
    runner,
    health: { persistence: ORDER_DATABASE_URL ? "postgres" : "memory" },
    logger: false,
  });
  await ordersApp.listen({ port: 0, host: "127.0.0.1" });
  const ordersUrl = `http://127.0.0.1:${(ordersApp.server.address() as AddressInfo).port}`;

  // --- the Customer Core, handing over through the PRODUCTION adapter -------
  const customerApp = createCustomerApp({
    deps: {
      repo: new InMemoryCustomerRepository(),
      outbox: new InMemoryCustomerOutbox(),
      clock: new CustomerClock(),
      idGen: new CustomerIdGenerator(),
      identityLookup: new HttpIdentityLookupPort({ baseUrl: identityUrl }),
      geography: new HttpGeographyPort({ baseUrl: geographyUrl }),
      // The one import this whole gate exists for.
      orderIntake: new HttpOrderIntakePort({ baseUrl: ordersUrl }),
    } satisfies UseCaseDeps,
    // A build with a store and a real engine may say `ok`. The engine being
    // real is what makes this honest here and dishonest anywhere else.
    health: { persistence: "memory", orderIntake: "configured" },
    logger: false,
  });
  await customerApp.listen({ port: 0, host: "127.0.0.1" });
  const customerUrl = `http://127.0.0.1:${(customerApp.server.address() as AddressInfo).port}`;

  return {
    customerUrl,
    ordersUrl,
    identityUrl,
    persistence: ORDER_DATABASE_URL ? "postgres" : "memory",
    engineEvents: () => readEvents(),
    close: async () => {
      await customerApp.close();
      await ordersApp.close();
      await geoApp.close();
      await identityApp.close();
      if (pool) await pool.end();
    },
  };
}

export interface HttpResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

async function call(
  baseUrl: string,
  init: {
    readonly method: string;
    readonly path: string;
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
  },
): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${init.path}`, {
    method: init.method,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

/** Call the Customer Core the way any consumer would. */
export async function callCustomers(
  gate: GateContext,
  init: {
    readonly method: string;
    readonly path: string;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
    readonly traceId?: string;
  },
): Promise<HttpResult> {
  return call(gate.customerUrl, {
    method: init.method,
    path: init.path,
    ...(init.body === undefined ? {} : { body: init.body }),
    headers: {
      ...(init.idempotencyKey === undefined
        ? {}
        : { "idempotency-key": init.idempotencyKey }),
      ...(init.traceId === undefined ? {} : { "x-request-id": init.traceId }),
    },
  });
}

/** Call the Order Engine the way Phase 07 will: over HTTP, with the headers. */
export async function callEngine(
  gate: GateContext,
  init: {
    readonly method: string;
    readonly path: string;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
    readonly customerScope?: string;
    readonly traceId?: string;
  },
): Promise<HttpResult> {
  return call(gate.ordersUrl, {
    method: init.method,
    path: init.path,
    ...(init.body === undefined ? {} : { body: init.body }),
    headers: {
      ...(init.idempotencyKey === undefined
        ? {}
        : { "idempotency-key": init.idempotencyKey }),
      ...(init.customerScope === undefined
        ? {}
        : { "x-customer-public-id": init.customerScope }),
      ...(init.traceId === undefined ? {} : { "x-request-id": init.traceId }),
    },
  });
}

let keyCounter = 0;

/** A fresh idempotency key. Every write in this suite carries its own. */
export function nextKey(prefix: string): string {
  keyCounter += 1;
  return `${prefix}-${String(keyCounter).padStart(6, "0")}`;
}

let channelUserCounter = 900_000;

/**
 * A customer that exists in identity AND has an active profile.
 *
 * Identity mints the `wasla_public_id` (the bot does the same call in Phase 04),
 * and the profile is created through the Customer Core's own route, because the
 * order-request use case refuses a customer without one — and this gate must not
 * reach into a store to invent a state the API cannot produce.
 */
export async function onboardCustomer(gate: GateContext): Promise<string> {
  channelUserCounter += 1;
  const resolved = await call(gate.identityUrl, {
    method: "POST",
    path: "/identity/resolve",
    body: { telegram_user_id: channelUserCounter, source: "customer_bot" },
  });
  const waslaPublicId = resolved.body.wasla_public_id as string;
  const profile = await callCustomers(gate, {
    method: "PUT",
    path: `/customers/${waslaPublicId}/profile`,
    body: { preferred_locale: "ar", display_name: "عميل البوابة" },
  });
  if (profile.status !== 201 && profile.status !== 200) {
    throw new Error(`profile creation failed: ${profile.status} ${JSON.stringify(profile.body)}`);
  }
  return waslaPublicId;
}

/** A valid two-stop order body for the Customer Core's own route. */
export function orderBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    order_type: "ride",
    vehicle_class: "sedan",
    price_mode: "customer_offer",
    offered_price: { amount_minor: 2500, currency: "SAR" },
    stops: [
      { kind: "pickup", zone_id: PICKUP_ZONE, source: "map", label: "البيت" },
      { kind: "dropoff", zone_id: DROPOFF_ZONE, source: "map", label: "المسجد النبوي" },
    ],
    notes: null,
    ...overrides,
  };
}

export interface HandedOverOrder {
  /** The Customer Core's row id. */
  readonly orderRequestId: string;
  /** The engine's reference, as the customer received it. */
  readonly orderPublicId: string;
  /** Who owns it — the scope header every engine read needs. */
  readonly customerPublicId: string;
}

/**
 * The gate's atomic act: a customer intent handed to the engine over HTTP.
 *
 * Nothing here talks to the engine directly. The order exists in the engine only
 * because the production adapter put it there, so every test built on this helper
 * is also a test of the handover.
 */
export async function handOverOrder(
  gate: GateContext,
  customerPublicId: string,
  options: { readonly traceId?: string; readonly body?: Record<string, unknown> } = {},
): Promise<HandedOverOrder> {
  const created = await callCustomers(gate, {
    method: "POST",
    path: `/customers/${customerPublicId}/order-requests`,
    body: options.body ?? orderBody(),
    idempotencyKey: nextKey("gate-intake"),
    ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
  });
  if (created.status !== 201) {
    throw new Error(`handover failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  return {
    orderRequestId: created.body.id as string,
    orderPublicId: created.body.order_public_id as string,
    customerPublicId,
  };
}

/** Read an order from the engine as its owner. */
export async function readOrder(
  gate: GateContext,
  order: HandedOverOrder,
): Promise<HttpResult> {
  return callEngine(gate, {
    method: "GET",
    path: `/orders/${order.orderPublicId}`,
    customerScope: order.customerPublicId,
  });
}

/** Read the audit trail from the engine as its owner. */
export async function readHistory(
  gate: GateContext,
  order: HandedOverOrder,
): Promise<HttpResult> {
  return callEngine(gate, {
    method: "GET",
    path: `/orders/${order.orderPublicId}/history`,
    customerScope: order.customerPublicId,
  });
}

/**
 * Ensure the order has an accepted assignment — over HTTP, as Phase 07 will.
 *
 * Idempotent on purpose. The engine refuses a second offer once one is accepted
 * (`ORDER_ASSIGNMENT_FORBIDDEN`, «الطلب مُسند لسائق بالفعل»), and the sweep below
 * cannot know whether the walk that parked an order in its source state already
 * needed a driver. Treating that refusal as «already bound» keeps the callers
 * from having to track it — and the refusal itself is asserted as a property in
 * its own test, so swallowing it here hides nothing.
 */
export async function bindAcceptedAssignment(
  gate: GateContext,
  order: HandedOverOrder,
): Promise<string | null> {
  channelUserCounter += 1;
  const driverPublicId = `WS-${String(channelUserCounter).padStart(10, "0")}`;
  const offered = await callEngine(gate, {
    method: "POST",
    path: `/orders/${order.orderPublicId}/assignments`,
    body: { driver_public_id: driverPublicId },
    idempotencyKey: nextKey("gate-offer"),
  });
  if (offered.status === 422 && offered.body.code === "ORDER_ASSIGNMENT_FORBIDDEN") {
    return null;
  }
  if (offered.status !== 201) {
    throw new Error(`assignment failed: ${offered.status} ${JSON.stringify(offered.body)}`);
  }
  const assignmentId = offered.body.id as string;
  const accepted = await callEngine(gate, {
    method: "PATCH",
    path: `/orders/${order.orderPublicId}/assignments/${assignmentId}`,
    body: { assignment_state: "accepted" },
    idempotencyKey: nextKey("gate-accept"),
  });
  if (accepted.status !== 200) {
    throw new Error(`resolution failed: ${accepted.status} ${JSON.stringify(accepted.body)}`);
  }
  return assignmentId;
}

/**
 * The shortest legal walk from `published` to `target`, derived from the table.
 *
 * Breadth-first over `allowedTargets`, which is the published table's own index.
 * Deriving it means a changed edge changes the walk automatically: a path list
 * kept by hand here would rot silently and the sweep would start proving this
 * file instead of the engine. (The engine's own unit harness has the same
 * function for the same reason; duplicating four lines of BFS is cheaper than
 * exporting a test helper from a service's public surface.)
 */
export function shortestPath(target: OrderStatus): OrderStatus[] {
  if (target === "published") return [];
  const previous = new Map<OrderStatus, OrderStatus>();
  const queue: OrderStatus[] = ["published"];
  const seen = new Set<OrderStatus>(["published"]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of allowedTargets(current)) {
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, current);
      if (next === target) {
        const path: OrderStatus[] = [target];
        let cursor: OrderStatus = target;
        while (previous.has(cursor)) {
          cursor = previous.get(cursor)!;
          if (cursor === "published") break;
          path.unshift(cursor);
        }
        return path;
      }
      queue.push(next);
    }
  }
  throw new Error(`${target} is unreachable from published`);
}

/** States that cannot be entered without an accepted assignment bound. */
export function needsAssignment(status: OrderStatus): boolean {
  return (
    status === "accepted" ||
    status === "assigned" ||
    status === "driver_en_route" ||
    status === "arrived" ||
    status === "in_progress" ||
    status === "completed"
  );
}

/** One transition attempt over HTTP, using the actor the table names for it. */
export async function attemptTransition(
  gate: GateContext,
  order: HandedOverOrder,
  to: OrderStatus,
): Promise<HttpResult> {
  const rule = transitionRule(await currentStatus(gate, order), to);
  const actorType = rule?.expectedActor ?? "system";
  return callEngine(gate, {
    method: "POST",
    path: `/orders/${order.orderPublicId}/transitions`,
    body: {
      to_status: to,
      ...(rule?.typicalReason == null ? {} : { reason_code: rule.typicalReason }),
      actor_type: actorType,
      ...(actorType === "system" ? {} : { actor_ref: order.customerPublicId }),
    },
    idempotencyKey: nextKey("gate-transition"),
  });
}

/** The engine's own answer about where the order is now. */
export async function currentStatus(
  gate: GateContext,
  order: HandedOverOrder,
): Promise<OrderStatus> {
  const read = await readOrder(gate, order);
  if (read.status !== 200) {
    throw new Error(`read failed: ${read.status} ${JSON.stringify(read.body)}`);
  }
  return read.body.status as OrderStatus;
}

/**
 * Walk an order from `published` to `target` over HTTP.
 *
 * The path comes from the published table (`shortestPath`), not from a list kept
 * here: a hand-maintained walk would drift from the table the moment an edge
 * changed, and the sweep below would start proving the harness instead of the
 * engine. Whenever the next state names a driver, an assignment is recorded and
 * accepted first — the engine refuses those edges otherwise, by design.
 */
export async function driveTo(
  gate: GateContext,
  order: HandedOverOrder,
  target: OrderStatus,
): Promise<void> {
  let bound = false;
  for (const next of shortestPath(target)) {
    if (!bound && needsAssignment(next)) {
      await bindAcceptedAssignment(gate, order);
      bound = true;
    }
    const response = await attemptTransition(gate, order, next);
    if (response.status !== 200) {
      throw new Error(
        `drive to ${target} stalled at ${next}: ${response.status} ${JSON.stringify(response.body)}`,
      );
    }
  }
}

/** An order handed over and driven to `status`, ready for the assertion. */
export async function orderInStatus(
  gate: GateContext,
  customerPublicId: string,
  status: OrderStatus,
): Promise<HandedOverOrder> {
  const order = await handOverOrder(gate, customerPublicId);
  await driveTo(gate, order, status);
  return order;
}
