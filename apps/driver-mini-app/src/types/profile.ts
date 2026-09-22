/**
 * Driver profile types for the driver mini app.
 *
 * Mirrors the API contract from the drivers-service (packages/contracts/driver).
 */

export const PROFILE_STATUSES = ["active", "suspended"] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

export const VERIFICATION_STATUSES = [
  "unverified",
  "pending_review",
  "verified",
  "rejected",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const DECLARED_AVAILABILITY = ["available", "offline"] as const;
export type DeclaredAvailability = (typeof DECLARED_AVAILABILITY)[number];

export const SERVICE_KINDS = ["ride", "delivery"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

/** Driver profile as returned by GET /drivers/:id */
export interface DriverProfile {
  wasla_public_id: string;
  display_name: string | null;
  preferred_locale: string;
  status: ProfileStatus;
  verification_status: VerificationStatus;
  declared_availability: DeclaredAvailability;
  work_city_zone_id: string | null;
  service_kinds: ServiceKind[];
  suspension_reason_code: string | null;
  eligibility_policy_version: number;
  eligibility_recheck_at: string | null;
  last_published_state: string | null;
  last_published_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Patch payload for PATCH /drivers/:id.
 * Present-and-null clears the field; absent leaves it untouched.
 */
export interface ProfilePatch {
  display_name?: string | null;
  preferred_locale?: string;
  work_city_zone_id?: string | null;
  service_kinds?: ServiceKind[];
}
