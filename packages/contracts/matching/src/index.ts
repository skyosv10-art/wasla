/**
 * @wasla/contracts-matching
 *
 * تبرير الحزمة (§7): تضع العقود الكنسية للمطابقة في سطح TypeScript واحد كي لا ينسخ
 * المستهلكون الحقيقة أو يبتكروا عقداً موازياً.
 *
 * These are Contract First artifacts (ADR-004), NOT a runtime implementation;
 * implementation lands in later MRs. ADR-011 limits Matching to candidacy and
 * ranking: it owns no offer, wave, deadline, or Order Engine write. Candidate
 * ids and scores remain in the audit store and never enter an event (decision 8).
 * Regenerate API types: pnpm --filter @wasla/contracts-matching generate
 */
export type * from "./api-types.js";
export type * from "./events-types.js";
export { MATCHING_EVENT_TYPES } from "./events-types.js";

import type { components, paths } from "./api-types.js";
export type { paths };
export type WaslaPublicId = components["schemas"]["WaslaPublicId"];
export type ZoneRef = components["schemas"]["ZoneRef"];
export type OrderPublicId = components["schemas"]["OrderPublicId"];
export type CandidateQuery = components["schemas"]["CandidateQuery"];
export type RankedCandidate = components["schemas"]["RankedCandidate"];
export type CandidateResult = components["schemas"]["CandidateResult"];
export type CandidacyUpsert = components["schemas"]["CandidacyUpsert"];
export type Candidacy = components["schemas"]["Candidacy"];
export type Ruleset = components["schemas"]["Ruleset"];
export type Decision = components["schemas"]["Decision"];
export type ErrorResponse = components["schemas"]["ErrorResponse"];

export const MATCHING_ERROR_CODES = [
  "MATCHING_VALIDATION_FAILED", "MATCHING_IDEMPOTENCY_KEY_REQUIRED",
  "MATCHING_CANDIDACY_NOT_FOUND", "MATCHING_DECISION_NOT_FOUND",
  "MATCHING_IDEMPOTENCY_KEY_REUSED", "MATCHING_ZONE_UNKNOWN",
  "MATCHING_VEHICLE_CLASS_UNKNOWN", "MATCHING_SERVICE_KIND_UNKNOWN",
  "MATCHING_RULESET_NOT_FOUND", "MATCHING_RULESET_NOT_FROZEN",
  "MATCHING_RULESET_WEIGHTS_INVALID", "MATCHING_UNAVAILABLE",
] as const;
export type MatchingErrorCode = (typeof MATCHING_ERROR_CODES)[number];
export const MATCHING_ERROR_CLASS_STATUS = {
  validation_error: 400, not_found: 404, conflict: 409, unprocessable: 422, service_unavailable: 503,
} as const;
export type MatchingErrorClass = keyof typeof MATCHING_ERROR_CLASS_STATUS;
export const MATCHING_ERROR_CODE_CLASS: Record<MatchingErrorCode, MatchingErrorClass> = {
  MATCHING_VALIDATION_FAILED: "validation_error", MATCHING_IDEMPOTENCY_KEY_REQUIRED: "validation_error",
  MATCHING_CANDIDACY_NOT_FOUND: "not_found", MATCHING_DECISION_NOT_FOUND: "not_found",
  MATCHING_IDEMPOTENCY_KEY_REUSED: "conflict", MATCHING_ZONE_UNKNOWN: "unprocessable",
  MATCHING_VEHICLE_CLASS_UNKNOWN: "unprocessable", MATCHING_SERVICE_KIND_UNKNOWN: "unprocessable",
  MATCHING_RULESET_NOT_FOUND: "unprocessable", MATCHING_RULESET_NOT_FROZEN: "unprocessable",
  MATCHING_RULESET_WEIGHTS_INVALID: "unprocessable", MATCHING_UNAVAILABLE: "service_unavailable",
};
export function httpStatusForMatchingError(code: MatchingErrorCode): number {
  return MATCHING_ERROR_CLASS_STATUS[MATCHING_ERROR_CODE_CLASS[code]];
}

/** Closed codes for an empty matching result; first failing hard filter wins. */
export const MATCHING_EMPTY_REASON_CODES = [
  "NO_CANDIDACY_ROWS", "NO_AVAILABLE_DRIVERS", "NO_ELIGIBLE_DRIVERS", "NO_FRESH_CANDIDACY",
  "NO_SERVICE_MATCH", "NO_VEHICLE_MATCH", "NO_ZONE_MATCH", "ALL_CANDIDATES_EXCLUDED",
] as const;
/** Closed codes that explain a candidacy availability transition. */
export const MATCHING_AVAILABILITY_REASON_CODES = [
  "DRIVER_DECLARED", "OFFER_ACCEPTED", "ORDER_TERMINAL", "ADMIN_OVERRIDE", "STALE_TIMEOUT",
] as const;
export type MatchingEmptyReasonCode = (typeof MATCHING_EMPTY_REASON_CODES)[number];
export type MatchingAvailabilityReasonCode = (typeof MATCHING_AVAILABILITY_REASON_CODES)[number];

/** Route values are kept for contract clients and drift-guarded against OpenAPI. */
export const MATCHING_API_PATHS = [
  "/health", "/matching/candidates", "/candidacy/{driverPublicId}",
  "/candidacy/{driverPublicId}/availability", "/matching/rulesets", "/matching/decisions/{decisionId}",
] as const;
export const MATCHING_HTTP_STATUS_CODES = [200, 400, 404, 409, 422, 503] as const;
