/**
 * The Postgres adapters against a real database (Phase 05 · MR 3/6).
 *
 * What this file is for, and what it deliberately leaves to its two siblings:
 *
 *  - HERE: the promises only a real database can keep or break — the constraint
 *    translations (23505 → a named domain error), the ORDER BY clauses that stand in
 *    for the in-memory insertion order, the `DATE` columns that must come back as
 *    `"YYYY-MM-DD"` and not as a `Date`, the partial unique indexes, and the columns
 *    a trigger owns.
 *  - `port-conformance.integration.test.ts`: that a use case produces the SAME
 *    observable result on both adapters.
 *  - `atomicity.integration.test.ts`: that a failure mid-operation leaves nothing
 *    behind.
 *
 * Skipped wholesale when DATABASE_URL is unset (`describe.skipIf`), so the file is
 * safe to have in the tree on a machine with no Postgres — which is the state of every
 * developer laptop until the compose file in Phase 09.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DRIVER, NOW, ZONE_A, ZONE_B } from "./helpers.js";
import { PG_ENABLED, resetData, setupPostgres, type PgFixture } from "./pg-harness.js";
import type { CreateDocumentInput, CreateProfileInput } from "../ports.js";
import type {
  CandidacyPublication,
  DriverDocument,
  EligibilityLogEntry,
  EligibilityReasonCode,
} from "../domain/model.js";
import { driverRegistered } from "../domain/events.js";

const OTHER_DRIVER = "WS-1000000002";
const VEHICLE_A = "aaaaaaaa-0000-4000-8000-000000000001";
const VEHICLE_B = "aaaaaaaa-0000-4000-8000-000000000002";
const DOC_A = "bbbbbbbb-0000-4000-8000-000000000001";
const DOC_B = "bbbbbbbb-0000-4000-8000-000000000002";

/**
 * Assert that a write was refused by a specific named CHECK constraint.
 *
 * Why the message and not `error.constraint`: the adapter's `rethrowNamed` prefixes the
 * message with the constraint name *precisely because* the driver does not reliably
 * expose it as a property. `drizzle-orm` wraps the `pg` error in a `DrizzleQueryError`
 * whose own enumerable keys are `query`, `params` and `cause`, so `error.constraint` is
 * `undefined` at the top level and only reachable through the cause chain — which is
 * exactly the walk `constraintName` in the adapter performs.
 *
 * So asserting the message checks the contract the adapter documents and guarantees,
 * while asserting the property checked an incidental detail of whichever driver version
 * happened to be installed. The constraints below did refuse every write all along; it
 * was the assertion that stopped being able to see it.
 */
async function expectRefusedBy(promise: Promise<unknown>, constraint: string): Promise<void> {
  await expect(promise).rejects.toThrow(new RegExp(`^${constraint}:`));
}

function profileInput(waslaPublicId = DRIVER): CreateProfileInput {
  return {
    waslaPublicId,
    displayName: "سائق تجربة",
    preferredLocale: "ar",
    workCityZoneId: null,
    serviceKinds: ["ride"],
    eligibilityPolicyVersion: 1,
    createdAt: NOW,
  };
}

describe.skipIf(!PG_ENABLED)("Postgres adapters", () => {
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

  // -------------------------------------------------------------------------
  // Profiles
  // -------------------------------------------------------------------------

  describe("profiles", () => {
    it("round-trips a profile with its defaults intact", async () => {
      const created = await pg.profiles.create(profileInput());
      expect(created.waslaPublicId).toBe(DRIVER);
      expect(created.declaredAvailability).toBe("offline");
      expect(created.verificationStatus).toBe("unverified");
      expect(created.status).toBe("active");
      expect(created.serviceKinds).toEqual(["ride"]);
      expect(created.createdAt).toBe(NOW);
      // The read path must agree with the write path's return value, or every
      // use case that writes then re-reads sees two different drivers.
      expect(await pg.profiles.find(DRIVER)).toEqual(created);
    });

    it("returns null for a driver who does not exist", async () => {
      expect(await pg.profiles.find(DRIVER)).toBeNull();
    });

    it("translates the duplicate primary key into driverAlreadyExists", async () => {
      // The whole point of the constraint translation layer: a 23505 on the primary
      // key is a 409 the caller can act on, not a 500 with a Postgres string in it.
      await pg.profiles.create(profileInput());
      await expect(pg.profiles.create(profileInput())).rejects.toMatchObject({
        code: "DRIVER_ALREADY_EXISTS",
      });
    });

    it("refuses a wasla_public_id that does not match the contract's shape", async () => {
      // `^WS-[0-9]{10}$` is a CHECK, and it is the last line of defence for an id
      // that reaches the database from anywhere other than identity-service.
      await expect(
        pg.profiles.create({ ...profileInput(), waslaPublicId: "driver-1" }),
      ).rejects.toThrow();
    });

    it("applies a partial mutation and leaves the rest alone", async () => {
      await pg.profiles.create(profileInput());
      const updated = await pg.profiles.update(
        DRIVER,
        { declaredAvailability: "available" },
        "2026-01-02T00:00:00.000Z",
      );
      expect(updated.declaredAvailability).toBe("available");
      expect(updated.displayName).toBe("سائق تجربة");
      expect(updated.serviceKinds).toEqual(["ride"]);
    });

    it("lets the trigger own updated_at", async () => {
      // Choice 5 of the adapter header. `updated_at` must MOVE on an update even
      // though no caller ever writes it — an audit that orders two changes reads
      // this column, and a writer who can set it can make an old change look new.
      const created = await pg.profiles.create(profileInput());
      await new Promise((resolve) => setTimeout(resolve, 5));
      const updated = await pg.profiles.update(DRIVER, { displayName: "اسم آخر" }, NOW);
      expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    });

    it("throws driverNotFound for every write against a missing row", async () => {
      // Three separate methods, one promise: a write that silently affects zero rows
      // is how a 404 becomes a 200 with a stale body.
      await expect(pg.profiles.update(DRIVER, { displayName: "x" }, NOW)).rejects.toMatchObject({
        code: "DRIVER_NOT_FOUND",
      });
      await expect(pg.profiles.setRecheckAt(DRIVER, null, NOW)).rejects.toMatchObject({
        code: "DRIVER_NOT_FOUND",
      });
      await expect(pg.profiles.recordPublication(DRIVER, "eligible", NOW)).rejects.toMatchObject({
        code: "DRIVER_NOT_FOUND",
      });
    });

    it("stores and clears the recheck instant", async () => {
      await pg.profiles.create(profileInput());
      const set = await pg.profiles.setRecheckAt(DRIVER, "2026-06-01T00:00:00.000Z", NOW);
      expect(set.eligibilityRecheckAt).toBe("2026-06-01T00:00:00.000Z");
      const cleared = await pg.profiles.setRecheckAt(DRIVER, null, NOW);
      expect(cleared.eligibilityRecheckAt).toBeNull();
    });

    it("records the published state and the instant together", async () => {
      await pg.profiles.create(profileInput());
      const recorded = await pg.profiles.recordPublication(DRIVER, "eligible", NOW);
      expect(recorded.lastPublishedState).toBe("eligible");
      expect(recorded.lastPublishedAt).toBe(NOW);
    });

    it("returns only due drivers, soonest first, within the limit", async () => {
      // This IS the expiry tick's index. An ORDER BY that drifted would starve the
      // driver whose licence expired first — the one case the tick exists for.
      await pg.profiles.create(profileInput(DRIVER));
      await pg.profiles.create(profileInput(OTHER_DRIVER));
      await pg.profiles.setRecheckAt(OTHER_DRIVER, "2026-01-01T00:00:00.000Z", NOW);
      await pg.profiles.setRecheckAt(DRIVER, "2026-05-01T00:00:00.000Z", NOW);

      const due = await pg.profiles.listDueForRecheck("2026-06-01T00:00:00.000Z", 10);
      expect(due.map((row) => row.waslaPublicId)).toEqual([OTHER_DRIVER, DRIVER]);

      // Not yet due, and a driver with no recheck instant, are both invisible.
      const early = await pg.profiles.listDueForRecheck("2026-02-01T00:00:00.000Z", 10);
      expect(early.map((row) => row.waslaPublicId)).toEqual([OTHER_DRIVER]);

      const bounded = await pg.profiles.listDueForRecheck("2026-06-01T00:00:00.000Z", 1);
      expect(bounded.map((row) => row.waslaPublicId)).toEqual([OTHER_DRIVER]);
    });
  });

  // -------------------------------------------------------------------------
  // Service zones
  // -------------------------------------------------------------------------

  describe("service zones", () => {
    beforeEach(async () => {
      await pg.profiles.create(profileInput());
    });

    it("replaces the whole set and returns it by preference rank", async () => {
      await pg.zones.replace(
        DRIVER,
        [
          { zoneId: ZONE_B, preferenceRank: 2 },
          { zoneId: ZONE_A, preferenceRank: 1 },
        ],
        NOW,
      );
      const listed = await pg.zones.list(DRIVER);
      expect(listed.map((zone) => zone.zoneId)).toEqual([ZONE_A, ZONE_B]);
      expect(listed.map((zone) => zone.preferenceRank)).toEqual([1, 2]);
    });

    it("replace is a replacement, not a merge", async () => {
      // The port is named `replace` and must behave like it: a driver who narrows his
      // served zones from three to one must not keep receiving orders in the two he
      // dropped.
      await pg.zones.replace(DRIVER, [{ zoneId: ZONE_A, preferenceRank: 1 }], NOW);
      await pg.zones.replace(DRIVER, [{ zoneId: ZONE_B, preferenceRank: 1 }], NOW);
      expect((await pg.zones.list(DRIVER)).map((zone) => zone.zoneId)).toEqual([ZONE_B]);
    });

    it("accepts an empty set", async () => {
      await pg.zones.replace(DRIVER, [{ zoneId: ZONE_A, preferenceRank: 1 }], NOW);
      await pg.zones.replace(DRIVER, [], NOW);
      expect(await pg.zones.list(DRIVER)).toEqual([]);
    });

    it("refuses two zones at the same preference rank", async () => {
      // ux_driver_service_zones_rank. Two zones at rank 1 means the dispatcher has no
      // deterministic order to offer them in, and two ticks could disagree.
      await expect(
        pg.zones.replace(
          DRIVER,
          [
            { zoneId: ZONE_A, preferenceRank: 1 },
            { zoneId: ZONE_B, preferenceRank: 1 },
          ],
          NOW,
        ),
      ).rejects.toThrow();
    });

    it("refuses the same zone twice", async () => {
      await expect(
        pg.zones.replace(
          DRIVER,
          [
            { zoneId: ZONE_A, preferenceRank: 1 },
            { zoneId: ZONE_A, preferenceRank: 2 },
          ],
          NOW,
        ),
      ).rejects.toThrow();
    });

    it("deletes a driver's zones with the driver (FK CASCADE)", async () => {
      await pg.zones.replace(DRIVER, [{ zoneId: ZONE_A, preferenceRank: 1 }], NOW);
      await pg.pool.query("DELETE FROM driver_profiles WHERE wasla_public_id = $1", [DRIVER]);
      expect(await pg.zones.list(DRIVER)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Vehicles
  // -------------------------------------------------------------------------

  describe("vehicles", () => {
    beforeEach(async () => {
      await pg.profiles.create(profileInput());
    });

    function vehicle(id: string, key: string, isPrimary: boolean) {
      return {
        id,
        waslaPublicId: DRIVER,
        vehicleClass: "sedan" as const,
        make: null,
        model: null,
        modelYear: null,
        color: null,
        plateNumber: "ABC-1234",
        isPrimary,
        idempotencyKey: key,
        createdAt: NOW,
      };
    }

    it("round-trips a vehicle and finds it by id and by key", async () => {
      const created = await pg.vehicles.create(vehicle(VEHICLE_A, "veh-000001", true));
      expect(created.status).toBe("active");
      expect(created.isPrimary).toBe(true);
      expect(await pg.vehicles.find(DRIVER, VEHICLE_A)).toEqual(created);
      expect(await pg.vehicles.findByIdempotencyKey(DRIVER, "veh-000001")).toEqual(created);
    });

    it("scopes find by owner, so one driver cannot read another's vehicle", async () => {
      // The vehicle id is a UUID and therefore unguessable, but "unguessable" is not
      // an authorisation model: the WHERE clause carries the owner.
      await pg.profiles.create(profileInput(OTHER_DRIVER));
      await pg.vehicles.create(vehicle(VEHICLE_A, "veh-000001", true));
      expect(await pg.vehicles.find(OTHER_DRIVER, VEHICLE_A)).toBeNull();
      expect(await pg.vehicles.findByIdempotencyKey(OTHER_DRIVER, "veh-000001")).toBeNull();
    });

    it("lists in creation order", async () => {
      // The in-memory store returns Map insertion order, so the adapter's
      // `ORDER BY created_at ASC, id ASC` is not a preference — it is the parity
      // contract. The tie-break on `id` matters because both rows below share the
      // fixed clock's instant.
      await pg.vehicles.create(vehicle(VEHICLE_B, "veh-000002", true));
      await pg.vehicles.create(vehicle(VEHICLE_A, "veh-000001", false));
      expect((await pg.vehicles.list(DRIVER)).map((row) => row.id)).toEqual([VEHICLE_A, VEHICLE_B]);
    });

    it("refuses a second primary vehicle", async () => {
      // ux_driver_vehicles_one_primary WHERE is_primary. Two primaries means the
      // eligibility calculator picks one at random and the driver's vehicle papers
      // appear to belong to the wrong car.
      await pg.vehicles.create(vehicle(VEHICLE_A, "veh-000001", true));
      await expect(pg.vehicles.create(vehicle(VEHICLE_B, "veh-000002", true))).rejects.toThrow();
    });

    it("allows any number of non-primary vehicles", async () => {
      await pg.vehicles.create(vehicle(VEHICLE_A, "veh-000001", false));
      await pg.vehicles.create(vehicle(VEHICLE_B, "veh-000002", false));
      expect(await pg.vehicles.list(DRIVER)).toHaveLength(2);
    });

    it("translates a reused idempotency key into idempotencyKeyReused", async () => {
      await pg.vehicles.create(vehicle(VEHICLE_A, "veh-000001", true));
      await expect(
        pg.vehicles.create(vehicle(VEHICLE_B, "veh-000001", false)),
      ).rejects.toMatchObject({ code: "DRIVER_IDEMPOTENCY_KEY_REUSED" });
    });

    it("saveAll demotes and promotes in one step", async () => {
      // The reassignment that the unique index makes impossible to do one row at a
      // time. `saveAll` receives both rows and the adapter orders the writes.
      const first = await pg.vehicles.create(vehicle(VEHICLE_A, "veh-000001", true));
      const second = await pg.vehicles.create(vehicle(VEHICLE_B, "veh-000002", false));
      await pg.vehicles.saveAll([
        { ...first, isPrimary: false },
        { ...second, isPrimary: true },
      ]);
      const listed = await pg.vehicles.list(DRIVER);
      expect(listed.filter((row) => row.isPrimary).map((row) => row.id)).toEqual([VEHICLE_B]);
    });

    it("saveAll validates the whole set before writing anything", async () => {
      // Parity with the in-memory store, and the reason it matters: a partial
      // `saveAll` could demote the current primary and fail to promote the new one,
      // leaving a driver with no primary vehicle and therefore no eligibility.
      const first = await pg.vehicles.create(vehicle(VEHICLE_A, "veh-000001", true));
      await expect(
        pg.vehicles.saveAll([
          { ...first, isPrimary: false },
          { ...first, id: VEHICLE_B, isPrimary: true },
        ]),
      ).rejects.toMatchObject({ code: "DRIVER_VEHICLE_NOT_FOUND" });
      expect((await pg.vehicles.find(DRIVER, VEHICLE_A))?.isPrimary).toBe(true);
    });

    it("refuses a retired vehicle that is still primary", async () => {
      // ck_driver_vehicles_retired_not_primary — a retired car cannot be the one the
      // driver's registration is checked against.
      const created = await pg.vehicles.create(vehicle(VEHICLE_A, "veh-000001", true));
      await expectRefusedBy(
        pg.vehicles.saveAll([{ ...created, status: "retired" }]),
        "ck_driver_vehicles_retired_not_primary",
      );
    });

    it("accepts an empty saveAll without a statement", async () => {
      expect(await pg.vehicles.saveAll([])).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------

  describe("documents", () => {
    beforeEach(async () => {
      await pg.profiles.create(profileInput());
      await pg.vehicles.create({
        id: VEHICLE_A,
        waslaPublicId: DRIVER,
        vehicleClass: "sedan",
        make: null,
        model: null,
        modelYear: null,
        color: null,
        plateNumber: "ABC-1234",
        isPrimary: true,
        idempotencyKey: "veh-000001",
        createdAt: NOW,
      });
    });

    function document(
      id: string,
      key: string,
      overrides: Partial<CreateDocumentInput> = {},
    ): CreateDocumentInput {
      return {
        id,
        waslaPublicId: DRIVER,
        documentType: "national_id",
        storageRef: "s3://wasla-docs/national_id.pdf",
        vehicleId: null,
        issuedAt: null,
        expiresAt: null,
        idempotencyKey: key,
        createdAt: NOW,
        ...overrides,
      };
    }

    /** A document row the database has never seen — for the not-found paths. */
    function unknownRow(id: string): DriverDocument {
      return {
        ...document(id, "doc-999999"),
        status: "pending",
        reviewedAt: null,
        reviewedBy: null,
        rejectionReasonCode: null,
        updatedAt: NOW,
      };
    }

    it("returns DATE columns as calendar days, never as timestamps", async () => {
      // Choice 4 of the adapter header, and the bug it prevents: `issued_at` and
      // `expires_at` are DATE, and `pg` hands a `Date` back for them. Coercing that
      // to an ISO instant would drag the server's local timezone into a licence's
      // expiry, and a driver in Riyadh would lose his eligibility three hours early.
      const created = await pg.documents.create(
        document(DOC_A, "doc-000001", { issuedAt: "2025-01-15", expiresAt: "2027-01-01" }),
      );
      expect(created.issuedAt).toBe("2025-01-15");
      expect(created.expiresAt).toBe("2027-01-01");
      expect(await pg.documents.find(DRIVER, DOC_A)).toEqual(created);
    });

    it("round-trips a document with its defaults intact", async () => {
      const created = await pg.documents.create(document(DOC_A, "doc-000001"));
      expect(created.status).toBe("pending");
      expect(created.reviewedAt).toBeNull();
      expect(created.reviewedBy).toBeNull();
      expect(created.rejectionReasonCode).toBeNull();
      expect(await pg.documents.findByIdempotencyKey(DRIVER, "doc-000001")).toEqual(created);
    });

    it("lists in creation order", async () => {
      await pg.documents.create(document(DOC_B, "doc-000002", { documentType: "driving_license" }));
      await pg.documents.create(document(DOC_A, "doc-000001"));
      expect((await pg.documents.list(DRIVER)).map((row) => row.id)).toEqual([DOC_A, DOC_B]);
    });

    it("refuses two live copies of the same driver-level document", async () => {
      // ux_driver_documents_one_live_per_type with the COALESCE to the nil UUID: a
      // NULL vehicle_id is distinct from another NULL in a unique index, so without
      // that expression this insert would succeed and the driver would hold two live
      // national IDs.
      await pg.documents.create(document(DOC_A, "doc-000001"));
      await expect(pg.documents.create(document(DOC_B, "doc-000002"))).rejects.toThrow();
    });

    it("allows a second copy once the first is superseded", async () => {
      // The index is partial (status IN ('pending','verified')), which is what makes
      // resubmission possible at all: supersede first, then insert.
      const first = await pg.documents.create(document(DOC_A, "doc-000001"));
      await pg.documents.saveAll([{ ...first, status: "superseded" }]);
      const second = await pg.documents.create(document(DOC_B, "doc-000002"));
      expect(second.status).toBe("pending");
    });

    it("scopes the live index by vehicle", async () => {
      // Two vehicle registrations may be live at once if they belong to two different
      // cars; two for the SAME car may not.
      await pg.vehicles.create({
        id: VEHICLE_B,
        waslaPublicId: DRIVER,
        vehicleClass: "suv",
        make: null,
        model: null,
        modelYear: null,
        color: null,
        plateNumber: "XYZ-9876",
        isPrimary: false,
        idempotencyKey: "veh-000002",
        createdAt: NOW,
      });
      await pg.documents.create(
        document(DOC_A, "doc-000001", {
          documentType: "vehicle_registration",
          vehicleId: VEHICLE_A,
        }),
      );
      const other = await pg.documents.create(
        document(DOC_B, "doc-000002", {
          documentType: "vehicle_registration",
          vehicleId: VEHICLE_B,
        }),
      );
      expect(other.vehicleId).toBe(VEHICLE_B);
    });

    it("findLive matches the index's scoping, including the NULL vehicle", async () => {
      // `findLive` reproduces the index's COALESCE expression. If the two ever drift,
      // the application would read one row while the index protected another — the
      // subtlest possible version of this bug, because both halves keep working.
      const driverLevel = await pg.documents.create(document(DOC_A, "doc-000001"));
      const vehicleLevel = await pg.documents.create(
        document(DOC_B, "doc-000002", {
          documentType: "vehicle_registration",
          vehicleId: VEHICLE_A,
        }),
      );
      expect(await pg.documents.findLive(DRIVER, "national_id", null)).toEqual(driverLevel);
      expect(await pg.documents.findLive(DRIVER, "national_id", VEHICLE_A)).toBeNull();
      expect(await pg.documents.findLive(DRIVER, "vehicle_registration", VEHICLE_A)).toEqual(
        vehicleLevel,
      );
      expect(await pg.documents.findLive(DRIVER, "vehicle_registration", null)).toBeNull();
    });

    it("findLive ignores rejected and superseded copies", async () => {
      const created = await pg.documents.create(document(DOC_A, "doc-000001"));
      await pg.documents.saveAll([
        { ...created, status: "rejected", reviewedAt: NOW, reviewedBy: "ops-1", rejectionReasonCode: "unreadable" },
      ]);
      expect(await pg.documents.findLive(DRIVER, "national_id", null)).toBeNull();
    });

    it("refuses a review with no reviewer, and a rejection with no reason", async () => {
      // ck_driver_documents_review_coherence. A verdict with no reviewer is a decision
      // nobody is accountable for; a rejection with no reason code is a driver told
      // "no" with nothing to fix.
      const created = await pg.documents.create(document(DOC_A, "doc-000001"));
      await expectRefusedBy(
        pg.documents.saveAll([{ ...created, status: "verified", reviewedAt: NOW, reviewedBy: null }]),
        "ck_driver_documents_review_coherence",
      );
      await expectRefusedBy(
        pg.documents.saveAll([
          { ...created, status: "rejected", reviewedAt: NOW, reviewedBy: "ops-1" },
        ]),
        "ck_driver_documents_review_coherence",
      );
    });

    it("refuses an expiry that precedes the issue date", async () => {
      // ck_driver_documents_dates.
      await expectRefusedBy(
        pg.documents.create(
          document(DOC_A, "doc-000001", { issuedAt: "2027-01-01", expiresAt: "2025-01-01" }),
        ),
        "ck_driver_documents_dates",
      );
    });

    it("refuses a vehicle-scoped type with no vehicle, and the reverse", async () => {
      // ck_driver_documents_vehicle_scope. A vehicle registration with no vehicle
      // cannot be checked against anything, and a national ID attached to a car
      // would disappear the day the car is retired.
      await expectRefusedBy(
        pg.documents.create(
          document(DOC_A, "doc-000001", { documentType: "vehicle_registration", vehicleId: null }),
        ),
        "ck_driver_documents_vehicle_scope",
      );
      await expectRefusedBy(
        pg.documents.create(
          document(DOC_B, "doc-000002", { documentType: "national_id", vehicleId: VEHICLE_A }),
        ),
        "ck_driver_documents_vehicle_scope",
      );
    });

    it("throws documentNotFound when saveAll names an unknown id", async () => {
      await expect(pg.documents.saveAll([unknownRow(DOC_A)])).rejects.toMatchObject({
        code: "DRIVER_DOCUMENT_NOT_FOUND",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Policies, log, publications
  // -------------------------------------------------------------------------

  describe("eligibility policies", () => {
    it("reads the seed the DDL ships", async () => {
      // The policy is contract data, not test data: `resetData` preserves it on
      // purpose (pg-harness rule 2), and the whole calculator reads it.
      const active = await pg.policies.findActive();
      expect(active).not.toBeNull();
      expect(active?.version).toBe(1);
      expect(active?.label).toBe("saudi-launch-v1");
      expect(active?.isFrozen).toBe(true);
      expect(active?.requirePrimaryVehicle).toBe(true);
      expect(active?.requireServiceZone).toBe(true);
      expect(await pg.policies.find(1)).toEqual(active);
      expect(await pg.policies.find(99)).toBeNull();
      expect(await pg.policies.list()).toHaveLength(1);
    });
  });

  describe("eligibility log", () => {
    beforeEach(async () => {
      await pg.profiles.create(profileInput());
    });

    function entry(
      toState: EligibilityLogEntry["toState"],
      reasons: readonly EligibilityReasonCode[],
    ): EligibilityLogEntry {
      return {
        waslaPublicId: DRIVER,
        fromState: null,
        toState,
        reasons,
        policyVersion: 1,
        trigger: "profile_changed",
        evaluatedAt: NOW,
      };
    }

    it("is append-only and ordered by insertion, not by instant", async () => {
      // `latest()` orders by the BIGSERIAL id and NOT by `evaluated_at`, because one
      // request shares one clock value: three appends in a single operation carry the
      // SAME instant, and ordering by it would return an arbitrary one of them.
      await pg.eligibilityLog.append(entry("ineligible", ["PROFILE_NOT_VERIFIED"]));
      await pg.eligibilityLog.append(entry("ineligible", ["NO_PRIMARY_VEHICLE"]));
      await pg.eligibilityLog.append(entry("eligible", []));

      const listed = await pg.eligibilityLog.list(DRIVER);
      expect(listed.map((row) => row.reasons)).toEqual([
        ["PROFILE_NOT_VERIFIED"],
        ["NO_PRIMARY_VEHICLE"],
        [],
      ]);
      expect((await pg.eligibilityLog.latest(DRIVER))?.toState).toBe("eligible");
    });

    it("returns null when a driver has never been evaluated", async () => {
      expect(await pg.eligibilityLog.latest(DRIVER)).toBeNull();
    });

    it("refuses a non-eligible verdict with no reasons", async () => {
      // ck_eligibility_log_reasons — the constraint that makes "why is this driver not
      // getting orders?" always answerable.
      await expect(pg.eligibilityLog.append(entry("ineligible", []))).rejects.toMatchObject({
        constraint: "ck_eligibility_log_reasons",
      });
    });
  });

  describe("candidacy publications", () => {
    beforeEach(async () => {
      await pg.profiles.create(profileInput());
    });

    function attempt(
      outcome: CandidacyPublication["outcome"],
      failureCode: string | null,
    ): CandidacyPublication {
      return {
        waslaPublicId: DRIVER,
        eligibilityState: "eligible",
        availabilityState: "available",
        serviceKinds: ["ride"],
        zoneIds: [ZONE_A],
        vehicleClass: "sedan",
        outcome,
        failureCode,
        attemptedAt: NOW,
      };
    }

    it("records every attempt in order, successful or not", async () => {
      // Drift between what we decided and what matching accepted is only measurable
      // if the failures are stored too.
      await pg.publications.append(attempt("rejected", "upstream_unavailable"));
      await pg.publications.append(attempt("published", null));
      const listed = await pg.publications.list(DRIVER);
      expect(listed.map((row) => row.outcome)).toEqual(["rejected", "published"]);
      expect(listed[0]?.failureCode).toBe("upstream_unavailable");
      expect(listed[0]?.zoneIds).toEqual([ZONE_A]);
    });

    it("refuses a success with a failure code, and a failure without one", async () => {
      // ck_candidacy_publication_outcome.
      await expectRefusedBy(
        pg.publications.append(attempt("published", "why")),
        "ck_candidacy_publication_outcome",
      );
      await expectRefusedBy(
        pg.publications.append(attempt("rejected", null)),
        "ck_candidacy_publication_outcome",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Outbox and idempotency
  // -------------------------------------------------------------------------

  describe("outbox", () => {
    // Built through the REAL envelope builder rather than a hand-written literal: an
    // outbox test that invented its own payload shape would keep passing after the
    // envelope changed, and the relay reads the stored JSONB, not this file.
    let profile: Awaited<ReturnType<typeof pg.profiles.create>>;

    beforeEach(async () => {
      profile = await pg.profiles.create(profileInput());
    });

    function event(eventId: string) {
      return driverRegistered(profile, {
        eventId,
        occurredAt: NOW,
        traceId: "11111111-1111-4111-8111-11111111aaaa",
      });
    }

    it("stores an event and returns it as unread", async () => {
      const appended = event("cccccccc-0000-4000-8000-000000000001");
      await pg.outbox.append(appended);
      const unread = await pg.outbox.unread();
      expect(unread).toHaveLength(1);
      expect(unread[0]).toEqual(appended);
    });

    it("hides an event once it is marked published", async () => {
      // The relay's contract (Phase 09): `unread()` filters `published_at IS NULL`,
      // so a delivered event is not delivered twice.
      await pg.outbox.append(event("cccccccc-0000-4000-8000-000000000001"));
      await pg.outbox.append(event("cccccccc-0000-4000-8000-000000000002"));
      await pg.outbox.markPublished(["cccccccc-0000-4000-8000-000000000001"], NOW);
      const unread = await pg.outbox.unread();
      expect(unread.map((row) => row.event_id)).toEqual([
        "cccccccc-0000-4000-8000-000000000002",
      ]);
    });

    it("refuses the same event_id twice", async () => {
      // The UNIQUE on event_id is what makes an at-least-once relay safe to retry.
      await pg.outbox.append(event("cccccccc-0000-4000-8000-000000000001"));
      await expect(
        pg.outbox.append(event("cccccccc-0000-4000-8000-000000000001")),
      ).rejects.toThrow();
    });
  });

  describe("idempotency", () => {
    it("remembers a fingerprint and returns it for the same key", async () => {
      await pg.idempotency.remember("vehicle:WS-1000000001:veh-000001", "fingerprint-a");
      expect(await pg.idempotency.find("vehicle:WS-1000000001:veh-000001")).toBe("fingerprint-a");
      expect(await pg.idempotency.find("vehicle:WS-1000000001:veh-000002")).toBeNull();
    });

    it("accepts the namespaced key length the domain validator allows at its maximum", async () => {
      // The reason §9 of the DDL widened this column to 192: the key stored here is
      // `vehicle:<wasla id>:<caller key>`, so a caller-legal 128-character key produces
      // a 150-character row — `"vehicle:"` is 8, `WS-1000000001` is 13, the separator
      // is 1, and the caller key is 128. At 128 the column would have rejected a key
      // the caller could never have anticipated or explained.
      //
      // The previous 151 was arithmetic no run had ever checked: the whole file is
      // skipped without DATABASE_URL, so the expectation could stay wrong indefinitely
      // on any machine — and every machine was such a machine. It says nothing about
      // the column, which is correct at 192, and everything about the cost of an
      // assertion no green run ever executed.
      const key = `vehicle:${DRIVER}:${"k".repeat(128)}`;
      expect(key.length).toBe(150);
      await pg.idempotency.remember(key, "fingerprint-a");
      expect(await pg.idempotency.find(key)).toBe("fingerprint-a");
    });

    it("is idempotent about being remembered twice", async () => {
      // A retry of the same request must not turn into a 23505: the store's job is to
      // recognise the repeat, not to punish it.
      await pg.idempotency.remember("vehicle:WS-1000000001:veh-000001", "fingerprint-a");
      await pg.idempotency.remember("vehicle:WS-1000000001:veh-000001", "fingerprint-a");
      expect(await pg.idempotency.find("vehicle:WS-1000000001:veh-000001")).toBe("fingerprint-a");
    });
  });
});
