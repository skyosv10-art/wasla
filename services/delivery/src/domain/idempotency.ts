/**
 * Idempotency for the delivery write boundary (ADR-026 §4.9-3 — the declared
 * debt this review pays).
 *
 * ## Why a key at all
 *
 * `POST /store-orders` mints a real order, a real task and two real outbox
 * events. Without a key, a client that times out has exactly two bad choices:
 * retry and risk a second order, or give up and risk a lost one. Review 6/N
 * chose `500 DELIVERY_INTERNAL_ERROR` over `503` precisely BECAUSE no key
 * existed — a retry hint on a non-idempotent command is a duplicate-order
 * generator (contracts/errors.md rule 4). With the key, "retry the same
 * request with the same key" becomes a safe instruction, so the debt and the
 * status choice had to be revisited together, not one without the other.
 *
 * ## Why the fingerprint, not just the key
 *
 * A key alone answers "have I seen this key?" — which lets a buggy client
 * reuse one key for two DIFFERENT orders and receive the first order's
 * response for the second request. That is a silent lost order, the worst
 * failure class in this service. So the key is stored WITH a fingerprint of
 * the request it was first used for, and a mismatch is refused loudly
 * (`DELIVERY_IDEMPOTENCY_KEY_REUSED`, 409) instead of being replayed.
 *
 * ## Why the fingerprint is canonical JSON, not `JSON.stringify`
 *
 * `JSON.stringify` preserves key insertion order, so `{a,b}` and `{b,a}` —
 * the same request through two clients — would fingerprint differently and
 * the honest retry would be refused as a reuse. `canonicalJson` sorts object
 * keys at every depth and keeps array order (array order is meaningful: it is
 * the order line numbering). It also refuses `undefined` and non-finite
 * numbers rather than silently dropping them, because a dropped field is a
 * fingerprint that ignores part of the request.
 *
 * ## What is NOT in scope here
 *
 * Nothing in this file touches a database or a clock: the fingerprint must be
 * reproducible by a retry hours later, so it cannot include a timestamp, a
 * trace id, or a generated uuid. Retention/sweeping of stored keys is a
 * declared deferral (ADR-026 §4.10-3), not a hidden one.
 */

import { createHash } from "node:crypto";

import { DeliveryError } from "./errors.js";

/**
 * The four routes that carry a key — every write path. Reads need no key
 * (repeating a read is free), so the type refuses one by construction rather
 * than trusting a caller not to pass `GET`.
 *
 * المراجعةُ 9/N أضافَت مرآةَ الدفعِ والتأكيدَ، وهما أحقُّ المساراتِ بالمفتاحِ: مُزوِّدُ
 * الدفعِ يُعيدُ إرسالَ خطّافِهِ (webhook) عندَ أوّلِ مِهلةٍ، وتخويلٌ مرَّتَينِ في الدفترِ
 * يجعلُ كلَّ من يحسبُ التخويلاتِ يحسبُ خطأً.
 */
export const IDEMPOTENT_ROUTES = [
  "POST /store-orders",
  "POST /store-orders/{orderPublicId}/cancellation",
  "PUT /store-orders/{orderPublicId}/payment-mirror",
  "POST /store-orders/{orderPublicId}/confirmation",
  "POST /store-orders/{orderPublicId}/fulfillment-transition",
] as const;
export type IdempotentRoute = (typeof IDEMPOTENT_ROUTES)[number];

/**
 * Key shape: 16..128 chars of URL/header-safe text.
 *
 * The lower bound is deliberate — an 8-char key from a weak generator
 * collides across clients, and a collision here is one client receiving
 * another client's order. A uuid v4 (36 chars) satisfies it; so does any ULID.
 */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;

/** Validate the header value. Throws `DELIVERY_VALIDATION_FAILED` (400). */
export function assertIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new DeliveryError(
      "DELIVERY_VALIDATION_FAILED",
      "ترويسةُ Idempotency-Key مطلوبةٌ بطولِ 16..128 من [A-Za-z0-9._:-]",
      {
        details: {
          field: "Idempotency-Key",
          actual: typeof value === "string" ? String(value.length) : typeof value,
        },
      },
    );
  }
  return value;
}

/**
 * Deterministic JSON: object keys sorted at every depth, array order kept.
 * Throws on values JSON cannot round-trip faithfully.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new DeliveryError("DELIVERY_VALIDATION_FAILED", "عددٌ غيرُ منتهٍ لا يُبصَّمُ", {
        details: { field: "fingerprint", actual: String(value) },
      });
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      // `undefined` in an object is JSON's silent drop — refuse instead.
      .filter(([, entryValue]) => {
        if (entryValue === undefined) {
          throw new DeliveryError("DELIVERY_VALIDATION_FAILED", "حقلٌ undefined لا يُبصَّمُ", {
            details: { field: "fingerprint" },
          });
        }
        return true;
      })
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  throw new DeliveryError("DELIVERY_VALIDATION_FAILED", "نوعٌ لا يُبصَّمُ في JSON", {
    details: { field: "fingerprint", actual: typeof value },
  });
}

/**
 * sha256 over `route | target | canonical(payload)`.
 *
 * `target` (the order's public id for cancellation, `null` for placement) is
 * part of the fingerprint on purpose: the same key sent to two different
 * orders with the same body (`{reason_code: "..."}`) MUST be a reuse, not a
 * replay. Without the target in the hash, cancelling order A and then order B
 * with one key would answer A's response and leave B running.
 */
export function deriveRequestFingerprint(
  route: IdempotentRoute,
  target: string | null,
  payload: unknown,
): string {
  return createHash("sha256")
    .update(`${route}\u0000${target ?? ""}\u0000${canonicalJson(payload)}`)
    .digest("hex");
}
