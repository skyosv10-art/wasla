/**
 * Postgres harness for the dispatch integration suites (Phase 07 · MR 5a/6).
 *
 * Three rules make these suites trustworthy:
 *
 *  1. **The schema is applied from the contract, never from Drizzle.** The harness
 *     DROPs the tables and replays `contracts/schema.sql`. A test that built its
 *     tables from the Drizzle projection would pass while the contract said
 *     something else — the one thing these tests exist to catch. `schema-drift.test.ts`
 *     guards the other direction.
 *  2. **`resetData` truncates everything.** Unlike matching, whose `matching_rulesets`
 *     version 1 is a seed INSERT in the DDL and therefore contract data, dispatch's
 *     DDL seeds no rows: every row in these five tables is test data. Rules reach the
 *     domain through `RulesProvider`, not through a table.
 *  3. **Nothing is shared between test files.** `vitest.integration.config.ts` sets
 *     `fileParallelism: false` because every file here owns the schema of the same
 *     database.
 *
 * Skipped entirely when DATABASE_URL is unset, so `pnpm test:integration` is safe to
 * run on a machine with no database.
 *
 * Local run:
 *   DATABASE_URL=postgres://wasla:wasla@127.0.0.1:5432/wasla_dispatch_test \
 *     pnpm --filter @wasla/dispatch-service test:integration
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

import { createDispatchDb, type Db } from "../infrastructure/drizzle/db.js";
import {
  PostgresDispatchIdempotencyStore,
  PostgresDispatchOutbox,
  PostgresJobRepository,
  PostgresOfferRepository,
  PostgresWaveRepository,
} from "../infrastructure/drizzle/repository.js";
import { PostgresDispatchUnitOfWork } from "../infrastructure/drizzle/transaction.js";
import { FixedClock, SequentialIdGenerator, StaticRulesProvider } from "../infrastructure/in-memory.js";
import type { DispatchDependencies } from "../ports.js";
import { FakeMatching, FakeOrderEngine, TEST_RULES } from "./harness.js";
import type { DispatchRules } from "../domain/model.js";

/** Resolved from this file so the contract is found regardless of cwd. */
const SERVICE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const DATABASE_URL = process.env.DATABASE_URL;
export const PG_ENABLED = Boolean(DATABASE_URL);

/**
 * Reverse dependency order — offers drop before the wave and the job they point at.
 *
 * `CASCADE` would make the order irrelevant for the DROP, but not for the TRUNCATE
 * below, and one list that is correct for both is one fewer thing to keep in sync.
 */
const TABLES = [
  "dispatch_idempotency",
  "dispatch_outbox",
  "dispatch_offers",
  "dispatch_waves",
  "dispatch_jobs",
] as const;

/** Drop everything and replay the canonical DDL. */
export async function applyCanonicalSchema(pool: Pool): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
  const sql = await readFile(path.join(SERVICE_ROOT, "contracts", "schema.sql"), "utf-8");
  await pool.query(sql);
}

/**
 * Empty every table between tests, keeping the schema.
 *
 * Nothing is preserved because the dispatch DDL seeds nothing — see rule 2 above.
 */
export async function resetData(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

export interface PgFixture {
  pool: Pool;
  db: Db;
  jobs: PostgresJobRepository;
  waves: PostgresWaveRepository;
  offers: PostgresOfferRepository;
  outbox: PostgresDispatchOutbox;
  idempotency: PostgresDispatchIdempotencyStore;
  unitOfWork: PostgresDispatchUnitOfWork;
  close: () => Promise<void>;
}

/** Connect, reset the schema, and hand back the Postgres adapters. */
export async function setupPostgres(): Promise<PgFixture> {
  const { pool, db } = createDispatchDb({
    connectionString: DATABASE_URL!,
    max: 4,
  });
  await applyCanonicalSchema(pool);
  return {
    pool,
    db,
    jobs: new PostgresJobRepository(db),
    waves: new PostgresWaveRepository(db),
    offers: new PostgresOfferRepository(db),
    outbox: new PostgresDispatchOutbox(db),
    idempotency: new PostgresDispatchIdempotencyStore(db),
    unitOfWork: new PostgresDispatchUnitOfWork(db),
    close: () => pool.end(),
  };
}

/**
 * The unit-test harness with its four in-memory repositories swapped for Postgres
 * ones — everything else identical.
 *
 * This is what makes `port-conformance.integration.test.ts` a real comparison: the
 * clock, the id generator, the rules and both fake ports are the SAME classes the
 * pure tests use, so the only variable between the two runs is the storage adapter.
 * A conformance test that also swapped the clock would report differences it created
 * itself.
 */
export interface PgHarness {
  readonly deps: DispatchDependencies;
  readonly clock: FixedClock;
  readonly orders: FakeOrderEngine;
  readonly matching: FakeMatching;
  readonly rules: StaticRulesProvider;
}

export function createPgHarness(fixture: PgFixture, rules: DispatchRules = TEST_RULES): PgHarness {
  const clock = new FixedClock();
  const orders = new FakeOrderEngine();
  const matching = new FakeMatching();
  const rulesProvider = new StaticRulesProvider(rules);
  const deps: DispatchDependencies = {
    jobs: fixture.jobs,
    waves: fixture.waves,
    offers: fixture.offers,
    outbox: fixture.outbox,
    idempotency: fixture.idempotency,
    matching,
    orders,
    rules: rulesProvider,
    clock,
    ids: new SequentialIdGenerator(),
  };
  return { deps, clock, orders, matching, rules: rulesProvider };
}
