/**
 * The process: wiring, and nothing else (Phase 05 · MR 4/6).
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
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import { DRIVER_SERVICE_PORT } from "@wasla/contracts-driver";

import { createDriverDb } from "../infrastructure/drizzle/db.js";
import type { DriverSharedDeps } from "../infrastructure/drizzle/transaction.js";
import {
  createInMemoryEnvironment,
  InMemoryCandidacyProjectionPort,
  InMemoryZoneCatalogPort,
} from "../infrastructure/in-memory.js";
import type { CandidacyProjectionPort, Clock, IdGenerator, ZoneCatalogPort } from "../ports.js";
import { createDirectRunner, PostgresDriverRunner, type DriverRunner } from "../runner.js";

import { createDriverApp, type DriverHealthDescriptor } from "./app.js";

class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

class CryptoIdGenerator implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }
}

/**
 * The candidacy port until MR 5/6 gives it a real HTTP implementation.
 *
 * It refuses instead of pretending to succeed. `publishCandidacy` records a refusal as
 * a failed publication and lets the local write stand (ADR-012 decision 3), so an
 * unconfigured matching service costs visible publication lag — never a silently
 * dropped projection that leaves matching believing a suspended driver is available.
 */
class UnconfiguredCandidacyPort implements CandidacyProjectionPort {
  async read(): Promise<null> {
    return null;
  }
  async publish(): Promise<{ accepted: boolean; failureCode: string | null }> {
    return { accepted: false, failureCode: "matching_not_configured" };
  }
}

/**
 * Zones known to this process, from `DRIVER_DEV_ZONE_IDS`.
 *
 * There is no `PostgresZoneCatalogPort` and there should not be: the zone hierarchy
 * belongs to matching (ADR-006), and `schema.ts` says in its own header that
 * `work_city_zone_id` deliberately carries no foreign key to geography — reading
 * another service's table would be exactly the cross-database coupling ADR-012 forbids.
 * The real adapter is an HTTP port to matching, and it lands in MR 5/6 beside
 * `HttpCandidacyPort` (matching's own `HttpGeographyPort` is the precedent to copy).
 *
 * So this stands on BOTH paths for now, Postgres included, and is env-driven rather
 * than empty because the port is fail-closed: with no seeded id, every `PUT /zones`
 * answers `422 DRIVER_ZONE_UNKNOWN` and looks like a bug in the route rather than a
 * missing adapter. Being explicit here is what keeps the gap visible in wiring instead
 * of hidden behind a class that pretends to know the hierarchy.
 */
function configuredZoneCatalog(): ZoneCatalogPort {
  const catalog = new InMemoryZoneCatalogPort();
  const configured = (process.env.DRIVER_DEV_ZONE_IDS ?? "")
    .split(",")
    .map((zoneId) => zoneId.trim())
    .filter((zoneId) => zoneId.length > 0);
  catalog.seed(...configured);
  return catalog;
}

interface Wiring {
  runner: DriverRunner;
  health: DriverHealthDescriptor;
  pool: Pool | null;
}

function buildWiring(): Wiring {
  const clock = new SystemClock();
  const ids = new CryptoIdGenerator();

  if (process.env.DATABASE_URL) {
    const { pool, db } = createDriverDb({ connectionString: process.env.DATABASE_URL });
    const shared: DriverSharedDeps = {
      // Still the unconfigured port on Postgres: storage and the outbound call are
      // independent choices, and MR 5/6 replaces exactly this line.
      candidacy: new UnconfiguredCandidacyPort(),
      zoneCatalog: configuredZoneCatalog(),
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
      candidacy: new InMemoryCandidacyProjectionPort(),
      zoneCatalog: configuredZoneCatalog(),
      clock,
      ids,
    }),
    health: { persistence: "memory" },
    pool: null,
  };
}

async function main(): Promise<void> {
  const { runner, health, pool } = buildWiring();
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
