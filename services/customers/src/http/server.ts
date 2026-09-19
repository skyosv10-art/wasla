/**
 * Customer Core service bootstrap (composition root) — MR 4/6.
 *
 * The only place in the service that decides which concrete adapter is used and
 * the only place that opens or closes a connection. It wires:
 *
 *  - persistence: Postgres (Drizzle, MR 3/6) when DATABASE_URL is set, otherwise
 *    the in-memory repository, for local smoke runs without a database;
 *  - identity: HttpIdentityLookupPort when IDENTITY_SERVICE_URL is set, otherwise
 *    a permissive fake (dev only — it answers «exists» for any format-valid id);
 *  - geography: HttpGeographyPort when GEOGRAPHY_SERVICE_URL is set, otherwise a
 *    fake with no zones, which rejects every stop rather than inventing one;
 *  - order intake (Phase 06 · MR 5/6): `HttpOrderIntakePort` when
 *    ORDER_SERVICE_URL is set, otherwise the fail-closed `UnavailableOrderIntake`
 *    — chosen **explicitly** so that «no engine» stays a visible decision
 *    (reported by /health as `degraded`) instead of an accident of omission. With
 *    the engine wired **and** Postgres wired, /health answers `ok` for the first
 *    time in the project's history: the service can now actually complete the
 *    thing it exists to do.
 *
 * ORDER_SERVICE_URL has no dev fallback that pretends to accept orders. A
 * permissive order fake would create rows claiming a customer's order reached an
 * engine that does not exist, which §53 forbids outright — so «no URL» means
 * «every handover fails loudly», exactly as in Phase 04.
 *
 * The dev fallbacks are asymmetric on purpose: a missing identity service is
 * permissive (it only gates profile creation) while a missing geography service
 * is restrictive (a zone decides whether an order can exist at all). A
 * permissive geography fake would let a developer submit orders anchored to
 * zones that do not exist anywhere.
 *
 * The pool is closed in Fastify's `onClose` hook, so `app.close()` — on SIGTERM
 * or in a test — releases the connections it opened instead of leaking them.
 *
 * Not covered by the unit suite (which uses createCustomerApp + app.inject with
 * in-memory adapters). Run with: `pnpm --filter @wasla/customers-service start`.
 * Port via PORT (default 8086 — identity 8080, geography 8081; see ports table).
 */

import {
  createServiceRequestSigner,
  keyRegistryFromEnv,
  type ServiceTokenReplayGuard,
} from "@wasla/service-auth";
import { createServiceTokenReplayGuardFromEnv } from "@wasla/service-auth/replay-store";

import type { Pool } from "pg";

import { readLenientIntEnv, readPortEnv } from "@wasla/config";
import {
  CryptoIdGenerator,
  FakeGeography,
  InMemoryCustomerRepository,
  InMemoryOutbox,
  SystemClock,
  UnavailableOrderIntake,
} from "../infrastructure/in-memory.js";
import { CUSTOMERS_ORDERS_SCOPES, HttpOrderIntakePort } from "../infrastructure/http-order-intake.js";
import { HttpGeographyPort, CUSTOMERS_GEOGRAPHY_SCOPES } from "../infrastructure/http-geography.js";
import {
  HttpIdentityLookupPort,
  CUSTOMERS_IDENTITY_SCOPES,
} from "../infrastructure/http-identity-lookup.js";
import { createCustomerDb } from "../infrastructure/drizzle/db.js";
import {
  PostgresCustomerOutbox,
  PostgresCustomerRepository,
} from "../infrastructure/drizzle/repository.js";
import type { GeographyPort, IdentityLookupPort, OrderIntakePort } from "../ports.js";
import type { UseCaseDeps } from "../use-cases/deps.js";

import { createCustomerApp, type CustomerHealthDescriptor } from "./app.js";
import { registerMetrics, instrumentApp, addMetricsEndpoint, startTracing } from "@wasla/observability";

/**
 * A permissive identity fake for dev runs: every format-valid public id is
 * treated as existing. Never wire this in production — that is what
 * IDENTITY_SERVICE_URL is for.
 */
class PermissiveIdentityLookup implements IdentityLookupPort {
  async identityExists(): Promise<boolean> {
    return true;
  }
}

function buildIdentityLookup(): IdentityLookupPort {
  const baseUrl = process.env.IDENTITY_SERVICE_URL;
  return baseUrl
    ? new HttpIdentityLookupPort({
        baseUrl,
        // M1-04 (الموجة 3): حد الهويّة صار يفرض هوية الخدمة. والصلاحية المطلوبة
        // قراءةُ مستخدم وحدها — لا ربطَ هويّةٍ ولا بدءَ استعادةٍ.
        signRequest: createServiceRequestSigner({
          serviceName: "customers",
          audience: "identity",
          keys: keyRegistryFromEnv(process.env),
          scopes: CUSTOMERS_IDENTITY_SCOPES,
        }),
      })
    : new PermissiveIdentityLookup();
}

/**
 * The engine adapter, or the loud absence of one.
 *
 * Returned together with the health label so the two can never disagree: a
 * process reporting `configured` while holding `UnavailableOrderIntake` would be
 * a service that lies about being able to take orders.
 */
function buildOrderIntake(): {
  orderIntake: OrderIntakePort;
  label: "configured" | "unconfigured";
} {
  const baseUrl = process.env.ORDER_SERVICE_URL;
  if (!baseUrl) {
    // Explicit fail-closed default (ADR-009 §3): no silent success, no silent drop.
    return { orderIntake: new UnavailableOrderIntake(), label: "unconfigured" };
  }
  // قراءةٌ متسامحةٌ بقصدٍ (M2-04): مهلةٌ ثانويّةٌ غيرُ مقروءةٍ تسقطُ إلى افتراضِ
  // المنفذِ بدلَ إسقاطِ الإقلاعِ — والتسامحُ مُسمّىً في اسمِ الدالّةِ لا صمتاً.
  const timeoutMs = readLenientIntEnv(process.env, "ORDER_SERVICE_TIMEOUT_MS", { min: 1 });
  return {
    orderIntake: new HttpOrderIntakePort({
      baseUrl,
      // M1-04: حد الطلبات صار يفرض هوية الخدمة. المفاتيح من البيئة بلا قيمة
      // افتراضية: منادٍ بلا مفاتيح يُرَدّ 401 فيُقرأ الرد عطلَ محرّكِ الطلبات لا
      // نقصَ إعدادٍ هنا، والإخفاق عند الإقلاع يسمّي العلة في موضعها.
      signRequest: createServiceRequestSigner({
        serviceName: "customers",
        audience: "orders",
        keys: keyRegistryFromEnv(process.env),
        scopes: CUSTOMERS_ORDERS_SCOPES,
      }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }),
    label: "configured",
  };
}

function buildGeography(): GeographyPort {
  const baseUrl = process.env.GEOGRAPHY_SERVICE_URL;
  // No URL → no zones: every stop is rejected with CUSTOMER_ZONE_NOT_FOUND,
  // which is the truthful answer when the zone hierarchy is not reachable.
  return baseUrl ? new HttpGeographyPort({
    baseUrl,
    // M1-04 (الموجةُ الخامسة): حدُّ الجغرافيا مفروضٌ، فكلُّ نداءٍ صادرٍ إليه
    // موقَّعٌ. المفاتيحُ من البيئةِ بلا قيمةٍ افتراضيّةٍ: منادٍ بلا مفاتيح
    // يُرَدُّ 401 فيُقرأ الردُّ عطلَ الجغرافيا لا نقصَ إعدادٍ هنا، والإخفاقُ
    // عندَ الإقلاعِ يسمّي العلةَ في موضعِها.
    signRequest: createServiceRequestSigner({
      serviceName: "customers",
      audience: "geography",
      keys: keyRegistryFromEnv(process.env),
      scopes: CUSTOMERS_GEOGRAPHY_SCOPES,
    }),
  }) : new FakeGeography([]);
}

interface Wiring {
  deps: UseCaseDeps;
  health: CustomerHealthDescriptor;
  pool: Pool | null;
}

function buildWiring(): Wiring {
  const clock = new SystemClock();
  const idGen = new CryptoIdGenerator();
  const identityLookup = buildIdentityLookup();
  const geography = buildGeography();
  const { orderIntake, label: orderIntakeLabel } = buildOrderIntake();

  if (process.env.DATABASE_URL) {
    const { pool, db } = createCustomerDb({
      connectionString: process.env.DATABASE_URL,
    });
    return {
      deps: {
        repo: new PostgresCustomerRepository(db),
        outbox: new PostgresCustomerOutbox(db),
        clock,
        idGen,
        identityLookup,
        geography,
        orderIntake,
      },
      health: { persistence: "postgres", orderIntake: orderIntakeLabel },
      pool,
    };
  }

  return {
    deps: {
      repo: new InMemoryCustomerRepository(),
      outbox: new InMemoryOutbox(),
      clock,
      idGen,
      identityLookup,
      geography,
      orderIntake,
    },
    health: { persistence: "memory", orderIntake: orderIntakeLabel },
    pool: null,
  };
}

/**
 * تركيبُ فرضِ الهويّةِ على حدِّ الدُّخولِ (`M1-04` · الموجةُ التاسعةُ).
 *
 * لا قيمةَ افتراضيّةً للمفاتيحِ: خدمةٌ بلا مفاتيحَ لا تفرّقُ مُنادياً من مزوّرٍ،
 * وإقلاعٌ يخفقُ برسالةٍ تسمّي المتغيرَ أرخصُ من حدِّ عميلٍ مفتوحٍ لا أحدَ يراه.
 * ومخزنُ آثارِ الإعادةِ **مشترَكٌ بينَ النسخِ** (ADR-035 · إغلاقُ
 * `RISK-0015`): يُبنى من البيئةِ فوقَ Postgres في
 * `createServiceTokenReplayGuardFromEnv`، ولا هبوطَ إلى الذاكرةِ بالسكوتِ —
 * نمطُ الذاكرةِ يُطلَبُ صراحةً ويُرفَضُ في `NODE_ENV=production`.
 */
function serviceIdentityWiring(): {
  keys: ReturnType<typeof keyRegistryFromEnv>;
  replayGuard: ServiceTokenReplayGuard;
} {
  return {
    keys: keyRegistryFromEnv(process.env),
    replayGuard: createServiceTokenReplayGuardFromEnv(process.env),
  };
}

async function main(): Promise<void> {
  const { deps, health, pool } = buildWiring();
    // M2-08b: Start observability tracing (no-op without OTEL_EXPORTER_OTLP_ENDPOINT)
  const stopTracing = startTracing("customers");

  const app = createCustomerApp({
    deps,
    health,
    logger: true,
    serviceIdentity: serviceIdentityWiring(),
  });

  // M2-08b: Wire observability — metrics middleware + /metrics endpoint
  const metrics = registerMetrics("customers");
  instrumentApp(app, metrics);
  addMetricsEndpoint(app, metrics);

  app.addHook("onClose", async () => { stopTracing(); });
  
  if (pool) {
    app.addHook("onClose", async () => {
    stopTracing();
      await pool.end();
    });
  }

  const port = readPortEnv(process.env, "PORT", 8086);

  // SIGTERM is how a container is asked to stop: close the server (and with it
  // the pool) instead of letting the process die with connections open.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }

  try {
    await app.listen({ port, host: "0.0.0.0" });
  } catch (error) {
    app.log.error(error);
    await app.close();
    process.exit(1);
  }
}

await main();
