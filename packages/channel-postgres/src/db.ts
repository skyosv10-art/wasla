/**
 * Postgres connection wiring for the channel layer.
 *
 * node-postgres (`pg`) + drizzle-orm/node-postgres, exactly like
 * `services/geography/src/infrastructure/drizzle/db.ts` — one connection pattern
 * per repository, so operating one service teaches you how to operate the rest.
 *
 * This module only wires a connection: the tables are created by the canonical
 * DDL (`packages/channel-core/contracts/schema.sql`), never by application code.
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg, { type Pool } from "pg";
import { guardPgPool, withPgPoolDefaults } from "@wasla/resilience";

import * as schema from "./schema.js";

export type ChannelDb = NodePgDatabase<typeof schema>;

export interface ChannelDbConfig {
  /** Postgres connection string (e.g. postgres://user:pass@host:5432/db). */
  readonly connectionString: string;
  /** Max pool connections. */
  readonly max?: number;
}

/** Create the drizzle handle plus the pool that owns its sockets. */
export function createChannelDb(config: ChannelDbConfig): { pool: Pool; db: ChannelDb } {
  // RISK-0058 · ADR-059: bounded connect/query time, error listeners and a circuit breaker.
  const pool = guardPgPool(
    new pg.Pool(
      withPgPoolDefaults({
        connectionString: config.connectionString,
        max: config.max ?? 10,
      }),
    ),
    { name: "channel-postgres" },
  );
  const db = drizzle(pool, { schema });
  return { pool, db };
}
