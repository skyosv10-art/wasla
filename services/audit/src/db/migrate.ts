/**
 * Migration: applies `contracts/schema.sql` to the given pool.
 *
 * The schema is `CREATE … IF NOT EXISTS`, so running it twice is safe.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

const SERVICE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const SCHEMA_CONTRACT_PATH = join(SERVICE_ROOT, "contracts", "schema.sql");

export function readSchemaContract(): string {
  return readFileSync(SCHEMA_CONTRACT_PATH, "utf8");
}

export async function applyAuditSchema(pool: Pool): Promise<void> {
  await pool.query(readSchemaContract());
}
