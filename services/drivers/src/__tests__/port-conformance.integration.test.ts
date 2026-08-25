/**
 * Port conformance: the in-memory adapters and the Postgres adapters must be
 * indistinguishable through the ports (Phase 05 · MR 3/6).
 *
 * ## Why this file is shaped the way it is
 *
 * The 69 unit tests of MR 2/6 prove the eligibility rules against the in-memory
 * stores. Every one of those proofs transfers to production only if the two adapters
 * behave the same — and "the same" is not something a hand-written expectation can
 * check, because a hand-written expectation is a third opinion that can agree with a
 * bug in both.
 *
 * So each scenario below runs TWICE, once per adapter, and the two resulting `Trace`
 * objects are compared **to each other**. Nothing here asserts what eligibility
 * *should* be; the unit suite does that. This file asserts only that the answer does
 * not depend on where the rows are stored. A difference in an ORDER BY, a lost array
 * default, a `DATE` that came back as a timestamp, a constraint translated to the
 * wrong error — all of them surface as a diff between two traces, with both sides
 * printed.
 *
 * ## Three rules the scenarios must follow
 *
 *  1. **Fixed idempotency keys.** `helpers.nextKey()` increments a MODULE-level
 *     counter, so the memory run and the Postgres run of the same scenario would
 *     receive different keys and every trace would differ on a field that means
 *     nothing. Every key here is a literal.
 *  2. **Local seeding helpers, generic over `DriverDependencies`.** The helpers in
 *     `helpers.ts` are typed to `InMemoryDriverEnvironment` and reach into
 *     `env.zoneCatalog.seed`, which the Postgres dependency set does not expose. The
 *     seeding below therefore goes through the use cases only.
 *  3. **`updatedAt` is excluded before comparing.** It is the one field that MUST
 *     differ: in memory it is the fixed clock's instant, and in Postgres it is the
 *     trigger's `now()` (adapter choice 5). `withoutVolatile` strips it recursively.
 *     Nothing else is excluded — an exclusion list that grew whenever a test failed
 *     would erase the only thing this file measures.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryEnvironment,
  type FixedClock,
  type InMemoryCandidacyProjectionPort,
} from "../infrastructure/in-memory.js";
import { registerDriver } from "../use-cases/register-driver.js";
import { registerVehicle, patchVehicle } from "../use-cases/manage-vehicles.js";
import { reviewDocument, submitDocument } from "../use-cases/manage-documents.js";
import {
  declareAvailability,
  reinstateDriver,
  setServiceZones,
  suspendDriver,
  updateProfile,
} from "../use-cases/manage-profile.js";
import { readEligibility, runExpiryTick } from "../use-cases/read-eligibility.js";
import type { DriverDependencies } from "../ports.js";
import { DRIVER, NOW, ZONE_A, ZONE_B } from "./helpers.js";
import { createPgHarness, PG_ENABLED, resetData, setupPostgres, type PgFixture } from "./pg-harness.js";

// ---------------------------------------------------------------------------
// Fixed keys. See rule 1 above.
// ---------------------------------------------------------------------------
const VEHICLE_KEY = "veh-fixed-0001";
const VEHICLE_KEY_2 = "veh-fixed-0002";
const ID_KEY = "doc-fixed-id01";
const LICENCE_KEY = "doc-fixed-lic1";
const REGISTRATION_KEY = "doc-fixed-reg1";

/**
 * Everything a scenario is allowed to observe.
 *
 * The shape is deliberately wide: the more of the service's state a trace carries,
 * the more kinds of divergence one comparison can catch. `outbox` carries the event
 * types only — the event ids are generated per run and would differ on every scenario
 * without telling us anything about storage.
 */
interface Trace {
  readonly profile: unknown;
  readonly zones: unknown;
  readonly vehicles: unknown;
  readonly documents: unknown;
  readonly log: unknown;
  readonly publications: unknown;
  readonly outboxTypes: readonly string[];
  readonly eligibility: unknown;
  readonly errors: readonly string[];
}

const EXCLUDED_KEYS = new Set(["updatedAt"]);

/** Strip the fields that MUST differ between the two adapters. See rule 3. */
function withoutVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutVolatile);
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (EXCLUDED_KEYS.has(key)) continue;
      output[key] = withoutVolatile(inner);
    }
    return output;
  }
  return value;
}

/** Read the whole observable state of one driver through the ports. */
async function trace(deps: DriverDependencies, errors: readonly string[] = []): Promise<Trace> {
  const [profile, zones, vehicles, documents, log, publications, outbox, eligibility] =
    await Promise.all([
      deps.profiles.find(DRIVER),
      deps.zones.list(DRIVER),
      deps.vehicles.list(DRIVER),
      deps.documents.list(DRIVER),
      deps.eligibilityLog.list(DRIVER),
      deps.publications.list(DRIVER),
      deps.outbox.unread(),
      readEligibility(deps, DRIVER),
    ]);
  return {
    profile,
    zones,
    vehicles,
    documents,
    log,
    publications,
    outboxTypes: outbox.map((event) => event.event_type),
    eligibility,
    errors,
  };
}

/** Run a call and record its error CODE, so a divergent translation shows up. */
async function capture(errors: string[], work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    const code = (error as { code?: string }).code;
    errors.push(code ?? `UNTRANSLATED:${(error as Error).name}`);
  }
}

// ---------------------------------------------------------------------------
// Local seeding helpers — generic over the ports. See rule 2.
// ---------------------------------------------------------------------------

async function seedRegistered(deps: DriverDependencies): Promise<void> {
  await registerDriver(deps, {
    waslaPublicId: DRIVER,
    displayName: "سائق تجربة",
    serviceKinds: ["ride"],
  });
}

async function seedWithZoneAndVehicle(deps: DriverDependencies): Promise<string> {
  await seedRegistered(deps);
  await setServiceZones(deps, DRIVER, { zones: [{ zoneId: ZONE_A, preferenceRank: 1 }] });
  const vehicle = await registerVehicle(deps, DRIVER, {
    vehicleClass: "sedan",
    idempotencyKey: VEHICLE_KEY,
    plateNumber: "ABC-1234",
  });
  return vehicle.id;
}

async function verify(
  deps: DriverDependencies,
  documentType: "national_id" | "driving_license" | "vehicle_registration",
  key: string,
  options: { vehicleId?: string | null; expiresAt?: string | null } = {},
): Promise<void> {
  const submitted = await submitDocument(deps, DRIVER, {
    documentType,
    storageRef: `s3://wasla-docs/${documentType}.pdf`,
    idempotencyKey: key,
    vehicleId: options.vehicleId ?? null,
    expiresAt: options.expiresAt ?? null,
  });
  await reviewDocument(deps, DRIVER, submitted.id, {
    status: "verified",
    reviewedBy: "ops-1",
    ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt ?? null }),
  });
}

/** The fully eligible baseline, built the same way on both adapters. */
async function seedEligible(deps: DriverDependencies): Promise<string> {
  const vehicleId = await seedWithZoneAndVehicle(deps);
  await verify(deps, "national_id", ID_KEY);
  await verify(deps, "driving_license", LICENCE_KEY, { expiresAt: "2027-01-01" });
  await verify(deps, "vehicle_registration", REGISTRATION_KEY, {
    vehicleId,
    expiresAt: "2027-06-01",
  });
  return vehicleId;
}

// ---------------------------------------------------------------------------
// The scenarios. Each is one async function of `deps` returning a Trace.
// ---------------------------------------------------------------------------

type Scenario = (deps: DriverDependencies) => Promise<Trace>;

/**
 * Both adapters share the SAME clock and candidacy classes — that is the whole point
 * of `createPgHarness` (only storage is swapped). These two casts let a scenario drive
 * the clock or break the projection identically on both sides; widening the ports
 * themselves to expose test levers would put them in production code.
 */
function clockOf(deps: DriverDependencies): FixedClock {
  return deps.clock as FixedClock;
}

function candidacyOf(deps: DriverDependencies): InMemoryCandidacyProjectionPort {
  return deps.candidacy as InMemoryCandidacyProjectionPort;
}

const SCENARIOS: ReadonlyArray<{ name: string; run: Scenario }> = [
  {
    name: "a bare registration is ineligible for every missing condition at once",
    run: async (deps) => {
      await seedRegistered(deps);
      return trace(deps);
    },
  },
  {
    name: "re-registering the same driver conflicts",
    run: async (deps) => {
      const errors: string[] = [];
      await seedRegistered(deps);
      await capture(errors, () => seedRegistered(deps));
      return trace(deps, errors);
    },
  },
  {
    name: "zones are returned by preference rank, not by insertion",
    run: async (deps) => {
      await seedRegistered(deps);
      await setServiceZones(deps, DRIVER, {
        zones: [
          { zoneId: ZONE_B, preferenceRank: 2 },
          { zoneId: ZONE_A, preferenceRank: 1 },
        ],
      });
      return trace(deps);
    },
  },
  {
    name: "replacing zones narrows the served set",
    run: async (deps) => {
      await seedRegistered(deps);
      await setServiceZones(deps, DRIVER, {
        zones: [
          { zoneId: ZONE_A, preferenceRank: 1 },
          { zoneId: ZONE_B, preferenceRank: 2 },
        ],
      });
      await setServiceZones(deps, DRIVER, { zones: [{ zoneId: ZONE_B, preferenceRank: 1 }] });
      return trace(deps);
    },
  },
  {
    name: "an unknown zone is refused before anything is written",
    run: async (deps) => {
      const errors: string[] = [];
      await seedRegistered(deps);
      await capture(errors, () =>
        setServiceZones(deps, DRIVER, {
          zones: [{ zoneId: "99999999-9999-4999-8999-999999999999", preferenceRank: 1 }],
        }),
      );
      return trace(deps, errors);
    },
  },
  {
    name: "vehicles are listed in creation order",
    run: async (deps) => {
      await seedWithZoneAndVehicle(deps);
      await registerVehicle(deps, DRIVER, {
        vehicleClass: "suv",
        idempotencyKey: VEHICLE_KEY_2,
        plateNumber: "XYZ-9876",
      });
      return trace(deps);
    },
  },
  {
    name: "a repeated vehicle idempotency key returns the first vehicle",
    run: async (deps) => {
      await seedWithZoneAndVehicle(deps);
      await registerVehicle(deps, DRIVER, {
        vehicleClass: "sedan",
        idempotencyKey: VEHICLE_KEY,
        plateNumber: "ABC-1234",
      });
      return trace(deps);
    },
  },
  {
    name: "the same key with a different body is a conflict",
    run: async (deps) => {
      const errors: string[] = [];
      await seedWithZoneAndVehicle(deps);
      await capture(errors, () =>
        registerVehicle(deps, DRIVER, {
          vehicleClass: "van",
          idempotencyKey: VEHICLE_KEY,
          plateNumber: "OTHER-99",
        }),
      );
      return trace(deps, errors);
    },
  },
  {
    name: "promoting the second vehicle demotes the first in one step",
    run: async (deps) => {
      await seedWithZoneAndVehicle(deps);
      const second = await registerVehicle(deps, DRIVER, {
        vehicleClass: "suv",
        idempotencyKey: VEHICLE_KEY_2,
        plateNumber: "XYZ-9876",
      });
      await patchVehicle(deps, DRIVER, second.id, { isPrimary: true });
      return trace(deps);
    },
  },
  {
    name: "retiring the only primary vehicle is refused",
    run: async (deps) => {
      const errors: string[] = [];
      const vehicleId = await seedWithZoneAndVehicle(deps);
      await capture(errors, () => patchVehicle(deps, DRIVER, vehicleId, { status: "retired" }));
      return trace(deps, errors);
    },
  },
  {
    name: "an unknown vehicle id is a 404 through both adapters",
    run: async (deps) => {
      const errors: string[] = [];
      await seedWithZoneAndVehicle(deps);
      await capture(errors, () =>
        patchVehicle(deps, DRIVER, "dddddddd-0000-4000-8000-000000000009", { isPrimary: true }),
      );
      return trace(deps, errors);
    },
  },
  {
    name: "submitting a document leaves it pending and the driver unverified",
    run: async (deps) => {
      await seedWithZoneAndVehicle(deps);
      await submitDocument(deps, DRIVER, {
        documentType: "national_id",
        storageRef: "s3://wasla-docs/national_id.pdf",
        idempotencyKey: ID_KEY,
      });
      return trace(deps);
    },
  },
  {
    name: "resubmitting supersedes the live copy and keeps one live per type",
    run: async (deps) => {
      await seedWithZoneAndVehicle(deps);
      await verify(deps, "national_id", ID_KEY);
      await submitDocument(deps, DRIVER, {
        documentType: "national_id",
        storageRef: "s3://wasla-docs/national_id-v2.pdf",
        idempotencyKey: "doc-fixed-id02",
      });
      return trace(deps);
    },
  },
  {
    name: "a rejected document carries its reason and the driver stays ineligible",
    run: async (deps) => {
      await seedWithZoneAndVehicle(deps);
      const submitted = await submitDocument(deps, DRIVER, {
        documentType: "national_id",
        storageRef: "s3://wasla-docs/national_id.pdf",
        idempotencyKey: ID_KEY,
      });
      await reviewDocument(deps, DRIVER, submitted.id, {
        status: "rejected",
        reviewedBy: "ops-1",
        rejectionReasonCode: "unreadable_scan",
      });
      return trace(deps);
    },
  },
  {
    name: "reviewing a document twice is refused",
    run: async (deps) => {
      const errors: string[] = [];
      await seedWithZoneAndVehicle(deps);
      const submitted = await submitDocument(deps, DRIVER, {
        documentType: "national_id",
        storageRef: "s3://wasla-docs/national_id.pdf",
        idempotencyKey: ID_KEY,
      });
      await reviewDocument(deps, DRIVER, submitted.id, { status: "verified", reviewedBy: "ops-1" });
      await capture(errors, () =>
        reviewDocument(deps, DRIVER, submitted.id, { status: "rejected", reviewedBy: "ops-2", rejectionReasonCode: "changed_mind" }),
      );
      return trace(deps, errors);
    },
  },
  {
    name: "calendar dates survive the round trip on a verified licence",
    run: async (deps) => {
      // The DATE columns. In memory they are the strings the caller passed; in
      // Postgres they pass through a `DATE` column and the `pg` driver's Date
      // conversion. A divergence here is a licence that expires on the wrong day.
      await seedWithZoneAndVehicle(deps);
      const submitted = await submitDocument(deps, DRIVER, {
        documentType: "driving_license",
        storageRef: "s3://wasla-docs/driving_license.pdf",
        idempotencyKey: LICENCE_KEY,
        issuedAt: "2025-01-15",
        expiresAt: "2027-01-01",
      });
      await reviewDocument(deps, DRIVER, submitted.id, { status: "verified", reviewedBy: "ops-1" });
      return trace(deps);
    },
  },
  {
    name: "the fully eligible driver reaches the same verdict on both adapters",
    run: async (deps) => {
      await seedEligible(deps);
      return trace(deps);
    },
  },
  {
    name: "declaring availability publishes a candidacy projection",
    run: async (deps) => {
      await seedEligible(deps);
      await declareAvailability(deps, DRIVER, "available");
      return trace(deps);
    },
  },
  {
    name: "a failed publication is recorded without rolling back local state",
    run: async (deps) => {
      // Design decision 9 of MR 2/6. The publication attempt is stored with its
      // failure code and the driver stays eligible locally — the state that makes the
      // drift measurable at all.
      await seedEligible(deps);
      candidacyOf(deps).failureCode = "upstream_unavailable";
      await declareAvailability(deps, DRIVER, "available");
      return trace(deps);
    },
  },
  {
    name: "suspending then reinstating returns the driver to eligible",
    run: async (deps) => {
      await seedEligible(deps);
      await suspendDriver(deps, DRIVER, "fraud_review");
      await reinstateDriver(deps, DRIVER);
      return trace(deps);
    },
  },
  {
    name: "a suspended driver cannot write, but can still be reviewed",
    run: async (deps) => {
      const errors: string[] = [];
      const vehicleId = await seedWithZoneAndVehicle(deps);
      const submitted = await submitDocument(deps, DRIVER, {
        documentType: "vehicle_registration",
        storageRef: "s3://wasla-docs/vehicle_registration.pdf",
        idempotencyKey: REGISTRATION_KEY,
        vehicleId,
        expiresAt: "2027-06-01",
      });
      await suspendDriver(deps, DRIVER, "fraud_review");
      await capture(errors, () => declareAvailability(deps, DRIVER, "available"));
      await capture(errors, () =>
        registerVehicle(deps, DRIVER, {
          vehicleClass: "van",
          idempotencyKey: VEHICLE_KEY_2,
          plateNumber: "VAN-0001",
        }),
      );
      // The review must still succeed: an operator queue that refuses suspended files
      // leaves papers unexamined exactly for the drivers already under question.
      await reviewDocument(deps, DRIVER, submitted.id, { status: "verified", reviewedBy: "ops-1" });
      return trace(deps, errors);
    },
  },
  {
    name: "updating the profile keeps the eligibility log complete",
    run: async (deps) => {
      await seedEligible(deps);
      await updateProfile(deps, DRIVER, { displayName: "اسم جديد", preferredLocale: "en" });
      return trace(deps);
    },
  },
  {
    name: "an expiry tick finds the due driver through the recheck index",
    run: async (deps) => {
      // `listDueForRecheck` is the one read whose ORDER BY and WHERE are the tick's
      // entire index. A divergence here means the tick silently skips a driver whose
      // licence has expired — he keeps receiving orders on an invalid paper.
      await seedEligible(deps);
      // Past the licence's expiry, so the driver is genuinely due. Without the
      // advance the tick would scan zero rows and two empty results would agree.
      clockOf(deps).set("2027-02-01T00:00:00.000Z");
      const result = await runExpiryTick(deps, 10);
      const base = await trace(deps);
      return {
        ...base,
        errors: [
          ...base.errors,
          `rechecked:${result.recheckedDrivers}`,
          `changed:${result.changedDrivers}`,
          `published:${result.published}`,
          `failures:${result.publishFailures}`,
        ],
      };
    },
  },
];

/**
 * The in-memory side of a scenario run.
 *
 * `createInMemoryEnvironment` ships an EMPTY `InMemoryZoneCatalogPort`, while
 * `createPgHarness` seeds `ZONE_A`/`ZONE_B` into its own catalog (`pg-harness.ts`).
 * The zone catalog is an OUTBOUND geography port, not one of the two STORAGE sets
 * this file compares, so that asymmetry was never a difference the file is meant to
 * measure — it just made the memory run of every zone-touching scenario fail with
 * `نطاق غير معروف في شجرة الجغرافيا` while the Postgres run succeeded.
 *
 * Seeding it here leaves storage as the single remaining difference between the two
 * runs, and keeps rule 2 intact: no storage ROW is seeded outside the use cases.
 */
function memoryEnvironment(): ReturnType<typeof createInMemoryEnvironment> {
  const environment = createInMemoryEnvironment(NOW);
  environment.zoneCatalog.seed(ZONE_A, ZONE_B);
  return environment;
}

describe.skipIf(!PG_ENABLED)("port conformance: in-memory ↔ Postgres", () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(async () => {
    await resetData(pg.pool);
  });

  it.each(SCENARIOS)("$name", async ({ run }) => {
    const memory = await run(memoryEnvironment());
    const postgres = await run(createPgHarness(pg, NOW).deps);

    // Guard against the failure mode that makes this whole file worthless: if the
    // memory scenario produced nothing, two empty traces would compare equal and the
    // test would pass while proving nothing at all.
    expect(memory.profile).not.toBeNull();
    expect(memory.outboxTypes.length).toBeGreaterThan(0);

    expect(withoutVolatile(postgres)).toEqual(withoutVolatile(memory));
  });
});
