/**
 * pg-harness لاختباراتِ تكاملِ الفوترة (M5-17P · CLM-0375).
 *
 * يُطبِّقُ `contracts/schema.sql` — العقدَ الذي يُطبِّقُهُ `migrate-cli` في الإنتاجِ نفسِهِ —
 * ويُنشئُ جدولَ `order_outbox` بنسخةٍ مطابقةٍ لأعمدةِ عقدِ الطلبات
 * (`services/orders/contracts/schema.sql`) لأنَّ المُرحِّلَ يقرؤُهُ من قاعدةٍ أخرى في
 * الإنتاج؛ وفي الاختبارِ القاعدةُ واحدةٌ والمصدرُ مسبحٌ مستقلٌّ.
 *
 * تتخطّى الاختباراتُ نفسَها بلا `DATABASE_URL`.
 */

import { randomUUID } from "node:crypto";

import pg, { type Pool } from "pg";

import { applyBillingSchema } from "../db/migrate.js";
import { PostgresOutboxPublisher } from "../infrastructure/pg/outbox-publisher.js";
import {
  PostgresConsumedEventLedger,
  PostgresOrderEventSource,
  PostgresRelayCheckpointStore,
  PostgresRelayConsumerLock,
  PostgresRelayTransactionRunner,
} from "../infrastructure/pg/relay-stores.js";
import type { RelayDeps } from "../ports.js";

export const DATABASE_URL = process.env.DATABASE_URL;
export const PG_ENABLED = Boolean(DATABASE_URL);

export const BILLING_TABLES = [
  "billing_relay_consumed_events",
  "billing_relay_checkpoint",
  "billing_outbox",
  "billing_settlements",
  "billing_invoices",
] as const;

/** نسخةُ أعمدةِ `order_outbox` من عقدِ الطلبات — مصدرُ المُرحِّلِ للقراءةِ فقط. */
const ORDER_OUTBOX_FIXTURE_DDL = `
CREATE TABLE order_outbox (
    event_id       UUID        PRIMARY KEY,
    event_type     TEXT        NOT NULL,
    event_version  TEXT        NOT NULL CHECK (event_version ~ '^v[0-9]+$'),
    aggregate_type TEXT        NOT NULL CHECK (aggregate_type IN ('order','order_assignment')),
    aggregate_id   TEXT        NOT NULL,
    payload        JSONB       NOT NULL,
    trace_id       TEXT        CHECK (trace_id IS NULL OR char_length(trace_id) <= 128),
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ,
    sequence_number BIGINT     NOT NULL GENERATED ALWAYS AS IDENTITY,
    attempts       INTEGER     NOT NULL DEFAULT 0,
    last_error     TEXT
)`;

export function newPool(max = 6): Pool {
  return new pg.Pool({ connectionString: DATABASE_URL!, max });
}

export async function resetSchema(pool: Pool): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${BILLING_TABLES.join(", ")}, order_outbox CASCADE`);
  await applyBillingSchema(pool);
  await pool.query(ORDER_OUTBOX_FIXTURE_DDL);
}

export async function resetData(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${BILLING_TABLES.join(", ")}, order_outbox RESTART IDENTITY CASCADE`);
}

export interface OrderEventInput {
  readonly eventId?: string;
  readonly occurredAt: string;
  readonly eventType?: string;
  readonly eventVersion?: string;
  readonly data: Record<string, unknown>;
}

export async function insertOrderEvent(pool: Pool, e: OrderEventInput): Promise<string> {
  const eventId = e.eventId ?? randomUUID();
  await pool.query(
    `INSERT INTO order_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload, occurred_at)
     VALUES ($1::uuid, $2, $3, 'order', $4, $5::jsonb, $6::timestamptz)`,
    [
      eventId,
      e.eventType ?? "order.status_changed",
      e.eventVersion ?? "v1",
      String(e.data.order_public_id ?? "ORD-X"),
      JSON.stringify(e.data),
      e.occurredAt,
    ],
  );
  return eventId;
}

export function completedOrder(n: number, totalCents: number): Record<string, unknown> {
  return {
    order_public_id: `ORD-${String(n).padStart(10, "0")}`,
    store_public_id: `WS-${String(n % 3).padStart(10, "0")}`,
    customer_public_id: `CUST-${String(n).padStart(10, "0")}`,
    from_status: "assigned",
    to_status: "completed",
    order_total_cents: totalCents,
  };
}

/** اعتماداتُ المُرحِّلِ كلُّها على Postgres — التوصيلُ نفسُهُ في `http/server.ts`. */
export function postgresRelayDeps(billing: Pool, source: Pool): RelayDeps {
  return {
    events: new PostgresOrderEventSource(source),
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
