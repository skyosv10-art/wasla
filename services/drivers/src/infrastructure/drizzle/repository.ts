/**
 * Postgres adapters for the Driver Core ports (Phase 05 · MR 3/6).
 *
 * Nine adapters against the canonical DDL in `services/drivers/contracts/schema.sql`:
 * profiles, service zones, vehicles, documents, eligibility policies, the
 * eligibility log, candidacy publications, the outbox and the idempotency store.
 *
 * The binding criterion published in advance for this MR (HANDOFF §11,
 * DRIVER_CORE_DOMAIN §13, precedent ORDER_PERSISTENCE §1 and DISPATCH_PERSISTENCE §1):
 * **the same use-case tests must pass against these adapters, and no file under
 * `src/use-cases/` may change to make them pass.** `port-conformance.integration.test.ts`
 * runs one set of scenarios twice — once per adapter — and compares the two traces to
 * each other rather than to a hand-written expectation, so a difference cannot be
 * absorbed by editing an assertion.
 *
 * Atomicity (schema.sql §8, ADR-012): every adapter takes a `DbOrTx` handle instead
 * of opening its own transaction. `PostgresDriverUnitOfWork` (transaction.ts) hands
 * the SAME tx to all nine, so one document review — the superseding UPDATE, the new
 * row, the fingerprint, the derived `verification_status`, both outbox events, the
 * eligibility log row, the publication row and `last_published_state` — commits or
 * rolls back together. A review committed without its eligibility log row is the one
 * outcome this service exists to prevent: a state change nobody can explain.
 *
 * Five deliberate choices, each with a cheaper wrong version:
 *
 *  1. **Write ORDER inside `saveAll` is the adapter's responsibility.** Two partial
 *     unique indexes are checked per STATEMENT, not at commit:
 *     `ux_driver_vehicles_one_primary` and `ux_driver_documents_one_live_per_type`.
 *     The cheap version writes the caller's array in order and passes in memory —
 *     where a set is validated as a whole — while failing on Postgres the first time
 *     a promotion happens to precede its demotion. So `saveAll` sorts: rows LEAVING
 *     the exclusive slot are written before rows entering it. `ports.ts` says this is
 *     the adapter's decision precisely so no use case has to know it.
 *
 *  2. **Membership is checked with `SELECT … FOR UPDATE` before any write.** The
 *     in-memory store validates the whole staged set and then throws
 *     `vehicleNotFound()` / `documentNotFound()`; a bare `UPDATE … WHERE id = …`
 *     would instead affect zero rows and report success. The row lock also closes a
 *     read-then-write race the in-memory store cannot have: two concurrent reviews of
 *     one document.
 *
 *  3. **Every list has an explicit ORDER BY that reproduces the in-memory order.**
 *     Postgres has no insertion order, and a suite that agrees only because rows
 *     happened to come back in physical order agrees by luck. Vehicles and documents
 *     order by `(created_at, id)` — the in-memory stores are insertion-ordered Maps —
 *     zones by `preference_rank`, the append-only tables by their `BIGSERIAL id`, and
 *     `listDueForRecheck` by `eligibility_recheck_at` ascending so a tick under its
 *     limit cannot starve the driver whose licence expired first.
 *
 *  4. **`TIMESTAMPTZ` becomes an ISO string here, once; `DATE` stays a string
 *     always.** `pg` returns `Date` for TIMESTAMPTZ, and one escaping `Date` would
 *     make `updatedAt` sometimes a string and sometimes an object. Drizzle's `date()`
 *     is read in string mode on purpose: `domain/documents.ts` reads an expiry as
 *     `T00:00:00Z`, and a `Date` built from a bare date would carry the server's
 *     local timezone into a licence's expiry — a driver in Riyadh losing his
 *     eligibility three hours early.
 *
 *  5. **`updated_at` is never written.** The three BEFORE UPDATE triggers
 *     (`trg_driver_profiles_updated_at`, `trg_driver_vehicles_updated_at`,
 *     `trg_driver_documents_updated_at`) own it,
 *     exactly as the in-memory stores stamp it themselves and refuse it from
 *     a caller: it is the column an audit reads to order two changes, and a writer who
 *     can set it can make an old change look new. The adapters therefore RE-READ the
 *     row after writing, so the returned `updatedAt` is the trigger's value and not a
 *     guess.
 */

import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";

import type {
  CandidacyPublication,
  DocumentStatus,
  DocumentType,
  DriverDocument,
  DriverProfile,
  EligibilityLogEntry,
  EligibilityPolicy,
  EligibilityReasonCode,
  EligibilityState,
  EligibilityTrigger,
  Locale,
  ProfileStatus,
  ProjectedAvailability,
  PublicationOutcome,
  ServiceKind,
  ServiceZone,
  Vehicle,
  VehicleClass,
  VehicleStatus,
  VerificationStatus,
} from "../../domain/model.js";
import {
  documentNotFound,
  driverAlreadyExists,
  driverNotFound,
  idempotencyKeyReused,
  vehicleNotFound,
} from "../../domain/errors.js";
import type { DriverDomainEvent } from "../../domain/events.js";
import type {
  CandidacyPublicationRepository,
  CreateDocumentInput,
  CreateProfileInput,
  CreateVehicleInput,
  DocumentRepository,
  DriverProfileRepository,
  EligibilityLogRepository,
  EligibilityPolicyRepository,
  IdempotencyStore,
  Outbox,
  ProfileMutation,
  ServiceZoneRepository,
  VehicleRepository,
} from "../../ports.js";
import type { DbOrTx } from "./db.js";
import {
  driverCandidacyPublications,
  driverDocuments,
  driverEligibilityLog,
  driverEligibilityPolicies,
  driverIdempotency,
  driverOutbox,
  driverProfiles,
  driverServiceZones,
  driverVehicles,
} from "./schema.js";

// --------------------------------------------------------------------------- //
// Column ⇄ domain conversions                                                //
// --------------------------------------------------------------------------- //

/** `pg` returns TIMESTAMPTZ as a Date; the domain speaks ISO-8601 strings. */
function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** Non-null variant for the columns the contract declares NOT NULL. */
function toIsoRequired(value: Date): string {
  return value.toISOString();
}

type ProfileRow = typeof driverProfiles.$inferSelect;
type ZoneRow = typeof driverServiceZones.$inferSelect;
type VehicleRow = typeof driverVehicles.$inferSelect;
type DocumentRow = typeof driverDocuments.$inferSelect;
type PolicyRow = typeof driverEligibilityPolicies.$inferSelect;
type LogRow = typeof driverEligibilityLog.$inferSelect;
type PublicationRow = typeof driverCandidacyPublications.$inferSelect;

/**
 * The casts below describe what a CHECK constraint already guarantees.
 *
 * `preferred_locale IN ('ar','en','ur')` is enforced by the database, so widening it
 * to `string` in the domain and re-validating on every read would add a code path
 * that can only fire if the DDL was edited without this file — which is exactly what
 * `schema-drift.test.ts` is for.
 */
function toProfile(row: ProfileRow): DriverProfile {
  return {
    waslaPublicId: row.waslaPublicId,
    displayName: row.displayName,
    preferredLocale: row.preferredLocale as Locale,
    workCityZoneId: row.workCityZoneId,
    serviceKinds: row.serviceKinds as ServiceKind[],
    declaredAvailability: row.declaredAvailability as DriverProfile["declaredAvailability"],
    verificationStatus: row.verificationStatus as VerificationStatus,
    status: row.status as ProfileStatus,
    suspensionReasonCode: row.suspensionReasonCode,
    eligibilityPolicyVersion: row.eligibilityPolicyVersion,
    eligibilityRecheckAt: toIso(row.eligibilityRecheckAt),
    lastPublishedState: row.lastPublishedState as EligibilityState | null,
    lastPublishedAt: toIso(row.lastPublishedAt),
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

function toZone(row: ZoneRow): ServiceZone {
  return {
    zoneId: row.zoneId,
    preferenceRank: row.preferenceRank,
    createdAt: toIsoRequired(row.createdAt),
  };
}

function toVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    waslaPublicId: row.waslaPublicId,
    vehicleClass: row.vehicleClass as VehicleClass,
    make: row.make,
    model: row.model,
    modelYear: row.modelYear,
    color: row.color,
    plateNumber: row.plateNumber,
    isPrimary: row.isPrimary,
    status: row.status as VehicleStatus,
    idempotencyKey: row.idempotencyKey,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

function toDocument(row: DocumentRow): DriverDocument {
  return {
    id: row.id,
    waslaPublicId: row.waslaPublicId,
    documentType: row.documentType as DocumentType,
    storageRef: row.storageRef,
    vehicleId: row.vehicleId,
    status: row.status as DocumentStatus,
    // Already "YYYY-MM-DD": drizzle `date()` reads in string mode (choice 4).
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    reviewedAt: toIso(row.reviewedAt),
    reviewedBy: row.reviewedBy,
    rejectionReasonCode: row.rejectionReasonCode,
    idempotencyKey: row.idempotencyKey,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

function toPolicy(row: PolicyRow): EligibilityPolicy {
  return {
    version: row.version,
    label: row.label,
    requiredDocumentsRide: row.requiredDocumentsRide as DocumentType[],
    requiredDocumentsDelivery: row.requiredDocumentsDelivery as DocumentType[],
    requirePrimaryVehicle: row.requirePrimaryVehicle,
    requireServiceZone: row.requireServiceZone,
    documentGraceDays: row.documentGraceDays,
    isFrozen: row.isFrozen,
    createdAt: toIsoRequired(row.createdAt),
  };
}

function toLogEntry(row: LogRow): EligibilityLogEntry {
  return {
    waslaPublicId: row.waslaPublicId,
    fromState: row.fromState as EligibilityState | null,
    toState: row.toState as EligibilityState,
    reasons: row.reasons as EligibilityReasonCode[],
    policyVersion: row.policyVersion,
    trigger: row.trigger as EligibilityTrigger,
    evaluatedAt: toIsoRequired(row.evaluatedAt),
  };
}

function toPublication(row: PublicationRow): CandidacyPublication {
  return {
    waslaPublicId: row.waslaPublicId,
    eligibilityState: row.eligibilityState as EligibilityState,
    availabilityState: row.availabilityState as ProjectedAvailability,
    serviceKinds: row.serviceKinds as ServiceKind[],
    zoneIds: row.zoneIds,
    vehicleClass: row.vehicleClass as VehicleClass | null,
    outcome: row.outcome as PublicationOutcome,
    failureCode: row.failureCode,
    attemptedAt: toIsoRequired(row.attemptedAt),
  };
}

// --------------------------------------------------------------------------- //
// Database error unwrapping                                                  //
// --------------------------------------------------------------------------- //

/**
 * SQLSTATE of a `pg` error, however deeply Drizzle wrapped it.
 *
 * Drizzle wraps the driver error in `DrizzleQueryError`, so reading `error.code`
 * directly finds nothing and every translation below would silently stop working —
 * the failure mode is not a crash but a 500 where a 409 was intended.
 */
function sqlState(error: unknown): string | undefined {
  let cursor: unknown = error;
  for (let depth = 0; depth < 4 && cursor !== null && cursor !== undefined; depth += 1) {
    if (typeof cursor !== "object") return undefined;
    const code = (cursor as { code?: unknown }).code;
    // A SQLSTATE is exactly five characters; Node's own error codes
    // ("ECONNREFUSED", "ERR_…") are not, and must not be mistaken for one.
    if (typeof code === "string" && code.length === 5) return code;
    const cause = (cursor as { cause?: unknown }).cause;
    if (cause === cursor) return undefined;
    cursor = cause;
  }
  return undefined;
}

/** Name of the violated constraint, when the driver exposes it. */
function constraintName(error: unknown): string | undefined {
  let cursor: unknown = error;
  for (let depth = 0; depth < 4 && cursor !== null && cursor !== undefined; depth += 1) {
    if (typeof cursor !== "object") return undefined;
    const constraint = (cursor as { constraint?: unknown }).constraint;
    if (typeof constraint === "string") return constraint;
    const cause = (cursor as { cause?: unknown }).cause;
    if (cause === cursor) return undefined;
    cursor = cause;
  }
  return undefined;
}

/**
 * Re-throw a database error with the violated constraint named in its message.
 *
 * Anything not translated into a domain error still has to be READABLE. Drizzle's own
 * message is the SQL text, which says what was attempted but not which promise of the
 * DDL refused it.
 */
function rethrowNamed(error: unknown): never {
  const constraint = constraintName(error);
  if (constraint !== undefined && error instanceof Error) {
    error.message = `${constraint}: ${error.message}`;
  }
  throw error;
}

/** SQLSTATE 23505 — unique violation. */
const UNIQUE_VIOLATION = "23505";

/** The two document statuses the one-live-per-type index applies to. */
const LIVE_DOCUMENT_STATUSES: readonly DocumentStatus[] = ["pending", "verified"];

function isLive(status: DocumentStatus): boolean {
  return status === "pending" || status === "verified";
}

// --------------------------------------------------------------------------- //
// 1) driver_profiles                                                         //
// --------------------------------------------------------------------------- //

export class PostgresDriverProfileRepository implements DriverProfileRepository {
  constructor(private readonly db: DbOrTx) {}

  async find(waslaPublicId: string): Promise<DriverProfile | null> {
    const rows = await this.db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.waslaPublicId, waslaPublicId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toProfile(row);
  }

  async create(input: CreateProfileInput): Promise<DriverProfile> {
    try {
      const rows = await this.db
        .insert(driverProfiles)
        .values({
          waslaPublicId: input.waslaPublicId,
          displayName: input.displayName,
          preferredLocale: input.preferredLocale,
          workCityZoneId: input.workCityZoneId,
          serviceKinds: [...input.serviceKinds],
          // The three DDL defaults are written explicitly: the in-memory store sets
          // them too, and a default that exists in only one adapter is a difference
          // waiting to be discovered by a test that never runs both.
          declaredAvailability: "offline",
          verificationStatus: "unverified",
          status: "active",
          suspensionReasonCode: null,
          eligibilityPolicyVersion: input.eligibilityPolicyVersion,
          createdAt: new Date(input.createdAt),
        })
        .returning();
      const row = rows[0];
      if (row === undefined) throw driverNotFound();
      return toProfile(row);
    } catch (error) {
      // Registering twice is a caller fact, not a server failure: 409, the same as
      // the in-memory store's `driver_profiles_pkey`.
      if (sqlState(error) === UNIQUE_VIOLATION) throw driverAlreadyExists();
      return rethrowNamed(error);
    }
  }

  async update(waslaPublicId: string, mutation: ProfileMutation, _at: string): Promise<DriverProfile> {
    // FOR UPDATE, then patch: the profile carries `verification_status`, which one
    // writer derives from the documents. Two concurrent reviews of two documents of
    // the same driver would otherwise both read the old value and the later write
    // would erase the earlier verdict.
    await this.lock(waslaPublicId);

    // Presence, not truthiness: `displayName: null` clears the name, and
    // `mutation.displayName ?? undefined` would silently turn that into a no-op.
    const patch = {
      ...("displayName" in mutation ? { displayName: mutation.displayName ?? null } : {}),
      ...(mutation.preferredLocale === undefined ? {} : { preferredLocale: mutation.preferredLocale }),
      ...("workCityZoneId" in mutation ? { workCityZoneId: mutation.workCityZoneId ?? null } : {}),
      ...(mutation.serviceKinds === undefined ? {} : { serviceKinds: [...mutation.serviceKinds] }),
      ...(mutation.declaredAvailability === undefined
        ? {}
        : { declaredAvailability: mutation.declaredAvailability }),
      ...(mutation.verificationStatus === undefined
        ? {}
        : { verificationStatus: mutation.verificationStatus }),
      ...(mutation.status === undefined ? {} : { status: mutation.status }),
      ...("suspensionReasonCode" in mutation
        ? { suspensionReasonCode: mutation.suspensionReasonCode ?? null }
        : {}),
    };

    if (Object.keys(patch).length === 0) {
      // An empty patch still stamps `updated_at` in memory (the store sets it from
      // the clock), so the trigger must fire here too or the two adapters would disagree
      // about whether "nothing changed" is a change. `updated_at` itself is left to
      // the trigger; touching any column is enough to make it fire.
      return this.touch(waslaPublicId);
    }

    try {
      const rows = await this.db
        .update(driverProfiles)
        .set(patch)
        .where(eq(driverProfiles.waslaPublicId, waslaPublicId))
        .returning();
      const row = rows[0];
      if (row === undefined) throw driverNotFound();
      return toProfile(row);
    } catch (error) {
      return rethrowNamed(error);
    }
  }

  // `_at` is unused: `updated_at` belongs to the trigger (choice 5), and
  // `eligibility_recheck_at` is a FUTURE instant that has nothing to do with now.
  async setRecheckAt(
    waslaPublicId: string,
    recheckAt: string | null,
    _at: string,
  ): Promise<DriverProfile> {
    await this.lock(waslaPublicId);
    const rows = await this.db
      .update(driverProfiles)
      .set({ eligibilityRecheckAt: recheckAt === null ? null : new Date(recheckAt) })
      .where(eq(driverProfiles.waslaPublicId, waslaPublicId))
      .returning();
    const row = rows[0];
    if (row === undefined) throw driverNotFound();
    return toProfile(row);
  }

  async recordPublication(
    waslaPublicId: string,
    state: EligibilityState,
    at: string,
  ): Promise<DriverProfile> {
    await this.lock(waslaPublicId);
    const rows = await this.db
      .update(driverProfiles)
      // `last_published_at` is NOT the trigger's column: it records what matching was
      // told and when, so the drift between local truth and published truth stays
      // measurable. It therefore takes the caller's instant, not `now()`.
      .set({ lastPublishedState: state, lastPublishedAt: new Date(at) })
      .where(eq(driverProfiles.waslaPublicId, waslaPublicId))
      .returning();
    const row = rows[0];
    if (row === undefined) throw driverNotFound();
    return toProfile(row);
  }

  async listDueForRecheck(now: string, limit: number): Promise<DriverProfile[]> {
    const rows = await this.db
      .select()
      .from(driverProfiles)
      .where(lte(driverProfiles.eligibilityRecheckAt, new Date(now)))
      // Oldest due first, then a stable tiebreak: a tick that runs under its limit
      // must not starve the driver whose licence expired first, and two drivers due
      // at the same instant must not swap places between runs.
      .orderBy(asc(driverProfiles.eligibilityRecheckAt), asc(driverProfiles.waslaPublicId))
      .limit(limit);
    return rows.map(toProfile);
  }

  /** `SELECT … FOR UPDATE`, raising the same 404 the in-memory store raises. */
  private async lock(waslaPublicId: string): Promise<void> {
    const rows = await this.db
      .select({ id: driverProfiles.waslaPublicId })
      .from(driverProfiles)
      .where(eq(driverProfiles.waslaPublicId, waslaPublicId))
      .limit(1)
      .for("update");
    if (rows[0] === undefined) throw driverNotFound();
  }

  /** Rewrite a column with its own value so the `updated_at` trigger fires. */
  private async touch(waslaPublicId: string): Promise<DriverProfile> {
    const rows = await this.db
      .update(driverProfiles)
      .set({ displayName: sql`${driverProfiles.displayName}` })
      .where(eq(driverProfiles.waslaPublicId, waslaPublicId))
      .returning();
    const row = rows[0];
    if (row === undefined) throw driverNotFound();
    return toProfile(row);
  }
}

// --------------------------------------------------------------------------- //
// 2) driver_service_zones                                                    //
// --------------------------------------------------------------------------- //

export class PostgresServiceZoneRepository implements ServiceZoneRepository {
  constructor(private readonly db: DbOrTx) {}

  async list(waslaPublicId: string): Promise<ServiceZone[]> {
    const rows = await this.db
      .select()
      .from(driverServiceZones)
      .where(eq(driverServiceZones.waslaPublicId, waslaPublicId))
      // Ordered by preference: "his first choice" is a question with one answer.
      .orderBy(asc(driverServiceZones.preferenceRank));
    return rows.map(toZone);
  }

  async replace(
    waslaPublicId: string,
    zones: readonly { zoneId: string; preferenceRank: number }[],
    at: string,
  ): Promise<ServiceZone[]> {
    // DELETE then INSERT, inside the caller's transaction. A merge would turn a
    // removal into a no-op the driver cannot see; and deleting first is also what
    // makes re-ranking possible at all — swapping ranks 1 and 2 by two UPDATEs
    // violates `ux_driver_service_zones_rank` halfway through.
    try {
      await this.db.delete(driverServiceZones).where(eq(driverServiceZones.waslaPublicId, waslaPublicId));
      if (zones.length > 0) {
        await this.db.insert(driverServiceZones).values(
          zones.map((zone) => ({
            waslaPublicId,
            zoneId: zone.zoneId,
            preferenceRank: zone.preferenceRank,
            createdAt: new Date(at),
          })),
        );
      }
      return this.list(waslaPublicId);
    } catch (error) {
      return rethrowNamed(error);
    }
  }
}

// --------------------------------------------------------------------------- //
// 3) driver_vehicles                                                         //
// --------------------------------------------------------------------------- //

export class PostgresVehicleRepository implements VehicleRepository {
  constructor(private readonly db: DbOrTx) {}

  async list(waslaPublicId: string): Promise<Vehicle[]> {
    const rows = await this.db
      .select()
      .from(driverVehicles)
      .where(eq(driverVehicles.waslaPublicId, waslaPublicId))
      // Creation order, matching the in-memory Map's insertion order (choice 3).
      .orderBy(asc(driverVehicles.createdAt), asc(driverVehicles.id));
    return rows.map(toVehicle);
  }

  async find(waslaPublicId: string, vehicleId: string): Promise<Vehicle | null> {
    const rows = await this.db
      .select()
      .from(driverVehicles)
      // Scoped by owner, not by id alone: an id is enough to read a row, and one
      // driver must never be able to read another's vehicle by guessing a uuid.
      .where(and(eq(driverVehicles.waslaPublicId, waslaPublicId), eq(driverVehicles.id, vehicleId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toVehicle(row);
  }

  async findByIdempotencyKey(waslaPublicId: string, key: string): Promise<Vehicle | null> {
    const rows = await this.db
      .select()
      .from(driverVehicles)
      .where(and(eq(driverVehicles.waslaPublicId, waslaPublicId), eq(driverVehicles.idempotencyKey, key)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toVehicle(row);
  }

  async create(input: CreateVehicleInput): Promise<Vehicle> {
    try {
      const rows = await this.db
        .insert(driverVehicles)
        .values({
          id: input.id,
          waslaPublicId: input.waslaPublicId,
          vehicleClass: input.vehicleClass,
          make: input.make,
          model: input.model,
          modelYear: input.modelYear,
          color: input.color,
          plateNumber: input.plateNumber,
          isPrimary: input.isPrimary,
          status: "active",
          idempotencyKey: input.idempotencyKey,
          createdAt: new Date(input.createdAt),
        })
        .returning();
      const row = rows[0];
      if (row === undefined) throw vehicleNotFound();
      return toVehicle(row);
    } catch (error) {
      if (sqlState(error) === UNIQUE_VIOLATION) {
        const constraint = constraintName(error) ?? "";
        // A second row under the same key is a retry the use case already looked for
        // and did not find — i.e. a key reused with a different payload. 409, not 500.
        if (constraint.includes("idempotency")) throw idempotencyKeyReused();
      }
      return rethrowNamed(error);
    }
  }

  async saveAll(vehicles: readonly Vehicle[]): Promise<Vehicle[]> {
    if (vehicles.length === 0) return [];

    // Membership first, for the whole set, exactly as the in-memory store validates
    // before writing: `saveAll` of an unknown id is 404, not a silent zero-row UPDATE.
    const ids = vehicles.map((vehicle) => vehicle.id);
    const locked = await this.db
      .select({ id: driverVehicles.id })
      .from(driverVehicles)
      .where(inArray(driverVehicles.id, ids))
      .for("update");
    if (locked.length !== new Set(ids).size) throw vehicleNotFound();

    // Demotions before promotions (choice 1): `ux_driver_vehicles_one_primary`
    // tolerates zero primaries for an instant inside this transaction and never two.
    const ordered = [...vehicles].sort(
      (left, right) => Number(left.isPrimary) - Number(right.isPrimary),
    );

    try {
      for (const vehicle of ordered) {
        await this.db
          .update(driverVehicles)
          .set({
            vehicleClass: vehicle.vehicleClass,
            make: vehicle.make,
            model: vehicle.model,
            modelYear: vehicle.modelYear,
            color: vehicle.color,
            plateNumber: vehicle.plateNumber,
            isPrimary: vehicle.isPrimary,
            status: vehicle.status,
          })
          .where(eq(driverVehicles.id, vehicle.id));
      }
    } catch (error) {
      return rethrowNamed(error);
    }

    // Re-read rather than echo the input: `updated_at` belongs to the trigger
    // (choice 5), and returning the caller's value would report a timestamp the
    // database does not hold.
    const rows = await this.db.select().from(driverVehicles).where(inArray(driverVehicles.id, ids));
    const byId = new Map(rows.map((row) => [row.id, toVehicle(row)]));
    return vehicles.map((vehicle) => {
      const row = byId.get(vehicle.id);
      if (row === undefined) throw vehicleNotFound();
      return row;
    });
  }
}

// --------------------------------------------------------------------------- //
// 4) driver_documents                                                        //
// --------------------------------------------------------------------------- //

export class PostgresDocumentRepository implements DocumentRepository {
  constructor(private readonly db: DbOrTx) {}

  async list(waslaPublicId: string): Promise<DriverDocument[]> {
    const rows = await this.db
      .select()
      .from(driverDocuments)
      .where(eq(driverDocuments.waslaPublicId, waslaPublicId))
      .orderBy(asc(driverDocuments.createdAt), asc(driverDocuments.id));
    return rows.map(toDocument);
  }

  async find(waslaPublicId: string, documentId: string): Promise<DriverDocument | null> {
    const rows = await this.db
      .select()
      .from(driverDocuments)
      .where(and(eq(driverDocuments.waslaPublicId, waslaPublicId), eq(driverDocuments.id, documentId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toDocument(row);
  }

  async findByIdempotencyKey(waslaPublicId: string, key: string): Promise<DriverDocument | null> {
    const rows = await this.db
      .select()
      .from(driverDocuments)
      .where(
        and(eq(driverDocuments.waslaPublicId, waslaPublicId), eq(driverDocuments.idempotencyKey, key)),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toDocument(row);
  }

  async findLive(
    waslaPublicId: string,
    documentType: DocumentType,
    vehicleId: string | null,
  ): Promise<DriverDocument | null> {
    // The predicate mirrors `ux_driver_documents_one_live_per_type` term for term,
    // including its COALESCE: reading with a plain `vehicle_id = NULL` would find
    // nothing for personal documents (NULL = NULL is unknown in SQL), the caller
    // would create a second live copy, and the index would refuse the insert with a
    // constraint name instead of the use case superseding the old copy.
    const nilUuid = "00000000-0000-0000-0000-000000000000";
    const rows = await this.db
      .select()
      .from(driverDocuments)
      .where(
        and(
          eq(driverDocuments.waslaPublicId, waslaPublicId),
          eq(driverDocuments.documentType, documentType),
          sql`COALESCE(${driverDocuments.vehicleId}, ${nilUuid}::uuid) = COALESCE(${vehicleId}::uuid, ${nilUuid}::uuid)`,
          inArray(driverDocuments.status, [...LIVE_DOCUMENT_STATUSES]),
        ),
      )
      .orderBy(asc(driverDocuments.createdAt), asc(driverDocuments.id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toDocument(row);
  }

  async create(input: CreateDocumentInput): Promise<DriverDocument> {
    try {
      const rows = await this.db
        .insert(driverDocuments)
        .values({
          id: input.id,
          waslaPublicId: input.waslaPublicId,
          documentType: input.documentType,
          storageRef: input.storageRef,
          vehicleId: input.vehicleId,
          status: "pending",
          issuedAt: input.issuedAt,
          expiresAt: input.expiresAt,
          idempotencyKey: input.idempotencyKey,
          createdAt: new Date(input.createdAt),
        })
        .returning();
      const row = rows[0];
      if (row === undefined) throw documentNotFound();
      return toDocument(row);
    } catch (error) {
      if (sqlState(error) === UNIQUE_VIOLATION) {
        const constraint = constraintName(error) ?? "";
        if (constraint.includes("idempotency")) throw idempotencyKeyReused();
      }
      return rethrowNamed(error);
    }
  }

  async saveAll(documents: readonly DriverDocument[]): Promise<DriverDocument[]> {
    if (documents.length === 0) return [];

    const ids = documents.map((document) => document.id);
    const locked = await this.db
      .select({ id: driverDocuments.id })
      .from(driverDocuments)
      .where(inArray(driverDocuments.id, ids))
      .for("update");
    if (locked.length !== new Set(ids).size) throw documentNotFound();

    // Rows LEAVING the live set are written before rows entering it (choice 1), for
    // `ux_driver_documents_one_live_per_type`. `submitDocument` already supersedes
    // before it creates, so today this sort never has anything to reorder — it is
    // here so that the day a caller batches a supersede and a re-activation into one
    // `saveAll`, the adapter does not fail on Postgres while passing in memory.
    const ordered = [...documents].sort(
      (left, right) => Number(isLive(left.status)) - Number(isLive(right.status)),
    );

    try {
      for (const document of ordered) {
        await this.db
          .update(driverDocuments)
          .set({
            storageRef: document.storageRef,
            status: document.status,
            issuedAt: document.issuedAt,
            expiresAt: document.expiresAt,
            reviewedAt: document.reviewedAt === null ? null : new Date(document.reviewedAt),
            reviewedBy: document.reviewedBy,
            rejectionReasonCode: document.rejectionReasonCode,
          })
          .where(eq(driverDocuments.id, document.id));
      }
    } catch (error) {
      return rethrowNamed(error);
    }

    const rows = await this.db.select().from(driverDocuments).where(inArray(driverDocuments.id, ids));
    const byId = new Map(rows.map((row) => [row.id, toDocument(row)]));
    return documents.map((document) => {
      const row = byId.get(document.id);
      if (row === undefined) throw documentNotFound();
      return row;
    });
  }
}

// --------------------------------------------------------------------------- //
// 5) driver_eligibility_policies — read-only                                 //
// --------------------------------------------------------------------------- //

/**
 * Read-only, deliberately: version 1 is seeded and frozen by schema.sql, and a new
 * version is a migration. A decision made under version 1 must stay reproducible
 * forever, and a repository with a `save` is how "frozen" quietly stops being true.
 */
export class PostgresEligibilityPolicyRepository implements EligibilityPolicyRepository {
  constructor(private readonly db: DbOrTx) {}

  async find(version: number): Promise<EligibilityPolicy | null> {
    const rows = await this.db
      .select()
      .from(driverEligibilityPolicies)
      .where(eq(driverEligibilityPolicies.version, version))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toPolicy(row);
  }

  async findActive(): Promise<EligibilityPolicy | null> {
    // The newest FROZEN version, matching the in-memory store: an unfrozen draft is
    // not the rule anyone was judged by.
    const rows = await this.db
      .select()
      .from(driverEligibilityPolicies)
      .where(eq(driverEligibilityPolicies.isFrozen, true))
      .orderBy(desc(driverEligibilityPolicies.version))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toPolicy(row);
  }

  async list(): Promise<EligibilityPolicy[]> {
    const rows = await this.db
      .select()
      .from(driverEligibilityPolicies)
      .orderBy(asc(driverEligibilityPolicies.version));
    return rows.map(toPolicy);
  }
}

// --------------------------------------------------------------------------- //
// 6) driver_eligibility_log — append-only                                    //
// --------------------------------------------------------------------------- //

export class PostgresEligibilityLogRepository implements EligibilityLogRepository {
  constructor(private readonly db: DbOrTx) {}

  async append(entry: EligibilityLogEntry): Promise<EligibilityLogEntry> {
    try {
      const rows = await this.db
        .insert(driverEligibilityLog)
        .values({
          waslaPublicId: entry.waslaPublicId,
          fromState: entry.fromState,
          toState: entry.toState,
          reasons: [...entry.reasons],
          policyVersion: entry.policyVersion,
          trigger: entry.trigger,
          evaluatedAt: new Date(entry.evaluatedAt),
        })
        .returning();
      const row = rows[0];
      if (row === undefined) throw driverNotFound();
      return toLogEntry(row);
    } catch (error) {
      return rethrowNamed(error);
    }
  }

  async latest(waslaPublicId: string): Promise<EligibilityLogEntry | null> {
    // Newest by `id`, NOT by `evaluated_at`: a recomputation chain inside one request
    // shares a single clock value, so ordering by the timestamp would make "the
    // previous state" a coin toss between two rows written microseconds apart.
    const rows = await this.db
      .select()
      .from(driverEligibilityLog)
      .where(eq(driverEligibilityLog.waslaPublicId, waslaPublicId))
      .orderBy(desc(driverEligibilityLog.id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toLogEntry(row);
  }

  async list(waslaPublicId: string): Promise<EligibilityLogEntry[]> {
    const rows = await this.db
      .select()
      .from(driverEligibilityLog)
      .where(eq(driverEligibilityLog.waslaPublicId, waslaPublicId))
      .orderBy(asc(driverEligibilityLog.id));
    return rows.map(toLogEntry);
  }
}

// --------------------------------------------------------------------------- //
// 7) driver_candidacy_publications — append-only                             //
// --------------------------------------------------------------------------- //

export class PostgresCandidacyPublicationRepository implements CandidacyPublicationRepository {
  constructor(private readonly db: DbOrTx) {}

  async append(publication: CandidacyPublication): Promise<CandidacyPublication> {
    try {
      const rows = await this.db
        .insert(driverCandidacyPublications)
        .values({
          waslaPublicId: publication.waslaPublicId,
          eligibilityState: publication.eligibilityState,
          availabilityState: publication.availabilityState,
          serviceKinds: [...publication.serviceKinds],
          zoneIds: [...publication.zoneIds],
          vehicleClass: publication.vehicleClass,
          outcome: publication.outcome,
          failureCode: publication.failureCode,
          attemptedAt: new Date(publication.attemptedAt),
        })
        .returning();
      const row = rows[0];
      if (row === undefined) throw driverNotFound();
      return toPublication(row);
    } catch (error) {
      return rethrowNamed(error);
    }
  }

  async list(waslaPublicId: string): Promise<CandidacyPublication[]> {
    const rows = await this.db
      .select()
      .from(driverCandidacyPublications)
      .where(eq(driverCandidacyPublications.waslaPublicId, waslaPublicId))
      .orderBy(asc(driverCandidacyPublications.id));
    return rows.map(toPublication);
  }
}

// --------------------------------------------------------------------------- //
// 8) driver_outbox                                                           //
// --------------------------------------------------------------------------- //

export class PostgresDriverOutbox implements Outbox {
  constructor(private readonly db: DbOrTx) {}

  async append(event: DriverDomainEvent): Promise<void> {
    try {
      await this.db.insert(driverOutbox).values({
        eventId: event.event_id,
        eventType: event.event_type,
        eventVersion: event.event_version,
        aggregateType: event.aggregate.type,
        aggregateId: event.aggregate.id,
        // The WHOLE envelope, `trace_id` included. There is no trace column on
        // purpose: a relay republishes exactly what the producer built, and a column
        // that duplicates a payload key is a second copy that can disagree.
        payload: event as unknown as Record<string, unknown>,
        occurredAt: new Date(event.occurred_at),
      });
    } catch (error) {
      return rethrowNamed(error);
    }
  }

  async unread(): Promise<DriverDomainEvent[]> {
    const rows = await this.db
      .select()
      .from(driverOutbox)
      .where(isNull(driverOutbox.publishedAt))
      // Production order, with `id` as the tiebreak: several events of one operation
      // share `occurred_at` down to the millisecond, and a consumer that reads
      // "eligibility changed" before "document reviewed" cannot explain the change.
      .orderBy(asc(driverOutbox.occurredAt), asc(driverOutbox.id));
    return rows.map((row) => row.payload as unknown as DriverDomainEvent);
  }

  /**
   * Mark events published. Used by the Phase 09 relay, not by any use case — the
   * port deliberately does not expose it, so nothing in the domain can decide that
   * an event was delivered.
   */
  async markPublished(eventIds: readonly string[], at: string): Promise<void> {
    if (eventIds.length === 0) return;
    await this.db
      .update(driverOutbox)
      .set({ publishedAt: new Date(at) })
      .where(inArray(driverOutbox.eventId, [...eventIds]));
  }
}

// --------------------------------------------------------------------------- //
// 9) driver_idempotency                                                      //
// --------------------------------------------------------------------------- //

export class PostgresDriverIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: DbOrTx) {}

  async find(key: string): Promise<string | null> {
    const rows = await this.db
      .select({ fingerprint: driverIdempotency.payloadFingerprint })
      .from(driverIdempotency)
      .where(eq(driverIdempotency.idempotencyKey, key))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : row.fingerprint;
  }

  async remember(key: string, payloadFingerprint: string): Promise<void> {
    // Upsert, not insert: `remember` is called on a path a client is allowed to
    // retry, and a primary-key violation on the second attempt would turn a
    // successful retry into a 500. Detecting a REUSED key is the use case's job (it
    // compares the stored fingerprint before writing); this method only records.
    await this.db
      .insert(driverIdempotency)
      .values({ idempotencyKey: key, payloadFingerprint })
      .onConflictDoUpdate({
        target: driverIdempotency.idempotencyKey,
        set: { payloadFingerprint },
      });
  }
}
