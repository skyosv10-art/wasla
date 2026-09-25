/**
 * Shared PostgreSQL pool helper for the partners service.
 *
 * The pool is created once and shared across all infrastructure adapters.
 * Each adapter takes a `Pool` (or `PoolClient` for testing) — no global state.
 */

import { Pool } from "pg";

export type { Pool, PoolClient } from "pg";

export function createPartnersPool(): Pool {
  const connectionString = process.env.PARTNERS_DATABASE_URL;
  if (!connectionString) {
    throw new Error("PARTNERS_DATABASE_URL is required to start the partners service");
  }
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30000 });
}

/**
 * Generate a UUID v4 using crypto.randomUUID (Node 18+).
 */
export function newUuid(): string {
  return crypto.randomUUID();
}

/**
 * Current ISO timestamp for DB operations.
 */
export function nowIso(): string {
  return new Date().toISOString();
}
