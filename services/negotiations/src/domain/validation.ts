/**
 * Shape validation at the domain boundary.
 *
 * Every use case takes `unknown` for caller-supplied fields and narrows here. Not
 * because the HTTP layer will not validate too (it will, in MR 4/6, against the
 * OpenAPI schemas), but because the bots call these use cases **in process** in MR
 * 5/6 — so «the schema already checked it» is only true on one of the two paths in.
 *
 * The patterns mirror the DDL's `CHECK (… ~ '…')` clauses exactly. When they
 * disagree, the database wins and the bug is here.
 *
 * Errors name the field and never echo its value: an id or a message body repeated
 * into an error string ends up in logs whose retention is longer than the
 * negotiation's.
 */

import {
  NEGOTIATION_CANCEL_REASON_CODES,
  NEGOTIATION_PARTIES,
  NEGOTIATION_SERVICE_KINDS,
} from "@wasla/contracts-negotiation";

import { localeUnsupported, validationFailed } from "./errors.js";
import {
  NEGOTIATION_LOCALES,
  type NegotiationCloseReasonCode,
  type NegotiationLocale,
  type NegotiationParty,
  type NegotiationServiceKind,
} from "./model.js";

const ORDER_PUBLIC_ID = /^ORD-[0-9]{10}$/;
const WASLA_PUBLIC_ID = /^WS-[0-9]{10}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertOrderPublicId(value: unknown, field = "order_public_id"): string {
  if (typeof value !== "string" || !ORDER_PUBLIC_ID.test(value)) {
    throw validationFailed(field, "ORD-##########");
  }
  return value;
}

export function assertWaslaPublicId(value: unknown, field: string): string {
  if (typeof value !== "string" || !WASLA_PUBLIC_ID.test(value)) {
    throw validationFailed(field, "WS-##########");
  }
  return value;
}

export function assertUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw validationFailed(field, "uuid");
  }
  return value;
}

export function assertParty(value: unknown, field = "party"): NegotiationParty {
  if (typeof value !== "string" || !NEGOTIATION_PARTIES.includes(value as NegotiationParty)) {
    throw validationFailed(field, NEGOTIATION_PARTIES.join(" | "));
  }
  return value as NegotiationParty;
}

export function assertServiceKind(value: unknown): NegotiationServiceKind {
  if (
    typeof value !== "string" ||
    !NEGOTIATION_SERVICE_KINDS.includes(value as NegotiationServiceKind)
  ) {
    throw validationFailed("service_kind", NEGOTIATION_SERVICE_KINDS.join(" | "));
  }
  return value as NegotiationServiceKind;
}

/**
 * An unsupported locale gets its **own** code, not a generic validation failure.
 *
 * A bot that sends `fr` needs to know the request was understood and the language
 * is not offered yet — which is a product answer, while a generic 400 reads as a
 * client bug and sends someone looking for a malformed field.
 */
export function assertLocale(value: unknown): NegotiationLocale {
  if (typeof value !== "string" || !NEGOTIATION_LOCALES.includes(value as NegotiationLocale)) {
    throw localeUnsupported();
  }
  return value as NegotiationLocale;
}

/**
 * A message body.
 *
 * Length is checked against the **policy**, not against a constant, so the limit
 * that refuses a message is the same number the bot showed while it was being
 * typed. Emptiness after trimming is a validation failure and not an empty
 * message: an empty bubble in a chat is a bug the user cannot report.
 */
export function assertMessageBody(value: unknown, maxLength: number): string {
  if (typeof value !== "string") throw validationFailed("body", "string");
  const trimmed = value.trim();
  if (trimmed.length === 0) throw validationFailed("body", "non-empty");
  // The caller raises NEGOTIATION_MESSAGE_TOO_LONG for the over-length case, which
  // is a distinct code with the policy limit in its details; this guard only exists
  // so an implementation that forgets to check cannot store an over-long row.
  if (trimmed.length > maxLength) throw validationFailed("body", `<= ${maxLength}`);
  return trimmed;
}

/**
 * A cancellation reason.
 *
 * Exactly two are accepted: `cancelled_by_dispatch` and `order_withdrawn`. A party
 * walking away is a **rejection** with `close_thread: true`, and it has its own
 * route — because «the driver said no» and «the order disappeared» are different
 * facts, and collapsing them makes the funnel unreadable in a month.
 */
export function assertCancelReasonCode(value: unknown): NegotiationCloseReasonCode {
  if (
    typeof value !== "string" ||
    !NEGOTIATION_CANCEL_REASON_CODES.includes(value as (typeof NEGOTIATION_CANCEL_REASON_CODES)[number])
  ) {
    throw validationFailed("reason_code", NEGOTIATION_CANCEL_REASON_CODES.join(" | "));
  }
  return value as NegotiationCloseReasonCode;
}

/** `expected_round_no` — the optimistic guard's input. Zero is legal: «I saw none». */
export function assertExpectedRoundNo(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw validationFailed("expected_round_no", "integer >= 0");
  }
  return value;
}

export function assertRoundNo(value: unknown, field = "round_no"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw validationFailed(field, "integer >= 1");
  }
  return value;
}

/**
 * An idempotency key.
 *
 * Bounds mirror `ck` on `negotiation_idempotency.idempotency_key` (8..128). The
 * lower bound is not decoration: a two-character key is a key that collides
 * between two unrelated callers, and the collision surfaces as one caller's write
 * silently answering another's.
 */
export function assertIdempotencyKey(value: unknown): string {
  if (typeof value !== "string") throw validationFailed("idempotencyKey", "string");
  if (value.length < 8 || value.length > 128) {
    throw validationFailed("idempotencyKey", "8..128 characters");
  }
  return value;
}

/** An optional note attached to a proposal or a decision. `null` when absent. */
export function assertOptionalNote(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  return assertMessageBody(value, maxLength);
}

/**
 * A required boolean flag.
 *
 * Strict: `"true"`, `1` and `undefined` are refused rather than coerced. `close_thread`
 * is the flag that decides whether a negotiation ends, and a coercing parser reads a
 * missing field as `false` — which would silently turn «I am done» into «I will
 * counter» for every client that forgot to send it.
 */
export function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw validationFailed(field, "boolean");
  return value;
}
