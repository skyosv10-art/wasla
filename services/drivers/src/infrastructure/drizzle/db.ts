/**
 * Postgres connection for the Driver Core service (Phase 05 · MR 3/6).
 *
 * node-postgres (`pg`) + drizzle-orm/node-postgres, mirroring identity, geography,
 * channel, customers, orders, matching and dispatch so one operational runbook
 * covers every service. The canonical DDL (`contracts/schema.sql`) creates the
 * tables; this module only wires the pool.
 *
 * Atomicity (ADR-012 · schema.sql §8): a single driver write is never one row. A
 * document submission supersedes the live copy, inserts the new one, remembers the
 * idempotency fingerprint, may rewrite `verification_status`, appends an outbox
 * event, then recomputes eligibility — which itself writes `eligibility_recheck_at`,
 * a log row, a second outbox event, a publication row and `last_published_state`.
 * That is up to nine writes across six tables through six separate port calls. An
 * adapter that opened and committed its own transaction per call could never cover
 * the calls that follow it, and a crash in the middle would leave the state this
 * service exists to prevent: a document `superseded` with no replacement, or a
 * verified document with no eligibility log row explaining what it changed.
 *
 * The transaction boundary therefore wraps the whole application operation through
 * `PostgresDriverUnitOfWork` (transaction.ts), and every adapter here accepts a
 * `Db`-or-transaction handle — which is what this file's union type names.
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
 * SAME tx to all nine repositories and their writes share one transaction.
 */
export type DbOrTx = Db;

export interface DbConfig {
  /** Postgres connection string (e.g. postgres://user:pass@host:5432/db). */
  connectionString: string;
  /** Max pool connections. */
  max?: number;
}

/** Create the drizzle DB together with its underlying pg pool. */
export function createDriverDb(config: DbConfig): { pool: Pool; db: Db } {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
