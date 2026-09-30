/**
 * PostgreSQL harness for search service integration tests.
 *
 * The relay reads `marketplace_outbox` (marketplace schema) and writes the
 * search projection (search schema). For integration tests we need BOTH in
 * one test DB: the `marketplace_outbox` table read from the marketplace
 * contract (with its RISK-0012 commit-order trigger) to seed events, plus the full search schema.
 *
 * Tests SKIP when `DATABASE_URL` is not set (see `docs/14-runbooks/`).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const searchSchemaSql = readFileSync(
  resolve(__dirname, "../../contracts/schema.sql"),
  "utf8",
);

/** وجودُ العنوانِ وحدَه هو مفتاحُ تشغيلِ التكامل. */
export const DATABASE_URL = process.env.DATABASE_URL;
export const PG_ENABLED = Boolean(DATABASE_URL);

export const T0 = "2026-03-01T00:00:00.000Z";
export const T1 = "2026-03-02T00:00:00.000Z";
export const T2 = "2026-03-03T00:00:00.000Z";

export const SEARCH_TABLES = [
  "search_relay_checkpoint",
  "search_relay_consumed_events",
  "search_outbox",
  "search_marketplace_product_state",
  "search_marketplace_store_state",
  "search_product_index",
] as const;

/**
 * Minimal `marketplace_outbox` DDL — **يُطابقُ عقدَ السوقِ حرفاً** بلا مفاتيحَ أجنبيّةٍ.
 *
 * ولمَ حرفاً؟ لأنّ `CREATE TABLE IF NOT EXISTS` **لا يفعلُ شيئاً** حينَ يكونُ الجدولُ
 * الحقيقيُّ موجوداً — كما في وظيفةِ القاعدةِ المشتركةِ (`M0-18`). فنسخةٌ ألينُ من العقدِ
 * (مفتاحٌ بقيمةٍ افتراضيّةٍ، وبلا قيودِ `CHECK`) تجعلُ المجموعةَ تنجحُ على قاعدةٍ نقيّةٍ
 * وتُخفِقُ على قاعدةٍ مشتركةٍ — **وهو ما وقعَ فعلاً** عندَ ضمِّ ساقِ البحثِ إلى السلسلةِ
 * 2026-09-08: `null value in column "outbox_id"`. والأسوأُ أنّها كانت تسمحُ ببذرِ حدثٍ
 * لا يستطيعُ السوقُ إصدارَه أصلاً، فتُقاسُ حالةٌ لا وجودَ لها.
 */
const MARKETPLACE_CONTRACT = readFileSync(
  resolve(__dirname, "../../../marketplace/contracts/schema.sql"),
  "utf8",
);

/*
 * RISK-0012 (CLM-0416 · ADR-057): the table AND its commit-order trigger are read
 * from the marketplace contract at runtime, so "verbatim" holds by construction.
 * The hand copy that stood here had already drifted (no `sequence_number`).
 */
function marketplaceOutboxDdl(): string {
  const create = /CREATE TABLE IF NOT EXISTS marketplace_outbox \([\s\S]*?\n\);/.exec(MARKETPLACE_CONTRACT);
  const order = /-- >>> RISK-0012 commit_sequence \(marketplace_outbox\)[\s\S]*?-- <<< RISK-0012 commit_sequence \(marketplace_outbox\)/.exec(
    MARKETPLACE_CONTRACT,
  );
  if (!create || !order) throw new Error("marketplace/contracts/schema.sql: marketplace_outbox DDL or its RISK-0012 block not found");
  return `${create[0]}\n${order[0]}\n`;
}

const OUTBOX_DDL = marketplaceOutboxDdl();

export interface PgFixture {
  readonly pool: Pool;
  readonly close: () => Promise<void>;
}

export async function applySearchSchema(pool: Pool): Promise<void> {
  await pool.query(OUTBOX_DDL);
  await pool.query(searchSchemaSql);
}

export async function resetData(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${SEARCH_TABLES.join(", ")}, marketplace_outbox RESTART IDENTITY CASCADE`);
}

export async function setupPostgres(): Promise<PgFixture> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: DATABASE_URL!, max: 4 });
  await applySearchSchema(pool);
  return { pool, close: () => pool.end() };
}

/** Seed an outbox row and return its outbox_id + created_at. */
export async function seedOutboxEvent(
  pool: Pool,
  event: {
    event_type: string;
    event_version?: string;
    aggregate_type: string;
    aggregate_id: string;
    payload: Record<string, unknown>;
    occurred_at?: string;
    created_at?: string;
  },
): Promise<{ outbox_id: string; created_at: string }> {
  const result = await pool.query<{ outbox_id: string; created_at: string }>(
    `INSERT INTO marketplace_outbox (outbox_id, event_type, event_version, aggregate_type, aggregate_id, payload, occurred_at, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING outbox_id::text, created_at::text`,
    [
      event.event_type,
      event.event_version ?? "v1",
      event.aggregate_type,
      event.aggregate_id,
      JSON.stringify(event.payload),
      event.occurred_at ?? new Date().toISOString(),
      event.created_at ?? new Date().toISOString(),
    ],
  );
  return result.rows[0];
}
