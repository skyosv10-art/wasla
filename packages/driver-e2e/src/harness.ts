/**
 * Shared setup for the Phase 05 Exit Gate suite.
 *
 * The gate asks one question: **«can a driver register, be reviewed, become eligible
 * by a CALCULATED verdict, receive a real offer from dispatch, and then — with one
 * pulse and no waiting — fall out of the pool the moment his document expires, with
 * matching reading `eligibility_source = driver_core` and never `claimed`?»**
 *
 * Everything in the path is real, and that is the point of a gate:
 *
 *   - **identity** mints the driver's `wasla_public_id`, over HTTP, the way the driver
 *     bot obtains it. A gate that invented `WS-1000000001` itself would be proving its
 *     own string format;
 *   - **geography** is its own listener, so the Driver Core's `HttpZoneCatalogPort`
 *     really asks `GET /geo/zones/{id}` before accepting a served zone. This is the
 *     only way the gate can claim the zone check is a check and not a formality: the
 *     unknown-zone scenario is refused by a service that was asked, not by a seeded set;
 *   - **matching** is its own listener, and the Driver Core reaches it through the
 *     **production** `HttpCandidacyPort` imported from `@wasla/drivers-service` — not a
 *     copy. This is the seam MR 5/6 could only prove against injected answers; here the
 *     wire itself is under test, including the key allowlist on matching's side, its
 *     `200`-not-`201` upsert, and the `driver_core` value in its `eligibility_source`
 *     enum;
 *   - the **Customer Core** hands a real intent to the **Order Engine** through the
 *     production `HttpOrderIntakePort` (Phase 06's gate), so the order this suite
 *     dispatches was created the way a customer creates one, not injected;
 *   - **dispatch** is its own listener and reaches matching and the engine through the
 *     production `HttpMatchingPort` and `HttpOrderEnginePort` (Phase 07's gate). The
 *     offer the driver receives is therefore an offer the shipped loop produced.
 *
 * That is seven listeners. None of them is a stub, and none of the four cross-service
 * adapters in the path is a copy — a gate that drove copies would keep passing while
 * the shipped adapters drifted, which is precisely the failure a gate exists to prevent.
 *
 * ## The promise this file keeps
 *
 * `packages/dispatch-e2e/src/harness.ts` says, in its header: *«No driver service.
 * Phase 05 (Driver Core) is not built. Candidacy rows are seeded through matching's own
 * `PUT /candidacy/{driver_public_id}` with `eligibility_source: "claimed"` … When Phase
 * 05 ships, the seeding helper here is the one place that changes, and
 * `eligibility_source` becomes `driver_core`.»*
 *
 * Phase 05 has shipped, and this file is where that promise is kept — but NOT by
 * editing Phase 07's harness. Phase 07's gate owns the question «does the dispatch loop
 * work?», and its four scenarios must stay able to put a driver in any state matching
 * accepts, including states the Driver Core would refuse to publish (a stale row, a
 * `busy` row, a driver serving a zone he has no vehicle for). Making that suite go
 * through the Driver Core would couple two gates: a Driver Core bug would then fail the
 * dispatch gate, and the failure would be reported against the wrong phase.
 *
 * So the promise is kept where it belongs: **here**, in the phase that owns the driver.
 * `eligibility_source` in this suite is `driver_core` because nobody typed it — the
 * Driver Core computed the verdict and published it. `dispatch-e2e` keeps `claimed`,
 * and that is now a deliberate statement rather than a gap: it is testing what matching
 * does with a row it was TOLD about, which is a case that still exists in production
 * (ADR-011) and needs a suite of its own.
 *
 * ## Time is injected, never slept
 *
 * One `GateClock` is shared by the Driver Core, matching and dispatch, so
 * `evaluated_at` (stamped by dispatch), `updated_at` (written by matching) and the
 * expiry instant (computed by the Driver Core) are all read off the same instant.
 * The document expiry in this suite is crossed by moving that clock and calling
 * `POST /drivers/eligibility/tick` exactly once: a gate that waited on wall time
 * would be a gate that is slow when it passes and flaky when it fails — and a
 * licence that expires in 2027 would make it unrunnable.
 *
 * ## What is NOT real, declared rather than hidden
 *
 *   1. **No driver bot and no channel.** Phase 03's gate owns the bots. A driver here
 *      registers and declares availability by calling the same routes the bot calls
 *      in-process (`bots/driver-bot`), so the routes are proven and the Telegram
 *      transport is not re-proven.
 *   2. **No document storage.** `storage_ref` is an opaque string by contract until
 *      Phase 12; the reviewer's decision is what eligibility depends on, and that is
 *      real here.
 *   3. **The customer store, the engine store, matching and dispatch are in-memory,
 *      always.** Phase 04, 06 and 07's gates own their atomicity. Repeating any of
 *      them here would make this gate fail for reasons that have nothing to do with
 *      the Driver Core. `DRIVER_DATABASE_URL` lifts **the Driver Core only**, because
 *      its atomicity is what this phase owns.
 *
 * Why `DRIVER_DATABASE_URL` and not `DATABASE_URL`: `DATABASE_URL` is the name the
 * Driver Core's own integration job already uses (`drivers-db-integration`), and the
 * channel store (Phase 03) uses it too. A separate name keeps this gate's database its
 * own, so a failure here is never a collision with another job's schema.
 *
 * Reasoning in docs/12-testing/PHASE05_EXIT_GATE_E2E.md.
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
  CUSTOMERS_ORDERS_SCOPES,
} from "@wasla/customers-service";
import {
  createDispatchApp,
  DISPATCH_MATCHING_SCOPES,
  createDirectRunner as createDispatchDirectRunner,
  createInMemoryStores,
  HttpMatchingPort,
  HttpOrderEnginePort,
  SequentialIdGenerator as DispatchIdGenerator,
  StaticRulesProvider,
  type DispatchRules,
  DISPATCH_ORDERS_SCOPES,
} from "@wasla/dispatch-service";
import {
  createDriverApp,
  createDriverDb,
  createDirectRunner as createDriverDirectRunner,
  createInMemoryEnvironment,
  DRIVERS_MATCHING_SCOPES,
  HttpCandidacyPort,
  HttpZoneCatalogPort,
  PostgresDriverOutbox,
  PostgresDriverRunner,
  SequentialIdGenerator as DriverIdGenerator,
  type DriverDomainEvent,
  type DriverDependencies,
  type DriverRunner,
  type DriverTickState,
} from "@wasla/drivers-service";
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
  createDirectRunner as createMatchingDirectRunner,
  HttpZoneHierarchy,
} from "@wasla/matching-service";
import {
  createDirectRunner as createOrderDirectRunner,
  createOrderApp,
  CryptoIdGenerator as OrderIdGenerator,
  InMemoryOrderPublicIdGenerator,
  InMemoryOrderRepository,
  InMemoryOutbox as InMemoryOrderOutbox,
  SystemClock as OrderClock,
  ORDER_SCOPES,
} from "@wasla/orders-service";
import {
  createServiceRequestSigner,
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
} from "@wasla/service-auth";
import { Pool } from "pg";


/**
 * Service-identity material for the matching boundary (M1-03).
 *
 * One secret for every actor in this gate: what is proven here is the WIRE, and key
 * management has its own suite in `packages/service-auth`. Each client still signs with
 * only the scopes it needs, so a scope mistake surfaces here rather than in production.
 */
const GATE_SERVICE_AUTH_KID = "gate-active";
const GATE_SERVICE_AUTH_SECRET = "gate-service-auth-secret-0123456789";

/** كامل صلاحيات المطابقة — للسِند وحده، وكل عميل إنتاجي يوقّع بصلاحياته هو. */
const GATE_MATCHING_SCOPES: readonly string[] = [
  "matching:candidates:evaluate",
  "matching:candidacy:read",
  "matching:candidacy:write",
  "matching:rulesets:read",
  "matching:decisions:read",
];

function gateServiceAuthKeys(): ServiceAuthKeyRegistry {
  return new ServiceAuthKeyRegistry({
    keys: [{ kid: GATE_SERVICE_AUTH_KID, secret: GATE_SERVICE_AUTH_SECRET, status: "active" }],
    activeKid: GATE_SERVICE_AUTH_KID,
  });
}

function gateSigner(serviceName: string, scopes: readonly string[]) {
  return createServiceRequestSigner({
    serviceName,
    audience: "matching",
    keys: gateServiceAuthKeys(),
    scopes,
  });
}

/**
 * M1-04: the order engine enforces service identity too, and a token minted for
 * `matching` is refused by `orders` — the audience is what makes the two
 * boundaries separate rather than one shared door.
 */
function ordersSigner(serviceName: string, scopes: readonly string[]) {
  return createServiceRequestSigner({
    serviceName,
    audience: "orders",
    keys: gateServiceAuthKeys(),
    scopes,
  });
}

/** Postgres mode is opt-in for the DRIVER CORE; the gate itself is not opt-in. */
export const DRIVER_DATABASE_URL = process.env.DRIVER_DATABASE_URL;

/**
 * Two active zones from the Saudi fixture — a real hierarchy, not a stub.
 *
 * `SERVED_ZONE` is the driver's served zone AND the order's pickup zone, so matching's
 * seventh hard filter (`zone_served_by_hierarchy`) resolves a lineage that geography
 * actually published.
 */
export const SERVED_ZONE = SAUDI_FIXTURE_IDS.zoneHaraEast;
export const DROPOFF_ZONE = SAUDI_FIXTURE_IDS.zoneQubaNorth;

/**
 * A syntactically valid zone id that geography does not know.
 *
 * Used by the unknown-zone scenario. A malformed string would be refused by the
 * Driver Core's own validation before any HTTP call, which would prove the opposite of
 * what that scenario is for.
 */
export const UNKNOWN_ZONE = "99999999-9999-4999-8999-999999999999";

/**
 * The instant every scenario starts from.
 *
 * Fixed rather than `now()` so a failing run can be replayed exactly, and so the
 * expiry instants printed in an assertion message are the same on every machine.
 */
export const GATE_EPOCH = "2026-08-22T09:00:00.000Z";

/**
 * The expiry date the gate's driving licence carries.
 *
 * `expiryInstant()` in the Driver Core reads a plain date as midnight UTC
 * (`domain/eligibility.ts`), and the launch policy's grace is 0 days, so this licence
 * stops being valid at exactly `2026-08-23T00:00:00.000Z` — fifteen hours after
 * `GATE_EPOCH`. `EXPIRY_ADVANCE_SECONDS` is what the scenario advances the clock by to
 * cross it, and it is derived from the two constants rather than written as a magic
 * `54000` so that moving the epoch cannot silently stop crossing the expiry.
 */
export const LICENCE_EXPIRES_AT = "2026-08-23";
export const EXPIRY_ADVANCE_SECONDS = Math.ceil(
  (Date.parse(`${LICENCE_EXPIRES_AT}T00:00:00.000Z`) - Date.parse(GATE_EPOCH)) / 1000,
);

/** Far enough away that only the licence expires when the clock moves. */
export const VEHICLE_DOC_EXPIRES_AT = "2027-06-01";

/**
 * The dispatch rules this suite dispatches under.
 *
 * `waveSize: 1` so one driver is one wave: the gate's question is «did the offer reach
 * THIS driver?», and a wider wave would let it pass on a coincidence.
 */
export const GATE_RULES: DispatchRules = {
  rulesetVersion: 1,
  waveSize: 1,
  offerTimeoutSeconds: 30,
  maxWaves: 3,
  escalationTimeoutSeconds: 120,
};

/** Reverse dependency order — the same list the service's own pg harness uses. */
const DRIVER_TABLES = [
  "driver_idempotency",
  "driver_outbox",
  "driver_candidacy_publications",
  "driver_eligibility_log",
  "driver_documents",
  "driver_vehicles",
  "driver_service_zones",
  "driver_eligibility_policies",
  "driver_profiles",
] as const;

/** The canonical DDL, read from the contracts rather than duplicated here. */
const DRIVER_SCHEMA_SQL = resolve(process.cwd(), "../../services/drivers/contracts/schema.sql");

/**
 * The one clock the Driver Core, matching and dispatch share.
 *
 * All three declare `Clock` as `{ now(): string }`, so one instance satisfies all of
 * them without any of them depending on another. Sharing it is what makes both the
 * freshness filter and the expiry deterministic: a candidacy row is fresh because the
 * test did not move time, and a licence is expired because the test did — never because
 * a machine was fast or slow.
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
  readonly driversUrl: string;
  /** The injected clock — the only way time moves in this suite. */
  readonly clock: GateClock;
  /** `postgres` or `memory` — for the DRIVER CORE. Reported so a run is unambiguous. */
  readonly persistence: "postgres" | "memory";
  /** Everything the Driver Core appended, whichever store is in play. */
  driverEvents(): Promise<DriverDomainEvent[]>;
  close(): Promise<void>;
}

export interface StartGateOptions {
  /** Override the dispatch rules — none of today's scenarios needs to. */
  readonly rules?: Partial<DispatchRules>;
}

/** Start the gate: seven listeners, one shared clock, one store set for Phase 05. */
export async function startGate(options: StartGateOptions = {}): Promise<GateContext> {
  const clock = new GateClock();
  const rules: DispatchRules = { ...GATE_RULES, ...options.rules };

  // Say which store this run used, before it uses it. A green gate means nothing until
  // the reader knows whether it proved the memory path or the Postgres one, and a log
  // line is cheaper than a reader guessing from the absence of an env var.
  console.info(
    `[phase05-gate] driver-core persistence = ${DRIVER_DATABASE_URL ? "postgres" : "memory"}`,
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
  const ordersApp = createOrderApp({
    runner: createOrderDirectRunner({
      repository: new InMemoryOrderRepository(),
      outbox: new InMemoryOrderOutbox(),
      clock: new OrderClock(),
      ids: new OrderIdGenerator(),
      publicIds: new InMemoryOrderPublicIdGenerator(),
    }),
    health: { persistence: "memory" },
    logger: false,
    serviceIdentity: {
      keys: gateServiceAuthKeys(),
      replayGuard: new InMemoryServiceTokenReplayGuard(),
    },
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
      orderIntake: new HttpOrderIntakePort({
        baseUrl: ordersUrl,
        signRequest: ordersSigner("customers", CUSTOMERS_ORDERS_SCOPES),
      }),
    } satisfies UseCaseDeps,
    health: { persistence: "memory", orderIntake: "configured" },
    logger: false,
  });
  await customerApp.listen({ port: 0, host: "127.0.0.1" });
  const customerUrl = `http://127.0.0.1:${(customerApp.server.address() as AddressInfo).port}`;

  // --- matching: real service, real zone hierarchy over HTTP ----------------
  const matchingApp = createMatchingApp({
    runner: createMatchingDirectRunner({
      ...createInMemoryDependencies({ now: GATE_EPOCH }),
      zones: new HttpZoneHierarchy({ baseUrl: geographyUrl }),
      clock,
    }),
    health: { persistence: "memory" },
    logger: false,
    // M1-03: matching enforces service identity; the two production clients below sign.
    serviceIdentity: {
      keys: gateServiceAuthKeys(),
      replayGuard: new InMemoryServiceTokenReplayGuard(),
    },
  });
  await matchingApp.listen({ port: 0, host: "127.0.0.1" });
  const matchingUrl = `http://127.0.0.1:${(matchingApp.server.address() as AddressInfo).port}`;

  // --- the Driver Core: the service this gate is for ------------------------
  //
  // The two outbound adapters are the PRODUCTION ones, pointed at the two listeners
  // above. This is the whole reason the gate exists: MR 5/6 proved what these adapters
  // DECIDE (`src/__tests__/outbound-ports.test.ts` — every status, every silence)
  // against injected answers; only a live matching service proves the WIRE.
  const candidacy = new HttpCandidacyPort({
    baseUrl: matchingUrl,
    clock,
    signRequest: gateSigner("drivers", DRIVERS_MATCHING_SCOPES),
  });
  const zoneCatalog = new HttpZoneCatalogPort({ baseUrl: geographyUrl });
  const ids = new DriverIdGenerator();
  const pools: Pool[] = [];
  let driverRunner: DriverRunner;
  let readDriverEvents: () => Promise<DriverDomainEvent[]>;

  if (DRIVER_DATABASE_URL) {
    const created = createDriverDb({ connectionString: DRIVER_DATABASE_URL, max: 4 });
    pools.push(created.pool);
    await created.pool.query(`DROP TABLE IF EXISTS ${DRIVER_TABLES.join(", ")} CASCADE`);
    // The DDL is replayed, not projected from Drizzle, and it carries the version 1
    // `saudi-launch-v1` policy seed (§5) that the whole calculator reads. A harness
    // that built its tables from the Drizzle schema would have no policy, and every
    // scenario would fail with `policyNotFound()` — a green suite proving registration
    // is broken.
    await created.pool.query(await readFile(DRIVER_SCHEMA_SQL, "utf-8"));
    driverRunner = new PostgresDriverRunner(created.db, { candidacy, zoneCatalog, clock, ids });
    const outbox = new PostgresDriverOutbox(created.db);
    readDriverEvents = () => outbox.unread();
  } else {
    const env = createInMemoryEnvironment(GATE_EPOCH);
    const deps = { ...env, candidacy, zoneCatalog, clock, ids } satisfies DriverDependencies;
    driverRunner = createDriverDirectRunner(deps);
    readDriverEvents = () => env.outbox.unread();
  }

  const tickState: DriverTickState = { lastTickAt: null };
  const driversApp = createDriverApp({
    runner: driverRunner,
    health: { persistence: DRIVER_DATABASE_URL ? "postgres" : "memory" },
    tickState,
    logger: false,
  });
  await driversApp.listen({ port: 0, host: "127.0.0.1" });
  const driversUrl = `http://127.0.0.1:${(driversApp.server.address() as AddressInfo).port}`;

  // --- dispatch: real service, PRODUCTION adapters to matching and the engine
  const stores = createInMemoryStores();
  const dispatchApp = createDispatchApp({
    runner: createDispatchDirectRunner({
      ...stores,
      matching: new HttpMatchingPort({
        baseUrl: matchingUrl,
        signRequest: gateSigner("dispatch", DISPATCH_MATCHING_SCOPES),
      }),
      orders: new HttpOrderEnginePort({
        baseUrl: ordersUrl,
        signRequest: ordersSigner("dispatch", DISPATCH_ORDERS_SCOPES),
      }),
      rules: new StaticRulesProvider(rules),
      clock,
      ids: new DispatchIdGenerator(),
    }),
    health: { persistence: "memory" },
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
    driversUrl,
    clock,
    persistence: DRIVER_DATABASE_URL ? "postgres" : "memory",
    driverEvents: () => readDriverEvents(),
    close: async () => {
      await dispatchApp.close();
      await driversApp.close();
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
  /** Extra headers — service identity on the matching boundary (M1-03). */
  readonly headers?: Record<string, string>;
}

async function call(baseUrl: string, init: CallInit): Promise<HttpResult> {
  const response = await fetch(`${baseUrl}${init.path}`, {
    method: init.method,
    headers: {
      // Only when there IS a body. `POST /drivers/eligibility/tick` takes none, and
      // Fastify answers a declared-but-empty JSON body with 400 before any route runs —
      // a header this helper added would have failed the gate for its own convenience.
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.idempotencyKey === undefined ? {} : { "idempotency-key": init.idempotencyKey }),
      ...(init.customerScope === undefined ? {} : { "x-customer-public-id": init.customerScope }),
      ...(init.traceId === undefined ? {} : { "x-request-id": init.traceId }),
      ...(init.headers ?? {}),
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
export const callGeography = (gate: GateContext, init: CallInit): Promise<HttpResult> =>
  call(gate.geographyUrl, init);
export const callCustomers = (gate: GateContext, init: CallInit): Promise<HttpResult> =>
  call(gate.customerUrl, init);
/** Direct engine calls are signed too (M1-04) — same reason as matching below. */
export const callEngine = (gate: GateContext, init: CallInit): Promise<HttpResult> =>
  call(gate.ordersUrl, {
    ...init,
    headers: {
      // الربط لا يشمل سلسلة الاستعلام (ADR-021 §4)، فيُوقَّع المسار وحده.
      ...ordersSigner("driver-exit-gate", Object.values(ORDER_SCOPES))(
        init.method,
        init.path.split("?")[0] ?? init.path,
      ),
      ...(init.headers ?? {}),
    },
  });
/**
 * Every direct call to matching in this suite is signed (M1-03). The seed helpers that
 * plant candidacy rows are service-to-service traffic like any other, and matching now
 * refuses traffic with no identity — so the harness carries one instead of the boundary
 * being loosened for the suite's convenience.
 */
export const callMatching = (gate: GateContext, init: CallInit): Promise<HttpResult> =>
  call(gate.matchingUrl, {
    ...init,
    headers: {
      ...gateSigner("e2e-harness", GATE_MATCHING_SCOPES)(init.method, init.path),
      ...(init.headers ?? {}),
    },
  });
export const callDispatch = (gate: GateContext, init: CallInit): Promise<HttpResult> =>
  call(gate.dispatchUrl, init);
export const callDrivers = (gate: GateContext, init: CallInit): Promise<HttpResult> =>
  call(gate.driversUrl, init);

let keyCounter = 0;

/** A fresh idempotency key. Every write in this suite carries its own. */
export function nextKey(prefix: string): string {
  keyCounter += 1;
  return `${prefix}-${String(keyCounter).padStart(6, "0")}`;
}

/** Fail loudly with the body, so a red gate says WHY and not just where. */
function expectStatus(result: HttpResult, expected: readonly number[], what: string): HttpResult {
  if (!expected.includes(result.status)) {
    throw new Error(`${what} → ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Fixtures: a driver identity, a customer, an order
// ---------------------------------------------------------------------------

let channelUserCounter = 900_000;

/**
 * A `wasla_public_id` minted by identity for a driver.
 *
 * `source: "driver_bot"` because that is who asks in production. The gate must not
 * invent the id: the format is identity's to own (ADR-002), and a hand-written
 * `WS-1000000001` would be this suite testing its own string literal.
 */
export async function mintDriverId(gate: GateContext): Promise<string> {
  channelUserCounter += 1;
  const resolved = await callIdentity(gate, {
    method: "POST",
    path: "/identity/resolve",
    body: { telegram_user_id: channelUserCounter, source: "driver_bot" },
  });
  expectStatus(resolved, [200, 201], "identity resolve (driver)");
  return resolved.body.wasla_public_id as string;
}

/** A customer that exists in identity AND has an active profile. */
export async function onboardCustomer(gate: GateContext): Promise<string> {
  channelUserCounter += 1;
  const resolved = await callIdentity(gate, {
    method: "POST",
    path: "/identity/resolve",
    body: { telegram_user_id: channelUserCounter, source: "customer_bot" },
  });
  expectStatus(resolved, [200, 201], "identity resolve (customer)");
  const waslaPublicId = resolved.body.wasla_public_id as string;
  const profile = await callCustomers(gate, {
    method: "PUT",
    path: `/customers/${waslaPublicId}/profile`,
    body: { preferred_locale: "ar", display_name: "عميل بوابة الطور 05" },
  });
  expectStatus(profile, [200, 201], "customer profile");
  return waslaPublicId;
}

export interface GateOrder {
  readonly orderId: string;
  readonly orderPublicId: string;
  readonly customerPublicId: string;
}

/** An order in the engine, created the way a customer creates one. */
export async function placeOrder(gate: GateContext): Promise<GateOrder> {
  const customerPublicId = await onboardCustomer(gate);
  const created = await callCustomers(gate, {
    method: "POST",
    path: `/customers/${customerPublicId}/order-requests`,
    body: {
      order_type: "ride",
      vehicle_class: "sedan",
      price_mode: "customer_offer",
      offered_price: { amount_minor: 2500, currency: "SAR" },
      stops: [
        { kind: "pickup", zone_id: SERVED_ZONE, source: "map", label: "حارة الشرق" },
        { kind: "dropoff", zone_id: DROPOFF_ZONE, source: "map", label: "قربان الشمالية" },
      ],
      notes: null,
    },
    idempotencyKey: nextKey("gate-intake"),
  });
  expectStatus(created, [201], "order handover");
  const orderPublicId = created.body.order_public_id as string;
  const read = await callEngine(gate, {
    method: "GET",
    path: `/orders/${orderPublicId}`,
    customerScope: customerPublicId,
  });
  expectStatus(read, [200], "order read");
  return { orderId: read.body.id as string, orderPublicId, customerPublicId };
}

// ---------------------------------------------------------------------------
// The driver's own journey — every step through the Driver Core's public HTTP
// ---------------------------------------------------------------------------

export interface OnboardDriverOptions {
  /** Skip the served zone, to prove the zone reason code. */
  readonly withZone?: boolean;
  /** Skip the primary vehicle, to prove the vehicle reason code. */
  readonly withVehicle?: boolean;
  /** Which required documents to submit AND verify. Default: all three. */
  readonly verifiedDocuments?: readonly ("national_id" | "driving_license" | "vehicle_registration")[];
  /** Declare `available` at the end. Default: true. */
  readonly declareAvailable?: boolean;
}

export interface GateDriver {
  readonly waslaPublicId: string;
  /** The primary vehicle's id, or `null` when the scenario asked for none. */
  readonly vehicleId: string | null;
}

/**
 * A driver taken from «does not exist» to «eligible and available», entirely through
 * `services/drivers` HTTP.
 *
 * Every step is a route a real caller has: register, replace zones, register a primary
 * vehicle, submit each required document, review each one, declare availability. The
 * gate never reaches into a store — a fixture that wrote rows could describe a state the
 * service cannot produce, and a gate proved over an impossible state proves nothing.
 *
 * The three document types are the launch policy's required set
 * (`saudi-launch-v1`: `national_id`, `driving_license`, `vehicle_registration`), and
 * the licence carries `LICENCE_EXPIRES_AT` so the expiry scenario has something to
 * cross.
 */
export async function onboardDriver(
  gate: GateContext,
  options: OnboardDriverOptions = {},
): Promise<GateDriver> {
  const waslaPublicId = await mintDriverId(gate);

  expectStatus(
    await callDrivers(gate, {
      method: "POST",
      path: "/drivers",
      idempotencyKey: nextKey("gate-reg"),
      body: {
        wasla_public_id: waslaPublicId,
        display_name: "سائق بوابة الطور 05",
        preferred_locale: "ar",
        service_kinds: ["ride"],
      },
    }),
    [201],
    "driver registration",
  );

  if (options.withZone !== false) {
    expectStatus(
      await callDrivers(gate, {
        method: "PUT",
        path: `/drivers/${waslaPublicId}/zones`,
        body: { zones: [{ zone_id: SERVED_ZONE, preference_rank: 1 }] },
      }),
      [200],
      "served zones",
    );
  }

  let vehicleId: string | null = null;
  if (options.withVehicle !== false) {
    const vehicle = expectStatus(
      await callDrivers(gate, {
        method: "POST",
        path: `/drivers/${waslaPublicId}/vehicles`,
        idempotencyKey: nextKey("gate-veh"),
        body: {
          vehicle_class: "sedan",
          make: "Toyota",
          model: "Camry",
          model_year: 2022,
          color: "أبيض",
          plate_number: "ABC-1234",
          is_primary: true,
        },
      }),
      [201],
      "primary vehicle",
    );
    vehicleId = vehicle.body.id as string;
  }

  const wanted = options.verifiedDocuments ?? [
    "national_id",
    "driving_license",
    "vehicle_registration",
  ];
  for (const documentType of wanted) {
    await verifyDocument(gate, waslaPublicId, documentType, vehicleId);
  }

  if (options.declareAvailable !== false) {
    expectStatus(
      await callDrivers(gate, {
        method: "PUT",
        path: `/drivers/${waslaPublicId}/availability`,
        body: { declared_availability: "available" },
      }),
      [200],
      "declare availability",
    );
  }

  return { waslaPublicId, vehicleId };
}

/** Submit one document and verify it, the way a reviewer would — two real calls. */
export async function verifyDocument(
  gate: GateContext,
  waslaPublicId: string,
  documentType: "national_id" | "driving_license" | "vehicle_registration",
  vehicleId: string | null,
): Promise<string> {
  // Only the licence and the registration carry an expiry, and only the licence's is
  // close enough to cross: the expiry scenario must move ONE document out of validity,
  // or a red gate would not say which rule fired.
  const expiresAt =
    documentType === "driving_license"
      ? LICENCE_EXPIRES_AT
      : documentType === "vehicle_registration"
        ? VEHICLE_DOC_EXPIRES_AT
        : null;

  const submitted = expectStatus(
    await callDrivers(gate, {
      method: "POST",
      path: `/drivers/${waslaPublicId}/documents`,
      idempotencyKey: nextKey("gate-doc"),
      body: {
        document_type: documentType,
        storage_ref: `s3://wasla-docs/${waslaPublicId}/${documentType}.pdf`,
        // Vehicle-scoped documents must name their vehicle; the others must not.
        vehicle_id: documentType === "vehicle_registration" ? vehicleId : null,
        expires_at: expiresAt,
      },
    }),
    [201],
    `submit ${documentType}`,
  );
  const documentId = submitted.body.id as string;

  expectStatus(
    await callDrivers(gate, {
      method: "POST",
      path: `/drivers/${waslaPublicId}/documents/${documentId}/review`,
      body: { decision: "verified", reviewed_by: "ops-gate-05" },
    }),
    [200],
    `verify ${documentType}`,
  );
  return documentId;
}

/** The Driver Core's own verdict, read over HTTP. */
export async function readEligibility(
  gate: GateContext,
  waslaPublicId: string,
): Promise<Record<string, unknown>> {
  return expectStatus(
    await callDrivers(gate, { method: "GET", path: `/drivers/${waslaPublicId}/eligibility` }),
    [200],
    "eligibility read",
  ).body;
}

/** One explicit pulse. Time never advances by itself in this suite. */
export async function tickEligibility(gate: GateContext): Promise<Record<string, unknown>> {
  return expectStatus(
    await callDrivers(gate, {
      method: "POST",
      path: "/drivers/eligibility/tick",
      idempotencyKey: nextKey("gate-tick"),
    }),
    [200],
    "eligibility tick",
  ).body;
}

// ---------------------------------------------------------------------------
// Reading the other side: what matching believes, and what dispatch offers
// ---------------------------------------------------------------------------

/** The candidacy row as MATCHING holds it — the projection's destination. */
export async function readCandidacy(
  gate: GateContext,
  driverPublicId: string,
): Promise<Record<string, unknown>> {
  return expectStatus(
    await callMatching(gate, { method: "GET", path: `/candidacy/${driverPublicId}` }),
    [200],
    "candidacy read",
  ).body;
}

/** Whether matching has any row for this driver at all. */
export async function candidacyStatus(gate: GateContext, driverPublicId: string): Promise<number> {
  return (await callMatching(gate, { method: "GET", path: `/candidacy/${driverPublicId}` })).status;
}

export async function createJob(
  gate: GateContext,
  order: GateOrder,
): Promise<Record<string, unknown>> {
  return expectStatus(
    await callDispatch(gate, {
      method: "POST",
      path: "/dispatch/jobs",
      idempotencyKey: nextKey("gate-job"),
      body: {
        order_id: order.orderId,
        order_public_id: order.orderPublicId,
        zone_id: SERVED_ZONE,
        order_type: "ride",
        vehicle_class: "sedan",
      },
    }),
    [201],
    "dispatch job",
  ).body;
}

export async function tickDispatch(gate: GateContext): Promise<HttpResult> {
  return callDispatch(gate, {
    method: "POST",
    path: "/dispatch/tick",
    idempotencyKey: nextKey("gate-dtick"),
  });
}

export async function readJob(gate: GateContext, jobId: string): Promise<Record<string, unknown>> {
  return expectStatus(
    await callDispatch(gate, { method: "GET", path: `/dispatch/jobs/${jobId}` }),
    [200],
    "job read",
  ).body;
}

export async function readOffers(
  gate: GateContext,
  jobId: string,
): Promise<Record<string, unknown>[]> {
  const result = expectStatus(
    await callDispatch(gate, { method: "GET", path: `/dispatch/jobs/${jobId}/offers` }),
    [200],
    "offers read",
  );
  return result.body.items as Record<string, unknown>[];
}

export async function openOffers(
  gate: GateContext,
  jobId: string,
): Promise<Record<string, unknown>[]> {
  return (await readOffers(gate, jobId)).filter((offer) => offer.status === "offered");
}

export async function orderStatus(gate: GateContext, order: GateOrder): Promise<string> {
  const result = expectStatus(
    await callEngine(gate, {
      method: "GET",
      path: `/orders/${order.orderId}`,
      customerScope: order.customerPublicId,
    }),
    [200],
    "order read",
  );
  return result.body.status as string;
}
