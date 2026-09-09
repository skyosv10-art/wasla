/**
 * Delivery service error contract.
 *
 * The catalog itself is NOT redefined here: the stable codes, their classes
 * and the HTTP status derived from each class live in @wasla/contracts-delivery,
 * which is drift-guarded against services/delivery/contracts/errors.md. This
 * file only wraps them in a throwable typed error, so a use case raises a
 * contract code and the (future, deferred — ADR-026 §4.2) HTTP layer maps it
 * without re-classifying.
 *
 * Tests assert `code` — never the Arabic message copy.
 */

import {
  DELIVERY_ERROR_CODE_CLASS,
  httpStatusForDeliveryError,
  type DeliveryErrorClass,
  type DeliveryErrorCode,
} from "@wasla/contracts-delivery";

export type { DeliveryErrorCode, DeliveryErrorClass };

/**
 * Structured, machine-readable detail carried alongside the code.
 *
 * Kept as named optional fields rather than a free `Record<string, unknown>`:
 * the transition error must always be able to answer "from where, to where?",
 * and a loose bag makes that a convention instead of a type.
 */
export interface DeliveryErrorDetails {
  readonly from?: string;
  readonly to?: string;
  readonly field?: string;
  readonly expected?: string;
  readonly actual?: string;
}

/** A domain error carrying a stable contract code. */
export class DeliveryError extends Error {
  readonly code: DeliveryErrorCode;
  readonly class: DeliveryErrorClass;
  readonly httpStatus: number;
  readonly traceId?: string;
  readonly details: DeliveryErrorDetails;

  constructor(
    code: DeliveryErrorCode,
    message: string,
    options: { traceId?: string; details?: DeliveryErrorDetails } = {},
  ) {
    super(message);
    this.name = "DeliveryError";
    this.code = code;
    this.class = DELIVERY_ERROR_CODE_CLASS[code];
    this.httpStatus = httpStatusForDeliveryError(code);
    this.traceId = options.traceId;
    this.details = options.details ?? {};
  }
}

/** Narrowing helper for callers that catch broadly. */
export function isDeliveryError(value: unknown): value is DeliveryError {
  return value instanceof DeliveryError;
}

/**
 * The rejection of a transition that is not in the published table.
 *
 * A dedicated constructor because this is the error the whole phase exists to
 * produce: it must always carry `from` and `to` so the caller learns which
 * pair was refused, not merely that something was refused.
 */
export function illegalTransition(
  from: string,
  to: string,
  traceId?: string,
): DeliveryError {
  return new DeliveryError(
    "DELIVERY_TRANSITION_NOT_ALLOWED",
    `الانتقال من ${from} إلى ${to} غير مذكور في جداول ADR-026 §3`,
    { traceId, details: { from, to } },
  );
}

/** The composite payment gate (§2.2): confirmed needs an authorized mirror. */
export function paymentNotAuthorized(
  actual: string,
  traceId?: string,
): DeliveryError {
  return new DeliveryError(
    "DELIVERY_PAYMENT_NOT_AUTHORIZED",
    `لا تأكيدَ لطلبٍ ومرآةُ الدفعِ في ${actual} — البوّابةُ تطلبُ authorized`,
    { traceId, details: { expected: "authorized", actual } },
  );
}

/** The proof gate (§2.4): delivered needs proof, proof needs delivered. */
export function invalidProof(detail: string, traceId?: string): DeliveryError {
  return new DeliveryError("DELIVERY_INVALID_PROOF", detail, { traceId });
}

/** The substitution window (§2.5): line substitution is picking-only. */
export function substitutionNotAllowed(
  state: string,
  traceId?: string,
): DeliveryError {
  return new DeliveryError(
    "DELIVERY_SUBSTITUTION_NOT_ALLOWED",
    `الاستبدالُ قرارُ صنفٍ أثناءَ الانتقاءِ فقط — الحالةُ الحاليّةُ ${state}`,
    { traceId, details: { actual: state, expected: "picking" } },
  );
}
