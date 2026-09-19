/**
 * Order Engine bootstrap (composition root) — MR 4/6.
 *
 * The only place in the service that decides which concrete adapter is used and
 * the only place that opens or closes a database connection. It wires:
 *
 *  - persistence: Drizzle/Postgres (MR 3/6) when `DATABASE_URL` is set, through
 *    `PostgresOrderRunner` so every write runs inside the Unit of Work and the
 *    triple write (status · audit row · event) stays atomic. Without it, the
 *    in-memory adapters — for a local smoke run with no database;
 *  - time and ids: `SystemClock` and `CryptoIdGenerator`. The deterministic
 *    `FixedClock` / `SequentialIdGenerator` exist for tests and are never wired
 *    here: an engine whose ids are countable would let a caller walk other
 *    customers' orders.
 *
 * The in-memory fallback is a declared dev convenience, and it is not silent:
 * `/health` answers `degraded` for it (the contract requires `ok` to mean
 * "durable storage configured"), so a deployment that lost its `DATABASE_URL`
 * announces the fact instead of accepting orders it will lose on restart.
 *
 * There is no engine-side dependency to configure: the Order Engine depends on
 * nothing (ADR-010) — no identity, no geography, no drivers — so unlike the
 * customers service this file has no port to point at another service.
 *
 * The pool is closed in Fastify's `onClose` hook, so `app.close()` — on SIGTERM
 * or in a test — releases the connections it opened instead of leaking them.
 *
 * Not covered by the unit suite (which uses `createOrderApp` + `app.inject` with
 * in-memory adapters). Run with: `pnpm --filter @wasla/orders-service start`.
 * Port via PORT (default 8087 — identity 8080, geography 8081, customers 8086).
 */

import { readPortEnv } from "@wasla/config";
import type { Pool } from "pg";

import { ORDER_SERVICE_PORT } from "@wasla/contracts-order";
import {
  keyRegistryFromEnv,
  type ServiceTokenReplayGuard,
} from "@wasla/service-auth";
import { createServiceTokenReplayGuardFromEnv } from "@wasla/service-auth/replay-store";

import { createOrderDb } from "../infrastructure/drizzle/db.js";
import { PostgresOrderRunner } from "../infrastructure/drizzle/runner.js";
import {
  CryptoIdGenerator,
  InMemoryOrderPublicIdGenerator,
  InMemoryOrderRepository,
  InMemoryOutbox,
  SystemClock,
} from "../infrastructure/in-memory.js";
import { createDirectRunner, type OrderRunner } from "../runner.js";

import { createOrderApp, type OrderHealthDescriptor } from "./app.js";
import { registerMetrics, instrumentApp, addMetricsEndpoint, startTracing } from "@wasla/observability";

/**
 * مفاتيح هوية الخدمة ومخزن آثار الإعادة لحد الطلبات.
 *
 * لا قيمة افتراضية للمفاتيح: خدمة بلا مفاتيح لا تفرّق منادياً من مزوّر، فتشغيلها
 * «مؤقتاً بلا فرض» هو تشغيل الثغرة نفسها. والإخفاق عند الإقلاع برسالة تسمّي
 * المتغير أرخص من محرّك طلبات مفتوح لا أحد يراه.
 *
 * ومخزنُ آثارِ الإعادةِ **مشترَكٌ بينَ النسخِ** (ADR-035 · إغلاقُ
 * `RISK-0015`): يُبنى من البيئةِ فوقَ Postgres في
 * `createServiceTokenReplayGuardFromEnv`، ولا هبوطَ إلى الذاكرةِ بالسكوتِ —
 * نمطُ الذاكرةِ يُطلَبُ صراحةً ويُرفَضُ في `NODE_ENV=production`.
 */
function serviceIdentityWiring(): {
  keys: ReturnType<typeof keyRegistryFromEnv>;
  replayGuard: ServiceTokenReplayGuard;
} {
  return { keys: keyRegistryFromEnv(process.env), replayGuard: createServiceTokenReplayGuardFromEnv(process.env) };
}

interface Wiring {
  runner: OrderRunner;
  health: OrderHealthDescriptor;
  pool: Pool | null;
}

function buildWiring(): Wiring {
  const clock = new SystemClock();
  const ids = new CryptoIdGenerator();

  if (process.env.DATABASE_URL) {
    const { pool, db } = createOrderDb({
      connectionString: process.env.DATABASE_URL,
    });
    return {
      runner: new PostgresOrderRunner(db, { clock, ids }),
      health: { persistence: "postgres" },
      pool,
    };
  }

  return {
    runner: createDirectRunner({
      repository: new InMemoryOrderRepository(),
      outbox: new InMemoryOutbox(),
      clock,
      ids,
      publicIds: new InMemoryOrderPublicIdGenerator(),
    }),
    health: { persistence: "memory" },
    pool: null,
  };
}

async function main(): Promise<void> {
  const { runner, health, pool } = buildWiring();
    // M2-08b: Start observability tracing (no-op without OTEL_EXPORTER_OTLP_ENDPOINT)
  const stopTracing = startTracing("orders");

  const app = createOrderApp({
    runner,
    health,
    logger: true,
    serviceIdentity: serviceIdentityWiring(),
  });

  // M2-08b: Wire observability — metrics middleware + /metrics endpoint
  const metrics = registerMetrics("orders");
  instrumentApp(app, metrics);
  addMetricsEndpoint(app, metrics);

  app.addHook("onClose", async () => { stopTracing(); });
  
  if (pool) {
    app.addHook("onClose", async () => {
    stopTracing();
      await pool.end();
    });
  }

  const port = readPortEnv(process.env, "PORT", ORDER_SERVICE_PORT);

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
