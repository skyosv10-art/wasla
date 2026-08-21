/**
 * Postgres connection for the Customer Core service.
 *
 * node-postgres (`pg`) + drizzle-orm/node-postgres, mirroring the geography and
 * identity services so one operational runbook covers all of them. The canonical
 * DDL (contracts/schema.sql) creates the tables; this module only wires the pool.
 *
 * The service mints no Wasla Public ID: it stores an opaque reference minted by
 * the identity service (ADR-009 §2), so there is no sequence to configure here.
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg, { type Pool } from "pg";

import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

export interface DbConfig {
  /** Postgres connection string (e.g. postgres://user:pass@host:5432/db). */
  connectionString: string;
  /** Max pool connections. */
  max?: number;
}

/** Create the drizzle DB together with its underlying pg pool. */
export function createCustomerDb(config: DbConfig): { pool: Pool; db: Db } {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
