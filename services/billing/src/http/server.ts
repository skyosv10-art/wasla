/**
 * إعدادُ تشغيلِ خادمِ الفوترة (Phase 17 · ADR-050).
 *
 * العمليّة: توصيلٌ ولا شيءَ غيره. `BILLING_DATABASE_URL` موجود → Postgres،
 * و`/health` يقول `ok`. غائب → مخازنُ ذاكرية و`degraded`.
 *
 * لا `await main()` مُصدَّر: هذا الملفُّ ليس في `src/index.ts`.
 */

import { readPortEnv } from "@wasla/config";
import { keyRegistryFromEnv } from "@wasla/service-auth";
import { createServiceTokenReplayGuardFromEnv } from "@wasla/service-auth/replay-store";
import type { Pool } from "pg";

import { BILLING_SERVICE_PORT } from "@wasla/contracts-billing";

import { createBillingDb } from "../infrastructure/drizzle/db.js";
import { PostgresInvoiceStore } from "../infrastructure/drizzle/repository.js";
import {
  InMemoryInvoiceStore,
  InMemoryPaymentGateway,
  InMemoryEventPublisher,
} from "../ports.js";
import { createBillingApp } from "./app.js";

export async function buildBillingServer(): Promise<{
  app: ReturnType<typeof createBillingApp>;
  pool: Pool | null;
}> {
  const port = readPortEnv(process.env, "PORT", BILLING_SERVICE_PORT);
  const connectionString = process.env.BILLING_DATABASE_URL;
  const keys = keyRegistryFromEnv(process.env);
  const replayGuard = createServiceTokenReplayGuardFromEnv(process.env);

  let pool: Pool | null = null;

  if (connectionString) {
    const { pool: pgPool, db } = createBillingDb({ connectionString });
    pool = pgPool;

    const app = createBillingApp({
      store: new PostgresInvoiceStore(db),
      paymentGateway: new InMemoryPaymentGateway(),
      publisher: new InMemoryEventPublisher(),
      serviceIdentity: { keys, replayGuard },
    });
    await app.listen({ port, host: "0.0.0.0" });
    return { app, pool };
  }

  const app = createBillingApp({
    store: new InMemoryInvoiceStore(),
    paymentGateway: new InMemoryPaymentGateway(),
    publisher: new InMemoryEventPublisher(),
    serviceIdentity: { keys, replayGuard },
  });
  await app.listen({ port, host: "0.0.0.0" });
  return { app, pool };
}

export async function main(): Promise<void> {
  const { pool } = await buildBillingServer();

  process.on("SIGTERM", async () => {
    if (pool) await pool.end();
    process.exit(0);
  });
}

await main();
