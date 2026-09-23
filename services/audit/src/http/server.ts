/**
 * The process: wiring, and nothing else.
 *
 * DATABASE_URL present → Postgres. Absent → in-memory (degraded).
 */

import { readPortEnv } from "@wasla/config";
import { Pool } from "pg";
import { keyRegistryFromEnv } from "@wasla/service-auth";
import { createServiceTokenReplayGuardFromEnv } from "@wasla/service-auth/replay-store";
import { registerMetrics, instrumentApp, addMetricsEndpoint, startTracing } from "@wasla/observability";

import { createAuditDb } from "../infrastructure/drizzle/db.js";
import { DrizzleAuditRepository } from "../infrastructure/drizzle/repository.js";
import { createInMemoryDeps, SystemClock } from "../infrastructure/in-memory.js";
import type { AuditDeps } from "../ports.js";

import { createAuditApp } from "./app.js";

const AUDIT_SERVICE_PORT = 8092;

function buildDeps(): { deps: AuditDeps; pool: Pool | null } {
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = createAuditDb(pool);
    return {
      deps: { repo: new DrizzleAuditRepository(db), clock: new SystemClock() },
      pool,
    };
  }
  const inMemory = createInMemoryDeps();
  return { deps: inMemory, pool: null };
}

async function main(): Promise<void> {
  const { deps, pool } = buildDeps();
  const keys = keyRegistryFromEnv(process.env);
  const replayGuard = createServiceTokenReplayGuardFromEnv(process.env);
  const stopTracing = startTracing("audit");

  const app = createAuditApp({
    deps,
    logger: true,
    serviceIdentity: { keys, replayGuard },
  });

  const metrics = registerMetrics("audit");
  instrumentApp(app, metrics);
  addMetricsEndpoint(app, metrics);
  app.addHook("onClose", async () => { stopTracing(); });

  if (pool) {
    app.addHook("onClose", async () => { await pool.end(); });
  }

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }

  try {
    await app.listen({ port: readPortEnv(process.env, "PORT", AUDIT_SERVICE_PORT), host: "0.0.0.0" });
  } catch (error) {
    app.log.error(error);
    await app.close();
    process.exit(1);
  }
}

await main();
