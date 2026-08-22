/**
 * Driver Core domain model (Phase 05 · MR 2/6).
 *
 * In-service shapes: camelCase, no transport concerns, no SQL concerns. They
 * mirror the published contracts one-to-one in meaning:
 *  - the API DTOs live in @wasla/contracts-driver (generated from OpenAPI),
 *  - the storage columns live in services/drivers/contracts/schema.sql,
 *  - `../mappers.ts` translates between the three.
 *
 * Boundary reminders (ADR-012):
 *  - **there is no `eligibilityState` field on `DriverProfile` here either.** The
 *    absence is the whole decision (decision 2): a stored answer stops being true
 *    the moment a document expires and then cannot explain itself. What the
 *    profile does carry is `lastPublishedState` — *what was published*, which is
 *    a different fact and the only way drift becomes measurable.
 *  - `declaredAvailability` has two values, not three. `busy` is derived from a
 *    live commitment owned by dispatch (decision 4), so it cannot appear in a
 *    driver-owned field without giving two services authority over one value.
 *  - documents are REFERENCES (`storageRef`), never content, and there is no
 *    `expired` status: expiry is data compared to an injected clock (decision 5).
 *  - nothing here knows an order, an offer, a wave, a subscription or a rating.
 */

import {
  DRIVER_DECLARED_AVAILABILITY,
  DRIVER_DOCUMENT_TYPES,
  DRIVER_ELIGIBILITY_STATES,
  DRIVER_VEHICLE_CLASSES,
  type DriverErrorCode,
  type DriverEventType,
  type EligibilityReasonCode,
} from "@wasla/contracts-driver";

export type { DriverErrorCode, DriverEventType, EligibilityReasonCode };

/**
 * Closed value sets are RE-EXPORTED from the contract package, never retyped.
 *
 * A second literal list in the service is the cheapest possible way to get a
 * silent divergence: both compile, both look right, and the difference only shows
 * up as a value the API accepts and the database refuses.
 */
export const SERVICE_KINDS = ["ride", "delivery"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

export const VEHICLE_CLASSES = DRIVER_VEHICLE_CLASSES;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export const LOCALES = ["ar", "en", "ur"] as const;
export type Locale = (typeof LOCALES)[number];

/** Two values, not three — see the file header. */
export const DECLARED_AVAILABILITY = DRIVER_DECLARED_AVAILABILITY;
export type DeclaredAvailability = (typeof DECLARED_AVAILABILITY)[number];

/**
 * The third state matching knows about, which this service can read but never
 * declare. It exists in the model only so the publication path can preserve it.
 */
export const PROJECTED_AVAILABILITY = ["available", "busy", "offline"] as const;
export type ProjectedAvailability = (typeof PROJECTED_AVAILABILITY)[number];

export const VERIFICATION_STATUSES = [
  "unverified",
  "pending_review",
  "verified",
  "rejected",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const PROFILE_STATUSES = ["active", "suspended"] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

export const VEHICLE_STATUSES = ["active", "retired"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

/** No `expired`: expiry is data, not a state anybody has to remember to write. */
export const DOCUMENT_STATUSES = ["pending", "verified", "rejected", "superseded"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_TYPES = DRIVER_DOCUMENT_TYPES;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * Document types that describe a VEHICLE rather than a person.
 *
 * The split is enforced in the database by `ck_driver_documents_vehicle_scope`,
 * and it is not cosmetic: an insurance certificate that is not attached to a
 * vehicle is "verified" without anyone being able to say what it covers.
 */
export const VEHICLE_SCOPED_DOCUMENT_TYPES = [
  "vehicle_registration",
  "vehicle_insurance",
  "vehicle_photo",
] as const;

export function isVehicleScopedDocument(type: DocumentType): boolean {
  return (VEHICLE_SCOPED_DOCUMENT_TYPES as readonly DocumentType[]).includes(type);
}

export const ELIGIBILITY_STATES = DRIVER_ELIGIBILITY_STATES;
export type EligibilityState = (typeof ELIGIBILITY_STATES)[number];

/** What moved the calculator. `expiry_tick` says out loud that time is an actor. */
export const ELIGIBILITY_TRIGGERS = [
  "profile_changed",
  "document_reviewed",
  "document_submitted",
  "vehicle_changed",
  "zones_changed",
  "availability_declared",
  "suspended",
  "reinstated",
  "expiry_tick",
  "recompute",
] as const;
export type EligibilityTrigger = (typeof ELIGIBILITY_TRIGGERS)[number];

export const PUBLICATION_OUTCOMES = ["published", "rejected", "unavailable"] as const;
export type PublicationOutcome = (typeof PUBLICATION_OUTCOMES)[number];

/**
 * The role profile. Keyed by `waslaPublicId` as an opaque reference with a CHECK
 * on its shape and NO foreign key to identity (ADR-009 §1): one person, many
 * roles, and a driver profile must not require deleting a customer profile.
 */
export interface DriverProfile {
  readonly waslaPublicId: string;
  readonly displayName: string | null;
  readonly preferredLocale: Locale;
  readonly workCityZoneId: string | null;
  readonly serviceKinds: readonly ServiceKind[];
  readonly declaredAvailability: DeclaredAvailability;
  readonly verificationStatus: VerificationStatus;
  readonly status: ProfileStatus;
  readonly suspensionReasonCode: string | null;
  readonly eligibilityPolicyVersion: number;
  /**
   * The tick index: the earliest instant at which eligibility could change with
   * nobody doing anything. Derived by the domain from document expiry — never
   * accepted from a caller, because a caller that can set it can hide an expiry.
   */
  readonly eligibilityRecheckAt: string | null;
  readonly lastPublishedState: EligibilityState | null;
  readonly lastPublishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A served zone carries a rank and a date; an array column carries neither. */
export interface ServiceZone {
  readonly zoneId: string;
  readonly preferenceRank: number;
  readonly createdAt: string;
}

export interface Vehicle {
  readonly id: string;
  readonly waslaPublicId: string;
  readonly vehicleClass: VehicleClass;
  readonly make: string | null;
  readonly model: string | null;
  readonly modelYear: number | null;
  readonly color: string | null;
  /** Stored for administrative review, and never published in an event (§8). */
  readonly plateNumber: string | null;
  readonly isPrimary: boolean;
  readonly status: VehicleStatus;
  readonly idempotencyKey: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DriverDocument {
  readonly id: string;
  readonly waslaPublicId: string;
  readonly documentType: DocumentType;
  /** A pointer into the file store. Never the number, never the image. */
  readonly storageRef: string;
  readonly vehicleId: string | null;
  readonly status: DocumentStatus;
  /** Dates, not timestamps: the contract column is DATE. */
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
  readonly reviewedAt: string | null;
  readonly reviewedBy: string | null;
  readonly rejectionReasonCode: string | null;
  readonly idempotencyKey: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A frozen, numbered version of the eligibility conditions (precedent:
 * `matching_rulesets`). Yesterday's decision stays readable under yesterday's
 * rules, which is the only way an audit question has an answer.
 */
export interface EligibilityPolicy {
  readonly version: number;
  readonly label: string;
  readonly requiredDocumentsRide: readonly DocumentType[];
  readonly requiredDocumentsDelivery: readonly DocumentType[];
  readonly requirePrimaryVehicle: boolean;
  readonly requireServiceZone: boolean;
  readonly documentGraceDays: number;
  readonly isFrozen: boolean;
  readonly createdAt: string;
}

/** Append-only. A row is never updated and never deleted. */
export interface EligibilityLogEntry {
  readonly waslaPublicId: string;
  readonly fromState: EligibilityState | null;
  readonly toState: EligibilityState;
  readonly reasons: readonly EligibilityReasonCode[];
  readonly policyVersion: number;
  readonly trigger: EligibilityTrigger;
  readonly evaluatedAt: string;
}

/** One recorded attempt to push the projection into matching, success or not. */
export interface CandidacyPublication {
  readonly waslaPublicId: string;
  readonly eligibilityState: EligibilityState;
  readonly availabilityState: ProjectedAvailability;
  readonly serviceKinds: readonly ServiceKind[];
  readonly zoneIds: readonly string[];
  readonly vehicleClass: VehicleClass | null;
  readonly outcome: PublicationOutcome;
  readonly failureCode: string | null;
  readonly attemptedAt: string;
}

/**
 * Everything the calculator reads, gathered once.
 *
 * A snapshot rather than repository calls inside the calculator: eligibility must
 * be a pure function of data at one instant. If it read the stores itself, two
 * reasons in the same answer could describe two different moments — and the
 * `driver_eligibility_log` row would then describe a state that never existed.
 */
export interface DriverSnapshot {
  readonly profile: DriverProfile;
  readonly zones: readonly ServiceZone[];
  readonly vehicles: readonly Vehicle[];
  readonly documents: readonly DriverDocument[];
}
