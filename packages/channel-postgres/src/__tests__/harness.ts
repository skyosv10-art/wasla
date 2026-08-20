/**
 * Shared setup for the Postgres integration suite.
 *
 * The canonical DDL lives with the core's contract
 * (`packages/channel-core/contracts/schema.sql`) — the adapter package never
 * defines tables of its own, it applies the contract. Each file drops the three
 * channel tables and re-applies that file, so a test run always starts from the
 * published schema and never from leftovers of a previous run.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Pool } from "pg";

/** Resolved from the package root (`pnpm --filter … test:integration`). */
export const CHANNEL_SCHEMA_SQL = resolve(process.cwd(), "../channel-core/contracts/schema.sql");

/** Dropped in dependency-free order (the contract has no FKs between them). */
export const CHANNEL_TABLES = "channel_outbox, channel_deliveries, channel_updates";

/** Drop the channel tables and re-apply the canonical DDL. */
export async function resetChannelSchema(pool: Pool): Promise<void> {
  const ddl = await readFile(CHANNEL_SCHEMA_SQL, "utf8");
  await pool.query(`DROP TABLE IF EXISTS ${CHANNEL_TABLES} CASCADE`);
  await pool.query(ddl);
}

/** Empty the channel tables between tests without re-applying the DDL. */
export async function truncateChannelTables(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${CHANNEL_TABLES}`);
}
