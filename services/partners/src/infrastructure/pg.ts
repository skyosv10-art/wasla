/**
 * Shared PostgreSQL pool helper for the partners service.
 *
 * The pool is created once and shared across all infrastructure adapters.
 * Each adapter takes a `Pool` (or `PoolClient` for testing) — no global state.
 */

import { Pool } from "pg";
import { guardPgPool, withPgPoolDefaults } from "@wasla/resilience";

export type { Pool, PoolClient } from "pg";

export function createPartnersPool(): Pool {
  const connectionString = process.env.PARTNERS_DATABASE_URL;
  if (!connectionString) {
    throw new Error("PARTNERS_DATABASE_URL is required to start the partners service");
  }
  // RISK-0058 · ADR-059: bounded connect/query time, error listeners and a circuit breaker.
  return guardPgPool(new Pool(withPgPoolDefaults({ connectionString, idleTimeoutMillis: 30000 })), {
    name: "partners",
  });
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
