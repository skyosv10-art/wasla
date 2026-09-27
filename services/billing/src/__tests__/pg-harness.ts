/**
 * pg-harness لاختباراتِ تكاملِ الفوترة (M5-17P · CLM-0375).
 *
 * يُطبِّقُ `contracts/schema.sql` — العقدَ الذي يُطبِّقُهُ `migrate-cli` في الإنتاجِ نفسِهِ —
 * ويُنشئُ `delivery_outbox` (M5-17Q · CLM-0376) **بنصِّ DDL المقتطَعِ من عقدِ التوصيلِ
 * نفسِهِ** (`services/delivery/contracts/schema.sql`) لا بنسخةٍ ثانيةٍ: لو تغيّرَ جدولُ
 * المنتِجِ تغيّرَ هنا. المُرحِّلُ يقرؤُهُ من قاعدةٍ أخرى في الإنتاج؛ وفي الاختبارِ القاعدةُ
 * واحدةٌ والمصدرُ مسبحٌ مستقلٌّ.
 *
 * تتخطّى الاختباراتُ نفسَها بلا `DATABASE_URL`.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg, { type Pool } from "pg";

import { applyBillingSchema } from "../db/migrate.js";
import { PostgresOutboxPublisher } from "../infrastructure/pg/outbox-publisher.js";
import {
  PostgresConsumedEventLedger,
  PostgresDeliveryEventSource,
  PostgresRelayCheckpointStore,
  PostgresRelayConsumerLock,
  PostgresRelayTransactionRunner,
} from "../infrastructure/pg/relay-stores.js";
import type { RelayDeps } from "../ports.js";
import type { DeliveryOutboxRow } from "../domain/consumed-events.js";

export const DATABASE_URL = process.env.DATABASE_URL;
export const PG_ENABLED = Boolean(DATABASE_URL);

export const BILLING_TABLES = [
  "billing_store_order_snapshots",
  "billing_relay_consumed_events",
  "billing_relay_checkpoint",
  "billing_outbox",
  "billing_settlements",
  "billing_invoices",
] as const;

const DELIVERY_SCHEMA_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "delivery", "contracts", "schema.sql",
);

/** `CREATE TABLE ... delivery_outbox (...)` حرفيّاً من عقدِ التوصيل. */
export function deliveryOutboxDdl(): string {
  const sql = readFileSync(DELIVERY_SCHEMA_PATH, "utf8");
  const m = /CREATE TABLE IF NOT EXISTS delivery_outbox \([\s\S]*?\n\);/.exec(sql);
  if (!m) throw new Error("delivery_outbox DDL not found in the delivery contract");
  return m[0];
}

export function newPool(max = 6): Pool {
  return new pg.Pool({ connectionString: DATABASE_URL!, max });
}

export async function resetSchema(pool: Pool): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${BILLING_TABLES.join(", ")}, delivery_outbox CASCADE`);
  await applyBillingSchema(pool);
  await pool.query(deliveryOutboxDdl());
}

export async function resetData(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${BILLING_TABLES.join(", ")}, delivery_outbox RESTART IDENTITY CASCADE`);
}

/** يكتبُ الصفَّ بالأعمدةِ نفسِها التي يكتبُها `appendOutbox` في مخزنِ طلباتِ التوصيل. */
export async function insertDeliveryEvent(pool: Pool, row: DeliveryOutboxRow): Promise<string> {
  await pool.query(
    `INSERT INTO delivery_outbox (
       event_id, event_type, event_version, aggregate_type, aggregate_id,
       payload, trace_id, occurred_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      row.event_id,
      row.event_type,
      row.event_version,
      row.aggregate_type,
      row.aggregate_id,
      JSON.stringify(row.payload),
      row.trace_id,
      row.occurred_at,
    ],
  );
  return row.event_id;
}

/** اعتماداتُ المُرحِّلِ كلُّها على Postgres — التوصيلُ نفسُهُ في `http/server.ts`. */
export function postgresRelayDeps(billing: Pool, source: Pool): RelayDeps {
  return {
    events: new PostgresDeliveryEventSource(source),
    transaction: new PostgresRelayTransactionRunner(billing),
    ledger: new PostgresConsumedEventLedger(billing),
    checkpoint: new PostgresRelayCheckpointStore(billing),
    lock: new PostgresRelayConsumerLock(billing),
    idGen: {
      newInvoiceId: () => randomUUID(),
      newSettlementId: () => randomUUID(),
      newPayoutId: () => randomUUID(),
    },
    clock: { now: () => new Date("2026-09-27T12:00:00Z") },
  };
}

export { PostgresOutboxPublisher };

export async function count(pool: Pool, sql: string, values: unknown[] = []): Promise<number> {
  const r = await pool.query<{ n: string }>(sql, values);
  return Number(r.rows[0]?.n ?? "0");
}
