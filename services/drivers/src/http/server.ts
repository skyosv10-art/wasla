/**
 * The process: wiring, and nothing else (Phase 05 · MR 5/6).
 *
 * Every decision about a status code, a body or a rule lives in `app.ts` and the use
 * cases. What is left here is the choice of adapters, and it is deliberately the ONLY
 * place that reads `process.env` — a use case that read an environment variable would
 * behave differently in a test than in production, which is the one difference a test
 * can never catch.
 *
 * `DATABASE_URL` present → Postgres, one transaction per write, `/health` reports `ok`.
 * Absent → in-memory stores and `degraded`, so a developer can run the service with no
 * database and an operator can never mistake that process for a real one.
 *
 * The same shape governs the two outbound ports, and independently of storage:
 * `MATCHING_SERVICE_URL` → real publications to matching 8088, absent → a port that
 * REFUSES with a readable code; `GEOGRAPHY_SERVICE_URL` → the real zone catalogue on
 * 8081, absent → `DRIVER_DEV_ZONE_IDS` with a warning. Nothing defaults to a URL:
 * guessing `localhost` would turn a missing variable into someone else's outage.
 */

import type { Pool } from "pg";

import { DRIVER_SERVICE_PORT } from "@wasla/contracts-driver";

import { createDriverDb } from "../infrastructure/drizzle/db.js";
import type { DriverSharedDeps } from "../infrastructure/drizzle/transaction.js";
import {
  createInMemoryEnvironment,
  CryptoIdGenerator,
  InMemoryCandidacyProjectionPort,
  SystemClock,
} from "../infrastructure/in-memory.js";
import {
  configuredCandidacy,
  configuredZoneCatalog,
  matchingConfigured,
  type DriverOutboundEnv,
} from "../infrastructure/outbound-wiring.js";
import { createDirectRunner, PostgresDriverRunner, type DriverRunner } from "../runner.js";

import { createDriverApp, type DriverHealthDescriptor } from "./app.js";

interface Wiring {
  runner: DriverRunner;
  health: DriverHealthDescriptor;
  pool: Pool | null;
}

function buildWiring(log: (message: string) => void): Wiring {
  const clock = new SystemClock();
  const ids = new CryptoIdGenerator();
  // One view of the environment for the whole wiring: reading `process.env` twice in
  // one boot could give the storage path and the outbound path two different answers.
  const env = process.env as DriverOutboundEnv;

  if (process.env.DATABASE_URL) {
    const { pool, db } = createDriverDb({ connectionString: process.env.DATABASE_URL });
    const shared: DriverSharedDeps = {
      candidacy: configuredCandidacy(env),
      zoneCatalog: configuredZoneCatalog(env, log),
      clock,
      ids,
    };
    return {
      runner: new PostgresDriverRunner(db, shared),
      health: { persistence: "postgres" },
      pool,
    };
  }

  const environment = createInMemoryEnvironment(clock.now());
  return {
    runner: createDirectRunner({
      ...environment,
      // The in-memory projection store is the honest fallback ONLY when no matching URL
      // is configured: it keeps `busy` preservation testable without a second service.
      candidacy: matchingConfigured(env)
        ? configuredCandidacy(env)
        : new InMemoryCandidacyProjectionPort(),
      zoneCatalog: configuredZoneCatalog(env, log),
      clock,
      ids,
    }),
    health: { persistence: "memory" },
    pool: null,
  };
}

async function main(): Promise<void> {
  // Wiring warnings are printed before the app exists, because the choice of adapters is
  // made before there is a logger to attach them to.
  const { runner, health, pool } = buildWiring((message) => console.warn(message));
  const app = createDriverApp({ runner, health, logger: true });
  if (pool) {
    app.addHook("onClose", async () => {
      await pool.end();
    });
  }
  // Closing the app before exiting is what lets in-flight writes finish and the pool
  // drain; a bare `process.exit` on SIGTERM would abandon an open transaction on every
  // deploy.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }
  try {
    await app.listen({ port: Number(process.env.PORT ?? DRIVER_SERVICE_PORT), host: "0.0.0.0" });
  } catch (error) {
    app.log.error(error);
    await app.close();
    process.exit(1);
  }
}

await main();
