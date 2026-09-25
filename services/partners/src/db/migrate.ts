/**
 * Partners migration: applies `contracts/schema.sql` verbatim.
 *
 * The contract text is all `CREATE … IF NOT EXISTS`, so running it twice is
 * safe. This is the same pattern used by the search service (ADR-024).
 *
 * No Drizzle in the execution here: `pool.query(ddl)` executes the text as-is.
 * No env reading here: `connectionString` is a parameter, and the contract
 * path is derived from this file's location, not from `cwd`. The only env
 * reader is `migrate-cli.ts`.
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

export async function applyPartnersSchema(pool: Pool): Promise<void> {
  await pool.query(readSchemaContract());
}
