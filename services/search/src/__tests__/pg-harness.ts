/**
 * PostgreSQL harness for search service integration tests.
 *
 * The relay reads `marketplace_outbox` (marketplace schema) and writes the
 * search projection (search schema). For integration tests we need BOTH in
 * one test DB: a minimal `marketplace_outbox` table (matching the marketplace
 * contract — no FKs) to seed events, plus the full search schema.
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

/** Minimal marketplace_outbox DDL matching the marketplace contract (no FKs). */
const OUTBOX_DDL = `
CREATE TABLE IF NOT EXISTS marketplace_outbox (
    outbox_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type     TEXT        NOT NULL,
    event_version  TEXT        NOT NULL,
    aggregate_type TEXT        NOT NULL,
    aggregate_id   TEXT        NOT NULL,
    payload        JSONB       NOT NULL,
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
`;

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
    `INSERT INTO marketplace_outbox (event_type, event_version, aggregate_type, aggregate_id, payload, occurred_at, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
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
