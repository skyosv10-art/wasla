/**
 * Postgres connection for the dispatch service (Phase 07 · MR 5a/6).
 *
 * node-postgres (`pg`) + drizzle-orm/node-postgres, mirroring identity, geography,
 * channel, customers, orders and matching so one operational runbook covers every
 * service. The canonical DDL (`contracts/schema.sql`) creates the tables; this
 * module only wires the pool.
 *
 * Atomicity (schema.sql §4 · ADR-011): a single tick writes a wave row, several
 * offer rows, a job status change and several outbox events through separate port
 * calls. An adapter that opened and committed its own transaction per call could
 * never cover the calls that follow it, and a crash in the middle would leave an
 * open wave with no offers — which the partial unique index
 * `ux_dispatch_waves_one_open_job` then keeps forever, because nothing would ever
 * close it. The transaction boundary therefore wraps the whole application
 * operation through `PostgresDispatchUnitOfWork` (transaction.ts), and every
 * adapter here accepts a `Db`-or-transaction handle — which is what this file's
 * union type names.
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg, { type Pool } from "pg";

import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

/**
 * A Drizzle handle that may be either the root database or an open transaction.
 *
 * A transaction handle is the same type minus `transaction`, and both expose
 * `select/insert/update/delete` — all the adapters use. Typing the handle as the
 * base `Db` lets one adapter class serve both, so the Unit of Work can hand the
 * SAME tx to the four repositories and the outbox, and their writes share one
 * transaction.
 */
export type DbOrTx = Db;

export interface DbConfig {
  /** Postgres connection string (e.g. postgres://user:pass@host:5432/db). */
  connectionString: string;
  /** Max pool connections. */
  max?: number;
}

/** Create the drizzle DB together with its underlying pg pool. */
export function createDispatchDb(config: DbConfig): { pool: Pool; db: Db } {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
