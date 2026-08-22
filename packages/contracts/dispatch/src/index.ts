/**
 * @wasla/contracts-dispatch
 *
 * تبرير الحزمة (§7): تضع العقود الكنسية للتوزيع في سطح TypeScript واحد كي لا ينسخ
 * المستهلكون الحقيقة أو يخلطوا قرار التوزيع بتنفيذه.
 *
 * These are Contract First artifacts (ADR-004), NOT a runtime implementation;
 * implementation lands in later MRs. ADR-011 limits Dispatch to tick-driven
 * coordination: it owns offers and stored deadlines, but never candidacy,
 * eligibility, ranking weights, or hidden process timers.
 * Regenerate API types: pnpm --filter @wasla/contracts-dispatch generate
 */
export type * from "./api-types.js";
export type * from "./events-types.js";
export { DISPATCH_EVENT_TYPES } from "./events-types.js";

import type { components, paths } from "./api-types.js";
export type { paths };
export type WaslaPublicId = components["schemas"]["WaslaPublicId"];
export type OrderPublicId = components["schemas"]["OrderPublicId"];
export type DispatchJobStatus = components["schemas"]["DispatchJobStatus"];
export type DispatchWaveStatus = components["schemas"]["DispatchWaveStatus"];
export type DispatchOfferStatus = components["schemas"]["DispatchOfferStatus"];
export type OrderType = components["schemas"]["OrderType"];
export type VehicleClass = components["schemas"]["VehicleClass"];
export type CreateDispatchJobRequest = components["schemas"]["CreateDispatchJobRequest"];
export type DispatchRulesSnapshot = components["schemas"]["DispatchRulesSnapshot"];
export type DispatchJob = components["schemas"]["DispatchJob"];
export type DispatchOffer = components["schemas"]["DispatchOffer"];
export type DispatchOfferList = components["schemas"]["DispatchOfferList"];
export type RejectOfferRequest = components["schemas"]["RejectOfferRequest"];
export type CancelDispatchJobRequest = components["schemas"]["CancelDispatchJobRequest"];
export type TickResult = components["schemas"]["TickResult"];
export type ErrorResponse = components["schemas"]["ErrorResponse"];

export const DISPATCH_ERROR_CODES = [
  "DISPATCH_VALIDATION_FAILED", "DISPATCH_JOB_NOT_FOUND", "DISPATCH_OFFER_NOT_FOUND",
  "DISPATCH_IDEMPOTENCY_KEY_REUSED", "DISPATCH_JOB_ALREADY_EXISTS", "DISPATCH_JOB_NOT_CANCELLABLE",
  "DISPATCH_OFFER_ALREADY_RESOLVED", "DISPATCH_OFFER_SUPERSEDED", "DISPATCH_WAVE_ALREADY_OPEN",
  "DISPATCH_REASON_CODE_REQUIRED", "DISPATCH_REASON_CODE_UNKNOWN", "DISPATCH_JOB_NOT_DISPATCHABLE",
  "DISPATCH_ORDER_ENGINE_REJECTED", "DISPATCH_MATCHING_RESULT_INVALID", "DISPATCH_ENGINE_UNAVAILABLE",
  "DISPATCH_ORDER_ENGINE_TIMEOUT",
] as const;
export type DispatchErrorCode = (typeof DISPATCH_ERROR_CODES)[number];
export const DISPATCH_ERROR_CLASS_STATUS = {
  validation_error: 400, not_found: 404, conflict: 409, unprocessable: 422, service_unavailable: 503,
} as const;
export type DispatchErrorClass = keyof typeof DISPATCH_ERROR_CLASS_STATUS;
export const DISPATCH_ERROR_CODE_CLASS: Record<DispatchErrorCode, DispatchErrorClass> = {
  DISPATCH_VALIDATION_FAILED: "validation_error", DISPATCH_JOB_NOT_FOUND: "not_found",
  DISPATCH_OFFER_NOT_FOUND: "not_found", DISPATCH_IDEMPOTENCY_KEY_REUSED: "conflict",
  DISPATCH_JOB_ALREADY_EXISTS: "conflict", DISPATCH_JOB_NOT_CANCELLABLE: "conflict",
  DISPATCH_OFFER_ALREADY_RESOLVED: "conflict", DISPATCH_OFFER_SUPERSEDED: "conflict",
  DISPATCH_WAVE_ALREADY_OPEN: "conflict", DISPATCH_REASON_CODE_REQUIRED: "unprocessable",
  DISPATCH_REASON_CODE_UNKNOWN: "unprocessable", DISPATCH_JOB_NOT_DISPATCHABLE: "unprocessable",
  DISPATCH_ORDER_ENGINE_REJECTED: "unprocessable", DISPATCH_MATCHING_RESULT_INVALID: "unprocessable",
  DISPATCH_ENGINE_UNAVAILABLE: "service_unavailable", DISPATCH_ORDER_ENGINE_TIMEOUT: "service_unavailable",
};
export function httpStatusForDispatchError(code: DispatchErrorCode): number {
  return DISPATCH_ERROR_CLASS_STATUS[DISPATCH_ERROR_CODE_CLASS[code]];
}

export const DISPATCH_REASON_CODES = [
  "OFFER_ACCEPTED", "DRIVER_DECLINED", "DRIVER_UNAVAILABLE", "DRIVER_VEHICLE_ISSUE",
  "OFFER_TIMED_OUT", "OFFER_SUPERSEDED", "JOB_CANCELLED", "WAVE_OFFERS_RESOLVED",
  "ALL_WAVES_EXHAUSTED", "NO_DRIVER_AVAILABLE", "ORDER_ENGINE_REJECTED", "ORDER_CANCELLED",
  "DISPATCH_CANCELLED_BY_REQUESTER",
] as const;
export type DispatchReasonCode = (typeof DISPATCH_REASON_CODES)[number];

export const DISPATCH_API_PATHS = [
  "/health", "/dispatch/jobs", "/dispatch/jobs/{job_id}", "/dispatch/jobs/{job_id}/offers",
  "/dispatch/tick", "/dispatch/offers/{offer_id}/accept", "/dispatch/offers/{offer_id}/reject",
  "/dispatch/jobs/{job_id}/cancel",
] as const;
export const DISPATCH_HTTP_STATUS_CODES = [200, 201, 400, 404, 409, 422, 503] as const;

/**
 * منفذ خدمة التوزيع (CONTAINERS §4.3).
 *
 * يقيم الثابت في حزمة العقد لا في الخدمة لأن بوابة الخروج (dispatch-e2e) وأي
 * مستهلك لاحق يحتاجان المنفذ نفسه، ونسخه في مكانين يعني انحرافه في مكانين.
 */
export const DISPATCH_SERVICE_PORT = 8089;
