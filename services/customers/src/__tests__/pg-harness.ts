/**
 * Postgres harness for the Customer Core integration suites (MR 3/6).
 *
 * Two rules make these suites trustworthy:
 *
 *  1. **The schema is applied from the contract, never from Drizzle.** The
 *     harness DROPs the five tables and replays `contracts/schema.sql`. A test
 *     that built its tables from the Drizzle projection would pass while the
 *     contract said something else — which is the one thing these tests exist to
 *     catch.
 *  2. **Nothing is shared between test files.** `vitest.integration.config.ts`
 *     sets `fileParallelism: false` because every file here owns the schema of
 *     the same database.
 *
 * Skipped entirely when DATABASE_URL is unset, so `pnpm test:integration` is
 * safe to run on a machine with no database.
 *
 * Local run:
 *   DATABASE_URL=postgres://wasla:wasla@127.0.0.1:5432/wasla_customer_test \
 *     pnpm --filter @wasla/customers-service test:integration
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Pool } from "pg";

import {
  FakeGeography,
  FakeIdentityLookup,
  FixedClock,
  RecordingOrderIntake,
  SequentialIdGenerator,
} from "../infrastructure/in-memory.js";
import { createCustomerDb, type Db } from "../infrastructure/drizzle/db.js";
import {
  PostgresCustomerOutbox,
  PostgresCustomerRepository,
} from "../infrastructure/drizzle/repository.js";
import type { CustomerRepository, OrderIntakePort, Outbox } from "../ports.js";
import type { UseCaseDeps } from "../use-cases/deps.js";
import { CUSTOMER, OTHER_CUSTOMER, ZONES } from "./helpers.js";

export const DATABASE_URL = process.env.DATABASE_URL;
export const PG_ENABLED = Boolean(DATABASE_URL);

/** Reverse dependency order — the same order as the contract's rollback block. */
const TABLES = [
  "customer_outbox",
  "customer_order_request_stops",
  "customer_order_requests",
  "customer_saved_places",
  "customer_profiles",
] as const;

/** Drop everything and replay the canonical DDL. */
export async function applyCanonicalSchema(pool: Pool): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
  const sql = await readFile(resolve(process.cwd(), "contracts/schema.sql"), "utf-8");
  await pool.query(sql);
}

/** Empty every table between tests without touching the schema. */
export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

export interface PgFixture {
  pool: Pool;
  db: Db;
  repo: PostgresCustomerRepository;
  outbox: PostgresCustomerOutbox;
  close: () => Promise<void>;
}

/** Connect, reset the schema, and hand back the Postgres adapters. */
export async function setupPostgres(): Promise<PgFixture> {
  const { pool, db } = createCustomerDb({ connectionString: DATABASE_URL!, max: 4 });
  await applyCanonicalSchema(pool);
  return {
    pool,
    db,
    repo: new PostgresCustomerRepository(db),
    outbox: new PostgresCustomerOutbox(db),
    close: () => pool.end(),
  };
}

/**
 * Build use-case dependencies around any repository/outbox pair. The clock, the
 * id generator, identity and geography stay the deterministic fakes from
 * `helpers.ts`: the adapter under test must be the only difference between two
 * runs of the same scenario, otherwise a conformance failure would not point at
 * anything.
 */
export function makeDeps(options: {
  repo: CustomerRepository;
  outbox: Outbox;
  orderIntake?: OrderIntakePort;
  clock?: FixedClock;
}): UseCaseDeps & { clock: FixedClock; intake: RecordingOrderIntake } {
  const clock = options.clock ?? new FixedClock();
  const intake = new RecordingOrderIntake({ clock });
  return {
    repo: options.repo,
    outbox: options.outbox,
    clock,
    idGen: new SequentialIdGenerator(),
    identityLookup: new FakeIdentityLookup([CUSTOMER, OTHER_CUSTOMER]),
    geography: new FakeGeography(ZONES),
    orderIntake: options.orderIntake ?? intake,
    intake,
  };
}
