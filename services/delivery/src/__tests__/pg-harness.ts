/**
 * PostgreSQL harness for delivery integration tests (review 3/N).
 *
 * The relay reads `dispatch_outbox` (dispatch schema, read-only) and writes
 * the task mirror (delivery schema). For integration tests we need BOTH in
 * one test DB: the `dispatch_outbox` table read from the dispatch contract
 * **verbatim** (with its RISK-0012 commit-order trigger), plus the full delivery schema.
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

import { readSchemaContract } from "../db/migrate.js";

// مسارٌ واحدٌ إلى العقدِ لا مسارانِ: `src/db/migrate.ts` يُصدِّرُ المسارَ والقارئَ، ويقرأُ
// الحارسُ (`schema-drift.test.ts`) والترحيلُ (`migrate-cli.ts`) نفسَ الملفِّ. وقارئٌ ثانٍ
// هنا كان سيبقى صحيحاً حتّى يتحرّكَ الملفُّ، ثمّ يُخفقُ أحدُ المسارَينِ وحدَه.
const deliverySchemaSql = readSchemaContract();

/** وجودُ العنوانِ وحدَهُ هو مفتاحُ تشغيلِ التكامل. */
export const DATABASE_URL = process.env.DATABASE_URL;
export const PG_ENABLED = Boolean(DATABASE_URL);

export const T0 = "2026-09-09T10:00:00.000Z";

/*
 * The producers' outbox tables, read FROM their contracts at runtime (RISK-0012 ·
 * CLM-0416). The hand-copied DDL that stood here had drifted: it lacked
 * `sequence_number`, so these tests ran against a table the producers never
 * create. Reading the contract keeps the harness verbatim by construction, and it
 * brings the commit-order trigger with it, so the relay tests exercise the real
 * ordering guarantee (ADR-057).
 */
const SERVICES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function producerOutboxDdl(service: string, table: string): string {
  const sql = readFileSync(resolve(SERVICES_ROOT, service, "contracts", "schema.sql"), "utf8");
  const create = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`).exec(sql);
  const order = new RegExp(`-- >>> RISK-0012 commit_sequence \\(${table}\\)[\\s\\S]*?-- <<< RISK-0012 commit_sequence \\(${table}\\)`).exec(sql);
  if (!create || !order) throw new Error(`${service}/contracts/schema.sql: ${table} DDL or its RISK-0012 block not found`);
  // `sequence_number` is added by ALTER in the contract for pre-ADR-037 tables; the
  // CREATE already declares it, so the ALTER is not needed here.
  return `${create[0]}\n${order[0]}\n`;
}

const DISPATCH_OUTBOX_DDL = producerOutboxDdl("dispatch", "dispatch_outbox");
const MARKETPLACE_OUTBOX_DDL = producerOutboxDdl("marketplace", "marketplace_outbox");

/** Tables the delivery contract owns — extracted FROM the contract at runtime (M0-18). */
export const CONTRACT_TABLES = [...deliverySchemaSql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);

export const DELIVERY_TABLES = [
  // Listed before store_orders: the FK cascades, but TRUNCATE order is also
  // the order a reader learns the dependency in.
  "delivery_idempotency_keys",
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
  // راياتُ التضاربِ (المراجعةُ 16/N): مذكورةٌ **صراحةً** لأنَّها لا تُقصَفُ
  // تِبَعاً — لا مفتاحَ أجنبيّاً فيها إلى `store_orders` ولا إلى الرصدِ (وذاكَ
  // مقصودٌ: الرايةُ سجلٌّ يبقى بعدَ الطلبِ). ولولا ذكرُها لَتَسرَّبَ صفٌّ من
  // اختبارٍ إلى اختبارٍ، وأوّلُ عدٍّ يفشلُ يُقرأُ عيباً في الكشفِ لا في التنظيفِ.
  "delivery_inventory_conflicts",
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
    `INSERT INTO store_orders (order_id, public_id, customer_ref, store_id, store_slug,
                               fulfillment_state, payment_state, currency_code,
                               items_total_minor_units, delivery_fee_minor_units, total_minor_units)
     VALUES ($1::uuid, $2, $3, $4::uuid, $5, 'confirmed', 'authorized', 'SAR', 1000, 500, 1500)`,
    [orderId, publicId, "WS-0000000009", "cccccccc-0000-0000-0000-000000000003", "matjar-alfawakih"],
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
    /**
     * A row the commit-order trigger never ordered — a pre-migration row, or one
     * written with triggers bypassed — placed at this `commit_sequence`. It is the
     * only way a never-consumed event can sit behind the checkpoint once
     * RISK-0012 is fixed, which is exactly what the per-task watermark guards.
     */
    legacy_commit_sequence?: number;
  },
): Promise<string> {
  const params = [
    event.event_id ?? null,
    event.event_type,
    event.event_version ?? "v1",
    event.aggregate_type ?? "dispatch_job",
    event.aggregate_id,
    JSON.stringify(event.payload),
    event.trace_id ?? null,
    event.occurred_at ?? new Date().toISOString(),
  ];
  if (event.legacy_commit_sequence === undefined) {
    const result = await pool.query<{ event_id: string }>(
      `INSERT INTO dispatch_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload, trace_id, occurred_at)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz)
       RETURNING event_id::text`,
      params,
    );
    return result.rows[0].event_id;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    const result = await client.query<{ event_id: string }>(
      `INSERT INTO dispatch_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload, trace_id, occurred_at, commit_sequence)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz, $9::bigint)
       RETURNING event_id::text`,
      [...params, event.legacy_commit_sequence],
    );
    await client.query("COMMIT");
    return result.rows[0].event_id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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

/**
 * The `commit_sequence` the producer's deferred trigger assigned to one row —
 * read back, never predicted: its value is the trigger's to choose (RISK-0012).
 */
export async function commitSequenceOf(
  pool: Pool,
  table: "dispatch_outbox" | "marketplace_outbox" | "delivery_outbox",
  idColumn: "event_id" | "outbox_id",
  id: string,
): Promise<string> {
  const r = await pool.query<{ s: string }>(
    `SELECT commit_sequence::text AS s FROM ${table} WHERE ${idColumn}::text = $1`,
    [id],
  );
  if (r.rows.length !== 1) throw new Error(`${table}: no row ${id}`);
  return r.rows[0]!.s;
}
