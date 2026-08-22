/**
 * Dispatch error contract.
 *
 * The catalog is NOT redefined here: the sixteen stable codes, their classes and
 * the HTTP status derived from each class live in `@wasla/contracts-dispatch`,
 * drift-guarded against `services/dispatch/contracts/errors.md`. This file only
 * wraps them in a throwable typed error, so a use case raises a contract code and
 * the HTTP layer (MR 5/6) maps it without re-classifying.
 *
 * Tests assert `code` — never the Arabic message copy.
 *
 * Two rules this file exists to protect:
 *
 * 1. **A rejection by the order engine is an outcome, not an exception.** It is
 *    written on the job with a reason code and an event; the thrown error only
 *    tells the caller the write did not happen the way they asked.
 * 2. **"No driver available" is not an error.** A wave that finds nobody escalates
 *    to the community and finally exhausts, both with reason codes and events.
 *    Nothing in this file may be thrown for it, because a caller trained to
 *    ignore 4xx is worse than any single unmatched order.
 */

import {
  DISPATCH_ERROR_CODE_CLASS,
  httpStatusForDispatchError,
  type DispatchErrorClass,
  type DispatchErrorCode,
} from "@wasla/contracts-dispatch";

export type { DispatchErrorClass, DispatchErrorCode };

/**
 * Structured, machine-readable detail carried alongside the code.
 *
 * Named optional fields rather than a free bag, and never the rejected value
 * itself: `errors.md` forbids echoing driver ids, coordinates or payloads into an
 * error body, because error logs are the least protected copy of any data.
 */
export interface DispatchErrorDetails {
  readonly field?: string;
  readonly expected?: string;
  readonly status?: string;
  readonly reasonCode?: string;
  readonly waveNumber?: number;
}

/** A domain error carrying a stable contract code. */
export class DispatchError extends Error {
  readonly code: DispatchErrorCode;
  readonly class: DispatchErrorClass;
  readonly httpStatus: number;
  readonly traceId?: string;
  readonly details: DispatchErrorDetails;

  constructor(
    code: DispatchErrorCode,
    message: string,
    options: { traceId?: string; details?: DispatchErrorDetails } = {},
  ) {
    super(message);
    this.name = "DispatchError";
    this.code = code;
    this.class = DISPATCH_ERROR_CODE_CLASS[code];
    this.httpStatus = httpStatusForDispatchError(code);
    this.traceId = options.traceId;
    this.details = options.details ?? {};
  }
}

/** Narrowing helper for callers that catch broadly. */
export function isDispatchError(value: unknown): value is DispatchError {
  return value instanceof DispatchError;
}

/** A shape rejection that names the field and never repeats its value. */
export function validationFailed(field: string, expected: string, traceId?: string): DispatchError {
  return new DispatchError("DISPATCH_VALIDATION_FAILED", `قيمة غير صالحة للحقل ${field}`, {
    traceId,
    details: { field, expected },
  });
}

export function jobNotFound(traceId?: string): DispatchError {
  return new DispatchError("DISPATCH_JOB_NOT_FOUND", "مهمة التوزيع غير موجودة", { traceId });
}

export function offerNotFound(traceId?: string): DispatchError {
  return new DispatchError("DISPATCH_OFFER_NOT_FOUND", "العرض غير موجود", { traceId });
}

/** Same idempotency key, different payload — measured by fingerprint, not field diff. */
export function idempotencyKeyReused(traceId?: string): DispatchError {
  return new DispatchError(
    "DISPATCH_IDEMPOTENCY_KEY_REUSED",
    "مفتاح منع التكرار مستعمل بحمولة مختلفة",
    { traceId, details: { field: "Idempotency-Key" } },
  );
}

/** One order, one dispatch job — enforced by `ux_dispatch_jobs_order_id` too. */
export function jobAlreadyExists(traceId?: string): DispatchError {
  return new DispatchError("DISPATCH_JOB_ALREADY_EXISTS", "للطلب مهمة توزيع قائمة", { traceId });
}

export function jobNotCancellable(status: string, traceId?: string): DispatchError {
  return new DispatchError("DISPATCH_JOB_NOT_CANCELLABLE", "المهمة في حالة نهائية لا تُلغى", {
    traceId,
    details: { status },
  });
}

/** The offer already has an answer; a second answer is not an update. */
export function offerAlreadyResolved(status: string, traceId?: string): DispatchError {
  return new DispatchError("DISPATCH_OFFER_ALREADY_RESOLVED", "العرض حُسم مسبقاً", {
    traceId,
    details: { status },
  });
}

/** Another driver won, or the engine refused a second live assignment. */
export function offerSuperseded(traceId?: string): DispatchError {
  return new DispatchError("DISPATCH_OFFER_SUPERSEDED", "سُبق العرض بقبول آخر", { traceId });
}

/** Mirrors the partial unique index `ux_dispatch_waves_one_open_job`. */
export function waveAlreadyOpen(waveNumber: number, traceId?: string): DispatchError {
  return new DispatchError("DISPATCH_WAVE_ALREADY_OPEN", "للمهمة موجة مفتوحة بالفعل", {
    traceId,
    details: { waveNumber },
  });
}

export function reasonCodeRequired(status: string, traceId?: string): DispatchError {
  return new DispatchError("DISPATCH_REASON_CODE_REQUIRED", "هذه الحالة تستلزم كود سبب", {
    traceId,
    details: { status, field: "reason_code" },
  });
}

/**
 * A reason code that is not usable here — either absent from the catalog entirely, or a
 * catalog code that this status/action is not allowed to carry. Both are the same mistake
 * from the caller's side ("this code is not one of the ones I may send"), and the contract
 * gives them one code, so `allowed` is what makes the answer actionable.
 */
export function reasonCodeUnknown(
  status: string,
  traceId?: string,
  allowed?: readonly string[],
): DispatchError {
  return new DispatchError("DISPATCH_REASON_CODE_UNKNOWN", "كود السبب غير معروف لهذه الحالة", {
    traceId,
    details: { status, field: "reason_code", ...(allowed === undefined ? {} : { allowed }) },
  });
}

/** The job's status forbids the requested dispatch move. */
export function jobNotDispatchable(status: string, traceId?: string): DispatchError {
  return new DispatchError("DISPATCH_JOB_NOT_DISPATCHABLE", "حالة المهمة تمنع هذه الخطوة", {
    traceId,
    details: { status },
  });
}

/**
 * The order engine refused, and the refusal is final.
 *
 * 409/422 from the engine per `errors.md`: the same idempotency key must not be
 * retried, because a retry would only be refused again while the customer waits.
 */
export function orderEngineRejected(traceId?: string): DispatchError {
  return new DispatchError("DISPATCH_ORDER_ENGINE_REJECTED", "محرّك الطلبات رفض الإسناد نهائياً", {
    traceId,
  });
}

/** Matching answered with something the job snapshot cannot use. */
export function matchingResultInvalid(expected: string, traceId?: string): DispatchError {
  return new DispatchError("DISPATCH_MATCHING_RESULT_INVALID", "جواب المطابقة غير صالح", {
    traceId,
    details: { field: "candidates", expected },
  });
}

/** A mandatory port is down. Retrying with the same key is safe. */
export function engineUnavailable(traceId?: string): DispatchError {
  return new DispatchError("DISPATCH_ENGINE_UNAVAILABLE", "منفذ إلزامي غير متاح", { traceId });
}

/**
 * No answer arrived from the order engine.
 *
 * Distinct from unavailable on purpose: a timeout is a *recorded ambiguity* — the
 * assignment may exist — so the retry must reuse the same deterministic key
 * rather than mint a new one.
 */
export function orderEngineTimeout(traceId?: string): DispatchError {
  return new DispatchError("DISPATCH_ORDER_ENGINE_TIMEOUT", "محرّك الطلبات لم يُجب في المدة", {
    traceId,
  });
}
