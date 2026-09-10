/**
 * PostgreSQL harness for delivery integration tests (review 3/N).
 *
 * The relay reads `dispatch_outbox` (dispatch schema, read-only) and writes
 * the task mirror (delivery schema). For integration tests we need BOTH in
 * one test DB: a minimal `dispatch_outbox` table matching the dispatch
 * contract **verbatim** (no FKs), plus the full delivery schema.
 *
 * Verbatim matters (the M0-18 lesson, paid for on 2026-09-08): a softer
 * stand-in succeeds on a clean DB and fails on the shared-DB CI leg, and —
 * worse — lets tests seed events dispatch can never emit.
 *
 * Tests SKIP when `DATABASE_URL` is not set (see
 * `docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md`).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const deliverySchemaSql = readFileSync(
  resolve(__dirname, "../../contracts/schema.sql"),
  "utf8",
);

/** وجودُ العنوانِ وحدَهُ هو مفتاحُ تشغيلِ التكامل. */
export const DATABASE_URL = process.env.DATABASE_URL;
export const PG_ENABLED = Boolean(DATABASE_URL);

export const T0 = "2026-09-09T10:00:00.000Z";

/**
 * Minimal `dispatch_outbox` DDL — **يُطابقُ عقدَ التوزيعِ حرفاً** بلا مفاتيحَ
 * أجنبيّةٍ (`services/dispatch/contracts/schema.sql`).
 */
const DISPATCH_OUTBOX_DDL = `
CREATE TABLE IF NOT EXISTS dispatch_outbox (
    event_id       UUID        PRIMARY KEY,
    event_type     TEXT        NOT NULL,
    event_version  TEXT        NOT NULL CHECK (event_version ~ '^v[0-9]+$'),
    aggregate_type TEXT        NOT NULL CHECK (aggregate_type IN ('dispatch_job','dispatch_offer')),
    aggregate_id   TEXT        NOT NULL,
    payload        JSONB       NOT NULL,
    trace_id       TEXT        CHECK (trace_id IS NULL OR char_length(trace_id) <= 128),
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ
);
`;

/**
 * Minimal `marketplace_outbox` DDL — **يُطابقُ عقدَ السوقِ حرفاً** بلا مفاتيحَ
 * أجنبيّةٍ (`services/marketplace/contracts/schema.sql`).
 */
const MARKETPLACE_OUTBOX_DDL = `
CREATE TABLE IF NOT EXISTS marketplace_outbox (
    outbox_id               UUID        PRIMARY KEY,
    event_type              TEXT        NOT NULL CHECK (event_type ~ '^marketplace\\.[a-z_]+$'),
    event_version           TEXT        NOT NULL CHECK (event_version ~ '^v[0-9]+$'),
    aggregate_type          TEXT        NOT NULL CHECK (aggregate_type IN ('store', 'product', 'inventory')),
    aggregate_id            TEXT        NOT NULL,
    payload                 JSONB       NOT NULL,
    occurred_at             TIMESTAMPTZ NOT NULL,
    published_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

/** Tables the delivery contract owns — extracted FROM the contract at runtime (M0-18). */
export const CONTRACT_TABLES = [...deliverySchemaSql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);

export const DELIVERY_TABLES = [
  "delivery_relay_checkpoint",
  "delivery_relay_consumed_events",
  "delivery_outbox",
  "delivery_task_transitions",
  "delivery_tasks",
  "store_order_items",
  "store_order_transitions",
  "store_orders",
  "delivery_inventory_observations",
  "delivery_inventory_relay_consumed_events",
  "delivery_inventory_relay_checkpoint",
] as const;

export interface PgFixture {
  readonly pool: Pool;
  readonly close: () => Promise<void>;
}

export async function applyDeliverySchema(pool: Pool): Promise<void> {
  await pool.query(DISPATCH_OUTBOX_DDL);
  await pool.query(MARKETPLACE_OUTBOX_DDL);
  await pool.query(deliverySchemaSql);
}

export async function resetData(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${DELIVERY_TABLES.join(", ")}, dispatch_outbox, marketplace_outbox RESTART IDENTITY CASCADE`);
}

export async function setupPostgres(): Promise<PgFixture> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: DATABASE_URL!, max: 4 });
  await applyDeliverySchema(pool);
  return { pool, close: () => pool.end() };
}

/** Seed a delivery task (order + task). `dispatchJobRef: null` seeds UNBOUND. */
export async function seedTask(
  pool: Pool,
  overrides: Partial<{ taskId: string; orderId: string; publicId: string; state: string; dispatchJobRef: string | null }> = {},
): Promise<{ taskId: string; orderId: string; jobId: string | null }> {
  const taskId = overrides.taskId ?? "aaaaaaaa-0000-0000-0000-000000000001";
  const orderId = overrides.orderId ?? "bbbbbbbb-0000-0000-0000-000000000002";
  const publicId = overrides.publicId ?? "WS-0000000001";
  // `??` would swallow an explicit null — an unbound seed must stay unbound.
  const jobId = "dispatchJobRef" in overrides ? (overrides.dispatchJobRef as string | null) : "job-agg-1";
  await pool.query(
    `INSERT INTO store_orders (order_id, public_id, customer_ref, store_id, store_public_id,
                               fulfillment_state, payment_state, currency_code,
                               items_total_minor_units, delivery_fee_minor_units, total_minor_units)
     VALUES ($1::uuid, $2, $3, $4::uuid, $5, 'confirmed', 'authorized', 'SAR', 1000, 500, 1500)`,
    [orderId, publicId, "WS-0000000009", "cccccccc-0000-0000-0000-000000000003", "WS-0000000002"],
  );
  await pool.query(
    `INSERT INTO delivery_tasks (task_id, order_id, state, dispatch_job_ref)
     VALUES ($1::uuid, $2::uuid, $3, $4)`,
    [taskId, orderId, overrides.state ?? "dispatch_requested", jobId],
  );
  return { taskId, orderId, jobId };
}

/** Seed a dispatch outbox row and return its event_id. */
export async function seedDispatchEvent(
  pool: Pool,
  event: {
    event_id?: string;
    event_type: string;
    event_version?: string;
    aggregate_type?: string;
    aggregate_id: string;
    payload: Record<string, unknown>;
    occurred_at?: string;
    trace_id?: string | null;
  },
): Promise<string> {
  const result = await pool.query<{ event_id: string }>(
    `INSERT INTO dispatch_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload, trace_id, occurred_at)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz)
     RETURNING event_id::text`,
    [
      event.event_id ?? null,
      event.event_type,
      event.event_version ?? "v1",
      event.aggregate_type ?? "dispatch_job",
      event.aggregate_id,
      JSON.stringify(event.payload),
      event.trace_id ?? null,
      event.occurred_at ?? new Date().toISOString(),
    ],
  );
  return result.rows[0].event_id;
}

/** Seed a marketplace outbox row (inventory_adjusted) and return its outbox_id. */
export async function seedMarketplaceEvent(
  pool: Pool,
  event: {
    outbox_id?: string;
    event_type?: string;
    event_version?: string;
    aggregate_type?: string;
    aggregate_id?: string;
    payload: Record<string, unknown>;
    occurred_at?: string;
  },
): Promise<string> {
  const result = await pool.query<{ outbox_id: string }>(
    `INSERT INTO marketplace_outbox (outbox_id, event_type, event_version, aggregate_type, aggregate_id, payload, occurred_at)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6::jsonb, $7::timestamptz)
     RETURNING outbox_id::text`,
    [
      event.outbox_id ?? null,
      event.event_type ?? "marketplace.inventory_adjusted",
      event.event_version ?? "v1",
      event.aggregate_type ?? "inventory",
      event.aggregate_id ?? "cccccccc-0000-0000-0000-000000000003",
      JSON.stringify(event.payload),
      event.occurred_at ?? new Date().toISOString(),
    ],
  );
  return result.rows[0].outbox_id;
}
