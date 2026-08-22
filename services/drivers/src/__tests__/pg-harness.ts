/**
 * Postgres harness for the drivers integration suites (Phase 05 · MR 3/6).
 *
 * Three rules make these suites trustworthy:
 *
 *  1. **The schema is applied from the contract, never from Drizzle.** The harness
 *     DROPs the tables and replays `contracts/schema.sql`. A test that built its
 *     tables from the Drizzle projection would pass while the contract said something
 *     else — the one thing these tests exist to catch. `schema-drift.test.ts` guards
 *     the other direction.
 *  2. **`resetData` truncates everything EXCEPT `driver_eligibility_policies`.** That
 *     table is not test data: version 1 `saudi-launch-v1` is a seed INSERT in the DDL
 *     (§5), which makes it contract data, and the whole eligibility calculator reads
 *     it through `EligibilityPolicyRepository.findActive()`. Truncating it would leave
 *     every subsequent test with `policyNotFound()` — and, worse, a green suite that
 *     merely proved registration fails. This is matching's precedent for its
 *     `matching_rulesets` seed, and the opposite of dispatch, whose DDL seeds nothing.
 *  3. **Nothing is shared between test files.** `vitest.integration.config.ts` sets
 *     `fileParallelism: false` because every file here owns the schema of the SAME
 *     database.
 *
 * Skipped entirely when DATABASE_URL is unset, so `pnpm test:integration` is safe to
 * run on a machine with no database.
 *
 * Local run:
 *   DATABASE_URL=postgres://wasla:wasla@127.0.0.1:5432/wasla_drivers_test \
 *     pnpm --filter @wasla/drivers-service test:integration
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

import { createDriverDb, type Db } from "../infrastructure/drizzle/db.js";
import {
  PostgresCandidacyPublicationRepository,
  PostgresDocumentRepository,
  PostgresDriverIdempotencyStore,
  PostgresDriverOutbox,
  PostgresDriverProfileRepository,
  PostgresEligibilityLogRepository,
  PostgresEligibilityPolicyRepository,
  PostgresServiceZoneRepository,
  PostgresVehicleRepository,
} from "../infrastructure/drizzle/repository.js";
import { PostgresDriverUnitOfWork } from "../infrastructure/drizzle/transaction.js";
import {
  FixedClock,
  InMemoryCandidacyProjectionPort,
  InMemoryZoneCatalogPort,
  SequentialIdGenerator,
} from "../infrastructure/in-memory.js";
import type { DriverDependencies } from "../ports.js";
import type { DriverSharedDeps } from "../infrastructure/drizzle/transaction.js";
import { NOW, ZONE_A, ZONE_B } from "./helpers.js";

/** Resolved from this file so the contract is found regardless of cwd. */
const SERVICE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const DATABASE_URL = process.env.DATABASE_URL;
export const PG_ENABLED = Boolean(DATABASE_URL);

/**
 * Reverse dependency order — documents drop before the vehicles and the profile they
 * point at.
 *
 * `CASCADE` would make the order irrelevant for the DROP, but not for the TRUNCATE
 * below, and one list that is correct for both is one fewer thing to keep in sync.
 */
const TABLES = [
  "driver_idempotency",
  "driver_outbox",
  "driver_candidacy_publications",
  "driver_eligibility_log",
  "driver_documents",
  "driver_vehicles",
  "driver_service_zones",
  "driver_eligibility_policies",
  "driver_profiles",
] as const;

/**
 * The tables `resetData` empties — everything except the policy seed (rule 2).
 *
 * Derived from `TABLES` rather than written out a second time: a table added to the
 * DDL and to `TABLES` but forgotten here would leak rows between tests, and the
 * symptom (one test that passes alone and fails in the suite) is among the most
 * expensive to diagnose.
 */
const TRUNCATED = TABLES.filter((table) => table !== "driver_eligibility_policies");

/** Drop everything and replay the canonical DDL. */
export async function applyCanonicalSchema(pool: Pool): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
  const sql = await readFile(path.join(SERVICE_ROOT, "contracts", "schema.sql"), "utf-8");
  await pool.query(sql);
}

/** Empty every table between tests, keeping the schema and the policy seed. */
export async function resetData(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${TRUNCATED.join(", ")} RESTART IDENTITY CASCADE`);
}

export interface PgFixture {
  pool: Pool;
  db: Db;
  profiles: PostgresDriverProfileRepository;
  zones: PostgresServiceZoneRepository;
  vehicles: PostgresVehicleRepository;
  documents: PostgresDocumentRepository;
  policies: PostgresEligibilityPolicyRepository;
  eligibilityLog: PostgresEligibilityLogRepository;
  publications: PostgresCandidacyPublicationRepository;
  outbox: PostgresDriverOutbox;
  idempotency: PostgresDriverIdempotencyStore;
  unitOfWork: PostgresDriverUnitOfWork;
  close: () => Promise<void>;
}

/** Connect, reset the schema, and hand back the Postgres adapters. */
export async function setupPostgres(): Promise<PgFixture> {
  const { pool, db } = createDriverDb({
    connectionString: DATABASE_URL!,
    max: 4,
  });
  await applyCanonicalSchema(pool);
  return {
    pool,
    db,
    profiles: new PostgresDriverProfileRepository(db),
    zones: new PostgresServiceZoneRepository(db),
    vehicles: new PostgresVehicleRepository(db),
    documents: new PostgresDocumentRepository(db),
    policies: new PostgresEligibilityPolicyRepository(db),
    eligibilityLog: new PostgresEligibilityLogRepository(db),
    publications: new PostgresCandidacyPublicationRepository(db),
    outbox: new PostgresDriverOutbox(db),
    idempotency: new PostgresDriverIdempotencyStore(db),
    unitOfWork: new PostgresDriverUnitOfWork(db),
    close: () => pool.end(),
  };
}

/**
 * The in-memory environment with its nine storage adapters swapped for Postgres ones —
 * everything else identical.
 *
 * This is what makes `port-conformance.integration.test.ts` a real comparison: the
 * clock, the id generator and both fake ports are the SAME classes the pure tests
 * use, so the only variable between the two runs is the storage adapter. A conformance
 * test that also swapped the clock would report differences it created itself.
 *
 * `zoneCatalog` is seeded with the same two zones `helpers.environment()` seeds, for
 * the same reason: the port is fail-closed, so an unseeded catalog turns every
 * `setServiceZones` into `zoneUnknown()`.
 */
export interface PgHarness {
  readonly deps: DriverDependencies;
  /**
   * The same four non-transactional dependencies, in the shape
   * `PostgresDriverUnitOfWork.run()` takes. Exposed so the atomicity suite does not
   * rebuild the object at every call site — six hand-written copies of one literal is
   * six chances for one of them to drift and for a test to silently exercise a
   * different clock than the one it asserts against.
   */
  readonly shared: DriverSharedDeps;
  readonly clock: FixedClock;
  readonly candidacy: InMemoryCandidacyProjectionPort;
  readonly zoneCatalog: InMemoryZoneCatalogPort;
}

export function createPgHarness(fixture: PgFixture, now = NOW): PgHarness {
  const clock = new FixedClock(now);
  const candidacy = new InMemoryCandidacyProjectionPort();
  const zoneCatalog = new InMemoryZoneCatalogPort();
  zoneCatalog.seed(ZONE_A, ZONE_B);
  const deps: DriverDependencies = {
    profiles: fixture.profiles,
    zones: fixture.zones,
    vehicles: fixture.vehicles,
    documents: fixture.documents,
    policies: fixture.policies,
    eligibilityLog: fixture.eligibilityLog,
    publications: fixture.publications,
    candidacy,
    zoneCatalog,
    outbox: fixture.outbox,
    idempotency: fixture.idempotency,
    clock,
    ids: new SequentialIdGenerator(),
  };
  const shared: DriverSharedDeps = { candidacy, zoneCatalog, clock, ids: deps.ids };
  return { deps, shared, clock, candidacy, zoneCatalog };
}
