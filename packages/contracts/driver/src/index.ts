/**
 * @wasla/contracts-driver
 *
 * تبرير الحزمة (§7): تضع العقود الكنسية لنواة السائق في سطح TypeScript واحد كي لا ينسخ
 * المستهلكون الحقيقة أو يبتكروا عقداً موازياً.
 *
 * These are Contract First artifacts (ADR-004), NOT a runtime implementation;
 * implementation lands in later MRs of Phase 05. ADR-012 limits Driver Core to
 * the role profile, vehicles, documents, service zones, declared availability
 * and the DERIVED eligibility function: it stores no eligibility column
 * (decision 2), never writes matching's database (decision 3), owns no `busy`
 * availability (decision 4), and runs no timer (decision 5).
 * Regenerate API types: pnpm --filter @wasla/contracts-driver generate
 */
export type * from "./api-types.js";
export type * from "./events-types.js";
export { DRIVER_EVENT_TYPES, ELIGIBILITY_REASON_CODES } from "./events-types.js";

import type { components, paths } from "./api-types.js";
export type { paths };
export type WaslaPublicId = components["schemas"]["WaslaPublicId"];
export type ZoneRef = components["schemas"]["ZoneRef"];
export type DriverProfile = components["schemas"]["DriverProfile"];
export type DriverRegistration = components["schemas"]["DriverRegistration"];
export type DriverProfilePatch = components["schemas"]["DriverProfilePatch"];
export type ServiceZone = components["schemas"]["ServiceZone"];
export type ServiceZoneList = components["schemas"]["ServiceZoneList"];
export type Vehicle = components["schemas"]["Vehicle"];
export type VehicleRegistration = components["schemas"]["VehicleRegistration"];
export type VehiclePatch = components["schemas"]["VehiclePatch"];
export type DriverDocument = components["schemas"]["DriverDocument"];
export type DocumentSubmission = components["schemas"]["DocumentSubmission"];
export type DocumentReview = components["schemas"]["DocumentReview"];
export type AvailabilityUpdate = components["schemas"]["AvailabilityUpdate"];
export type SuspensionRequest = components["schemas"]["SuspensionRequest"];
export type EligibilityView = components["schemas"]["EligibilityView"];
export type EligibilityTickResult = components["schemas"]["EligibilityTickResult"];
export type HealthStatus = components["schemas"]["HealthStatus"];
export type ErrorResponse = components["schemas"]["ErrorResponse"];

export const DRIVER_ERROR_CODES = [
  "DRIVER_VALIDATION_FAILED", "DRIVER_IDEMPOTENCY_KEY_REQUIRED",
  "DRIVER_IDEMPOTENCY_KEY_REUSED", "DRIVER_NOT_FOUND", "DRIVER_ALREADY_EXISTS",
  "DRIVER_ZONE_UNKNOWN", "DRIVER_VEHICLE_CLASS_UNKNOWN", "DRIVER_SERVICE_KIND_UNKNOWN",
  "DRIVER_VEHICLE_NOT_FOUND", "DRIVER_PRIMARY_VEHICLE_REQUIRED", "DRIVER_VEHICLE_RETIRED",
  "DRIVER_DOCUMENT_NOT_FOUND", "DRIVER_DOCUMENT_ALREADY_REVIEWED",
  "DRIVER_DOCUMENT_TYPE_UNKNOWN", "DRIVER_DOCUMENT_EXPIRY_INVALID",
  "DRIVER_SUSPENDED", "DRIVER_NOT_SUSPENDED", "DRIVER_POLICY_NOT_FOUND",
  "DRIVER_POLICY_NOT_FROZEN", "DRIVER_CANDIDACY_PUBLISH_FAILED", "DRIVER_UNAVAILABLE",
] as const;
export type DriverErrorCode = (typeof DRIVER_ERROR_CODES)[number];

/**
 * `bad_gateway` صنف قائم بذاته لأنّ فشل النشر إلى المطابقة **خطأ تكاملنا لا خطأ المُنادي**:
 * الحالة المحلية تغيّرت بنجاح، والذي فشل هو إسقاطها إلى تابع خلفنا (ADR-012 القرار 3).
 */
export const DRIVER_ERROR_CLASS_STATUS = {
  validation_error: 400,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  bad_gateway: 502,
  service_unavailable: 503,
} as const;
export type DriverErrorClass = keyof typeof DRIVER_ERROR_CLASS_STATUS;

export const DRIVER_ERROR_CODE_CLASS: Record<DriverErrorCode, DriverErrorClass> = {
  DRIVER_VALIDATION_FAILED: "validation_error",
  DRIVER_IDEMPOTENCY_KEY_REQUIRED: "validation_error",
  DRIVER_VEHICLE_CLASS_UNKNOWN: "validation_error",
  DRIVER_SERVICE_KIND_UNKNOWN: "validation_error",
  DRIVER_DOCUMENT_TYPE_UNKNOWN: "validation_error",
  DRIVER_NOT_FOUND: "not_found",
  DRIVER_VEHICLE_NOT_FOUND: "not_found",
  DRIVER_DOCUMENT_NOT_FOUND: "not_found",
  DRIVER_IDEMPOTENCY_KEY_REUSED: "conflict",
  DRIVER_ALREADY_EXISTS: "conflict",
  DRIVER_DOCUMENT_ALREADY_REVIEWED: "conflict",
  DRIVER_SUSPENDED: "conflict",
  DRIVER_NOT_SUSPENDED: "conflict",
  DRIVER_ZONE_UNKNOWN: "unprocessable",
  DRIVER_PRIMARY_VEHICLE_REQUIRED: "unprocessable",
  DRIVER_VEHICLE_RETIRED: "unprocessable",
  DRIVER_DOCUMENT_EXPIRY_INVALID: "unprocessable",
  DRIVER_POLICY_NOT_FOUND: "unprocessable",
  DRIVER_POLICY_NOT_FROZEN: "unprocessable",
  DRIVER_CANDIDACY_PUBLISH_FAILED: "bad_gateway",
  DRIVER_UNAVAILABLE: "service_unavailable",
};

export function httpStatusForDriverError(code: DriverErrorCode): number {
  return DRIVER_ERROR_CLASS_STATUS[DRIVER_ERROR_CODE_CLASS[code]];
}

/** أنواع الوثائق المُقفلة. القائمة عقد لا تفضيل: توسيعها يحتاج نسخة سياسة جديدة. */
export const DRIVER_DOCUMENT_TYPES = [
  "national_id", "driving_license", "vehicle_registration",
  "vehicle_insurance", "vehicle_photo",
] as const;

export const DRIVER_VEHICLE_CLASSES = [
  "sedan", "suv", "van", "pickup", "motorcycle", "truck_small",
] as const;

/** قيمتان لا ثلاث: `busy` ليست من كلمات السائق (ADR-012 القرار 4). */
export const DRIVER_DECLARED_AVAILABILITY = ["available", "offline"] as const;

export const DRIVER_ELIGIBILITY_STATES = [
  "eligible", "ineligible", "suspended", "unknown",
] as const;

/** Route values are kept for contract clients and drift-guarded against OpenAPI. */
export const DRIVER_API_PATHS = [
  "/health",
  "/drivers",
  "/drivers/eligibility/tick",
  "/drivers/{waslaPublicId}",
  "/drivers/{waslaPublicId}/zones",
  "/drivers/{waslaPublicId}/vehicles",
  "/drivers/{waslaPublicId}/vehicles/{vehicleId}",
  "/drivers/{waslaPublicId}/documents",
  "/drivers/{waslaPublicId}/documents/{documentId}/review",
  "/drivers/{waslaPublicId}/availability",
  "/drivers/{waslaPublicId}/suspend",
  "/drivers/{waslaPublicId}/reinstate",
  "/drivers/{waslaPublicId}/eligibility",
] as const;

export const DRIVER_HTTP_STATUS_CODES = [200, 201, 400, 404, 409, 422, 502, 503] as const;

/**
 * القيَم التي تنشرها نواة السائق في إسقاط ترشيح المطابقة (ADR-012 القرار 3).
 *
 * تقيم هنا لا في كود الخدمة لأنّ عقد المطابقة انتظرهما منذ الطور 07: نشرٌ بقيمة أخرى
 * يُسدّد الدَين شكلاً ويُبقيه معنى، إذ لا يعرف المستهلك أنّ الأهليّة صارت محسوبة لا مدّعاة.
 */
export const DRIVER_CANDIDACY_ELIGIBILITY_SOURCE = "driver_core" as const;
export const DRIVER_CANDIDACY_UPDATED_BY = "driver_core" as const;

/**
 * منفذ خدمة نواة السائق (CONTAINERS §4.4).
 *
 * يقيم الثابت في حزمة العقد لا في الخدمة لأن المستهلك (بوت السائق · الإدارة) يحتاج المنفذ
 * ليبني عنوان العميل، ولو نسخه لصار لدينا حقيقتان تتباعدان بصمت.
 */
export const DRIVER_SERVICE_PORT = 8090;
