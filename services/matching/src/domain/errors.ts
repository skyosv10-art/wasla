/**
 * Matching error contract.
 *
 * The catalog itself is NOT redefined here: the stable codes, their classes and
 * the HTTP status derived from each class live in @wasla/contracts-matching,
 * which is drift-guarded against services/matching/contracts/errors.md. This
 * file only wraps them in a throwable typed error, so a use case raises a
 * contract code and the HTTP layer (MR 5/6) maps it without re-classifying.
 *
 * Tests assert `code` — never the Arabic message copy.
 *
 * And the rule this service exists to protect: **"no candidate" is not an
 * error.** Zero candidates is a 200 with an `empty_reason_code`; nothing in this
 * file may be thrown for it, because a consumer that learns to ignore errors is
 * worse than any single failed match.
 */

import {
  MATCHING_ERROR_CODE_CLASS,
  httpStatusForMatchingError,
  type MatchingErrorClass,
  type MatchingErrorCode,
} from "@wasla/contracts-matching";

export type { MatchingErrorClass, MatchingErrorCode };

/**
 * Structured, machine-readable detail carried alongside the code.
 *
 * Named optional fields rather than a free bag: a validation error must always
 * be able to name the field it refused, and privacy forbids echoing the value
 * (errors.md §"ما لا يُعاد في أي خطأ").
 */
export interface MatchingErrorDetails {
  readonly field?: string;
  readonly expected?: string;
  readonly rulesetVersion?: number;
  readonly weightsSum?: number;
}

/** A domain error carrying a stable contract code. */
export class MatchingError extends Error {
  readonly code: MatchingErrorCode;
  readonly class: MatchingErrorClass;
  readonly httpStatus: number;
  readonly traceId?: string;
  readonly details: MatchingErrorDetails;

  constructor(
    code: MatchingErrorCode,
    message: string,
    options: { traceId?: string; details?: MatchingErrorDetails } = {},
  ) {
    super(message);
    this.name = "MatchingError";
    this.code = code;
    this.class = MATCHING_ERROR_CODE_CLASS[code];
    this.httpStatus = httpStatusForMatchingError(code);
    this.traceId = options.traceId;
    this.details = options.details ?? {};
  }
}

/** Narrowing helper for callers that catch broadly. */
export function isMatchingError(value: unknown): value is MatchingError {
  return value instanceof MatchingError;
}

/**
 * A shape rejection that names the field and never repeats its value.
 *
 * A value inside a message becomes a value inside a log, and a log is read with
 * wider permissions than the request that produced it.
 */
export function validationFailed(
  field: string,
  expected: string,
  traceId?: string,
): MatchingError {
  return new MatchingError(
    "MATCHING_VALIDATION_FAILED",
    `الحقل ${field} لا يطابق العقد (المتوقَّع: ${expected})`,
    { traceId, details: { field, expected } },
  );
}

/** No candidacy row for this driver: availability is an attribute of an existing row. */
export function candidacyNotFound(traceId?: string): MatchingError {
  return new MatchingError(
    "MATCHING_CANDIDACY_NOT_FOUND",
    "لا صفّ ترشيح لهذا السائق — نادِ PUT /candidacy/{id} أولاً",
    { traceId },
  );
}

/** Decisions are never updated nor deleted; absence means a wrong id. */
export function decisionNotFound(traceId?: string): MatchingError {
  return new MatchingError(
    "MATCHING_DECISION_NOT_FOUND",
    "لا قرار مطابقة بهذا المُعرّف",
    { traceId },
  );
}

/** Same idempotency key, different payload — measured by fingerprint, not by field diff. */
export function idempotencyKeyReused(traceId?: string): MatchingError {
  return new MatchingError(
    "MATCHING_IDEMPOTENCY_KEY_REUSED",
    "نفس مفتاح منع التكرار بحمولة مختلفة",
    { traceId },
  );
}

/** Every write carries `Idempotency-Key` (§43): the system's front door is a bot. */
export function idempotencyKeyRequired(traceId?: string): MatchingError {
  return new MatchingError(
    "MATCHING_IDEMPOTENCY_KEY_REQUIRED",
    "كل كتابة تحتاج مفتاح منع تكرار",
    { traceId },
  );
}

/** Zone absent from the geography hierarchy — checked through a port, not an FK (ADR-006). */
export function zoneUnknown(field: string, traceId?: string): MatchingError {
  return new MatchingError(
    "MATCHING_ZONE_UNKNOWN",
    `المنطقة المذكورة في ${field} غير موجودة في هرم الجغرافيا`,
    { traceId, details: { field } },
  );
}

export function rulesetNotFound(version: number, traceId?: string): MatchingError {
  return new MatchingError(
    "MATCHING_RULESET_NOT_FOUND",
    "نسخة القواعد المطلوبة غير موجودة",
    { traceId, details: { rulesetVersion: version } },
  );
}

/**
 * An editable ruleset must not rank.
 *
 * A decision that cannot be reproduced is a decision that cannot be defended in
 * front of a driver's complaint — so an unfrozen version is refused before any
 * candidate is scored, not after.
 */
export function rulesetNotFrozen(version: number, traceId?: string): MatchingError {
  return new MatchingError(
    "MATCHING_RULESET_NOT_FROZEN",
    "نسخة القواعد موجودة وغير مُقفَلة — لا نُرتّب بقواعد قابلة للتحرير",
    { traceId, details: { rulesetVersion: version } },
  );
}

/** Weights must sum to exactly 100 — enforced here AND by `ck_ruleset_weights_sum_100`. */
export function rulesetWeightsInvalid(
  version: number,
  weightsSum: number,
  traceId?: string,
): MatchingError {
  return new MatchingError(
    "MATCHING_RULESET_WEIGHTS_INVALID",
    "مجموع أوزان نسخة القواعد ليس 100",
    { traceId, details: { rulesetVersion: version, weightsSum } },
  );
}

/**
 * Degraded service: no persistence, or no frozen ruleset to rank with.
 *
 * A matching service without rules cannot order anything, and calling itself
 * healthy would hide a fault that surfaces on the first real order.
 */
export function matchingUnavailable(reason: string, traceId?: string): MatchingError {
  return new MatchingError("MATCHING_UNAVAILABLE", reason, { traceId });
}
