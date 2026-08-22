/**
 * Driver Core Domain Event types — hand-derived from
 * services/drivers/contracts/events.json (JSON Schema 2020-12).
 *
 * Drift guards read the canonical schema at test time. ADR-012 decision 8:
 * an event says WHAT changed, never WHO the driver is — no name, phone, plate,
 * document storage_ref, coordinate, or channel id ever enters a payload.
 */
export type DriverAggregateType = "driver" | "driver_document" | "driver_vehicle";

/** حالة مُشتقّة لا مخزّنة (القرار 2). `unknown` تعني «لا ملفّ» لا «لم نتحقّق بعد». */
export type DriverEligibilityState = "eligible" | "ineligible" | "suspended" | "unknown";

/** ما يُعلنه السائق. `busy` غائبة عمداً: يملكها التوزيع (القرار 4). */
export type DeclaredAvailability = "available" | "offline";

export type DriverVehicleClass =
  | "sedan" | "suv" | "van" | "pickup" | "motorcycle" | "truck_small";

export type DriverDocumentType =
  | "national_id" | "driving_license" | "vehicle_registration"
  | "vehicle_insurance" | "vehicle_photo";

export type DriverLocale = "ar" | "en" | "ur";

/** ما حرّك حساب الأهليّة. مُقفل كي يبقى سؤال «لماذا تغيّرت؟» قابلاً للحصر. */
export type EligibilityTrigger =
  | "profile_changed" | "document_reviewed" | "document_submitted"
  | "vehicle_changed" | "zones_changed" | "availability_declared"
  | "suspended" | "reinstated" | "expiry_tick" | "recompute";

export interface DriverEventEnvelope {
  event_id: string;
  event_type: string;
  event_version: string;
  occurred_at: string;
  producer: "drivers-service";
  aggregate: { type: DriverAggregateType; id: string };
  trace_id?: string | null;
}

export interface DriverRegisteredV1 extends DriverEventEnvelope {
  event_type: "drivers.registered";
  event_version: "v1";
  data: {
    driver_public_id: string;
    preferred_locale: DriverLocale;
    work_city_zone_id?: string | null;
    occurred_for: string;
  };
}

export interface DriverProfileUpdatedV1 extends DriverEventEnvelope {
  event_type: "drivers.profile_updated";
  event_version: "v1";
  data: {
    driver_public_id: string;
    service_kinds: Array<"ride" | "delivery">;
    work_city_zone_id?: string | null;
    preferred_locale?: DriverLocale;
    occurred_for: string;
  };
}

export interface DriverServiceZonesChangedV1 extends DriverEventEnvelope {
  event_type: "drivers.service_zones_changed";
  event_version: "v1";
  data: { driver_public_id: string; zone_ids: string[]; occurred_for: string };
}

export interface DriverVehicleRegisteredV1 extends DriverEventEnvelope {
  event_type: "drivers.vehicle_registered";
  event_version: "v1";
  data: {
    driver_public_id: string;
    vehicle_id: string;
    vehicle_class: DriverVehicleClass;
    is_primary: boolean;
    occurred_for: string;
  };
}

export interface DriverVehicleStatusChangedV1 extends DriverEventEnvelope {
  event_type: "drivers.vehicle_status_changed";
  event_version: "v1";
  data: {
    driver_public_id: string;
    vehicle_id: string;
    status: "active" | "retired";
    is_primary: boolean;
    vehicle_class?: DriverVehicleClass;
    occurred_for: string;
  };
}

export interface DriverDocumentSubmittedV1 extends DriverEventEnvelope {
  event_type: "drivers.document_submitted";
  event_version: "v1";
  data: {
    driver_public_id: string;
    document_id: string;
    document_type: DriverDocumentType;
    vehicle_id?: string | null;
    expires_at?: string | null;
    occurred_for: string;
  };
}

export interface DriverDocumentReviewedV1 extends DriverEventEnvelope {
  event_type: "drivers.document_reviewed";
  event_version: "v1";
  data: {
    driver_public_id: string;
    document_id: string;
    document_type: DriverDocumentType;
    status: "verified" | "rejected";
    rejection_reason_code?: string | null;
    expires_at?: string | null;
    occurred_for: string;
  };
}

export interface DriverAvailabilityDeclaredV1 extends DriverEventEnvelope {
  event_type: "drivers.availability_declared";
  event_version: "v1";
  data: {
    driver_public_id: string;
    declared_availability: DeclaredAvailability;
    occurred_for: string;
  };
}

/** الحدث المركزي: يجعل «لماذا لم يصله عرض؟» سؤالاً له جواب مخزّن. */
export interface DriverEligibilityChangedV1 extends DriverEventEnvelope {
  event_type: "drivers.eligibility_changed";
  event_version: "v1";
  data: {
    driver_public_id: string;
    from_state?: DriverEligibilityState | null;
    to_state: DriverEligibilityState;
    reasons: EligibilityReasonCode[];
    policy_version: number;
    trigger: EligibilityTrigger;
    occurred_for: string;
  };
}

export interface DriverSuspendedV1 extends DriverEventEnvelope {
  event_type: "drivers.suspended";
  event_version: "v1";
  data: { driver_public_id: string; reason_code: string; occurred_for: string };
}

export interface DriverReinstatedV1 extends DriverEventEnvelope {
  event_type: "drivers.reinstated";
  event_version: "v1";
  data: { driver_public_id: string; occurred_for: string };
}

export type DriverDomainEvent =
  | DriverRegisteredV1
  | DriverProfileUpdatedV1
  | DriverServiceZonesChangedV1
  | DriverVehicleRegisteredV1
  | DriverVehicleStatusChangedV1
  | DriverDocumentSubmittedV1
  | DriverDocumentReviewedV1
  | DriverAvailabilityDeclaredV1
  | DriverEligibilityChangedV1
  | DriverSuspendedV1
  | DriverReinstatedV1;

export const DRIVER_EVENT_TYPES = {
  DRIVER_REGISTERED: "drivers.registered",
  DRIVER_PROFILE_UPDATED: "drivers.profile_updated",
  DRIVER_SERVICE_ZONES_CHANGED: "drivers.service_zones_changed",
  DRIVER_VEHICLE_REGISTERED: "drivers.vehicle_registered",
  DRIVER_VEHICLE_STATUS_CHANGED: "drivers.vehicle_status_changed",
  DRIVER_DOCUMENT_SUBMITTED: "drivers.document_submitted",
  DRIVER_DOCUMENT_REVIEWED: "drivers.document_reviewed",
  DRIVER_AVAILABILITY_DECLARED: "drivers.availability_declared",
  DRIVER_ELIGIBILITY_CHANGED: "drivers.eligibility_changed",
  DRIVER_SUSPENDED: "drivers.suspended",
  DRIVER_REINSTATED: "drivers.reinstated",
} as const;

export type DriverEventType = (typeof DRIVER_EVENT_TYPES)[keyof typeof DRIVER_EVENT_TYPES];

/**
 * أكواد أسباب عدم الأهليّة — مُقفلة لأنّ سبباً مجهولاً لا يستطيع السائق ولا الدعم معالجته.
 * موثّقة في services/drivers/contracts/errors.md §كتالوج أسباب عدم الأهليّة، ومحروسة ضدّ الانحراف.
 */
export const ELIGIBILITY_REASON_CODES = [
  "PROFILE_SUSPENDED", "PROFILE_NOT_VERIFIED", "NO_PRIMARY_VEHICLE", "NO_SERVICE_ZONE",
  "NO_SERVICE_KIND", "DOCUMENT_MISSING", "DOCUMENT_PENDING", "DOCUMENT_REJECTED",
  "DOCUMENT_EXPIRED",
] as const;

export type EligibilityReasonCode = (typeof ELIGIBILITY_REASON_CODES)[number];
