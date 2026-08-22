/**
 * Event factories for the eleven Driver Core events (contracts/events.json).
 *
 * One privacy rule governs this whole file (ADR-012 decision 8): **an event says
 * WHAT changed, never WHO the driver is.** No name, no phone, no document number,
 * no plate number, no `storage_ref`, no coordinate, no channel id. The finest
 * location granularity allowed to cross the boundary is a zone id from the
 * geography hierarchy. That is why the factories below take the domain rows and
 * copy out named fields one by one instead of spreading them: a spread quietly
 * publishes every column somebody adds to the row later.
 *
 * `occurred_at` vs `occurred_for` — the contract requires both, and MR 2/6 fixes
 * their meaning:
 *  - `occurred_at` (envelope) = when the event was PRODUCED,
 *  - `occurred_for` (payload) = the instant the change is EFFECTIVE for.
 * They are the same value on every driver-initiated path. They differ on exactly
 * one: `expiry_tick`, where a licence stopped being valid at its expiry instant
 * while the event is produced whenever the tick happens to run. Collapsing the
 * two would make a tick that ran late report that the document expired late,
 * which is the one thing an audit of an expiry must not be told.
 */

import { DRIVER_EVENT_TYPES } from "@wasla/contracts-driver";
import type {
  DriverAvailabilityDeclaredV1,
  DriverDocumentReviewedV1,
  DriverDocumentSubmittedV1,
  DriverDomainEvent,
  DriverEligibilityChangedV1,
  DriverProfileUpdatedV1,
  DriverRegisteredV1,
  DriverReinstatedV1,
  DriverServiceZonesChangedV1,
  DriverSuspendedV1,
  DriverVehicleRegisteredV1,
  DriverVehicleStatusChangedV1,
} from "@wasla/contracts-driver";

import type {
  DriverDocument,
  DriverProfile,
  EligibilityState,
  EligibilityTrigger,
  ServiceKind,
  Vehicle,
} from "./model.js";
import type { EligibilityDecision } from "./eligibility.js";

export type { DriverDomainEvent };

export interface EnvelopeInput {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly traceId: string | null;
  /** Defaults to `occurredAt`; only the expiry tick passes something else. */
  readonly occurredFor?: string;
}

function effectiveAt(envelope: EnvelopeInput): string {
  return envelope.occurredFor ?? envelope.occurredAt;
}

export function driverRegistered(
  profile: DriverProfile,
  envelope: EnvelopeInput,
): DriverRegisteredV1 {
  return {
    event_id: envelope.eventId,
    event_type: DRIVER_EVENT_TYPES.DRIVER_REGISTERED,
    event_version: "v1",
    occurred_at: envelope.occurredAt,
    producer: "drivers-service",
    aggregate: { type: "driver", id: profile.waslaPublicId },
    trace_id: envelope.traceId,
    data: {
      driver_public_id: profile.waslaPublicId,
      preferred_locale: profile.preferredLocale,
      work_city_zone_id: profile.workCityZoneId,
      occurred_for: effectiveAt(envelope),
    },
  };
}

export function driverProfileUpdated(
  profile: DriverProfile,
  envelope: EnvelopeInput,
): DriverProfileUpdatedV1 {
  return {
    event_id: envelope.eventId,
    event_type: DRIVER_EVENT_TYPES.DRIVER_PROFILE_UPDATED,
    event_version: "v1",
    occurred_at: envelope.occurredAt,
    producer: "drivers-service",
    aggregate: { type: "driver", id: profile.waslaPublicId },
    trace_id: envelope.traceId,
    data: {
      driver_public_id: profile.waslaPublicId,
      service_kinds: [...profile.serviceKinds] as ServiceKind[],
      work_city_zone_id: profile.workCityZoneId,
      preferred_locale: profile.preferredLocale,
      occurred_for: effectiveAt(envelope),
      // `display_name` is absent on purpose: it is the one field on the profile
      // that names a person, and `additionalProperties: false` in events.json is
      // what stops it being added here in a hurry.
    },
  };
}

export function driverServiceZonesChanged(
  waslaPublicId: string,
  zoneIds: readonly string[],
  envelope: EnvelopeInput,
): DriverServiceZonesChangedV1 {
  return {
    event_id: envelope.eventId,
    event_type: DRIVER_EVENT_TYPES.DRIVER_SERVICE_ZONES_CHANGED,
    event_version: "v1",
    occurred_at: envelope.occurredAt,
    producer: "drivers-service",
    aggregate: { type: "driver", id: waslaPublicId },
    trace_id: envelope.traceId,
    data: {
      driver_public_id: waslaPublicId,
      zone_ids: [...zoneIds],
      occurred_for: effectiveAt(envelope),
    },
  };
}

export function driverVehicleRegistered(
  vehicle: Vehicle,
  envelope: EnvelopeInput,
): DriverVehicleRegisteredV1 {
  return {
    event_id: envelope.eventId,
    event_type: DRIVER_EVENT_TYPES.DRIVER_VEHICLE_REGISTERED,
    event_version: "v1",
    occurred_at: envelope.occurredAt,
    producer: "drivers-service",
    // The aggregate is the VEHICLE, not the driver: a consumer that reorders
    // events per aggregate must not interleave two vehicles of one driver.
    aggregate: { type: "driver_vehicle", id: vehicle.id },
    trace_id: envelope.traceId,
    data: {
      driver_public_id: vehicle.waslaPublicId,
      vehicle_id: vehicle.id,
      vehicle_class: vehicle.vehicleClass,
      is_primary: vehicle.isPrimary,
      occurred_for: effectiveAt(envelope),
      // No plate, make, model or colour: together they identify a car in the
      // street, which identifies a person (§8).
    },
  };
}

export function driverVehicleStatusChanged(
  vehicle: Vehicle,
  envelope: EnvelopeInput,
): DriverVehicleStatusChangedV1 {
  return {
    event_id: envelope.eventId,
    event_type: DRIVER_EVENT_TYPES.DRIVER_VEHICLE_STATUS_CHANGED,
    event_version: "v1",
    occurred_at: envelope.occurredAt,
    producer: "drivers-service",
    aggregate: { type: "driver_vehicle", id: vehicle.id },
    trace_id: envelope.traceId,
    data: {
      driver_public_id: vehicle.waslaPublicId,
      vehicle_id: vehicle.id,
      status: vehicle.status,
      // `is_primary` travels WITH the status because retirement changes both, and
      // a consumer that learns only "retired" cannot tell whether the driver
      // still has a primary vehicle at all.
      is_primary: vehicle.isPrimary,
      vehicle_class: vehicle.vehicleClass,
      occurred_for: effectiveAt(envelope),
    },
  };
}

export function driverDocumentSubmitted(
  document: DriverDocument,
  envelope: EnvelopeInput,
): DriverDocumentSubmittedV1 {
  return {
    event_id: envelope.eventId,
    event_type: DRIVER_EVENT_TYPES.DRIVER_DOCUMENT_SUBMITTED,
    event_version: "v1",
    occurred_at: envelope.occurredAt,
    producer: "drivers-service",
    aggregate: { type: "driver_document", id: document.id },
    trace_id: envelope.traceId,
    data: {
      driver_public_id: document.waslaPublicId,
      document_id: document.id,
      document_type: document.documentType,
      vehicle_id: document.vehicleId,
      expires_at: document.expiresAt,
      occurred_for: effectiveAt(envelope),
      // `storage_ref` is NOT here. It is a key into the file store, and a broker
      // fan-out is the last place a pointer to a scan of an ID card belongs.
    },
  };
}

export function driverDocumentReviewed(
  document: DriverDocument,
  envelope: EnvelopeInput,
): DriverDocumentReviewedV1 {
  if (document.status !== "verified" && document.status !== "rejected") {
    // A "reviewed" event for a document that was not reviewed would teach every
    // consumer to re-check the status field, which defeats the event.
    throw new Error("drivers.document_reviewed requires a decided document");
  }
  return {
    event_id: envelope.eventId,
    event_type: DRIVER_EVENT_TYPES.DRIVER_DOCUMENT_REVIEWED,
    event_version: "v1",
    occurred_at: envelope.occurredAt,
    producer: "drivers-service",
    aggregate: { type: "driver_document", id: document.id },
    trace_id: envelope.traceId,
    data: {
      driver_public_id: document.waslaPublicId,
      document_id: document.id,
      document_type: document.documentType,
      status: document.status,
      rejection_reason_code: document.rejectionReasonCode,
      expires_at: document.expiresAt,
      occurred_for: effectiveAt(envelope),
      // `reviewed_by` stays in the database: the operator's identity is an
      // internal audit fact, not something to broadcast to every subscriber.
    },
  };
}

export function driverAvailabilityDeclared(
  profile: DriverProfile,
  envelope: EnvelopeInput,
): DriverAvailabilityDeclaredV1 {
  return {
    event_id: envelope.eventId,
    event_type: DRIVER_EVENT_TYPES.DRIVER_AVAILABILITY_DECLARED,
    event_version: "v1",
    occurred_at: envelope.occurredAt,
    producer: "drivers-service",
    aggregate: { type: "driver", id: profile.waslaPublicId },
    trace_id: envelope.traceId,
    data: {
      driver_public_id: profile.waslaPublicId,
      declared_availability: profile.declaredAvailability,
      occurred_for: effectiveAt(envelope),
    },
  };
}

/**
 * The central event: it is what turns "why did no offer reach me?" into a
 * question with a stored answer.
 *
 * `from_state` is nullable and that nullability is meaningful: `null` is the FIRST
 * evaluation of a driver, not a transition from `unknown`. Writing `unknown` there
 * would make the very first evaluation of every driver look like a regression.
 */
export function driverEligibilityChanged(
  waslaPublicId: string,
  fromState: EligibilityState | null,
  decision: EligibilityDecision,
  trigger: EligibilityTrigger,
  envelope: EnvelopeInput,
): DriverEligibilityChangedV1 {
  return {
    event_id: envelope.eventId,
    event_type: DRIVER_EVENT_TYPES.DRIVER_ELIGIBILITY_CHANGED,
    event_version: "v1",
    occurred_at: envelope.occurredAt,
    producer: "drivers-service",
    aggregate: { type: "driver", id: waslaPublicId },
    trace_id: envelope.traceId,
    data: {
      driver_public_id: waslaPublicId,
      from_state: fromState,
      to_state: decision.state,
      reasons: [...decision.reasonCodes],
      policy_version: decision.policyVersion,
      trigger,
      occurred_for: effectiveAt(envelope),
    },
  };
}

/**
 * NOTE the `Event` suffix, which the other factories here do not carry.
 *
 * `driverSuspended()` is already taken by the ERROR factory in `domain/errors.ts`
 * (the 409 raised when a suspended driver tries to write). Two exports with one name
 * in the package surface is a collision the compiler catches; two exports whose names
 * differ by nothing but their module is a collision the READER does not, and "throw
 * the suspension" versus "announce the suspension" is not a distinction to leave to
 * import order.
 */
export function driverSuspendedEvent(
  profile: DriverProfile,
  reasonCode: string,
  envelope: EnvelopeInput,
): DriverSuspendedV1 {
  return {
    event_id: envelope.eventId,
    event_type: DRIVER_EVENT_TYPES.DRIVER_SUSPENDED,
    event_version: "v1",
    occurred_at: envelope.occurredAt,
    producer: "drivers-service",
    aggregate: { type: "driver", id: profile.waslaPublicId },
    trace_id: envelope.traceId,
    data: {
      driver_public_id: profile.waslaPublicId,
      // A code, not free text: the reason is counted and compared, and an Arabic
      // sentence typed by an operator can be neither.
      reason_code: reasonCode,
      occurred_for: effectiveAt(envelope),
    },
  };
}

export function driverReinstated(
  profile: DriverProfile,
  envelope: EnvelopeInput,
): DriverReinstatedV1 {
  return {
    event_id: envelope.eventId,
    event_type: DRIVER_EVENT_TYPES.DRIVER_REINSTATED,
    event_version: "v1",
    occurred_at: envelope.occurredAt,
    producer: "drivers-service",
    aggregate: { type: "driver", id: profile.waslaPublicId },
    trace_id: envelope.traceId,
    data: {
      driver_public_id: profile.waslaPublicId,
      occurred_for: effectiveAt(envelope),
    },
  };
}
