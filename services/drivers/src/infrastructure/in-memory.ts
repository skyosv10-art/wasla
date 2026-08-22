/**
 * In-memory adapters (MR 2/6).
 *
 * They exist so the domain can be proven without a database — the whole suite
 * runs in milliseconds — and so MR 3/6 has a parity target: the Postgres
 * repositories must make the same use-case tests pass with no change to
 * `src/use-cases/`, which is the written criterion inherited from Phase 06
 * (ORDER_PERSISTENCE.md).
 *
 * They therefore imitate the CONSTRAINTS of schema.sql and not merely its
 * columns, and they name each one **exactly as the database names it**. That
 * naming is the point: when MR 3/6 makes Postgres raise
 * `ux_driver_documents_one_live_per_type`, the failure the in-memory suite
 * produces for the same mistake is already the same string, so a reader is not
 * left comparing two vocabularies for the same rule.
 *
 * Simulated here, by name:
 *  - `ck_driver_profiles_suspension_reason` — a suspension carries its reason.
 *  - `ux_driver_service_zones_rank` — one zone per rank.
 *  - `ux_driver_vehicles_one_primary` — at most one primary per driver.
 *  - `ck_driver_vehicles_retired_not_primary` — a retired vehicle is not primary.
 *  - `ux_driver_vehicles_idempotency`, `ux_driver_documents_idempotency`.
 *  - `ck_driver_documents_review_coherence` — every decision carries who and when.
 *  - `ck_driver_documents_vehicle_scope` — vehicle papers name a vehicle.
 *  - `ux_driver_documents_one_live_per_type` — one live copy per type per vehicle.
 *
 * `updated_at` is stamped by the STORE, never accepted from a caller: it is the
 * column an audit reads to order two changes, and a caller that can set it can
 * make an old change look new.
 */

import { randomUUID } from "node:crypto";

import type { DriverDomainEvent } from "@wasla/contracts-driver";

import type {
  CandidacyPublication,
  DriverDocument,
  DriverProfile,
  EligibilityLogEntry,
  EligibilityPolicy,
  EligibilityState,
  ProjectedAvailability,
  ServiceZone,
  Vehicle,
} from "../domain/model.js";
import { isVehicleScopedDocument } from "../domain/model.js";
import { SEEDED_POLICIES } from "../domain/policy.js";
import { documentNotFound, driverNotFound, vehicleNotFound } from "../domain/errors.js";
import type {
  CandidacyProjection,
  CandidacyProjectionPort,
  CandidacyPublicationRepository,
  Clock,
  CreateDocumentInput,
  CreateProfileInput,
  CreateVehicleInput,
  DocumentRepository,
  DriverDependencies,
  DriverProfileRepository,
  EligibilityLogRepository,
  EligibilityPolicyRepository,
  IdGenerator,
  IdempotencyStore,
  Outbox,
  ProfileMutation,
  ServiceZoneRepository,
  VehicleRepository,
  ZoneCatalogPort,
} from "../ports.js";

/**
 * A simulated database constraint violation.
 *
 * NOT a `DriverError`: a constraint that fires means the domain let through a
 * write it should have refused, i.e. a bug here — and dressing a bug as a 4xx is
 * how it gets triaged as a client problem for a year. The use cases are expected
 * to prevent these; the tests assert that they do.
 */
export class ConstraintViolation extends Error {
  readonly constraint: string;
  constructor(constraint: string) {
    super(`constraint violated: ${constraint}`);
    this.name = "ConstraintViolation";
    this.constraint = constraint;
  }
}

export class InMemoryDriverProfileRepository implements DriverProfileRepository {
  private readonly rows = new Map<string, DriverProfile>();

  async find(waslaPublicId: string): Promise<DriverProfile | null> {
    return this.rows.get(waslaPublicId) ?? null;
  }

  async create(input: CreateProfileInput): Promise<DriverProfile> {
    if (this.rows.has(input.waslaPublicId)) throw new ConstraintViolation("driver_profiles_pkey");
    const row: DriverProfile = {
      waslaPublicId: input.waslaPublicId,
      displayName: input.displayName,
      preferredLocale: input.preferredLocale,
      workCityZoneId: input.workCityZoneId,
      serviceKinds: [...input.serviceKinds],
      declaredAvailability: "offline",
      verificationStatus: "unverified",
      status: "active",
      suspensionReasonCode: null,
      eligibilityPolicyVersion: input.eligibilityPolicyVersion,
      eligibilityRecheckAt: null,
      lastPublishedState: null,
      lastPublishedAt: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.rows.set(row.waslaPublicId, row);
    return row;
  }

  async update(waslaPublicId: string, mutation: ProfileMutation, at: string): Promise<DriverProfile> {
    const existing = this.rows.get(waslaPublicId);
    if (existing === undefined) throw driverNotFound();
    const row: DriverProfile = {
      ...existing,
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
      updatedAt: at,
    };
    // ck_driver_profiles_suspension_reason: a suspension without a reason is a ban
    // nobody can explain or appeal, and an active profile carrying a stale reason
    // makes a lifted suspension look live.
    const suspendedWithoutReason = row.status === "suspended" && row.suspensionReasonCode === null;
    const activeWithReason = row.status === "active" && row.suspensionReasonCode !== null;
    if (suspendedWithoutReason || activeWithReason) {
      throw new ConstraintViolation("ck_driver_profiles_suspension_reason");
    }
    this.rows.set(waslaPublicId, row);
    return row;
  }

  async setRecheckAt(waslaPublicId: string, recheckAt: string | null, at: string): Promise<DriverProfile> {
    const existing = this.rows.get(waslaPublicId);
    if (existing === undefined) throw driverNotFound();
    const row: DriverProfile = { ...existing, eligibilityRecheckAt: recheckAt, updatedAt: at };
    this.rows.set(waslaPublicId, row);
    return row;
  }

  async recordPublication(
    waslaPublicId: string,
    state: EligibilityState,
    at: string,
  ): Promise<DriverProfile> {
    const existing = this.rows.get(waslaPublicId);
    if (existing === undefined) throw driverNotFound();
    const row: DriverProfile = {
      ...existing,
      lastPublishedState: state,
      lastPublishedAt: at,
      updatedAt: at,
    };
    this.rows.set(waslaPublicId, row);
    return row;
  }

  async listDueForRecheck(now: string, limit: number): Promise<DriverProfile[]> {
    return [...this.rows.values()]
      .filter((row) => row.eligibilityRecheckAt !== null && row.eligibilityRecheckAt <= now)
      // Oldest due first: a tick that runs under its limit must not starve the
      // driver whose licence expired first.
      .sort((left, right) => (left.eligibilityRecheckAt ?? "").localeCompare(right.eligibilityRecheckAt ?? ""))
      .slice(0, limit);
  }
}

export class InMemoryServiceZoneRepository implements ServiceZoneRepository {
  private readonly rows = new Map<string, ServiceZone[]>();

  async list(waslaPublicId: string): Promise<ServiceZone[]> {
    // Ordered by preference: "his first choice" is a question with one answer.
    return [...(this.rows.get(waslaPublicId) ?? [])].sort(
      (left, right) => left.preferenceRank - right.preferenceRank,
    );
  }

  async replace(
    waslaPublicId: string,
    zones: readonly { zoneId: string; preferenceRank: number }[],
    at: string,
  ): Promise<ServiceZone[]> {
    const ranks = new Set<number>();
    const ids = new Set<string>();
    for (const zone of zones) {
      if (ranks.has(zone.preferenceRank)) throw new ConstraintViolation("ux_driver_service_zones_rank");
      if (ids.has(zone.zoneId)) throw new ConstraintViolation("driver_service_zones_pkey");
      ranks.add(zone.preferenceRank);
      ids.add(zone.zoneId);
    }
    const rows: ServiceZone[] = zones.map((zone) => ({
      zoneId: zone.zoneId,
      preferenceRank: zone.preferenceRank,
      createdAt: at,
    }));
    this.rows.set(waslaPublicId, rows);
    return this.list(waslaPublicId);
  }
}

export class InMemoryVehicleRepository implements VehicleRepository {
  private readonly rows = new Map<string, Vehicle>();

  async list(waslaPublicId: string): Promise<Vehicle[]> {
    return [...this.rows.values()].filter((row) => row.waslaPublicId === waslaPublicId);
  }

  async find(waslaPublicId: string, vehicleId: string): Promise<Vehicle | null> {
    const row = this.rows.get(vehicleId);
    return row !== undefined && row.waslaPublicId === waslaPublicId ? row : null;
  }

  async findByIdempotencyKey(waslaPublicId: string, key: string): Promise<Vehicle | null> {
    return (
      (await this.list(waslaPublicId)).find((row) => row.idempotencyKey === key) ?? null
    );
  }

  async create(input: CreateVehicleInput): Promise<Vehicle> {
    const siblings = await this.list(input.waslaPublicId);
    if (siblings.some((row) => row.idempotencyKey === input.idempotencyKey)) {
      throw new ConstraintViolation("ux_driver_vehicles_idempotency");
    }
    const row: Vehicle = {
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
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.assertInvariants([...siblings, row]);
    this.rows.set(row.id, row);
    return row;
  }

  async saveAll(vehicles: readonly Vehicle[]): Promise<Vehicle[]> {
    // The whole set is validated BEFORE anything is written: a promotion plus a
    // demotion is one change, and validating row by row would refuse the very
    // reassignment the domain computed to keep the index satisfied.
    const owners = new Set(vehicles.map((vehicle) => vehicle.waslaPublicId));
    const staged = new Map(this.rows);
    for (const vehicle of vehicles) {
      if (!staged.has(vehicle.id)) throw vehicleNotFound();
      staged.set(vehicle.id, { ...vehicle });
    }
    for (const owner of owners) {
      this.assertInvariants([...staged.values()].filter((row) => row.waslaPublicId === owner));
    }
    for (const vehicle of vehicles) this.rows.set(vehicle.id, { ...vehicle });
    return vehicles.map((vehicle) => ({ ...vehicle }));
  }

  private assertInvariants(fleet: readonly Vehicle[]): void {
    if (fleet.filter((row) => row.isPrimary).length > 1) {
      throw new ConstraintViolation("ux_driver_vehicles_one_primary");
    }
    if (fleet.some((row) => row.status === "retired" && row.isPrimary)) {
      throw new ConstraintViolation("ck_driver_vehicles_retired_not_primary");
    }
  }
}

export class InMemoryDocumentRepository implements DocumentRepository {
  private readonly rows = new Map<string, DriverDocument>();

  async list(waslaPublicId: string): Promise<DriverDocument[]> {
    return [...this.rows.values()].filter((row) => row.waslaPublicId === waslaPublicId);
  }

  async find(waslaPublicId: string, documentId: string): Promise<DriverDocument | null> {
    const row = this.rows.get(documentId);
    return row !== undefined && row.waslaPublicId === waslaPublicId ? row : null;
  }

  async findByIdempotencyKey(waslaPublicId: string, key: string): Promise<DriverDocument | null> {
    return (await this.list(waslaPublicId)).find((row) => row.idempotencyKey === key) ?? null;
  }

  async findLive(
    waslaPublicId: string,
    documentType: DriverDocument["documentType"],
    vehicleId: string | null,
  ): Promise<DriverDocument | null> {
    return (
      (await this.list(waslaPublicId)).find(
        (row) =>
          row.documentType === documentType &&
          row.vehicleId === vehicleId &&
          (row.status === "pending" || row.status === "verified"),
      ) ?? null
    );
  }

  async create(input: CreateDocumentInput): Promise<DriverDocument> {
    const siblings = await this.list(input.waslaPublicId);
    if (siblings.some((row) => row.idempotencyKey === input.idempotencyKey)) {
      throw new ConstraintViolation("ux_driver_documents_idempotency");
    }
    const row: DriverDocument = {
      id: input.id,
      waslaPublicId: input.waslaPublicId,
      documentType: input.documentType,
      storageRef: input.storageRef,
      vehicleId: input.vehicleId,
      status: "pending",
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      reviewedAt: null,
      reviewedBy: null,
      rejectionReasonCode: null,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    assertDocumentInvariants(row);
    assertOneLivePerType([...siblings, row]);
    this.rows.set(row.id, row);
    return row;
  }

  async saveAll(documents: readonly DriverDocument[]): Promise<DriverDocument[]> {
    const staged = new Map(this.rows);
    for (const document of documents) {
      if (!staged.has(document.id)) throw documentNotFound();
      assertDocumentInvariants(document);
      staged.set(document.id, { ...document });
    }
    for (const owner of new Set(documents.map((document) => document.waslaPublicId))) {
      assertOneLivePerType([...staged.values()].filter((row) => row.waslaPublicId === owner));
    }
    for (const document of documents) this.rows.set(document.id, { ...document });
    return documents.map((document) => ({ ...document }));
  }
}

function assertDocumentInvariants(row: DriverDocument): void {
  const coherent =
    (row.status === "pending" &&
      row.reviewedAt === null &&
      row.reviewedBy === null &&
      row.rejectionReasonCode === null) ||
    (row.status === "verified" &&
      row.reviewedAt !== null &&
      row.reviewedBy !== null &&
      row.rejectionReasonCode === null) ||
    (row.status === "rejected" &&
      row.reviewedAt !== null &&
      row.reviewedBy !== null &&
      row.rejectionReasonCode !== null) ||
    row.status === "superseded";
  if (!coherent) throw new ConstraintViolation("ck_driver_documents_review_coherence");

  if (row.issuedAt !== null && row.expiresAt !== null && row.expiresAt <= row.issuedAt) {
    throw new ConstraintViolation("ck_driver_documents_dates");
  }

  const needsVehicle = isVehicleScopedDocument(row.documentType);
  if (needsVehicle !== (row.vehicleId !== null)) {
    throw new ConstraintViolation("ck_driver_documents_vehicle_scope");
  }
}

function assertOneLivePerType(rows: readonly DriverDocument[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.status !== "pending" && row.status !== "verified") continue;
    const key = `${row.documentType}::${row.vehicleId ?? "-"}`;
    if (seen.has(key)) throw new ConstraintViolation("ux_driver_documents_one_live_per_type");
    seen.add(key);
  }
}

/** Read-only: the seed of schema.sql §5, frozen. */
export class InMemoryEligibilityPolicyRepository implements EligibilityPolicyRepository {
  async find(version: number): Promise<EligibilityPolicy | null> {
    return SEEDED_POLICIES.find((policy) => policy.version === version) ?? null;
  }

  async findActive(): Promise<EligibilityPolicy | null> {
    const frozen = SEEDED_POLICIES.filter((policy) => policy.isFrozen);
    return frozen.length === 0 ? null : (frozen[frozen.length - 1] ?? null);
  }

  async list(): Promise<EligibilityPolicy[]> {
    return [...SEEDED_POLICIES];
  }
}

export class InMemoryEligibilityLogRepository implements EligibilityLogRepository {
  private readonly rows: EligibilityLogEntry[] = [];

  async append(entry: EligibilityLogEntry): Promise<EligibilityLogEntry> {
    if (entry.toState !== "eligible" && entry.reasons.length === 0) {
      // ck_eligibility_log_reasons: a refusal with no reason is the exact failure
      // this whole service was built to make impossible.
      throw new ConstraintViolation("ck_eligibility_log_reasons");
    }
    const row: EligibilityLogEntry = { ...entry, reasons: [...entry.reasons] };
    this.rows.push(row);
    return row;
  }

  async latest(waslaPublicId: string): Promise<EligibilityLogEntry | null> {
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      const row = this.rows[index];
      if (row !== undefined && row.waslaPublicId === waslaPublicId) return row;
    }
    return null;
  }

  async list(waslaPublicId: string): Promise<EligibilityLogEntry[]> {
    return this.rows.filter((row) => row.waslaPublicId === waslaPublicId);
  }
}

export class InMemoryCandidacyPublicationRepository implements CandidacyPublicationRepository {
  private readonly rows: CandidacyPublication[] = [];

  async append(publication: CandidacyPublication): Promise<CandidacyPublication> {
    const published = publication.outcome === "published";
    if (published !== (publication.failureCode === null)) {
      // ck_candidacy_publication_outcome: a failure without a code cannot be
      // grouped, counted or alerted on, and a success carrying one is a lie.
      throw new ConstraintViolation("ck_candidacy_publication_outcome");
    }
    const row: CandidacyPublication = {
      ...publication,
      serviceKinds: [...publication.serviceKinds],
      zoneIds: [...publication.zoneIds],
    };
    this.rows.push(row);
    return row;
  }

  async list(waslaPublicId: string): Promise<CandidacyPublication[]> {
    return this.rows.filter((row) => row.waslaPublicId === waslaPublicId);
  }
}

/**
 * A stand-in for matching's `PUT /candidacy/{id}`.
 *
 * It keeps the projected availability so the "never overwrite `busy`" rule can be
 * tested here, in MR 2/6, rather than waiting for the HTTP client in MR 5/6 —
 * because that rule is a DOMAIN rule about who owns a value, and a domain rule
 * proved only by an integration test is a domain rule proved late.
 */
export class InMemoryCandidacyProjectionPort implements CandidacyProjectionPort {
  private readonly rows = new Map<string, CandidacyProjection>();
  /** Test lever: make the next publications fail like an unreachable service. */
  failureCode: string | null = null;
  transportBroken = false;
  /**
   * Test lever for the OTHER failure, which is a different rule (MR 5/6): the read that
   * precedes a publication can fail on its own, and when it does the publication must be
   * abandoned rather than sent without knowing whether matching holds a `busy` row.
   */
  readBroken = false;

  async read(waslaPublicId: string): Promise<{ availabilityState: ProjectedAvailability } | null> {
    if (this.readBroken) throw new Error("candidacy read unavailable");
    const row = this.rows.get(waslaPublicId);
    return row === undefined ? null : { availabilityState: row.availabilityState };
  }

  async publish(
    projection: CandidacyProjection,
  ): Promise<{ accepted: boolean; failureCode: string | null }> {
    if (this.transportBroken) throw new Error("candidacy transport unavailable");
    if (this.failureCode !== null) return { accepted: false, failureCode: this.failureCode };
    this.rows.set(projection.waslaPublicId, {
      ...projection,
      serviceKinds: [...projection.serviceKinds],
      zoneIds: [...projection.zoneIds],
    });
    return { accepted: true, failureCode: null };
  }

  /** Seed helper: simulate matching having marked the driver busy. */
  seed(projection: CandidacyProjection): void {
    this.rows.set(projection.waslaPublicId, projection);
  }
}

/** Every zone id is unknown until it is seeded — fail-closed by default. */
export class InMemoryZoneCatalogPort implements ZoneCatalogPort {
  private readonly known = new Set<string>();

  async existing(zoneIds: readonly string[]): Promise<Set<string>> {
    return new Set(zoneIds.filter((zoneId) => this.known.has(zoneId)));
  }

  seed(...zoneIds: readonly string[]): void {
    for (const zoneId of zoneIds) this.known.add(zoneId);
  }
}

export class InMemoryOutbox implements Outbox {
  private readonly events: DriverDomainEvent[] = [];

  async append(event: DriverDomainEvent): Promise<void> {
    this.events.push(event);
  }

  async unread(): Promise<DriverDomainEvent[]> {
    return [...this.events];
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly keys = new Map<string, string>();

  async find(key: string): Promise<string | null> {
    return this.keys.get(key) ?? null;
  }

  async remember(key: string, payloadFingerprint: string): Promise<void> {
    this.keys.set(key, payloadFingerprint);
  }
}

/**
 * The production clock and id generator (Phase 05 · MR 5/6).
 *
 * They live here — beside the fakes, in the file every composition root already
 * imports — rather than privately inside `http/server.ts`, because as of MR 5/6 the
 * service has TWO roots: its own HTTP process, and the driver bot, which reaches these
 * use cases in process (`bots/driver-bot/src/driver-core.ts`). Two private copies of
 * «now is an ISO-8601 instant in UTC» would be two answers to the question every event
 * envelope, expiry comparison and audit row is ordered by; the same precedent already
 * exists in the customers and geography services.
 *
 * They are the only implementations here that read the real world, and nothing in the
 * domain may construct them: a use case that could reach the wall clock would behave
 * differently in a test than in production.
 */
export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class CryptoIdGenerator implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }
}

/** A clock the test drives. Nothing in the domain reads the real one. */
export class FixedClock implements Clock {
  constructor(private current: string) {}

  now(): string {
    return this.current;
  }

  set(value: string): void {
    this.current = value;
  }

  advanceDays(days: number): void {
    this.current = new Date(Date.parse(this.current) + days * 86_400_000).toISOString();
  }
}

/** Deterministic ids: a failing test must name the same vehicle every run. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  uuid(): string {
    this.counter += 1;
    return `00000000-0000-4000-8000-${this.counter.toString().padStart(12, "0")}`;
  }
}

export interface InMemoryDriverEnvironment extends DriverDependencies {
  readonly profiles: InMemoryDriverProfileRepository;
  readonly zones: InMemoryServiceZoneRepository;
  readonly vehicles: InMemoryVehicleRepository;
  readonly documents: InMemoryDocumentRepository;
  readonly eligibilityLog: InMemoryEligibilityLogRepository;
  readonly publications: InMemoryCandidacyPublicationRepository;
  readonly candidacy: InMemoryCandidacyProjectionPort;
  readonly zoneCatalog: InMemoryZoneCatalogPort;
  readonly outbox: InMemoryOutbox;
  readonly clock: FixedClock;
}

/** One call to assemble a fully wired, database-free service. */
export function createInMemoryEnvironment(
  now = "2026-01-01T00:00:00.000Z",
): InMemoryDriverEnvironment {
  return {
    profiles: new InMemoryDriverProfileRepository(),
    zones: new InMemoryServiceZoneRepository(),
    vehicles: new InMemoryVehicleRepository(),
    documents: new InMemoryDocumentRepository(),
    policies: new InMemoryEligibilityPolicyRepository(),
    eligibilityLog: new InMemoryEligibilityLogRepository(),
    publications: new InMemoryCandidacyPublicationRepository(),
    candidacy: new InMemoryCandidacyProjectionPort(),
    zoneCatalog: new InMemoryZoneCatalogPort(),
    outbox: new InMemoryOutbox(),
    idempotency: new InMemoryIdempotencyStore(),
    clock: new FixedClock(now),
    ids: new SequentialIdGenerator(),
  };
}
