/**
 * Ports (hexagonal boundaries) for the Driver Core domain.
 *
 * Use cases depend on these interfaces only. Adapters live in ./infrastructure:
 * the in-memory stores here (MR 2/6) and the Drizzle/Postgres repositories in
 * MR 3/6, with a parity suite running the same use-case tests against both — so
 * "it worked in memory" can never mean "it works".
 *
 * Dependency direction (ADR-012):
 *  - Driver Core depends on geography for zone ids and on NOTHING else inbound.
 *  - It pushes a projection into matching through `CandidacyProjectionPort`, i.e.
 *    an HTTP call to `PUT /candidacy/{driverPublicId}` (decision 3). It does NOT
 *    get a matching repository, and there is deliberately no port here that could
 *    write matching's tables: two services writing one table is how a boundary
 *    stops existing while both diagrams still show it.
 *  - Nothing here can read an order, an offer or a subscription.
 */

import type { DriverDomainEvent } from "@wasla/contracts-driver";

import type {
  CandidacyPublication,
  DeclaredAvailability,
  DriverDocument,
  DriverProfile,
  EligibilityLogEntry,
  EligibilityPolicy,
  EligibilityState,
  ProjectedAvailability,
  ServiceKind,
  ServiceZone,
  Vehicle,
  VehicleClass,
  VerificationStatus,
} from "./domain/model.js";

/** Wall-clock time as an ISO-8601 string. The domain never calls `Date.now()`. */
export interface Clock {
  now(): string;
}

/** UUID generator (vehicle ids, document ids, event ids). */
export interface IdGenerator {
  uuid(): string;
}

export interface CreateProfileInput {
  readonly waslaPublicId: string;
  readonly displayName: string | null;
  readonly preferredLocale: DriverProfile["preferredLocale"];
  readonly workCityZoneId: string | null;
  readonly serviceKinds: readonly ServiceKind[];
  readonly eligibilityPolicyVersion: number;
  readonly createdAt: string;
}

/**
 * The columns a use case may change on a profile.
 *
 * Deliberately NOT `Partial<DriverProfile>`: `createdAt`, `lastPublishedState`
 * and `eligibilityRecheckAt` are service-owned, and a patch type that can reach
 * them lets a caller declare its own freshness or hide an expiry.
 */
export interface ProfileMutation {
  readonly displayName?: string | null;
  readonly preferredLocale?: DriverProfile["preferredLocale"];
  readonly workCityZoneId?: string | null;
  readonly serviceKinds?: readonly ServiceKind[];
  readonly declaredAvailability?: DeclaredAvailability;
  readonly verificationStatus?: VerificationStatus;
  readonly status?: DriverProfile["status"];
  readonly suspensionReasonCode?: string | null;
}

export interface DriverProfileRepository {
  find(waslaPublicId: string): Promise<DriverProfile | null>;
  create(input: CreateProfileInput): Promise<DriverProfile>;
  update(waslaPublicId: string, mutation: ProfileMutation, at: string): Promise<DriverProfile>;
  /**
   * Set the derived tick index. A separate method from `update` because it is the
   * one column the domain calculator owns end to end, and mixing it into a caller
   * patch is how it would eventually be set by a caller.
   */
  setRecheckAt(waslaPublicId: string, recheckAt: string | null, at: string): Promise<DriverProfile>;
  /** Record what was actually published, and when. Drift becomes measurable here. */
  recordPublication(
    waslaPublicId: string,
    state: EligibilityState,
    at: string,
  ): Promise<DriverProfile>;
  /**
   * Drivers whose `eligibility_recheck_at` has come due — the expiry tick's index
   * (§5). Bounded by `limit` so a tick cannot become an unbounded scan the day the
   * platform has fifty thousand drivers.
   */
  listDueForRecheck(now: string, limit: number): Promise<DriverProfile[]>;
}

export interface ServiceZoneRepository {
  list(waslaPublicId: string): Promise<ServiceZone[]>;
  /**
   * Full replacement, never a merge: the request is "these are my zones", and a
   * merge turns a removal into a no-op that the driver cannot see.
   */
  replace(
    waslaPublicId: string,
    zones: readonly { zoneId: string; preferenceRank: number }[],
    at: string,
  ): Promise<ServiceZone[]>;
}

export interface CreateVehicleInput {
  readonly id: string;
  readonly waslaPublicId: string;
  readonly vehicleClass: VehicleClass;
  readonly make: string | null;
  readonly model: string | null;
  readonly modelYear: number | null;
  readonly color: string | null;
  readonly plateNumber: string | null;
  readonly isPrimary: boolean;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface VehicleRepository {
  list(waslaPublicId: string): Promise<Vehicle[]>;
  find(waslaPublicId: string, vehicleId: string): Promise<Vehicle | null>;
  findByIdempotencyKey(waslaPublicId: string, key: string): Promise<Vehicle | null>;
  create(input: CreateVehicleInput): Promise<Vehicle>;
  /**
   * Persist a set of already-computed rows in one step.
   *
   * The primary-vehicle reassignment is a promotion AND a demotion, and the unique
   * index `ux_driver_vehicles_one_primary` is violated by any ordering that writes
   * them one at a time. So the port takes the whole set and the adapter is
   * responsible for making it atomic — in Postgres a single statement per row
   * inside one transaction with the index deferred is not available, so MR 3/6
   * demotes first within the transaction. Either way the decision is the adapter's,
   * not the use case's.
   */
  saveAll(vehicles: readonly Vehicle[]): Promise<Vehicle[]>;
}

export interface CreateDocumentInput {
  readonly id: string;
  readonly waslaPublicId: string;
  readonly documentType: DriverDocument["documentType"];
  readonly storageRef: string;
  readonly vehicleId: string | null;
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface DocumentRepository {
  list(waslaPublicId: string): Promise<DriverDocument[]>;
  find(waslaPublicId: string, documentId: string): Promise<DriverDocument | null>;
  findByIdempotencyKey(waslaPublicId: string, key: string): Promise<DriverDocument | null>;
  /** The live copy the one-live-per-type index would collide with, if any. */
  findLive(
    waslaPublicId: string,
    documentType: DriverDocument["documentType"],
    vehicleId: string | null,
  ): Promise<DriverDocument | null>;
  create(input: CreateDocumentInput): Promise<DriverDocument>;
  saveAll(documents: readonly DriverDocument[]): Promise<DriverDocument[]>;
}

/**
 * Policy catalogue. Read-only in this phase: version 1 is seeded and frozen by
 * schema.sql, and a new version is a migration, not an API call.
 */
export interface EligibilityPolicyRepository {
  find(version: number): Promise<EligibilityPolicy | null>;
  findActive(): Promise<EligibilityPolicy | null>;
  list(): Promise<EligibilityPolicy[]>;
}

/** Append-only audit store: entries are never updated and never deleted. */
export interface EligibilityLogRepository {
  append(entry: EligibilityLogEntry): Promise<EligibilityLogEntry>;
  /** The newest entry — the "previous state" that change detection compares to. */
  latest(waslaPublicId: string): Promise<EligibilityLogEntry | null>;
  list(waslaPublicId: string): Promise<EligibilityLogEntry[]>;
}

/** Append-only too: every publication ATTEMPT is recorded, successful or not. */
export interface CandidacyPublicationRepository {
  append(publication: CandidacyPublication): Promise<CandidacyPublication>;
  list(waslaPublicId: string): Promise<CandidacyPublication[]>;
}

export interface CandidacyProjection {
  readonly waslaPublicId: string;
  readonly eligibilityState: EligibilityState;
  readonly availabilityState: ProjectedAvailability;
  readonly serviceKinds: readonly ServiceKind[];
  readonly zoneIds: readonly string[];
  readonly vehicleClass: VehicleClass | null;
}

/**
 * The one outbound call this service makes: `PUT /candidacy/{driverPublicId}` on
 * matching (ADR-012 decision 3 · precedent `OrderIntakePort`, ADR-009 §3).
 *
 * `read` exists for one reason: matching owns `busy`, and Driver Core must not
 * overwrite a live commitment with `available` just because the driver said he is
 * free. So a publication reads the current projected availability, and only
 * downgrades it — never upgrades a `busy` row.
 *
 * `publish` returns an outcome instead of throwing on refusal, because a refusal
 * by matching is a fact to record, not our failure. It throws only when the
 * transport itself failed.
 */
export interface CandidacyProjectionPort {
  read(waslaPublicId: string): Promise<{ availabilityState: ProjectedAvailability } | null>;
  publish(projection: CandidacyProjection): Promise<{ accepted: boolean; failureCode: string | null }>;
}

/**
 * Zone existence lookups (ADR-006), through a port rather than an FK.
 *
 * A zone id absent from the hierarchy is 422 `DRIVER_ZONE_UNKNOWN` on a WRITE:
 * unlike matching, which tolerates a retired zone on an existing row, this service
 * is where the zone list is authored, and accepting an unknown id here is how it
 * gets into every downstream row.
 */
export interface ZoneCatalogPort {
  existing(zoneIds: readonly string[]): Promise<Set<string>>;
}

/**
 * Domain event outbox. Use cases append within the same logical operation as the
 * write; a relay publishes later (Phase 09). Kept separate from the repositories
 * so the domain owns event ordering without knowing about a broker.
 */
export interface Outbox {
  append(event: DriverDomainEvent): Promise<void>;
  unread(): Promise<DriverDomainEvent[]>;
}

/**
 * Idempotency memory for writes.
 *
 * Vehicles and documents carry their key in their own table (`ux_driver_vehicles_
 * idempotency`, `ux_driver_documents_idempotency`), so this port covers the writes
 * that have no row of their own to hold a key. Storing the fingerprint is what
 * lets a retry (same key, same payload) succeed while a caller bug (same key,
 * different payload) is refused with 409 instead of silently overwriting.
 */
export interface IdempotencyStore {
  find(key: string): Promise<string | null>;
  remember(key: string, payloadFingerprint: string): Promise<void>;
}

/** Everything a use case needs, passed explicitly rather than imported. */
export interface DriverDependencies {
  readonly profiles: DriverProfileRepository;
  readonly zones: ServiceZoneRepository;
  readonly vehicles: VehicleRepository;
  readonly documents: DocumentRepository;
  readonly policies: EligibilityPolicyRepository;
  readonly eligibilityLog: EligibilityLogRepository;
  readonly publications: CandidacyPublicationRepository;
  readonly candidacy: CandidacyProjectionPort;
  readonly zoneCatalog: ZoneCatalogPort;
  readonly outbox: Outbox;
  readonly idempotency: IdempotencyStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}
