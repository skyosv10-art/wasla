/**
 * pg-harness for partners service integration tests.
 *
 * Applies the schema from contracts/schema.sql directly — no separate
 * migration runner yet (deferred to a later review).
 *
 * Tests skip when DATABASE_URL is not set.
 */

import type { Pool } from "pg";
import { Pool as PgPool } from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DATABASE_URL = process.env.DATABASE_URL || process.env.PARTNERS_DATABASE_URL;
export const PG_ENABLED = Boolean(DATABASE_URL);

export const TABLES = [
  "partner_audit_log",
  "partner_usage_counters",
  "partner_webhooks",
  "partner_api_credentials",
  "partner_lifecycle",
] as const;

export interface PgFixture {
  readonly pool: Pool;
  readonly close: () => Promise<void>;
}

export function readSchemaSql(): string {
  return readFileSync(
    join(__dirname, "..", "..", "contracts", "schema.sql"),
    "utf-8",
  );
}

export async function resetSchema(pool: Pool): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
  await pool.query(readSchemaSql());
}

export async function resetData(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

export async function setupPostgres(): Promise<PgFixture> {
  const pool = new PgPool({ connectionString: DATABASE_URL!, max: 4 });
  await resetSchema(pool);
  return { pool, close: () => pool.end() };
}

export async function countRows(pool: Pool, table: (typeof TABLES)[number]): Promise<number> {
  const result = await pool.query<{ readonly count: string }>(
    `SELECT count(*)::text AS count FROM ${table}`,
  );
  return Number(result.rows[0]?.count ?? "0");
}

export async function tableNames(pool: Pool): Promise<ReadonlyArray<string>> {
  const result = await pool.query<{ readonly tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename`,
  );
  return result.rows.map((row) => row.tablename);
}

export async function constraintNames(pool: Pool): Promise<ReadonlyArray<string>> {
  const result = await pool.query<{ readonly conname: string }>(
    `SELECT c.conname AS conname
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = ANY($1::text[])
      ORDER BY c.conname`,
    [[...TABLES]],
  );
  return result.rows.map((row) => row.conname);
}
