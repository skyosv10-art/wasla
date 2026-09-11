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
 * trace id, or a generated uuid.
 *
 * ## Retention — no longer deferred (المراجعةُ 13/N · ADR-026 §4.15)
 *
 * Storage was the deferral declared in §4.10-3: keys accumulated forever, so a
 * table that only ever grew was the price of a guarantee that only ever
 * mattered for minutes. This file now owns the ONE number that decides how
 * long a key lives; the sweeper that enforces it lives in
 * `use-cases/sweep-expired-idempotency-keys.ts`, and the clock stays in the
 * database (`now()`), never here — two nodes with a skewed clock must not
 * disagree about whether a key is alive.
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

// ---------------------------------------------------------------------------
// حياةُ المفتاحِ (المراجعةُ 13/N · ADR-026 §4.15)
// ---------------------------------------------------------------------------

/**
 * Default key lifetime: 24 hours.
 *
 * الرقمُ ليس ذوقاً: المفتاحُ يحمي **إعادةَ محاولةٍ**، وإعادةُ المحاولةِ إمّا آليّةٌ
 * (ثوانٍ) أو بشريّةٌ (دقائقُ إلى ساعاتٍ) أو استئنافُ خطّافِ دفعٍ من مُزوِّدٍ —
 * وأطولُ سياسةِ إعادةٍ في مُزوِّدي الدفعِ تُقاسُ بالساعاتِ لا بالأيّامِ. فيومٌ
 * كاملٌ يغطّي الثلاثةَ بهامشٍ، ويُبقي الجدولَ في حجمِ يومٍ من الكتابةِ لا في
 * حجمِ عمرِ الخدمةِ. والمدّةُ **صفةُ الصفِّ** (`expires_at`) لا صفةُ الاستعلامِ:
 * تغييرُ الإعدادِ لا يُميتُ مفتاحاً وُعِدَ بيومٍ ولا يُحيي منتهياً.
 */
export const IDEMPOTENCY_KEY_TTL_SECONDS = 86_400;

/**
 * أدنى مدّةٍ مقبولةٍ: ساعةٌ.
 *
 * ولمَ حدٌّ أدنى أصلاً؟ لأنَّ `IDEMPOTENCY_KEY_TTL_SECONDS=1` إعدادٌ **يُلغي
 * الحمايةَ بلا أن يُعلِنَ إلغاءَها**: كلُّ إعادةِ محاولةٍ تصلُ بعدَ ثانيةٍ فتجدُ
 * المفتاحَ ميّتاً فتُنشئُ طلباً ثانياً — وهوَ عينُ الطلبِ المكرَّرِ الذي وُضِعَ
 * المفتاحُ لمنعِهِ، فيبدو النظامُ سليماً ويكونُ أعطبَ من نظامٍ بلا مفاتيحَ (إذ
 * يظنُّ المنادي نفسَهُ محميّاً).
 */
export const IDEMPOTENCY_KEY_TTL_FLOOR_SECONDS = 3_600;

/**
 * Resolve the lifetime from the environment.
 *
 * وهذا الحقلُ **يُوقِفُ الإقلاعَ** على قيمةٍ خاطئةٍ، خلافاً لـ`MARKETPLACE_TIMEOUT_MS`
 * الذي يُهمِلُ غيرَ المقروءِ إلى الافتراضِ (`http/server.ts`). والفرقُ مقصودٌ لا
 * تناقُضٌ: مَهَلٌ خاطئٌ يُبطئُ نداءً ويُعلِنُ عن نفسِهِ في أوّلِ رَدٍّ، أمّا مدّةٌ
 * خاطئةٌ فتفتحُ ثغرةَ تكرارٍ **صامتةً** لا يكشفُها إلّا حادثةُ طلبٍ مزدوجٍ عندَ
 * عميلٍ. وحقلُ سلامةٍ يُخفَضُ في صمتٍ أسوأُ من خدمةٍ لا تُقلِعُ.
 *
 * @throws Error عندَ قيمةٍ غيرِ عدديّةٍ أو غيرِ صحيحةٍ أو أقلَّ من الحدِّ الأدنى.
 */
export function resolveIdempotencyTtlSeconds(
  env: Readonly<Record<string, string | undefined>>,
): number {
  const raw = env.IDEMPOTENCY_KEY_TTL_SECONDS;
  if (raw === undefined || raw.trim() === "") return IDEMPOTENCY_KEY_TTL_SECONDS;

  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(
      `IDEMPOTENCY_KEY_TTL_SECONDS يجبُ أن يكونَ عدداً صحيحاً من الثواني (القيمةُ: ${raw})`,
    );
  }
  if (value < IDEMPOTENCY_KEY_TTL_FLOOR_SECONDS) {
    throw new Error(
      `IDEMPOTENCY_KEY_TTL_SECONDS=${value} أقلُّ من الحدِّ الأدنى ${IDEMPOTENCY_KEY_TTL_FLOOR_SECONDS} ثانيةً — مدّةٌ أقصرُ تُلغي حمايةَ التماثُلِ صامتةً`,
    );
  }
  return value;
}
