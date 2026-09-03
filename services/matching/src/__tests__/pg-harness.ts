/**
 * Postgres harness for the matching integration suites (Phase 07 · MR 3/6).
 *
 * Three rules make these suites trustworthy:
 *
 *  1. **The schema is applied from the contract, never from Drizzle.** The harness
 *     DROPs the tables and replays `contracts/schema.sql`. A test that built its
 *     tables from the Drizzle projection would pass while the contract said
 *     something else — the one thing these tests exist to catch.
 *  2. **The seeded ruleset survives the reset.** `resetData` truncates the data
 *     tables and deletes only the ruleset versions a test added; version 1 is
 *     part of the CONTRACT (a seed INSERT in schema.sql), not test data, and a
 *     suite that truncated it would be testing a service with no rules.
 *  3. **Nothing is shared between test files.** `vitest.integration.config.ts`
 *     sets `fileParallelism: false` because every file here owns the schema of the
 *     same database.
 *
 * Skipped entirely when DATABASE_URL is unset, so `pnpm test:integration` is safe
 * to run on a machine with no database.
 *
 * Local run:
 *   DATABASE_URL=postgres://wasla:wasla@127.0.0.1:5432/wasla_matching_test \
 *     pnpm --filter @wasla/matching-service test:integration
 */

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

import { RULESET_V1_VERSION } from "../domain/ruleset.js";
import { createMatchingDb, type Db } from "../infrastructure/drizzle/db.js";
import {
  PostgresCandidacyRepository,
  PostgresDecisionRepository,
  PostgresIdempotencyStore,
  PostgresMatchingOutbox,
  PostgresRulesetRepository,
} from "../infrastructure/drizzle/repository.js";
import { PostgresMatchingUnitOfWork } from "../infrastructure/drizzle/transaction.js";

/** Resolved from this file so the contract is found regardless of cwd. */
const SERVICE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const DATABASE_URL = process.env.DATABASE_URL;
export const PG_ENABLED = Boolean(DATABASE_URL);

/**
 * The tables the contract declares, parsed from `contracts/schema.sql` at load
 * time. (M0-18)
 *
 * The integration suite must be able to say "every table the contract declares
 * exists" WITHOUT reading tables that belong to another service — a shared test
 * database is declared safe by `docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md` §3,
 * and an assertion that read all of `public` turned "does the contract hold?"
 * into "is this service alone in the database?" (`RISK-0014`).
 *
 * It is PARSED, not written out by hand: a list typed here could keep guarding a
 * table the contract had already dropped, which is the exact drift these suites
 * exist to catch. The regex is the same shape `schema-drift.test.ts` uses, so
 * both read the contract the one way.
 */
export const CONTRACT_TABLES: readonly string[] = (() => {
  const sql = readFileSync(path.join(SERVICE_ROOT, "contracts", "schema.sql"), "utf8");
  const found = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gu)].map((m) => m[1]!);
  const unique = [...new Set(found)].sort();
  if (unique.length === 0) {
    throw new Error("contracts/schema.sql declared no tables — the parse, not the contract, is wrong");
  }
  return unique;
})();

/** Reverse dependency order — a decision's score rows drop before the decision. */
const TABLES = [
  "matching_idempotency",
  "matching_outbox",
  "matching_decision_candidates",
  "matching_decisions",
  "matching_rulesets",
  "driver_candidacy",
] as const;

/** Tables whose contents are test data (matching_rulesets is contract data). */
const DATA_TABLES = [
  "matching_idempotency",
  "matching_outbox",
  "matching_decision_candidates",
  "matching_decisions",
  "driver_candidacy",
] as const;

/** Drop everything and replay the canonical DDL. */
export async function applyCanonicalSchema(pool: Pool): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
  const sql = await readFile(path.join(SERVICE_ROOT, "contracts", "schema.sql"), "utf-8");
  await pool.query(sql);
}

/** Empty the data tables between tests, keeping the schema and the seeded ruleset. */
export async function resetData(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${DATA_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  await pool.query("DELETE FROM matching_rulesets WHERE version <> $1", [
    RULESET_V1_VERSION,
  ]);
}

export interface PgFixture {
  pool: Pool;
  db: Db;
  candidacy: PostgresCandidacyRepository;
  rulesets: PostgresRulesetRepository;
  decisions: PostgresDecisionRepository;
  outbox: PostgresMatchingOutbox;
  idempotency: PostgresIdempotencyStore;
  unitOfWork: PostgresMatchingUnitOfWork;
  close: () => Promise<void>;
}

/** Connect, reset the schema, and hand back the Postgres adapters. */
export async function setupPostgres(): Promise<PgFixture> {
  const { pool, db } = createMatchingDb({
    connectionString: DATABASE_URL!,
    max: 4,
  });
  await applyCanonicalSchema(pool);
  return {
    pool,
    db,
    candidacy: new PostgresCandidacyRepository(db),
    rulesets: new PostgresRulesetRepository(db),
    decisions: new PostgresDecisionRepository(db),
    outbox: new PostgresMatchingOutbox(db),
    idempotency: new PostgresIdempotencyStore(db),
    unitOfWork: new PostgresMatchingUnitOfWork(db),
    close: () => pool.end(),
  };
}
