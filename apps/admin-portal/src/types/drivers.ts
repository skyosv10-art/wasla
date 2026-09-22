/**
 * Driver management types for admin portal.
 *
 * Mirrors the API contract from the drivers-service (packages/contracts/driver).
 * These are admin-facing types distinct from the driver mini app's self-service types.
 * Wire format is snake_case.
 */

export const DRIVER_STATUSES = ["active", "suspended"] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const VERIFICATION_STATUSES = [
  "unverified",
  "pending_review",
  "verified",
  "rejected",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const DOCUMENT_STATUSES = [
  "pending",
  "verified",
  "rejected",
  "superseded",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_TYPES = [
  "national_id",
  "driving_license",
  "vehicle_registration",
  "vehicle_insurance",
  "vehicle_photo",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Driver summary as returned by GET /drivers (admin list endpoint) */
export interface DriverSummary {
  wasla_public_id: string;
  display_name: string | null;
  status: DriverStatus;
  verification_status: VerificationStatus;
  declared_availability: string;
  work_city_zone_id: string | null;
  service_kinds: string[];
  suspension_reason_code: string | null;
  created_at: string;
  updated_at: string;
}

/** Wire response from GET /drivers */
export interface DriverListResponse {
  drivers: DriverSummary[];
}

/** Wire response from GET /drivers/:id */
export interface DriverDetail extends DriverSummary {
  phone_number: string | null;
  preferred_locale: string;
  eligibility_policy_version: number;
  last_published_state: string | null;
  last_published_at: string | null;
}

/** Document as returned by GET /drivers/:id/documents */
export interface DriverDocument {
  id: string;
  document_type: DocumentType;
  status: DocumentStatus;
  vehicle_id: string | null;
  storage_ref: string;
  issued_at: string | null;
  expires_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface DriverDocumentList {
  documents: DriverDocument[];
}

/** Review document request body */
export interface ReviewDocumentRequest {
  decision: "approved" | "rejected";
  rejection_reason_code?: string;
  reviewed_by: string;
}

/** Suspend request body */
export interface SuspendDriverRequest {
  reason_code: string;
}
