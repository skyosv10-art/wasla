/**
 * العمليّة: توصيلٌ ولا شيءَ غيره (Phase 16 · ADR-049).
 *
 * `DATABASE_URL` موجود → Postgres، و`/health` يقول `ok`.
 * غائب → مخازنُ ذاكرية و`degraded`.
 *
 * لا `await main()` مُصدَّر: هذا الملفُّ ليس في `src/index.ts`.
 */

import { readPortEnv } from "@wasla/config";
import { keyRegistryFromEnv, userAssertionConfigFromEnv } from "@wasla/service-auth";
import { createServiceTokenReplayGuardFromEnv } from "@wasla/service-auth/replay-store";
import type { Pool } from "pg";

import { SUPPORT_SERVICE_PORT } from "@wasla/contracts-support";

import { createSupportDb } from "../infrastructure/drizzle/db.js";
import { createPostgresSupportAdapters } from "../infrastructure/drizzle/repository.js";
import {
  InMemorySupportTicketStore,
  InMemorySupportEventPublisher,
} from "../infrastructure/in-memory.js";
import { InMemoryReputationBridge } from "../infrastructure/reputation-bridge.js";
import { createSupportApp } from "./app.js";
import { attachDatabaseHealth } from "@wasla/resilience";

export async function buildSupportServer(): Promise<{
  app: ReturnType<typeof createSupportApp>;
  pool: Pool | null;
}> {
  const port = readPortEnv(process.env, "PORT", SUPPORT_SERVICE_PORT);
  const connectionString = process.env.DATABASE_URL;
  const keys = keyRegistryFromEnv(process.env);
  const replayGuard = createServiceTokenReplayGuardFromEnv(process.env);
  // ADR-060 P2 (CLM-0475): user assertion config for asserted routes (S1-S4).
  // Production default is `off` — no assertion verification, behavior unchanged.
  const userAssertion = userAssertionConfigFromEnv(process.env);

  let pool: Pool | null = null;

  if (connectionString) {
    const { pool: pgPool, db } = createSupportDb({ connectionString });
    pool = pgPool;
    const adapters = createPostgresSupportAdapters(db);

    const app = createSupportApp({
      store: adapters.store,
      publisher: adapters.publisher,
      reputationBridge: adapters.reputationBridge,
      serviceIdentity: { keys, replayGuard, ...(userAssertion === undefined ? {} : { userAssertion }) },
    });
    // RISK-0058 · ADR-059: health answers 503 with the real database state when a pool is down.
    attachDatabaseHealth(app, { paths: ["/health"], service: "support" });
    await app.listen({ port, host: "0.0.0.0" });
    return { app, pool };
  }

  const app = createSupportApp({
    store: new InMemorySupportTicketStore(),
    publisher: new InMemorySupportEventPublisher(),
    reputationBridge: new InMemoryReputationBridge(),
    serviceIdentity: { keys, replayGuard, ...(userAssertion === undefined ? {} : { userAssertion }) },
  });
  // RISK-0058 · ADR-059: health answers 503 with the real database state when a pool is down.
  attachDatabaseHealth(app, { paths: ["/health"], service: "support" });
  await app.listen({ port, host: "0.0.0.0" });
  return { app, pool };
}

export async function main(): Promise<void> {
  const { pool } = await buildSupportServer();

  process.on("SIGTERM", async () => {
    if (pool) await pool.end();
    process.exit(0);
  });
}

await main();
