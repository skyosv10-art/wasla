/**
 * @wasla/contracts-delivery
 *
 * Typed Store Orders & Delivery contracts (Phase 13):
 *  - API types hand-derived from the OpenAPI source of truth.
 *  - Event types hand-derived from the JSON Schema Event Contract.
 *  - The stable error-code catalog (drift-guarded against errors.md).
 *  - Lifecycle state constants so the domain state machine can prove its
 *    table against the full state × state space.
 *
 * These are Contract First artifacts (ADR-004) — NOT a runtime
 * implementation. The domain core lands in services/delivery; HTTP and
 * persistence are deferred to later reviews (ADR-026 §4).
 *
 * Boundary reminders (ADR-026):
 *  - This service owns the STORE ORDER aggregate (§2.1), never the
 *    transport order (services/orders, ADR-010).
 *  - `payment_state` mirrors an external intent — no money processing
 *    here (§2.2); billing is M5-17.
 *  - No inventory balances here: item snapshots only; live quantities are
 *    read through the agreed marketplace port (§2.3).
 *  - `delivery_task` is a coarse mirror of dispatch results (§2.4) — no
 *    offer/wave logic is rebuilt here.
 */

export type * from "./api-types.js";
export type * from "./events-types.js";
export { DELIVERY_EVENT_TYPES } from "./events-types.js";
// المراجعةُ 6/N: حدُّ HTTP يحتاجُ الكتالوجَ المغلقَ قيمةً لا نوعاً فقط؛
// دونَهُ كانَ المحلِّلُ سيُعيدُ سردَ الأسبابِ في ملفِّهِ — وثاني سردٍ ينحرفُ.
export { STORE_ORDER_CANCEL_REASON_CODES } from "./events-types.js";

import type { components } from "./api-types.js";

/** All API paths and their operations. */
export type { paths } from "./api-types.js";

// --- API contract types (from OpenAPI) --------------------------------

/** Opaque external reference — WS-##########, never personal data (§2.6). */
export type WaslaPublicId = components["schemas"]["WaslaPublicId"];

// --- Lifecycle state constants ----------------------------------------

/** Every fulfillment state, in ADR-026 §3.1 order. */
export const FULFILLMENT_STATES = [
  "draft",
  "placed",
  "confirmed",
  "picking",
  "picked",
  "ready_for_delivery",
  "handed_to_courier",
  "delivered",
  "cancelled",
  "rejected",
  "failed",
] as const;
export type FulfillmentState = (typeof FULFILLMENT_STATES)[number];

/** States an order never leaves (ADR-026 §3.1). */
export const FULFILLMENT_TERMINAL_STATES = [
  "delivered",
  "cancelled",
  "rejected",
  "failed",
] as const;
export type FulfillmentTerminalState = (typeof FULFILLMENT_TERMINAL_STATES)[number];

/** A brand-new order starts here. */
export const FULFILLMENT_INITIAL_STATE: FulfillmentState = "draft";

/** Every payment state, in ADR-026 §3.2 order. */
export const PAYMENT_STATES = [
  "pending",
  "authorized",
  "captured",
  "failed",
  "refunding",
  "partially_refunded",
  "refunded",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/** Mirror states an external intent never leaves (ADR-026 §3.2). */
export const PAYMENT_TERMINAL_STATES = ["failed", "refunded"] as const;
export type PaymentTerminalState = (typeof PAYMENT_TERMINAL_STATES)[number];

/** A new order's payment mirror starts here. */
export const PAYMENT_INITIAL_STATE: PaymentState = "pending";

/** Every delivery-task state, in ADR-026 §3.3 order. */
export const DELIVERY_TASK_STATES = [
  "pending_eligibility",
  "eligible",
  "dispatch_requested",
  "driver_assigned",
  "timed_out",
  "reassigned",
  "exhausted",
  "picked_up",
  "in_transit",
  "arrived",
  "delivered",
  "ineligible",
  "failed",
  "cancelled",
] as const;
export type DeliveryTaskState = (typeof DELIVERY_TASK_STATES)[number];

/** Task states nothing leaves (ADR-026 §3.3). */
export const DELIVERY_TASK_TERMINAL_STATES = [
  "delivered",
  "failed",
  "cancelled",
  "ineligible",
  "exhausted",
] as const;
export type DeliveryTaskTerminalState = (typeof DELIVERY_TASK_TERMINAL_STATES)[number];

/** A task always starts here. */
export const DELIVERY_TASK_INITIAL_STATE: DeliveryTaskState = "pending_eligibility";

// --- Stable error-code catalog (drift-guarded against errors.md) ------

export const DELIVERY_ERROR_CODES = [
  "DELIVERY_VALIDATION_FAILED",
  "DELIVERY_ORDER_NOT_FOUND",
  "DELIVERY_TASK_NOT_FOUND",
  "DELIVERY_TRANSITION_NOT_ALLOWED",
  "DELIVERY_CANCEL_NOT_ALLOWED",
  "DELIVERY_PAYMENT_NOT_AUTHORIZED",
  "DELIVERY_INVALID_PROOF",
  "DELIVERY_SUBSTITUTION_NOT_ALLOWED",
  "DELIVERY_SUBSTITUTION_WRONG_STORE",
  "DELIVERY_INELIGIBLE",
  "DELIVERY_MARKETPLACE_UNAVAILABLE",
  "DELIVERY_DISPATCH_UNAVAILABLE",
  "DELIVERY_CONCURRENT_UPDATE",
  // المراجعةُ 6/N: الحدُّ الأخيرُ لطبقةِ HTTP — خطأٌ غيرُ مُصنَّفٍ لا يجوزُ أن
  // يخرجَ بجسمٍ خارجَ `ErrorResponse` ولا أن يستعيرَ كوداً يعني شيئاً آخرَ
  // («تعذَّرَ السوقُ» ليس اسماً لعيبٍ في الشيفرةِ). ولا يُصنَّفُ 503:
  // `POST /store-orders` بلا مفتاحِ تماثُلٍ في هذا العقدِ، فدعوةُ العميلِ
  // إلى الإعادةِ قد تُنشئُ طلبَينِ — 500 يقولُ «لا تُعِد» بصدقٍ.
  "DELIVERY_INTERNAL_ERROR",
  // المراجعةُ 7/N: مفتاحُ التماثُلِ على المسارَينِ الكاتبَينِ (ADR-026 §4.10).
  // مفتاحٌ نفسُهُ بطلبٍ مختلفٍ ⇒ رفضٌ صريحٌ لا إعادةُ جوابِ الطلبِ الأولِ:
  // إعادةُ جوابٍ لطلبٍ آخرَ طلبٌ ضائعٌ بصمتٍ — أسوأُ صنفِ فشلٍ هنا.
  "DELIVERY_IDEMPOTENCY_KEY_REUSED",
  // مفتاحٌ نفسُهُ يُعالَجُ الآنَ في معاملةٍ أخرى ⇒ لا كتابةَ ثانيةً، والإعادةُ
  // بعدَ لحظةٍ تُعيدُ جوابَ الأولِ (replay) لا طلباً ثانياً.
  "DELIVERY_IDEMPOTENT_REQUEST_IN_FLIGHT",
  // مسبارُ الجاهزيّةِ سألَ القاعدةَ فلم تُجِب — 503 صريحٌ لا `ok` كاذبٌ
  // (درسُ RISK-0030 في البحثِ · §4.10-2).
  "DELIVERY_DATABASE_UNAVAILABLE",
] as const;
export type DeliveryErrorCode = (typeof DELIVERY_ERROR_CODES)[number];

export const DELIVERY_ERROR_CLASS_STATUS = {
  validation: 400,
  not_found: 404,
  conflict: 409,
  dependency_unavailable: 503,
  internal: 500,
} as const;
export type DeliveryErrorClass = keyof typeof DELIVERY_ERROR_CLASS_STATUS;

export const DELIVERY_ERROR_CODE_CLASS: Record<DeliveryErrorCode, DeliveryErrorClass> = {
  DELIVERY_VALIDATION_FAILED: "validation",
  DELIVERY_ORDER_NOT_FOUND: "not_found",
  DELIVERY_TASK_NOT_FOUND: "not_found",
  DELIVERY_TRANSITION_NOT_ALLOWED: "conflict",
  DELIVERY_CANCEL_NOT_ALLOWED: "conflict",
  DELIVERY_PAYMENT_NOT_AUTHORIZED: "conflict",
  DELIVERY_INVALID_PROOF: "conflict",
  DELIVERY_SUBSTITUTION_NOT_ALLOWED: "conflict",
  DELIVERY_SUBSTITUTION_WRONG_STORE: "conflict",
  DELIVERY_INELIGIBLE: "conflict",
  DELIVERY_MARKETPLACE_UNAVAILABLE: "dependency_unavailable",
  DELIVERY_DISPATCH_UNAVAILABLE: "dependency_unavailable",
  DELIVERY_CONCURRENT_UPDATE: "conflict",
  DELIVERY_INTERNAL_ERROR: "internal",
  DELIVERY_IDEMPOTENCY_KEY_REUSED: "conflict",
  DELIVERY_IDEMPOTENT_REQUEST_IN_FLIGHT: "conflict",
  DELIVERY_DATABASE_UNAVAILABLE: "dependency_unavailable",
};

/** The HTTP status derived from the class — the HTTP layer never re-classifies. */
export function httpStatusForDeliveryError(code: DeliveryErrorCode): number {
  return DELIVERY_ERROR_CLASS_STATUS[DELIVERY_ERROR_CODE_CLASS[code]];
}
