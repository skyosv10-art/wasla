/**
 * Postgres harness for the Order Engine integration suites (MR 3/6).
 *
 * Two rules make these suites trustworthy:
 *
 *  1. **The schema is applied from the contract, never from Drizzle.** The
 *     harness DROPs the tables and replays `contracts/schema.sql`. A test that
 *     built its tables from the Drizzle projection would pass while the contract
 *     said something else — which is the one thing these tests exist to catch.
 *  2. **Nothing is shared between test files.** `vitest.integration.config.ts`
 *     sets `fileParallelism: false` because every file here owns the schema of
 *     the same database.
 *
 * Skipped entirely when DATABASE_URL is unset, so `pnpm test:integration` is
 * safe to run on a machine with no database.
 *
 * Local run:
 *   DATABASE_URL=postgres://wasla:wasla@127.0.0.1:5432/wasla_orders_test \
 *     pnpm --filter @wasla/orders-service test:integration
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Pool } from "pg";

import { createOrderDb, type Db } from "../infrastructure/drizzle/db.js";
import {
  PostgresOrderOutbox,
  PostgresOrderPublicIdGenerator,
  PostgresOrderRepository,
} from "../infrastructure/drizzle/repository.js";
import { PostgresOrderUnitOfWork } from "../infrastructure/drizzle/transaction.js";

export const DATABASE_URL = process.env.DATABASE_URL;
export const PG_ENABLED = Boolean(DATABASE_URL);

/** Reverse dependency order — the same order as the contract's rollback block. */
const TABLES = [
  "order_outbox",
  "order_assignments",
  "order_status_history",
  "order_stops",
  "orders",
] as const;

/** Drop everything and replay the canonical DDL. */
export async function applyCanonicalSchema(pool: Pool): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
  const sql = await readFile(resolve(process.cwd(), "contracts/schema.sql"), "utf-8");
  await pool.query(sql);
}

/** Empty every table between tests without touching the schema. */
export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

export interface PgFixture {
  pool: Pool;
  db: Db;
  repo: PostgresOrderRepository;
  outbox: PostgresOrderOutbox;
  publicIds: PostgresOrderPublicIdGenerator;
  unitOfWork: PostgresOrderUnitOfWork;
  close: () => Promise<void>;
}

/** Connect, reset the schema, and hand back the Postgres adapters. */
export async function setupPostgres(): Promise<PgFixture> {
  const { pool, db } = createOrderDb({ connectionString: DATABASE_URL!, max: 4 });
  await applyCanonicalSchema(pool);
  return {
    pool,
    db,
    repo: new PostgresOrderRepository(db),
    outbox: new PostgresOrderOutbox(db),
    publicIds: new PostgresOrderPublicIdGenerator(db),
    unitOfWork: new PostgresOrderUnitOfWork(db),
    close: () => pool.end(),
  };
}
