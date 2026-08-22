/**
 * Negotiation & Chat error contract.
 *
 * The catalogue is NOT redefined here: the 29 stable codes, their classes and the
 * HTTP status derived from each class live in `@wasla/contracts-negotiation`,
 * drift-guarded against `services/negotiations/contracts/errors.md`. This file
 * only wraps them in a throwable typed error, so a use case raises a contract code
 * and the HTTP layer (MR 4/6) maps it without re-classifying.
 *
 * Tests assert `code`, never the Arabic message copy.
 *
 * ## The rule this file exists to protect
 *
 * **There is no error for a failed price hand-off.** Not `502`, not
 * `bad_gateway`, not a factory below. When the order engine cannot be reached, the
 * accept still answers with its agreement, the failure is recorded in
 * `negotiation_price_handoffs`, and `handoffState` carries it (ADR-013 decision 2 ·
 * precedent: the retired `DRIVER_CANDIDACY_PUBLISH_FAILED` in Phase 05 · MR 5/6).
 * A failure code on a successful accept teaches both parties they did not agree
 * when they did — and one of them is a driver already on his way.
 *
 * Likewise **a rejection is not an error**. A driver refusing a price is the
 * system working; `NEGOTIATION_ROUND_NOT_PENDING` is for acting on a round that
 * has already been settled, never for the settlement itself.
 *
 * ## Privacy (errors.md §«ما لا يُعاد في أي خطأ»)
 *
 * No message, and no `details` field here, may carry a message body, a name, a
 * phone, or a coordinate. `field` names the field; it never echoes the value. The
 * amount is the one exception and it is deliberate: `NEGOTIATION_AMOUNT_OUT_OF_
 * BOUNDS` reports the **policy's** bounds, not the caller's number, so a bot can
 * say «between 5 and 5000 riyals» without repeating what the user typed.
 */

import {
  NEGOTIATION_ERROR_CODE_CLASS,
  httpStatusForNegotiationError,
  type NegotiationErrorClass,
  type NegotiationErrorCode,
} from "@wasla/contracts-negotiation";

export type { NegotiationErrorClass, NegotiationErrorCode };

/**
 * Structured, machine-readable detail carried alongside the code.
 *
 * Named optional fields rather than a free bag, precisely so that «just put the
 * value in the details» is not reachable by accident. The set mirrors
 * `ErrorResponse.error.details` in the OpenAPI contract, which declares
 * `additionalProperties: false` — so an unlisted key would fail a strict
 * consumer's validation on an otherwise correct response (the lesson of
 * Phase 05 · MR 4/6).
 */
export interface NegotiationErrorDetails {
  readonly field?: string;
  readonly expected?: string;
  readonly constraint?: string;
  readonly policyVersion?: number;
  readonly threadState?: string;
  readonly roundState?: string;
  readonly expectedRoundNo?: number;
  readonly currentRoundNo?: number;
  readonly minAmountMinor?: number;
  readonly maxAmountMinor?: number;
  readonly maxRounds?: number;
  readonly currency?: string;
}

/** A domain error carrying a stable contract code. */
export class NegotiationError extends Error {
  readonly code: NegotiationErrorCode;
  readonly class: NegotiationErrorClass;
  readonly httpStatus: number;
  readonly traceId?: string;
  readonly details: NegotiationErrorDetails;

  constructor(
    code: NegotiationErrorCode,
    message: string,
    options: { traceId?: string; details?: NegotiationErrorDetails } = {},
  ) {
    super(message);
    this.name = "NegotiationError";
    this.code = code;
    this.class = NEGOTIATION_ERROR_CODE_CLASS[code];
    this.httpStatus = httpStatusForNegotiationError(code);
    this.traceId = options.traceId;
    this.details = options.details ?? {};
  }
}

export function isNegotiationError(value: unknown): value is NegotiationError {
  return value instanceof NegotiationError;
}

// ---------------------------------------------------------------------------
// 400 — the caller's request cannot be read
// ---------------------------------------------------------------------------

/** A shape rejection that names the field and never repeats its value. */
export function validationFailed(field: string, expected: string): NegotiationError {
  return new NegotiationError("NEGOTIATION_VALIDATION_FAILED", `حقل غير صالح: ${field}`, {
    details: { field, expected },
  });
}

export function idempotencyKeyRequired(): NegotiationError {
  return new NegotiationError(
    "NEGOTIATION_IDEMPOTENCY_KEY_REQUIRED",
    "مفتاح المعالجة الواحدة مطلوب لهذه الكتابة",
    { details: { field: "idempotencyKey" } },
  );
}

/**
 * A thread listing with no filter.
 *
 * Refused rather than answered with everything: an unfiltered list of every
 * negotiation on the platform is both a scan and a disclosure, and «I forgot the
 * filter» must not be the query that returns the most data.
 */
export function filterRequired(): NegotiationError {
  return new NegotiationError(
    "NEGOTIATION_FILTER_REQUIRED",
    "قائمة الخيوط تحتاج مُرشِّحاً: طلباً أو سائقاً",
    { details: { field: "order_public_id" } },
  );
}

export function localeUnsupported(): NegotiationError {
  return new NegotiationError("NEGOTIATION_LOCALE_UNSUPPORTED", "لغة غير مدعومة", {
    details: { field: "sourceLocale", expected: "ar | en | ur" },
  });
}

/**
 * A body longer than the policy allows.
 *
 * Its own code rather than a generic validation failure, because the client can
 * fix it precisely — and because `maxMessageLength` is policy data, so the limit
 * that refused the message is the limit the bot should have shown.
 */
export function messageTooLong(maxMessageLength: number): NegotiationError {
  return new NegotiationError("NEGOTIATION_MESSAGE_TOO_LONG", "نصّ الرسالة أطول من الحدّ المسموح", {
    details: { field: "body", expected: `<= ${maxMessageLength}` },
  });
}

// ---------------------------------------------------------------------------
// 404 — nothing with that identity
// ---------------------------------------------------------------------------

export function threadNotFound(): NegotiationError {
  return new NegotiationError("NEGOTIATION_THREAD_NOT_FOUND", "لا يوجد خيط تفاوض بهذا المعرّف");
}

export function roundNotFound(): NegotiationError {
  return new NegotiationError("NEGOTIATION_ROUND_NOT_FOUND", "لا يوجد دور بهذا الرقم في هذا الخيط");
}

/**
 * A thread that was never agreed has no agreement to read.
 *
 * `404` and not an empty `200`: a bot that reads an empty body as «no price yet»
 * behaves identically whether the thread is still open or was declined an hour
 * ago, and those two need different words to the user.
 */
export function agreementNotFound(): NegotiationError {
  return new NegotiationError("NEGOTIATION_AGREEMENT_NOT_FOUND", "لا يوجد اتفاق على هذا الخيط");
}

// ---------------------------------------------------------------------------
// 409 — the request contradicts a state that already exists
// ---------------------------------------------------------------------------

export function idempotencyKeyReused(): NegotiationError {
  return new NegotiationError(
    "NEGOTIATION_IDEMPOTENCY_KEY_REUSED",
    "مفتاح المعالجة الواحدة مستخدم بحمولة مختلفة",
    { details: { field: "idempotencyKey" } },
  );
}

/**
 * A second thread for one (order, driver).
 *
 * A conflict and not an idempotent success: re-offering the same order to the same
 * driver **continues** his thread, and answering «created» would produce two
 * places that each believe they hold «what we agreed on».
 */
export function threadAlreadyExists(
  constraint: "ux_negotiation_threads_order_driver" | "ux_negotiation_threads_dispatch_offer" =
    "ux_negotiation_threads_order_driver",
): NegotiationError {
  // The constraint is a parameter because two different indexes produce this same
  // conflict, and «which one» is the whole diagnosis: `…_order_driver` means this pair is
  // already negotiating, `…_dispatch_offer` means the offer was already taken — usually by
  // a retry that raced. One shared name would send the reader to the wrong table.
  return new NegotiationError(
    "NEGOTIATION_THREAD_ALREADY_EXISTS",
    "يوجد خيط تفاوض لهذا الطلب مع هذا السائق",
    { details: { constraint } },
  );
}

/** Acting on a thread that has ended, for any reason other than agreement. */
export function threadClosed(state: string, reasonCode: string | null): NegotiationError {
  return new NegotiationError("NEGOTIATION_THREAD_CLOSED", "الخيط مُغلق: لا تُقبل هذه العملية", {
    details: {
      threadState: state,
      expected: "open",
      ...(reasonCode === null ? {} : { field: "close_reason_code" }),
    },
  });
}

/** Accepting or rejecting a round that has already been settled. */
export function roundNotPending(state: string): NegotiationError {
  return new NegotiationError("NEGOTIATION_ROUND_NOT_PENDING", "هذا الدور غير معلّق", {
    details: { roundState: state, expected: "pending" },
  });
}

/**
 * The optimistic guard: the caller acted on a screen that has since changed.
 *
 * Refused rather than applied, because a counter-offer built on a stale amount is
 * an answer to a question nobody asked any more — and if it were applied, the
 * party would have bid against a number he never saw.
 */
export function roundStale(expectedRoundNo: number, currentRoundNo: number): NegotiationError {
  return new NegotiationError(
    "NEGOTIATION_ROUND_STALE",
    "تغيّر التفاوض بعد آخر ما رأيتَه: أعِد القراءة ثمّ اقترح",
    { details: { expectedRoundNo, currentRoundNo, field: "expected_round_no" } },
  );
}

/**
 * Turn-taking: the same party proposing twice in a row.
 *
 * Mandatory rather than tolerated (ADR-013 decision 3). Without it a party can
 * walk his own price down alone, filling the round budget with a monologue while
 * the counterparty's single reply arrives after `max_rounds` is spent.
 */
export function turnViolation(waitingFor: string): NegotiationError {
  return new NegotiationError("NEGOTIATION_TURN_VIOLATION", "الدور على الطرف الآخر", {
    details: { expected: waitingFor, constraint: "ux_negotiation_rounds_one_pending" },
  });
}

/** A second agreement on one thread. */
export function alreadyAgreed(
  constraint: "ux_negotiation_rounds_one_accepted" | "ux_negotiation_agreements_order_driver" =
    "ux_negotiation_rounds_one_accepted",
): NegotiationError {
  // Same reasoning as `threadAlreadyExists`: the rounds index means «this thread already
  // has an accepted round», the agreements index means «this order and driver already
  // agreed, on another thread». Different tables, different fix.
  return new NegotiationError("NEGOTIATION_ALREADY_AGREED", "تمّ الاتفاق على هذا الخيط مسبقاً", {
    details: { constraint },
  });
}

// ---------------------------------------------------------------------------
// 422 — readable, addressed to the right thread, and still refused
// ---------------------------------------------------------------------------

/**
 * An amount outside the frozen policy's bounds.
 *
 * The bounds are returned and the caller's number is not: the client needs to know
 * what is allowed, and repeating what the user typed into an error string puts it
 * in logs with a wider retention than the negotiation itself.
 */
export function amountOutOfBounds(
  minAmountMinor: number,
  maxAmountMinor: number,
): NegotiationError {
  return new NegotiationError(
    "NEGOTIATION_AMOUNT_OUT_OF_BOUNDS",
    "المبلغ خارج حدود سياسة التفاوض",
    {
      details: {
        field: "amount_minor",
        minAmountMinor,
        maxAmountMinor,
        constraint: "ck_negotiation_policies_amount_bounds",
      },
    },
  );
}

/**
 * A counter-offer in a currency other than the thread's.
 *
 * Refused and never converted: this service has no rate, and a negotiation that
 * silently converts is a negotiation where the two parties agreed to different
 * numbers.
 */
export function currencyMismatch(currency: string): NegotiationError {
  return new NegotiationError(
    "NEGOTIATION_CURRENCY_MISMATCH",
    "عملة المبلغ تخالف عملة الخيط",
    { details: { field: "currency", expected: currency } },
  );
}

/** A currency the frozen policy does not price in. */
export function currencyUnknown(expected: string): NegotiationError {
  return new NegotiationError("NEGOTIATION_CURRENCY_UNKNOWN", "عملة غير معروفة لهذه السياسة", {
    details: { field: "currency", expected },
  });
}

/**
 * The round budget is spent.
 *
 * `422` and not `409`: the thread is still readable and still the right thread —
 * what is exhausted is the policy's allowance, which is a rule about the request,
 * not a race with another writer.
 */
export function maxRoundsReached(maxRounds: number): NegotiationError {
  return new NegotiationError("NEGOTIATION_MAX_ROUNDS_REACHED", "استُنفد سقف أدوار التفاوض", {
    details: { maxRounds, constraint: "ck_negotiation_threads_round_counters" },
  });
}

/**
 * The round's deadline passed before the action arrived.
 *
 * Raised at ACTION time, not only by the tick (ADR-013 decision 5). Relying on the
 * tick alone leaves a window in which an expired price can still be accepted, and
 * that is a window on money, not on a screen.
 */
export function roundExpired(): NegotiationError {
  return new NegotiationError("NEGOTIATION_ROUND_EXPIRED", "انتهت مهلة هذا الدور", {
    details: { roundState: "expired", field: "expires_at" },
  });
}

/** The thread's own deadline passed before the action arrived. */
export function threadExpired(): NegotiationError {
  return new NegotiationError("NEGOTIATION_THREAD_EXPIRED", "انتهت مهلة هذا الخيط", {
    details: { threadState: "expired", field: "expires_at" },
  });
}

/**
 * Accepting one's own proposal.
 *
 * The database refuses the same write through
 * `ck_negotiation_rounds_no_self_resolution`; this is the first line of defence
 * and the constraint is named so a reader can find the second (ADR-013 decision 3).
 * When the two disagree, the database wins and the bug is here.
 */
export function selfAcceptForbidden(): NegotiationError {
  return new NegotiationError(
    "NEGOTIATION_SELF_ACCEPT_FORBIDDEN",
    "من اقترح لا يقبل: القبول الذاتي إعلانٌ لا اتفاق",
    { details: { constraint: "ck_negotiation_rounds_no_self_resolution" } },
  );
}

/**
 * A party acting on a thread that is not his.
 *
 * `422` rather than `404`: the thread exists and the caller named it correctly, so
 * pretending it is absent would send an honest client hunting for a routing bug.
 * Note this is a **domain** check on the ids in the thread — it is not
 * authentication, which arrives with the gateway in a later phase and is named as
 * a gap in the service README rather than implied to be covered here.
 */
export function partyMismatch(field: string): NegotiationError {
  return new NegotiationError(
    "NEGOTIATION_PARTY_MISMATCH",
    "هذا الطرف ليس طرفاً في هذا الخيط",
    { details: { field } },
  );
}

/** The thread's message allowance is spent. */
export function messageLimitReached(maxMessagesPerThread: number): NegotiationError {
  return new NegotiationError(
    "NEGOTIATION_MESSAGE_LIMIT_REACHED",
    "بلغ الخيط حدّ عدد الرسائل",
    { details: { expected: `<= ${maxMessagesPerThread}`, field: "sequence_no" } },
  );
}

export function policyNotFound(policyVersion: number): NegotiationError {
  return new NegotiationError("NEGOTIATION_POLICY_NOT_FOUND", "نسخة سياسة التفاوض غير معروفة", {
    details: { policyVersion },
  });
}

/**
 * A policy version that can still be edited.
 *
 * Refused rather than used: a thread computed against an unfrozen row carries a
 * `policy_version` that no longer describes the rules that were applied, so the
 * audit trail lies while looking complete — worse than having none.
 */
export function policyNotFrozen(policyVersion: number): NegotiationError {
  return new NegotiationError(
    "NEGOTIATION_POLICY_NOT_FROZEN",
    "لا يُفتَح خيط بنسخة سياسة غير مُجمَّدة",
    { details: { policyVersion, constraint: "is_frozen" } },
  );
}

/**
 * The order does not accept a negotiated price.
 *
 * The order engine's `price_mode` is the authority, read through a port. Opening a
 * thread on a fixed-price order would produce an agreement nobody can apply, and
 * the two parties would only find out after they had settled.
 */
export function orderNotNegotiable(): NegotiationError {
  return new NegotiationError(
    "NEGOTIATION_ORDER_NOT_NEGOTIABLE",
    "هذا الطلب لا يقبل سعراً بالتفاوض",
    { details: { field: "order_public_id", expected: "price_mode=negotiable" } },
  );
}

/**
 * The dispatch offer is not live.
 *
 * A thread is only ever opened on a standing offer (ADR-013 decision 1). Without
 * this check a negotiation could outlive the offer that justified it, and the
 * driver would be bargaining for a job already given to someone else.
 */
export function offerNotActive(): NegotiationError {
  return new NegotiationError("NEGOTIATION_OFFER_NOT_ACTIVE", "عرض التوزيع غير قائم", {
    details: { field: "dispatch_offer_id" },
  });
}

// ---------------------------------------------------------------------------
// 503 — we could not answer, and retrying is the correct instruction
// ---------------------------------------------------------------------------

/**
 * A mandatory port answered with nothing we can act on — the offer catalogue, the
 * outbox, the store.
 *
 * `503` and not `502`: the caller's request never took effect, so retrying is
 * right, and `503` is the code that says so. This factory exists so the failure is
 * raised BY NAME at the point that discovered it, instead of reaching the HTTP
 * layer as an unrecognised throw that the catch-all classifies by guessing.
 *
 * Note what is **not** here: a code for a failed price hand-off. See this file's
 * header, and `contracts/errors.md` §القاعدة البند 3.
 */
export function negotiationUnavailable(message: string): NegotiationError {
  return new NegotiationError("NEGOTIATION_UNAVAILABLE", message);
}
