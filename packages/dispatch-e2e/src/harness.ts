/**
 * Shared setup for the Phase 07 Exit Gate suite.
 *
 * The gate asks one question: **«can a real order find a real driver — offer by
 * offer, wave by wave — across six independent services over real HTTP, and never
 * reach a state any of their published tables forbids?»**
 *
 * Everything in the path is real, and that is the point of a gate:
 *
 *   - **identity** and **geography** are their own listeners, so the Customer Core's
 *     `HttpIdentityLookupPort` / `HttpGeographyPort` and matching's own
 *     `HttpZoneHierarchy` all speak HTTP exactly as deployed. The zone hierarchy in
 *     particular is not a stub: matching's seventh hard filter
 *     (`zone_served_by_hierarchy`) resolves the pickup zone's lineage by asking the
 *     geography service, which is the only way this gate can claim the filter works;
 *   - the **Customer Core** hands the intent to the **Order Engine** through the
 *     production `HttpOrderIntakePort` (Phase 06's gate), so the order this suite
 *     dispatches was created the way a customer creates one, not injected;
 *   - **matching** is its own listener behind `createMatchingApp`, over the same
 *     `MatchingRunner` seam the bootstrap uses;
 *   - **dispatch** is its own listener behind `createDispatchApp`, and it reaches
 *     matching and the engine through the **production** `HttpMatchingPort` and
 *     `HttpOrderEnginePort` imported from `@wasla/dispatch-service` — not copies. A
 *     gate that drove copies would keep passing while the shipped adapters drifted,
 *     which is precisely the failure a gate exists to prevent.
 *
 * Time is injected, never slept. One `GateClock` is shared by matching and dispatch,
 * so `evaluated_at` (sent by dispatch) and `updated_at` (written by matching) are read
 * off the same instant and matching's freshness filter is deterministic. Every
 * deadline in this suite is crossed by moving that clock and calling
 * `POST /dispatch/tick` explicitly: a gate that waited on wall time would be a gate
 * that is slow when it passes and flaky when it fails.
 *
 * What is NOT real, declared rather than hidden:
 *
 *   1. **No driver service.** Phase 05 (Driver Core) is not built. Candidacy rows are
 *      seeded through matching's own `PUT /candidacy/{driver_public_id}` with
 *      `eligibility_source: "claimed"`, which is the contract's declared answer for
 *      exactly this window (ADR-011): matching stores what it was told and never asks
 *      a driver service. When Phase 05 ships, the seeding helper here is the one place
 *      that changes, and `eligibility_source` becomes `driver_core`.
 *   2. **No driver bot and no channel.** A driver accepts by calling
 *      `POST /dispatch/offers/{id}/accept` — the same route the bot will call.
 *   3. **The customer store and the engine store are in-memory, always.** Phase 04's
 *      gate proves the customer row commits atomically and Phase 06's gate proves the
 *      same for every order transition. Repeating either here would make this gate
 *      fail for reasons that have nothing to do with dispatch.
 *      `DISPATCH_DATABASE_URL` lifts **matching and dispatch** onto Postgres, because
 *      their atomicity is what this phase owns.
 *
 * Why one database for both matching and dispatch: Phase 07 owns two services, their
 * table names do not collide (`driver_candidacy`/`matching_*` vs `dispatch_*`), and a
 * single connection string keeps the CI job honest about what it lifted. Why
 * `DISPATCH_DATABASE_URL` and not `DATABASE_URL`: `DATABASE_URL` is the channel store
 * (Phase 03) and the name both services' own integration jobs already use. A separate
 * name keeps this gate's database its own, so a failure here is never a collision with
 * another job's schema.
 *
 * Reasoning in docs/12-testing/PHASE07_EXIT_GATE_E2E.md.
 */

import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

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
  createDispatchApp,
  createDispatchDb,
  createDirectRunner as createDispatchDirectRunner,
  createInMemoryStores,
  HttpMatchingPort,
  HttpOrderEnginePort,
  PostgresDispatchOutbox,
  PostgresDispatchRunner,
  PostgresDispatchUnitOfWork,
  SequentialIdGenerator as DispatchIdGenerator,
  StaticRulesProvider,
  type AnyDispatchEvent,
  type DispatchRules,
  type DispatchRunner,
} from "@wasla/dispatch-service";
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
  createInMemoryDependencies,
  createMatchingApp,
  createMatchingDb,
  createDirectRunner as createMatchingDirectRunner,
  HttpZoneHierarchy,
  PostgresMatchingRunner,
  PostgresMatchingUnitOfWork,
  SequentialIdGenerator as MatchingIdGenerator,
  type MatchingRunner,
} from "@wasla/matching-service";
import {
  createDirectRunner as createOrderDirectRunner,
  createOrderApp,
  CryptoIdGenerator as OrderIdGenerator,
  InMemoryOrderPublicIdGenerator,
  InMemoryOrderRepository,
  InMemoryOutbox as InMemoryOrderOutbox,
  SystemClock as OrderClock,
} from "@wasla/orders-service";
import { Pool } from "pg";

/** Postgres mode is opt-in for MATCHING and DISPATCH; the gate itself is not opt-in. */
export const DISPATCH_DATABASE_URL = process.env.DISPATCH_DATABASE_URL;

/** Two active zones from the Saudi fixture — a real hierarchy, not a stub. */
export const PICKUP_ZONE = SAUDI_FIXTURE_IDS.zoneHaraEast;
export const DROPOFF_ZONE = SAUDI_FIXTURE_IDS.zoneQubaNorth;

/**
 * The instant every scenario starts from.
 *
 * Fixed rather than `now()` so a failing run can be replayed exactly, and so the
 * deadlines printed in an assertion message are the same on every machine.
 */
export const GATE_EPOCH = "2026-08-22T09:00:00.000Z";

/**
 * The dispatch rules this suite dispatches under.
 *
 * `waveSize: 1` on purpose, and it is the difference between a gate that proves
 * escalation and one that only claims it: with one driver per wave, the second wave
 * exists only if the first was closed and the rejecting driver excluded, so the
 * exclusion is observable instead of inferred. The server's default is 2, and the
 * supersession scenario raises it back to 2 to prove the sibling path.
 */
export const GATE_RULES: DispatchRules = {
  rulesetVersion: 1,
  waveSize: 1,
  offerTimeoutSeconds: 30,
  maxWaves: 3,
  escalationTimeoutSeconds: 120,
};

/** Reverse dependency order — the same lists the two services' own pg harnesses use. */
const MATCHING_TABLES = [
  "matching_idempotency",
  "matching_outbox",
  "matching_decision_candidates",
  "matching_decisions",
  "matching_rulesets",
  "driver_candidacy",
] as const;

const DISPATCH_TABLES = [
  "dispatch_idempotency",
  "dispatch_outbox",
  "dispatch_offers",
  "dispatch_waves",
  "dispatch_jobs",
] as const;

/** The canonical DDL, read from the contracts rather than duplicated here. */
const MATCHING_SCHEMA_SQL = resolve(process.cwd(), "../../services/matching/contracts/schema.sql");
const DISPATCH_SCHEMA_SQL = resolve(process.cwd(), "../../services/dispatch/contracts/schema.sql");

/**
 * The one clock matching and dispatch share.
 *
 * Both services declare `Clock` as `{ now(): string }`, so one instance satisfies
 * both without either depending on the other. Sharing it is what makes the freshness
 * filter deterministic: dispatch stamps `evaluated_at` from this clock and matching
 * stamped `updated_at` from the same one, so a candidacy row is fresh because the
 * test moved time, never because a machine was fast.
 */
export class GateClock {
  private current: number;

  constructor(iso: string = GATE_EPOCH) {
    this.current = Date.parse(iso);
  }

  now(): string {
    return new Date(this.current).toISOString();
  }

  advanceSeconds(seconds: number): void {
    this.current += seconds * 1000;
  }
}

export interface GateContext {
  readonly identityUrl: string;
  readonly geographyUrl: string;
  readonly customerUrl: string;
  readonly ordersUrl: string;
  readonly matchingUrl: string;
  readonly dispatchUrl: string;
  /** The injected clock — the only way time moves in this suite. */
  readonly clock: GateClock;
  /** `postgres` or `memory` — for MATCHING and DISPATCH. Reported so a run is unambiguous. */
  readonly persistence: "postgres" | "memory";
  /** Everything dispatch appended, whichever store is in play. */
  dispatchEvents(): Promise<AnyDispatchEvent[]>;
  close(): Promise<void>;
}

export interface StartGateOptions {
  /** Override the dispatch rules — used by the supersession scenario to widen the wave. */
  readonly rules?: Partial<DispatchRules>;
}

/** Start the gate: six listeners, one shared clock, one store set for Phase 07. */
export async function startGate(options: StartGateOptions = {}): Promise<GateContext> {
  const clock = new GateClock();
  const rules: DispatchRules = { ...GATE_RULES, ...options.rules };

  // Say which store this run used, before it uses it. A green gate means nothing
  // until the reader knows whether it proved the memory path or the Postgres one, and
  // a log line is cheaper than a reader guessing from the absence of an env var.
  console.info(
    `[phase07-gate] matching+dispatch persistence = ${DISPATCH_DATABASE_URL ? "postgres" : "memory"}`,
  );

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

  // --- the Order Engine: in-memory by declaration (see the header) ----------
  const orderOutbox = new InMemoryOrderOutbox();
  const ordersApp = createOrderApp({
    runner: createOrderDirectRunner({
      repository: new InMemoryOrderRepository(),
      outbox: orderOutbox,
      clock: new OrderClock(),
      ids: new OrderIdGenerator(),
      publicIds: new InMemoryOrderPublicIdGenerator(),
    }),
    health: { persistence: "memory" },
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
      orderIntake: new HttpOrderIntakePort({ baseUrl: ordersUrl }),
    } satisfies UseCaseDeps,
    health: { persistence: "memory", orderIntake: "configured" },
    logger: false,
  });
  await customerApp.listen({ port: 0, host: "127.0.0.1" });
  const customerUrl = `http://127.0.0.1:${(customerApp.server.address() as AddressInfo).port}`;

  // --- matching: real service, real zone hierarchy over HTTP ----------------
  const pools: Pool[] = [];
  const zones = new HttpZoneHierarchy({ baseUrl: geographyUrl });
  let matchingRunner: MatchingRunner;

  if (DISPATCH_DATABASE_URL) {
    const created = createMatchingDb({ connectionString: DISPATCH_DATABASE_URL, max: 4 });
    pools.push(created.pool);
    await created.pool.query(`DROP TABLE IF EXISTS ${MATCHING_TABLES.join(", ")} CASCADE`);
    await created.pool.query(await readFile(MATCHING_SCHEMA_SQL, "utf-8"));
    matchingRunner = new PostgresMatchingRunner(new PostgresMatchingUnitOfWork(created.db), {
      zones,
      clock,
      ids: new MatchingIdGenerator(),
    });
  } else {
    matchingRunner = createMatchingDirectRunner({
      ...createInMemoryDependencies({ now: GATE_EPOCH }),
      zones,
      clock,
    });
  }

  const matchingApp = createMatchingApp({
    runner: matchingRunner,
    health: { persistence: DISPATCH_DATABASE_URL ? "postgres" : "memory" },
    logger: false,
  });
  await matchingApp.listen({ port: 0, host: "127.0.0.1" });
  const matchingUrl = `http://127.0.0.1:${(matchingApp.server.address() as AddressInfo).port}`;

  // --- dispatch: real service, PRODUCTION adapters to matching and the engine
  const matchingPort = new HttpMatchingPort({ baseUrl: matchingUrl });
  const ordersPort = new HttpOrderEnginePort({ baseUrl: ordersUrl });
  const rulesProvider = new StaticRulesProvider(rules);
  let dispatchRunner: DispatchRunner;
  let readDispatchEvents: () => Promise<AnyDispatchEvent[]>;

  if (DISPATCH_DATABASE_URL) {
    const created = createDispatchDb({ connectionString: DISPATCH_DATABASE_URL, max: 4 });
    pools.push(created.pool);
    await created.pool.query(`DROP TABLE IF EXISTS ${DISPATCH_TABLES.join(", ")} CASCADE`);
    await created.pool.query(await readFile(DISPATCH_SCHEMA_SQL, "utf-8"));
    dispatchRunner = new PostgresDispatchRunner(new PostgresDispatchUnitOfWork(created.db), {
      matching: matchingPort,
      orders: ordersPort,
      rules: rulesProvider,
      clock,
      ids: new DispatchIdGenerator(),
    });
    const outbox = new PostgresDispatchOutbox(created.db);
    readDispatchEvents = () => outbox.unread();
  } else {
    const stores = createInMemoryStores();
    dispatchRunner = createDispatchDirectRunner({
      ...stores,
      matching: matchingPort,
      orders: ordersPort,
      rules: rulesProvider,
      clock,
      ids: new DispatchIdGenerator(),
    });
    readDispatchEvents = () => stores.outbox.unread();
  }

  const dispatchApp = createDispatchApp({
    runner: dispatchRunner,
    health: { persistence: DISPATCH_DATABASE_URL ? "postgres" : "memory" },
    logger: false,
  });
  await dispatchApp.listen({ port: 0, host: "127.0.0.1" });
  const dispatchUrl = `http://127.0.0.1:${(dispatchApp.server.address() as AddressInfo).port}`;

  return {
    identityUrl,
    geographyUrl,
    customerUrl,
    ordersUrl,
    matchingUrl,
    dispatchUrl,
    clock,
    persistence: DISPATCH_DATABASE_URL ? "postgres" : "memory",
    dispatchEvents: () => readDispatchEvents(),
    close: async () => {
      await dispatchApp.close();
      await matchingApp.close();
      await customerApp.close();
      await ordersApp.close();
      await geoApp.close();
      await identityApp.close();
      for (const pool of pools) await pool.end();
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers — every call in this suite goes over the wire
// ---------------------------------------------------------------------------

export interface HttpResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface CallInit {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly customerScope?: string;
  readonly traceId?: string;
}

async function call(baseUrl: string, init: CallInit): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${init.path}`, {
    method: init.method,
    headers: {
      // Only when there IS a body. `POST /dispatch/tick` takes none, and Fastify
      // answers a declared-but-empty JSON body with 400 before any route runs — a
      // header this helper added would have failed the gate for its own convenience.
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.idempotencyKey === undefined ? {} : { "idempotency-key": init.idempotencyKey }),
      ...(init.customerScope === undefined ? {} : { "x-customer-public-id": init.customerScope }),
      ...(init.traceId === undefined ? {} : { "x-request-id": init.traceId }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

export const callIdentity = (gate: GateContext, init: CallInit): Promise<HttpResult> =>
  call(gate.identityUrl, init);
export const callCustomers = (gate: GateContext, init: CallInit): Promise<HttpResult> =>
  call(gate.customerUrl, init);
export const callEngine = (gate: GateContext, init: CallInit): Promise<HttpResult> =>
  call(gate.ordersUrl, init);
export const callMatching = (gate: GateContext, init: CallInit): Promise<HttpResult> =>
  call(gate.matchingUrl, init);
export const callDispatch = (gate: GateContext, init: CallInit): Promise<HttpResult> =>
  call(gate.dispatchUrl, init);

let keyCounter = 0;

/** A fresh idempotency key. Every write in this suite carries its own. */
export function nextKey(prefix: string): string {
  keyCounter += 1;
  return `${prefix}-${String(keyCounter).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Fixtures: a customer, an order, and drivers matching will actually return
// ---------------------------------------------------------------------------

let channelUserCounter = 700_000;

/**
 * A customer that exists in identity AND has an active profile.
 *
 * Identity mints the `wasla_public_id`, and the profile is created through the
 * Customer Core's own route, because the order-request use case refuses a customer
 * without one — this gate must not reach into a store to invent a state the API
 * cannot produce.
 */
export async function onboardCustomer(gate: GateContext): Promise<string> {
  channelUserCounter += 1;
  const resolved = await callIdentity(gate, {
    method: "POST",
    path: "/identity/resolve",
    body: { telegram_user_id: channelUserCounter, source: "customer_bot" },
  });
  const waslaPublicId = resolved.body.wasla_public_id as string;
  const profile = await callCustomers(gate, {
    method: "PUT",
    path: `/customers/${waslaPublicId}/profile`,
    body: { preferred_locale: "ar", display_name: "عميل بوابة المرحلة 07" },
  });
  if (profile.status !== 201 && profile.status !== 200) {
    throw new Error(`profile creation failed: ${profile.status} ${JSON.stringify(profile.body)}`);
  }
  return waslaPublicId;
}

/** A valid two-stop order body for the Customer Core's own route. */
export function orderBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_type: "ride",
    vehicle_class: "sedan",
    price_mode: "customer_offer",
    offered_price: { amount_minor: 2500, currency: "SAR" },
    stops: [
      { kind: "pickup", zone_id: PICKUP_ZONE, source: "map", label: "حارة الشرق" },
      { kind: "dropoff", zone_id: DROPOFF_ZONE, source: "map", label: "قربان الشمالية" },
    ],
    notes: null,
    ...overrides,
  };
}

export interface GateOrder {
  /** The engine's internal UUID — what `POST /dispatch/jobs` takes. */
  readonly orderId: string;
  /** The engine's reference, as the customer received it. */
  readonly orderPublicId: string;
  /** Who owns it — the scope header every engine read needs. */
  readonly customerPublicId: string;
}

/**
 * An order in the engine, created the way a customer creates one.
 *
 * The intent goes to the Customer Core, which hands it over through the production
 * `HttpOrderIntakePort`; the engine's internal id is then read back over HTTP,
 * because that is the id dispatch is given and the suite must not know it any other
 * way than a caller would.
 */
export async function placeOrder(gate: GateContext): Promise<GateOrder> {
  const customerPublicId = await onboardCustomer(gate);
  const created = await callCustomers(gate, {
    method: "POST",
    path: `/customers/${customerPublicId}/order-requests`,
    body: orderBody(),
    idempotencyKey: nextKey("gate-intake"),
  });
  if (created.status !== 201) {
    throw new Error(`handover failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const orderPublicId = created.body.order_public_id as string;
  const read = await callEngine(gate, {
    method: "GET",
    path: `/orders/${orderPublicId}`,
    customerScope: customerPublicId,
  });
  if (read.status !== 200) {
    throw new Error(`order read failed: ${read.status} ${JSON.stringify(read.body)}`);
  }
  return { orderId: read.body.id as string, orderPublicId, customerPublicId };
}

/**
 * A driver matching will actually return.
 *
 * The eight hard filters are all satisfied deliberately and in one place, so a test
 * that wants a driver *excluded* has exactly one thing to change:
 * `available` + `eligible` + fresh (the shared clock) + serves `ride` + `sedan` +
 * serving the pickup zone itself (the hierarchy resolves it through geography).
 */
export async function seedDriver(
  gate: GateContext,
  driverPublicId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const result = await callMatching(gate, {
    method: "PUT",
    path: `/candidacy/${driverPublicId}`,
    idempotencyKey: nextKey("gate-candidacy"),
    body: {
      availability_state: "available",
      eligibility_state: "eligible",
      // Declared, not pretended: Phase 05 does not exist yet (see the header).
      eligibility_source: "claimed",
      service_kinds: ["ride"],
      vehicle_class: "sedan",
      zone_ids: [PICKUP_ZONE],
      actor_type: "test",
      ...overrides,
    },
  });
  if (result.status !== 200 && result.status !== 201) {
    throw new Error(`candidacy seed failed: ${result.status} ${JSON.stringify(result.body)}`);
  }
}

// ---------------------------------------------------------------------------
// Driving the loop
// ---------------------------------------------------------------------------

/** Create the dispatch job for an order. Returns the job body. */
export async function createJob(gate: GateContext, order: GateOrder): Promise<Record<string, unknown>> {
  const created = await callDispatch(gate, {
    method: "POST",
    path: "/dispatch/jobs",
    idempotencyKey: nextKey("gate-job"),
    body: {
      order_id: order.orderId,
      order_public_id: order.orderPublicId,
      zone_id: PICKUP_ZONE,
      order_type: "ride",
      vehicle_class: "sedan",
    },
  });
  if (created.status !== 201) {
    throw new Error(`job creation failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  return created.body;
}

/** One explicit tick. Time never advances by itself in this suite. */
export async function tick(gate: GateContext): Promise<HttpResult> {
  return callDispatch(gate, {
    method: "POST",
    path: "/dispatch/tick",
    idempotencyKey: nextKey("gate-tick"),
  });
}

export async function readJob(gate: GateContext, jobId: string): Promise<Record<string, unknown>> {
  const result = await callDispatch(gate, { method: "GET", path: `/dispatch/jobs/${jobId}` });
  if (result.status !== 200) {
    throw new Error(`job read failed: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

export async function readOffers(
  gate: GateContext,
  jobId: string,
): Promise<Record<string, unknown>[]> {
  const result = await callDispatch(gate, {
    method: "GET",
    path: `/dispatch/jobs/${jobId}/offers`,
  });
  if (result.status !== 200) {
    throw new Error(`offers read failed: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result.body.items as Record<string, unknown>[];
}

/** The offers still awaiting an answer, newest wave last. */
export async function openOffers(
  gate: GateContext,
  jobId: string,
): Promise<Record<string, unknown>[]> {
  return (await readOffers(gate, jobId)).filter((offer) => offer.status === "offered");
}

export async function readOrder(
  gate: GateContext,
  order: GateOrder,
): Promise<Record<string, unknown>> {
  const result = await callEngine(gate, {
    method: "GET",
    path: `/orders/${order.orderId}`,
    customerScope: order.customerPublicId,
  });
  if (result.status !== 200) {
    throw new Error(`order read failed: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

export async function orderStatus(gate: GateContext, order: GateOrder): Promise<string> {
  return (await readOrder(gate, order)).status as string;
}

/** The order's status trail, oldest first — the engine's own audit, read over HTTP. */
export async function orderStatusTrail(
  gate: GateContext,
  order: GateOrder,
): Promise<string[]> {
  const result = await callEngine(gate, {
    method: "GET",
    path: `/orders/${order.orderId}/history`,
    customerScope: order.customerPublicId,
  });
  if (result.status !== 200) {
    throw new Error(`history read failed: ${result.status} ${JSON.stringify(result.body)}`);
  }
  const items = result.body.items as Record<string, unknown>[];
  return items.map((entry) => entry.to_status as string);
}

export async function readCandidacy(
  gate: GateContext,
  driverPublicId: string,
): Promise<Record<string, unknown>> {
  const result = await callMatching(gate, {
    method: "GET",
    path: `/candidacy/${driverPublicId}`,
  });
  if (result.status !== 200) {
    throw new Error(`candidacy read failed: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result.body;
}
