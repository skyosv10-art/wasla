/**
 * Postgres connection for the Order Engine service.
 *
 * node-postgres (`pg`) + drizzle-orm/node-postgres, mirroring the customer,
 * geography and identity services so one operational runbook covers all of them.
 * The canonical DDL (contracts/schema.sql) creates the tables; this module only
 * wires the pool.
 *
 * Unlike the customer service, the order engine MINTS its own public id from
 * `order_public_id_seq` (ADR-010 §1). The sequence lives in the same database, so
 * the public-id generator (`PostgresOrderPublicIdGenerator`, in repository.ts) is
 * constructed against this same `Db`.
 *
 * Atomicity (ADR-010 §127): every status change + audit row + outbox event is one
 * transaction. A repository method cannot keep a transaction open across the
 * subsequent `outbox.append()` call, so the transaction boundary wraps the whole
 * application operation through `PostgresOrderUnitOfWork` (transaction.ts). For
 * that to work, both `PostgresOrderRepository` and `PostgresOrderOutbox` accept a
 * `Db`-or-transaction handle — this file exposes the union type they share.
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg, { type Pool } from "pg";

import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

/**
 * A Drizzle handle that may be either the root database or an open transaction.
 *
 * `NodePgDatabase` is callable (`db.transaction(...)`), and a transaction tx is the
 * same type minus the `transaction` method. Both expose `select/insert/update/
 * delete`, which is all the repository and outbox use. Typing the handle as the
 * base `Db` lets one adapter class serve both the root and a tx, so the Unit of
 * Work can hand the same tx to both `PostgresOrderRepository` and
 * `PostgresOrderOutbox` and the triple write shares one transaction.
 */
export type DbOrTx = Db;

export interface DbConfig {
  /** Postgres connection string (e.g. postgres://user:pass@host:5432/db). */
  connectionString: string;
  /** Max pool connections. */
  max?: number;
}

/** Create the drizzle DB together with its underlying pg pool. */
export function createOrderDb(config: DbConfig): { pool: Pool; db: Db } {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
