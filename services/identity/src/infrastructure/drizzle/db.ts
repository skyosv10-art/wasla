/**
 * Postgres connection setup for the Identity service.
 *
 * Uses node-postgres (`pg`) + drizzle-orm/node-postgres. The canonical DDL
 * (schema.sql) creates the tables; this module only wires the connection and
 * the wasla_public_id sequence (an implementation detail that schema.sql
 * leaves to the implementation).
 */

import pg, { type Pool } from "pg";
import { guardPgPool, withPgPoolDefaults } from "@wasla/resilience";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

export interface DbConfig {
  /** Postgres connection string (e.g. postgres://user:pass@host:5432/db). */
  connectionString: string;
  /** Max pool clients — default bounded by `WASLA_PG_POOL_MAX` (RISK-0067), see `withPgPoolDefaults`. */
  max?: number;
}

/** Create the drizzle DB + underlying pg pool. */
export function createDb(config: DbConfig): { pool: Pool; db: Db } {
  // RISK-0058 · ADR-059: bounded connect/query time, error listeners and a circuit breaker.
  const pool = guardPgPool(
    new pg.Pool(
      withPgPoolDefaults({
        connectionString: config.connectionString,
        max: config.max,
      }),
    ),
    { name: "identity" },
  );
  const db = drizzle(pool, { schema });
  return { pool, db };
}

/**
 * Ensure the wasla_public_id sequence exists. Per schema.sql, the Public ID
 * format is `WS-[0-9]{10}` and generation is left to the implementation; this
 * sequence backs PostgresPublicIdSequence. Idempotent.
 */
export async function ensurePublicIdSequence(db: Db): Promise<void> {
  await db.execute(
    sql`CREATE SEQUENCE IF NOT EXISTS wasla_public_id_seq START 1`,
  );
}
