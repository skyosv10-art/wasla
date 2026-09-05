/**
 * Shared setup for the Phase 08 Exit Gate suite.
 *
 * The gate asks one question, and it is the one ROADMAP §3 wrote for this phase:
 * **«can a customer and a driver negotiate a price across four independent services
 * over real HTTP, agree on it, and have the ORDER ENGINE end up holding that number —
 * and does the agreement survive when the engine does not?»**
 *
 * Everything in the path is real, and that is the point of a gate:
 *
 *   - **identity** and **geography** are their own listeners, so the Customer Core's
 *     `HttpIdentityLookupPort` / `HttpGeographyPort` and matching's own
 *     `HttpZoneHierarchy` all speak HTTP exactly as deployed;
 *   - the **Customer Core** hands the intent to the **Order Engine** through the
 *     production `HttpOrderIntakePort`, so the order this suite negotiates over was
 *     created the way a customer creates one — with `price_mode: "negotiable"`, which
 *     is the only shape this phase is about;
 *   - **matching** and **dispatch** are their own listeners, and dispatch reaches
 *     matching and the engine through the production `HttpMatchingPort` and
 *     `HttpOrderEnginePort`. The dispatch OFFER a thread is opened on is therefore a
 *     real offer produced by a real wave, not an id this suite invented;
 *   - **negotiations** is its own listener behind `createNegotiationApp`, and its two
 *     outbound ports come from `configuredDispatchOffers` / `configuredAgreedPrice` in
 *     `@wasla/negotiations-service` — **the same functions `src/http/server.ts` calls**,
 *     given the same environment shape. That is deliberate and it is the whole reason
 *     `infrastructure/outbound-wiring.ts` exists as a module instead of two lines in the
 *     server (see its header): a gate that wired its own adapters would prove a
 *     composition nobody deploys.
 *
 * Why the composition lives here at all, given HANDOFF §14 item 2 says «`server.ts` is
 * the only permitted composition»: `services/negotiations/src/http/server.ts` ends in
 * `await main()` and is deliberately absent from the package's exports, so importing it
 * would raise a server on port 8091 and read `process.env`. The rule's intent — never
 * exercise a copy of a production adapter — is satisfied the way the four earlier gates
 * satisfy it: every adapter and every wiring decision is imported from the service, and
 * this file chooses nothing the service would choose differently. What it adds is what a
 * process cannot: ephemeral ports, an injected clock, and an order engine that can be
 * stopped and started again.
 *
 * Time is injected, never slept. One `GateClock` is shared by matching, dispatch AND
 * negotiations, so a round's deadline, an offer's deadline and a hand-off's retry moment
 * are all read off the same instant. Every deadline in this suite is crossed by moving
 * that clock and calling `POST /dispatch/tick` or `POST /negotiations/tick` explicitly: a
 * gate that waited on wall time would be slow when it passes and flaky when it fails.
 *
 * What is NOT real, declared rather than hidden:
 *
 *   1. **No driver service.** Phase 05 shipped and `packages/driver-e2e` drives it; here
 *      candidacy is seeded through matching's own `PUT /candidacy/{driver_public_id}`
 *      with `eligibility_source: "claimed"`, which is matching's declared contract for
 *      any caller that is not driver core (ADR-011). The reasoning is the one written in
 *      `packages/dispatch-e2e/src/harness.ts`: a gate that cannot fail alone can no
 *      longer say which phase regressed, and nothing in Phase 08 reads eligibility.
 *   2. **No bot and no channel.** A party negotiates by calling the negotiation routes —
 *      the same routes the two bots call in MR 5/6.
 *   3. **The identity, geography, customer, matching and dispatch stores are in-memory,
 *      always.** Each of those has its own gate for its own atomicity.
 *      `NEGOTIATION_DATABASE_URL` lifts **negotiations** onto Postgres, because the
 *      negotiation store is what this phase owns. Why not `DATABASE_URL`: that is the
 *      channel store (Phase 03) and the name negotiations' own integration job already
 *      uses; a separate name keeps this gate's database its own, so a failure here is
 *      never a collision with another job's schema.
 *   4. **The order engine store is in-memory too — and here it is load-bearing.** The
 *      fourth scenario stops the engine and starts it again on the same port, and it
 *      must come back holding the same orders. In-memory stores that outlive the
 *      listener are what make that possible without a database.
 *
 * Reasoning in docs/12-testing/PHASE08_EXIT_GATE_E2E.md.
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
  CUSTOMERS_IDENTITY_SCOPES,
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
  DISPATCH_SCOPES,
  DISPATCH_SERVICE_AUDIENCE,
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
  IDENTITY_SCOPES,
  IDENTITY_SERVICE_AUDIENCE,
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
  configuredAgreedPrice,
  configuredDispatchOffers,
  createDirectNegotiationRunner,
  createNegotiationApp,
  createNegotiationDb,
  createInMemoryNegotiationDependencies,
  PostgresNegotiationRunner,
  SequentialIdGenerator as NegotiationIdGenerator,
  type NegotiationRunner,
} from "@wasla/negotiations-service";
import {
  createDirectRunner as createOrderDirectRunner,
  createOrderApp,
  CryptoIdGenerator as OrderIdGenerator,
  InMemoryOrderPublicIdGenerator,
  InMemoryOrderRepository,
  InMemoryOutbox as InMemoryOrderOutbox,
  SystemClock as OrderClock,
  type OrderRunner,
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

/**
 * M1-04: the order engine enforces service identity too, and a token minted for
 * `matching` is refused by `orders` — the audience is what keeps the two
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

function gateSigner(serviceName: string, scopes: readonly string[]) {
  return createServiceRequestSigner({
    serviceName,
    audience: "matching",
    keys: gateServiceAuthKeys(),
    scopes,
  });
}

/** Postgres mode is opt-in for NEGOTIATIONS; the gate itself is not opt-in. */
export const NEGOTIATION_DATABASE_URL = process.env.NEGOTIATION_DATABASE_URL;

/** Two active zones from the Saudi fixture — a real hierarchy, not a stub. */
export const PICKUP_ZONE = SAUDI_FIXTURE_IDS.zoneHaraEast;
export const DROPOFF_ZONE = SAUDI_FIXTURE_IDS.zoneQubaNorth;

/**
 * The instant every scenario starts from.
 *
 * Fixed rather than `now()` so a failing run can be replayed exactly, and so the
 * deadlines printed in an assertion message are the same on every machine.
 */
export const GATE_EPOCH = "2026-08-23T09:00:00.000Z";

/** The frozen launch policy's numbers, restated so a scenario reads as arithmetic. */
export const POLICY_CURRENCY = "SAR";
export const ROUND_TTL_SECONDS = 120;
export const THREAD_TTL_SECONDS = 900;
export const MAX_ROUNDS = 5;

/**
 * Dispatch rules for this gate.
 *
 * `waveSize: 2` because one scenario needs **two live offers on the same order** at the
 * same time: two drivers, two threads, two agreements, and only one of them may end up
 * as the order's price. A wave of one would have made that scenario a sequence of two
 * dispatch attempts instead of the race the constraint exists for.
 *
 * `offerTimeoutSeconds: 600` and `escalationTimeoutSeconds: 1800` because this suite
 * moves the clock to cross NEGOTIATION deadlines (120s a round, 900s a thread, 30s of
 * hand-off backoff), and a dispatch offer that expired underneath a running negotiation
 * would fail the gate for a reason Phase 07 already owns.
 */
export const GATE_RULES: DispatchRules = {
  rulesetVersion: 1,
  waveSize: 2,
  offerTimeoutSeconds: 600,
  maxWaves: 3,
  escalationTimeoutSeconds: 1800,
};

/** Reverse dependency order — the same list negotiations' own pg harness uses. */
const NEGOTIATION_TABLES = [
  "negotiation_outbox",
  "negotiation_idempotency",
  "negotiation_price_handoffs",
  "negotiation_agreements",
  "negotiation_messages",
  "negotiation_rounds",
  "negotiation_threads",
  "negotiation_policies",
] as const;

/** The canonical DDL, read from the contracts rather than duplicated here. */
const NEGOTIATION_SCHEMA_SQL = resolve(
  process.cwd(),
  "../../services/negotiations/contracts/schema.sql",
);

/**
 * The one clock matching, dispatch and negotiations share.
 *
 * All three services declare `Clock` as `{ now(): string }`, so one instance satisfies
 * them without any of them depending on another. Sharing it is what makes every
 * deadline in this suite a decision instead of a coincidence: a round expires because
 * the test moved time, never because a machine was slow.
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
  readonly negotiationsUrl: string;
  /** The injected clock — the only way time moves in this suite. */
  readonly clock: GateClock;
  /** `postgres` or `memory` — for NEGOTIATIONS. Reported so a run is unambiguous. */
  readonly persistence: "postgres" | "memory";
  /** Stop the order engine's listener, keeping its stores. Scenario 4 owns this. */
  stopOrderEngine(): Promise<void>;
  /** Start it again on the same port, with the same stores. */
  startOrderEngine(): Promise<void>;
  close(): Promise<void>;
}

export interface StartGateOptions {
  /** Override the dispatch rules — a scenario may widen or narrow the wave. */
  readonly rules?: Partial<DispatchRules>;
  /**
   * Wire negotiations' outbound ports WITHOUT the order engine's address.
   *
   * Not a convenience: it is how a scenario reproduces «`ORDERS_SERVICE_URL` is not
   * set» exactly as the production wiring sees it, rather than by injecting a port
   * this suite wrote. `configuredDispatchOffers` needs both addresses, so this leaves
   * the thread unopenable — which is why it is only used by the wiring scenario.
   */
  readonly withoutOrdersUrl?: boolean;
}

/** Start the gate: seven listeners, one shared clock, one store set for Phase 08. */
export async function startGate(options: StartGateOptions = {}): Promise<GateContext> {
  const clock = new GateClock();
  const rules: DispatchRules = { ...GATE_RULES, ...options.rules };

  // Say which store this run used, before it uses it. A green gate means nothing until
  // the reader knows whether it proved the memory path or the Postgres one.
  console.info(
    `[phase08-gate] negotiations persistence = ${NEGOTIATION_DATABASE_URL ? "postgres" : "memory"}`,
  );

  // --- identity: a real service on an ephemeral port ------------------------
  const identityServiceAuthKeys = gateServiceAuthKeys();
  // M1-04 (الموجةُ 3): حدُّ الهويّةِ يفرضُ هويّةَ الخدمةِ، فالبوّابةُ تُشغِّلُه
  // **مفروضاً** وتوقِّعُ عملاءَه بالمفاتيحِ نفسِها — لا تُعطِّلُ الفرضَ لتمرَّ.
  const identityApp = createIdentityApp({
    deps: {
      repo: new InMemoryIdentityRepository(),
      outbox: new InMemoryIdentityOutbox(),
      publicIdSeq: new InMemoryPublicIdSequence(),
      clock: new IdentityClock(),
      idGen: new IdentityIdGenerator(),
    },
    logger: false,
    serviceIdentity: {
      keys: identityServiceAuthKeys,
      replayGuard: new InMemoryServiceTokenReplayGuard(),
    },
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

  // --- the Order Engine: in-memory stores that OUTLIVE the listener ---------
  //
  // The runner is built once and captured, so `stopOrderEngine`/`startOrderEngine` can
  // raise a second Fastify instance over the very same repository. An engine that
  // forgot its orders when its process restarted would make scenario 4 prove nothing:
  // «the hand-off succeeded after a restart» is only meaningful if the order it wrote
  // to is the order that was negotiated over.
  const orderRunner: OrderRunner = createOrderDirectRunner({
    repository: new InMemoryOrderRepository(),
    outbox: new InMemoryOrderOutbox(),
    clock: new OrderClock(),
    ids: new OrderIdGenerator(),
    publicIds: new InMemoryOrderPublicIdGenerator(),
  });
  const buildOrdersApp = () =>
    createOrderApp({
      runner: orderRunner,
      health: { persistence: "memory" },
      logger: false,
      serviceIdentity: {
        keys: gateServiceAuthKeys(),
        replayGuard: new InMemoryServiceTokenReplayGuard(),
      },
    });
  let ordersApp = buildOrdersApp();
  await ordersApp.listen({ port: 0, host: "127.0.0.1" });
  const ordersPort = (ordersApp.server.address() as AddressInfo).port;
  const ordersUrl = `http://127.0.0.1:${ordersPort}`;
  let ordersListening = true;

  // --- the Customer Core, handing over through the PRODUCTION adapter -------
  const customerApp = createCustomerApp({
    deps: {
      repo: new InMemoryCustomerRepository(),
      outbox: new InMemoryCustomerOutbox(),
      clock: new CustomerClock(),
      idGen: new CustomerIdGenerator(),
      identityLookup: new HttpIdentityLookupPort({
        baseUrl: identityUrl,
        signRequest: createServiceRequestSigner({
          serviceName: "customers",
          audience: "identity",
          keys: identityServiceAuthKeys,
          scopes: CUSTOMERS_IDENTITY_SCOPES,
        }),
      }),
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
    // M1-03: matching enforces service identity; dispatch's client below signs.
    serviceIdentity: {
      keys: gateServiceAuthKeys(),
      replayGuard: new InMemoryServiceTokenReplayGuard(),
    },
  });
  await matchingApp.listen({ port: 0, host: "127.0.0.1" });
  const matchingUrl = `http://127.0.0.1:${(matchingApp.server.address() as AddressInfo).port}`;

  // --- dispatch: real service, PRODUCTION adapters to matching and the engine
  const dispatchApp = createDispatchApp({
    // `M1-04` · الموجةُ الرابعة: الحدُّ مفروضٌ هنا كما في الإنتاجِ، ومنفذُ
    // التفاوضِ الحقيقيُّ (`configuredDispatchOffers` أدناه) هو الذي يوقّعُ
    // نداءَه إليه — فسلسلةُ «تفاوضٌ → توزيعٌ» تُقاسُ موقَّعةً لا مُدَّعاةً.
    serviceIdentity: {
      keys: gateServiceAuthKeys(),
      replayGuard: new InMemoryServiceTokenReplayGuard(),
    },
    runner: createDispatchDirectRunner({
      ...createInMemoryStores(),
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

  // --- negotiations: real service, PRODUCTION outbound wiring ---------------
  //
  // The environment is a plain object, not `process.env`: `outbound-wiring.ts` takes it
  // as a parameter precisely so a caller can describe the wiring it wants without
  // mutating the process it runs in. Two addresses, because a dispatch-offer snapshot
  // spans two ownerships — the offer belongs to dispatch and `price_mode` belongs to
  // the engine — and the port refuses to be half-wired.
  const wiringWarnings: string[] = [];
  const log = (message: string) => {
    wiringWarnings.push(message);
  };
  const outboundEnv = {
    DISPATCH_SERVICE_URL: dispatchUrl,
    ORDERS_SERVICE_URL: options.withoutOrdersUrl === true ? undefined : ordersUrl,
    // M1-04: the real agreed-price port is a signer now, so the wiring needs key
    // material — an address alone no longer builds a port that the engine accepts.
    WASLA_SERVICE_AUTH_KEYS: `${GATE_SERVICE_AUTH_KID}:active:${GATE_SERVICE_AUTH_SECRET}`,
    WASLA_SERVICE_AUTH_ACTIVE_KID: GATE_SERVICE_AUTH_KID,
  };
  const offers = configuredDispatchOffers(outboundEnv, log);
  const agreedPrice = configuredAgreedPrice(outboundEnv, log);

  const pools: Pool[] = [];
  let negotiationRunner: NegotiationRunner;
  if (NEGOTIATION_DATABASE_URL) {
    const created = createNegotiationDb({ connectionString: NEGOTIATION_DATABASE_URL, max: 4 });
    pools.push(created.pool);
    await created.pool.query(`DROP TABLE IF EXISTS ${NEGOTIATION_TABLES.join(", ")} CASCADE`);
    // The canonical DDL seeds `negotiation_policies` version 1 itself, so the frozen
    // launch policy is present because the contract says so — not because a fixture
    // in this package invented bounds the service would then be tested against.
    await created.pool.query(await readFile(NEGOTIATION_SCHEMA_SQL, "utf-8"));
    negotiationRunner = new PostgresNegotiationRunner(created.db, {
      offers,
      agreedPrice,
      clock,
      ids: new NegotiationIdGenerator(),
    });
  } else {
    const memory = createInMemoryNegotiationDependencies();
    negotiationRunner = createDirectNegotiationRunner({
      ...memory,
      offers,
      agreedPrice,
      clock,
      ids: new NegotiationIdGenerator(),
    });
  }

  const negotiationsApp = createNegotiationApp({
    runner: negotiationRunner,
    health: { persistence: NEGOTIATION_DATABASE_URL ? "postgres" : "memory" },
    logger: false,
  });
  await negotiationsApp.listen({ port: 0, host: "127.0.0.1" });
  const negotiationsUrl = `http://127.0.0.1:${(negotiationsApp.server.address() as AddressInfo).port}`;

  return {
    identityUrl,
    geographyUrl,
    customerUrl,
    ordersUrl,
    matchingUrl,
    dispatchUrl,
    negotiationsUrl,
    clock,
    persistence: NEGOTIATION_DATABASE_URL ? "postgres" : "memory",
    stopOrderEngine: async () => {
      if (!ordersListening) return;
      await ordersApp.close();
      ordersListening = false;
    },
    startOrderEngine: async () => {
      if (ordersListening) return;
      ordersApp = buildOrdersApp();
      // The SAME port, because negotiations was wired with an address and a service
      // that comes back somewhere else is a different outage: what this scenario
      // reproduces is a restart, not a redeploy behind a new endpoint.
      await ordersApp.listen({ port: ordersPort, host: "127.0.0.1" });
      ordersListening = true;
    },
    close: async () => {
      await negotiationsApp.close();
      await dispatchApp.close();
      await matchingApp.close();
      await customerApp.close();
      if (ordersListening) await ordersApp.close();
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
      // Only when there IS a body. `POST /dispatch/tick` takes none, and Fastify
      // answers a declared-but-empty JSON body with 400 before any route runs — a
      // header this helper added would have failed the gate for its own convenience.
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


/**
 * توقيعُ نداءِ البوّابةِ إلى حدِّ الهويّةِ (`M1-04`). الحدُّ صارَ مُغلَقاً
 * افتراضاً، فبوّابةٌ تُنادي بلا توقيعٍ تُخفِقُ 401 لسببٍ لا علاقةَ له بموضوعِها.
 * والصلاحيّاتُ كلُّها هنا لأنّ البوّابةَ تُمثّلُ سلسلةَ النداءِ كاملةً، لا خدمةً
 * واحدةً بصلاحيّةٍ ضيّقةٍ.
 */
function identitySigner() {
  return createServiceRequestSigner({
    serviceName: "e2e-harness",
    audience: IDENTITY_SERVICE_AUDIENCE,
    keys: gateServiceAuthKeys(),
    scopes: Object.values(IDENTITY_SCOPES),
  });
}

export const callIdentity = (gate: GateContext, init: CallInit): Promise<HttpResult> =>
  call(gate.identityUrl, {
    ...init,
    headers: {
      ...identitySigner()(init.method, init.path.split("?")[0] ?? init.path),
      ...(init.headers ?? {}),
    },
  });
export const callCustomers = (gate: GateContext, init: CallInit): Promise<HttpResult> =>
  call(gate.customerUrl, init);
/** Direct engine calls are signed too (M1-04) — same reason as matching below. */
export const callEngine = (gate: GateContext, init: CallInit): Promise<HttpResult> =>
  call(gate.ordersUrl, {
    ...init,
    headers: {
      // الربط لا يشمل سلسلة الاستعلام (ADR-021 §4)، فيُوقَّع المسار وحده.
      ...ordersSigner("negotiation-exit-gate", Object.values(ORDER_SCOPES))(
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
  call(gate.dispatchUrl, {
    ...init,
    headers: {
      // الربط لا يشمل سلسلة الاستعلام (ADR-021 §4)، فيُوقَّع المسار وحده.
      ...createServiceRequestSigner({
        serviceName: "e2e-harness",
        audience: DISPATCH_SERVICE_AUDIENCE,
        keys: gateServiceAuthKeys(),
        scopes: Object.values(DISPATCH_SCOPES),
      })(init.method, init.path.split("?")[0] ?? init.path),
      ...(init.headers ?? {}),
    },
  });
export const callNegotiations = (gate: GateContext, init: CallInit): Promise<HttpResult> =>
  call(gate.negotiationsUrl, init);

let keyCounter = 0;

/** A fresh idempotency key. Every write in this suite carries its own. */
export function nextKey(prefix: string): string {
  keyCounter += 1;
  return `${prefix}-${String(keyCounter).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Fixtures: a customer, a NEGOTIABLE order, and drivers matching returns
// ---------------------------------------------------------------------------

let channelUserCounter = 800_000;

/** A customer that exists in identity AND has an active profile. */
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
    body: { preferred_locale: "ar", display_name: "عميل بوابة المرحلة 08" },
  });
  if (profile.status !== 201 && profile.status !== 200) {
    throw new Error(`profile creation failed: ${profile.status} ${JSON.stringify(profile.body)}`);
  }
  return waslaPublicId;
}

/**
 * A valid two-stop order body — `negotiable` by default, which is this phase's subject.
 *
 * `price_mode: "negotiable"` **forbids** `offered_price`: the whole point of the mode is
 * that no amount exists yet, and the engine's `ck_orders_price_mode_amount` refuses a row
 * that carries one. A scenario that needs the opposite passes `customer_offer` with an
 * amount, and it needs it to prove that negotiations reads the mode instead of assuming it.
 */
export function orderBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_type: "ride",
    vehicle_class: "sedan",
    price_mode: "negotiable",
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
  /** The engine's reference — what a NEGOTIATION thread is keyed by. */
  readonly orderPublicId: string;
  /** Who owns it — the scope header every customer-facing engine read needs. */
  readonly customerPublicId: string;
}

/**
 * An order in the engine, created the way a customer creates one.
 *
 * The intent goes to the Customer Core, which hands it over through the production
 * `HttpOrderIntakePort`; the engine's internal id is then read back over HTTP, because
 * that is the id dispatch is given and the suite must not know it any other way.
 */
export async function placeOrder(
  gate: GateContext,
  overrides: Record<string, unknown> = {},
): Promise<GateOrder> {
  const customerPublicId = await onboardCustomer(gate);
  const created = await callCustomers(gate, {
    method: "POST",
    path: `/customers/${customerPublicId}/order-requests`,
    body: orderBody(overrides),
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

/** A driver matching will actually return: available, eligible, fresh, serving the zone. */
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
      // Declared, not pretended: see the header, item 1.
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
// Driving dispatch far enough to have a real offer to negotiate over
// ---------------------------------------------------------------------------

/** Create the dispatch job for an order. Returns the job body. */
export async function createJob(
  gate: GateContext,
  order: GateOrder,
): Promise<Record<string, unknown>> {
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

/** One explicit dispatch tick. Time never advances by itself in this suite. */
export async function dispatchTick(gate: GateContext): Promise<HttpResult> {
  return callDispatch(gate, {
    method: "POST",
    path: "/dispatch/tick",
    idempotencyKey: nextKey("gate-dispatch-tick"),
  });
}

/** One explicit negotiation tick — the only thing that expires a round or a thread. */
export async function negotiationTick(gate: GateContext): Promise<HttpResult> {
  return callNegotiations(gate, {
    method: "POST",
    path: "/negotiations/tick",
    idempotencyKey: nextKey("gate-negotiation-tick"),
  });
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

export interface GateOffer {
  readonly offerId: string;
  readonly driverPublicId: string;
}

/**
 * An order that reached a real dispatch offer: intake → job → one tick → wave.
 *
 * Returned as offers, not as a single one, because the two-offer scenario needs both
 * and building it twice would let the two paths drift.
 */
export async function orderWithOffers(
  gate: GateContext,
  drivers: readonly string[],
  overrides: Record<string, unknown> = {},
): Promise<{ order: GateOrder; jobId: string; offers: GateOffer[] }> {
  for (const driver of drivers) await seedDriver(gate, driver);
  const order = await placeOrder(gate, overrides);
  const job = await createJob(gate, order);
  const jobId = job.id as string;
  const ticked = await dispatchTick(gate);
  if (ticked.status !== 200) {
    throw new Error(`dispatch tick failed: ${ticked.status} ${JSON.stringify(ticked.body)}`);
  }
  const offers = (await openOffers(gate, jobId)).map((offer) => ({
    offerId: offer.id as string,
    driverPublicId: offer.driver_public_id as string,
  }));
  if (offers.length === 0) {
    throw new Error("dispatch opened no offer: the gate has nothing to negotiate over");
  }
  return { order, jobId, offers };
}

// ---------------------------------------------------------------------------
// Negotiating
// ---------------------------------------------------------------------------

export interface OpenThreadOptions {
  readonly openedBy?: "customer" | "driver";
  readonly openingAmountMinor?: number;
  readonly openingNote?: string | null;
  readonly currency?: string;
}

/** Open a thread on a REAL dispatch offer. Returns the raw HTTP result, codes included. */
export async function openThread(
  gate: GateContext,
  order: GateOrder,
  offer: GateOffer,
  options: OpenThreadOptions = {},
): Promise<HttpResult> {
  return callNegotiations(gate, {
    method: "POST",
    path: "/negotiations",
    idempotencyKey: nextKey("gate-thread"),
    body: {
      order_public_id: order.orderPublicId,
      customer_public_id: order.customerPublicId,
      driver_public_id: offer.driverPublicId,
      dispatch_offer_id: offer.offerId,
      service_kind: "ride",
      opening_amount_minor: options.openingAmountMinor ?? 3000,
      currency: options.currency ?? POLICY_CURRENCY,
      opened_by: options.openedBy ?? "customer",
      opening_note: options.openingNote ?? null,
      source_locale: "ar",
    },
  });
}

/** Open a thread and refuse to continue if it did not open — for the happy paths. */
export async function openThreadOrThrow(
  gate: GateContext,
  order: GateOrder,
  offer: GateOffer,
  options: OpenThreadOptions = {},
): Promise<Record<string, unknown>> {
  const opened = await openThread(gate, order, offer, options);
  if (opened.status !== 201) {
    throw new Error(`thread open failed: ${opened.status} ${JSON.stringify(opened.body)}`);
  }
  return opened.body;
}

export interface ProposeOptions {
  readonly note?: string | null;
  readonly currency?: string;
}

/** Propose a round. `expectedRoundNo` is the guard, and it is never inferred here. */
export async function proposeRound(
  gate: GateContext,
  threadId: string,
  input: {
    readonly proposedBy: "customer" | "driver";
    readonly amountMinor: number;
    readonly expectedRoundNo: number;
  },
  options: ProposeOptions = {},
): Promise<HttpResult> {
  return callNegotiations(gate, {
    method: "POST",
    path: `/negotiations/${threadId}/rounds`,
    idempotencyKey: nextKey("gate-round"),
    body: {
      proposed_by: input.proposedBy,
      amount_minor: input.amountMinor,
      currency: options.currency ?? POLICY_CURRENCY,
      expected_round_no: input.expectedRoundNo,
      note: options.note ?? null,
      source_locale: "ar",
    },
  });
}

/** Accept a numbered round. The key is a parameter so a replay can reuse it exactly. */
export async function acceptRound(
  gate: GateContext,
  threadId: string,
  roundNo: number,
  actingParty: "customer" | "driver",
  idempotencyKey: string,
): Promise<HttpResult> {
  return callNegotiations(gate, {
    method: "POST",
    path: `/negotiations/${threadId}/rounds/${String(roundNo)}/accept`,
    idempotencyKey,
    body: { acting_party: actingParty, note: null, source_locale: "ar" },
  });
}

/** Reject a numbered round, optionally closing the thread. */
export async function rejectRound(
  gate: GateContext,
  threadId: string,
  roundNo: number,
  actingParty: "customer" | "driver",
  closeThread = false,
): Promise<HttpResult> {
  return callNegotiations(gate, {
    method: "POST",
    path: `/negotiations/${threadId}/rounds/${String(roundNo)}/reject`,
    idempotencyKey: nextKey("gate-reject"),
    body: {
      acting_party: actingParty,
      close_thread: closeThread,
      note: null,
      source_locale: "ar",
    },
  });
}

export async function readThread(
  gate: GateContext,
  threadId: string,
): Promise<Record<string, unknown>> {
  const result = await callNegotiations(gate, {
    method: "GET",
    path: `/negotiations/${threadId}`,
  });
  if (result.status !== 200) {
    throw new Error(`thread read failed: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

export async function readRounds(
  gate: GateContext,
  threadId: string,
): Promise<Record<string, unknown>[]> {
  const result = await callNegotiations(gate, {
    method: "GET",
    path: `/negotiations/${threadId}/rounds`,
  });
  if (result.status !== 200) {
    throw new Error(`rounds read failed: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result.body.rounds as Record<string, unknown>[];
}

export async function readAgreement(
  gate: GateContext,
  threadId: string,
): Promise<Record<string, unknown>> {
  const result = await callNegotiations(gate, {
    method: "GET",
    path: `/negotiations/${threadId}/agreement`,
  });
  if (result.status !== 200) {
    throw new Error(`agreement read failed: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

// ---------------------------------------------------------------------------
// Reading the ORDER ENGINE — the half of the gate that is not negotiation
// ---------------------------------------------------------------------------

/**
 * The engine's own service-facing summary, read over HTTP.
 *
 * `GET /orders/lookup` and never a `SELECT`: the question this gate answers is «does
 * the order know its price?», and the only answer that matters is the one every other
 * service gets. A row read straight out of the store would pass while the route that
 * exposes it was broken — which is exactly the failure a gate exists to catch.
 */
export async function lookupOrder(
  gate: GateContext,
  orderPublicId: string,
): Promise<Record<string, unknown>> {
  const result = await callEngine(gate, {
    method: "GET",
    path: `/orders/lookup?order_public_id=${encodeURIComponent(orderPublicId)}`,
  });
  if (result.status !== 200) {
    throw new Error(`order lookup failed: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

/** Drive the order through a published transition — used to leave the agreed-price window. */
export async function transitionOrder(
  gate: GateContext,
  order: GateOrder,
  toStatus: string,
  reasonCode: string,
): Promise<HttpResult> {
  return callEngine(gate, {
    method: "POST",
    path: `/orders/${order.orderId}/transitions`,
    idempotencyKey: nextKey("gate-transition"),
    body: {
      to_status: toStatus,
      reason_code: reasonCode,
      actor: { actor_type: "system" },
    },
  });
}
