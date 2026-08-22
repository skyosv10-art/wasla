/**
 * The ONE place where the internal `camelCase` model becomes the `snake_case` wire
 * shape published in `contracts/api.openapi.yml` and `contracts/events.json`.
 *
 * Why one place: the alternative is a `snake_case` key appearing wherever a response
 * happens to be built, and the day a field is renamed the rename is complete in four
 * files out of five. A mapper that lives alone can be tested against the OpenAPI
 * `required` lists — and it is (`__tests__/mappers.test.ts`), so a contract change
 * without a mapper change fails the build rather than the client.
 *
 * Direction matters too: the HTTP layer (MR 4/6) parses INTO the camelCase inputs the
 * use cases already declare, so nothing downstream of this file ever sees a
 * `snake_case` key.
 *
 * **Nothing here emits `storage_ref`, `plate_number` or `reviewed_by` into an event.**
 * Those live in API responses that an authorised reader asked for; an event goes to
 * every subscriber, and a plate in a broadcast is a plate in every subscriber's logs.
 */

import type {
  CandidacyPublication,
  DriverDocument,
  DriverProfile,
  EligibilityLogEntry,
  ServiceZone,
  Vehicle,
} from "./domain/model.js";
import type { EligibilityDecision } from "./domain/eligibility.js";

export interface DriverProfileWire {
  readonly wasla_public_id: string;
  readonly display_name: string | null;
  readonly preferred_locale: string;
  readonly status: string;
  readonly verification_status: string;
  readonly declared_availability: string;
  readonly work_city_zone_id: string | null;
  readonly service_kinds: readonly string[];
  readonly suspension_reason_code: string | null;
  readonly eligibility_policy_version: number;
  readonly eligibility_recheck_at: string | null;
  readonly last_published_state: string | null;
  readonly last_published_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export function driverProfileToWire(profile: DriverProfile): DriverProfileWire {
  return {
    wasla_public_id: profile.waslaPublicId,
    display_name: profile.displayName,
    preferred_locale: profile.preferredLocale,
    status: profile.status,
    verification_status: profile.verificationStatus,
    declared_availability: profile.declaredAvailability,
    work_city_zone_id: profile.workCityZoneId,
    service_kinds: [...profile.serviceKinds],
    suspension_reason_code: profile.suspensionReasonCode,
    eligibility_policy_version: profile.eligibilityPolicyVersion,
    eligibility_recheck_at: profile.eligibilityRecheckAt,
    last_published_state: profile.lastPublishedState,
    last_published_at: profile.lastPublishedAt,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  };
}

export interface ServiceZoneWire {
  readonly zone_id: string;
  readonly preference_rank: number;
  readonly created_at: string;
}

export function serviceZoneToWire(zone: ServiceZone): ServiceZoneWire {
  return {
    zone_id: zone.zoneId,
    preference_rank: zone.preferenceRank,
    created_at: zone.createdAt,
  };
}

export interface VehicleWire {
  readonly id: string;
  readonly wasla_public_id: string;
  readonly vehicle_class: string;
  readonly status: string;
  readonly is_primary: boolean;
  readonly make: string | null;
  readonly model: string | null;
  readonly model_year: number | null;
  readonly color: string | null;
  readonly plate_number: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export function vehicleToWire(vehicle: Vehicle): VehicleWire {
  return {
    id: vehicle.id,
    wasla_public_id: vehicle.waslaPublicId,
    vehicle_class: vehicle.vehicleClass,
    status: vehicle.status,
    is_primary: vehicle.isPrimary,
    make: vehicle.make,
    model: vehicle.model,
    model_year: vehicle.modelYear,
    color: vehicle.color,
    plate_number: vehicle.plateNumber,
    created_at: vehicle.createdAt,
    updated_at: vehicle.updatedAt,
  };
}

export interface DriverDocumentWire {
  readonly id: string;
  readonly wasla_public_id: string;
  readonly document_type: string;
  readonly status: string;
  readonly vehicle_id: string | null;
  readonly storage_ref: string;
  readonly issued_at: string | null;
  readonly expires_at: string | null;
  readonly reviewed_at: string | null;
  readonly reviewed_by: string | null;
  readonly rejection_reason_code: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export function driverDocumentToWire(document: DriverDocument): DriverDocumentWire {
  return {
    id: document.id,
    wasla_public_id: document.waslaPublicId,
    document_type: document.documentType,
    status: document.status,
    vehicle_id: document.vehicleId,
    storage_ref: document.storageRef,
    issued_at: document.issuedAt,
    expires_at: document.expiresAt,
    reviewed_at: document.reviewedAt,
    reviewed_by: document.reviewedBy,
    rejection_reason_code: document.rejectionReasonCode,
    created_at: document.createdAt,
    updated_at: document.updatedAt,
  };
}

export interface EligibilityWire {
  readonly wasla_public_id: string;
  readonly eligibility_state: string;
  readonly reason_codes: readonly string[];
  readonly policy_version: number;
  readonly evaluated_at: string;
}

/**
 * The eligibility answer, with `deficits` deliberately NOT on the wire.
 *
 * `reason_codes` is the published contract; the per-document detail in `deficits` is
 * how the calculator reached it. Publishing both would invite clients to branch on
 * the detail, and the detail is the part we intend to keep free to change.
 *
 * `recheck_at` is absent for a harder reason: `EligibilityView` in
 * `api.openapi.yml` declares `additionalProperties: false`, so emitting it would make
 * every response fail a strict client's own validation. The value is not lost — it is
 * published as `eligibility_recheck_at` on the profile, which is where an operator
 * asking "when will this be looked at again?" goes anyway. The field name is
 * `eligibility_state` and not `state` for the same reason: the contract said so first.
 */
export function eligibilityToWire(
  waslaPublicId: string,
  decision: EligibilityDecision,
): EligibilityWire {
  return {
    wasla_public_id: waslaPublicId,
    eligibility_state: decision.state,
    reason_codes: [...decision.reasonCodes],
    policy_version: decision.policyVersion,
    evaluated_at: decision.evaluatedAt,
  };
}

export interface EligibilityLogEntryWire {
  readonly wasla_public_id: string;
  readonly from_state: string | null;
  readonly to_state: string;
  readonly reasons: readonly string[];
  readonly policy_version: number;
  readonly trigger: string;
  readonly evaluated_at: string;
}

export function eligibilityLogEntryToWire(entry: EligibilityLogEntry): EligibilityLogEntryWire {
  return {
    wasla_public_id: entry.waslaPublicId,
    from_state: entry.fromState,
    to_state: entry.toState,
    reasons: [...entry.reasons],
    policy_version: entry.policyVersion,
    trigger: entry.trigger,
    evaluated_at: entry.evaluatedAt,
  };
}

export interface CandidacyPublicationWire {
  readonly wasla_public_id: string;
  readonly eligibility_state: string;
  readonly availability_state: string;
  readonly service_kinds: readonly string[];
  readonly zone_ids: readonly string[];
  readonly vehicle_class: string | null;
  readonly outcome: string;
  readonly failure_code: string | null;
  readonly attempted_at: string;
}

export function candidacyPublicationToWire(
  publication: CandidacyPublication,
): CandidacyPublicationWire {
  return {
    wasla_public_id: publication.waslaPublicId,
    eligibility_state: publication.eligibilityState,
    availability_state: publication.availabilityState,
    service_kinds: [...publication.serviceKinds],
    zone_ids: [...publication.zoneIds],
    vehicle_class: publication.vehicleClass,
    outcome: publication.outcome,
    failure_code: publication.failureCode,
    attempted_at: publication.attemptedAt,
  };
}
