/**
 * Postgres connection for the matching service (Phase 07 · MR 3/6).
 *
 * node-postgres (`pg`) + drizzle-orm/node-postgres, mirroring identity,
 * geography, channel, customers and orders so one operational runbook covers
 * every service. The canonical DDL (`contracts/schema.sql`) creates the tables;
 * this module only wires the pool.
 *
 * Atomicity (ADR-011 · schema.sql §5: "events are written in the transaction of
 * the change itself"): a use case calls `decisions.append()` and then
 * `outbox.append()` as two separate port calls, so an adapter that opened and
 * committed its own transaction per call could never cover the second one. The
 * transaction boundary therefore wraps the whole application operation through
 * `PostgresMatchingUnitOfWork` (transaction.ts), and every adapter here accepts
 * a `Db`-or-transaction handle — which is what this file's union type names.
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
 * SAME tx to the repository and to the outbox and the two writes share one
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
export function createMatchingDb(config: DbConfig): { pool: Pool; db: Db } {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
