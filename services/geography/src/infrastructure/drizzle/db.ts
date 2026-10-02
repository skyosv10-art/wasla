/**
 * Postgres connection setup for the Geography service.
 *
 * Uses node-postgres (`pg`) + drizzle-orm/node-postgres. The canonical DDL
 * (schema.sql) creates the tables; this module only wires the connection.
 * Geography does NOT generate Wasla Public IDs (it references existing ones
 * from the identity service as an opaque reference), so no public-id sequence
 * is needed here (unlike the identity service).
 */

import pg, { type Pool } from "pg";
import { guardPgPool, withPgPoolDefaults } from "@wasla/resilience";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

export interface DbConfig {
  /** Postgres connection string (e.g. postgres://user:pass@host:5432/db). */
  connectionString: string;
  /** Max pool connections. */
  max?: number;
}

/** Create the drizzle DB + underlying pg pool. */
export function createDb(config: DbConfig): { pool: Pool; db: Db } {
  // RISK-0058 · ADR-059: bounded connect/query time, error listeners and a circuit breaker.
  const pool = guardPgPool(
    new pg.Pool(
      withPgPoolDefaults({
        connectionString: config.connectionString,
        max: config.max ?? 10,
      }),
    ),
    { name: "geography" },
  );
  const db = drizzle(pool, { schema });
  return { pool, db };
}
