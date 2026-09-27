/**
 * إعدادُ تشغيلِ خادمِ الفوترة (Phase 17 · ADR-050).
 *
 * العمليّة: توصيلٌ ولا شيءَ غيره. `BILLING_DATABASE_URL` موجود → Postgres،
 * و`/health` يقول `ok`. غائب → مخازنُ ذاكرية و`degraded`.
 *
 * M5-17P (CLM-0375): على المسارِ الدائمِ التسوياتُ `PostgresSettlement` والناشرُ
 * `PostgresOutboxPublisher` (صفوفٌ في `billing_outbox`). وحلقةُ المُرحِّلِ تعملُ داخلَ
 * العمليةِ حينَ يُضبَطُ `BILLING_DELIVERY_EVENTS_DATABASE_URL` — M5-17Q (CLM-0376):
 * قراءةٌ فقط من `delivery_outbox` (`store_order.*`، المنتِجُ الحقيقيُّ للقطةِ المالِ)،
 * ونقطةُ التفتيشِ ودفترُ الاستهلاكِ ولقطاتُ الطلباتِ في قاعدةِ الفوترةِ نفسِها. بوّابةُ الدفعِ ما زالت
 * `InMemoryPaymentGateway`: محوِّلُ Tap خارجَ نطاقِ M5-17P بقرارِ المالك.
 *
 * لا `await main()` مُصدَّر: هذا الملفُّ ليس في `src/index.ts`.
 */

import { readPortEnv } from "@wasla/config";
import { keyRegistryFromEnv } from "@wasla/service-auth";
import { createServiceTokenReplayGuardFromEnv } from "@wasla/service-auth/replay-store";
import { randomUUID } from "node:crypto";
import pg, { type Pool } from "pg";

import { BILLING_SERVICE_PORT } from "@wasla/contracts-billing";

import { createBillingDb } from "../infrastructure/drizzle/db.js";
import { PostgresInvoiceStore } from "../infrastructure/drizzle/repository.js";
import { PostgresOutboxPublisher } from "../infrastructure/pg/outbox-publisher.js";
import {
  PostgresConsumedEventLedger,
  PostgresDeliveryEventSource,
  PostgresRelayCheckpointStore,
  PostgresRelayConsumerLock,
  PostgresRelayTransactionRunner,
} from "../infrastructure/pg/relay-stores.js";
import { PostgresSettlement } from "../infrastructure/pg/settlement-store.js";
import { DEFAULT_RELAY_CONFIG } from "../relay.js";
import { startRelayLoop, type RelayLoopHandle } from "../relay-loop.js";
import {
  InMemoryInvoiceStore,
  InMemoryPaymentGateway,
  InMemoryEventPublisher,
  InMemorySettlement,
} from "../ports.js";
import { createBillingApp } from "./app.js";

/** مهلةُ ما بينَ دفعتَينِ للمُرحِّل — ثابتٌ لا متغيّرُ بيئة (لا ضبطَ يُحتاجُ الآن). */
export const BILLING_RELAY_INTERVAL_MS = 5_000;

export async function buildBillingServer(): Promise<{
  app: ReturnType<typeof createBillingApp>;
  pool: Pool | null;
  relay: { loop: RelayLoopHandle; sourcePool: Pool } | null;
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
      settlements: new PostgresSettlement(pgPool),
      paymentGateway: new InMemoryPaymentGateway(),
      publisher: new PostgresOutboxPublisher(pgPool),
      serviceIdentity: { keys, replayGuard },
    });
    await app.listen({ port, host: "0.0.0.0" });

    let relay: { loop: RelayLoopHandle; sourcePool: Pool } | null = null;
    const sourceUrl = process.env.BILLING_DELIVERY_EVENTS_DATABASE_URL;
    if (sourceUrl) {
      const sourcePool = new pg.Pool({ connectionString: sourceUrl, max: 2 });
      const loop = startRelayLoop({
        deps: {
          events: new PostgresDeliveryEventSource(sourcePool),
          transaction: new PostgresRelayTransactionRunner(pgPool),
          ledger: new PostgresConsumedEventLedger(pgPool),
          checkpoint: new PostgresRelayCheckpointStore(pgPool),
          lock: new PostgresRelayConsumerLock(pgPool),
          idGen: {
            newInvoiceId: () => randomUUID(),
            newSettlementId: () => randomUUID(),
            newPayoutId: () => randomUUID(),
          },
          clock: { now: () => new Date() },
        },
        config: DEFAULT_RELAY_CONFIG,
        intervalMs: BILLING_RELAY_INTERVAL_MS,
        onBatch: (r) => {
          if (r.processed > 0) app.log.info({ relay: r }, "billing relay batch");
        },
        onError: (err) => app.log.error({ err }, "billing relay batch failed"),
      });
      relay = { loop, sourcePool };
    } else {
      app.log.warn("BILLING_DELIVERY_EVENTS_DATABASE_URL غيرُ مضبوط — حلقةُ المُرحِّلِ لا تعمل");
    }
    return { app, pool, relay };
  }

  const app = createBillingApp({
    store: new InMemoryInvoiceStore(),
    settlements: new InMemorySettlement(),
    paymentGateway: new InMemoryPaymentGateway(),
    publisher: new InMemoryEventPublisher(),
    serviceIdentity: { keys, replayGuard },
  });
  await app.listen({ port, host: "0.0.0.0" });
  return { app, pool, relay: null };
}

export async function main(): Promise<void> {
  const { app, pool, relay } = await buildBillingServer();

  process.on("SIGTERM", async () => {
    // الدفعةُ الجاريةُ تنتهي أوّلاً، ثمَّ الخادمُ، ثمَّ المسابح.
    if (relay) await relay.loop.stop();
    await app.close();
    if (relay) await relay.sourcePool.end();
    if (pool) await pool.end();
    process.exit(0);
  });
}

await main();
