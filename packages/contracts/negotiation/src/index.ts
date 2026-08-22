/**
 * @wasla/contracts-negotiation
 *
 * تبرير الحزمة (§7): تضع العقود الكنسية للتفاوض والمحادثة في سطح TypeScript واحد كي لا
 * ينسخ المستهلكون الحقيقة أو يبتكروا عقداً موازياً.
 *
 * These are Contract First artifacts (ADR-004), NOT a runtime implementation;
 * implementation lands in later MRs of Phase 08. ADR-013 limits Negotiation & Chat
 * to a bilateral thread over one dispatch offer: it never writes `orders`
 * (decision 2), never owns a price column on the order, requires explicit
 * acceptance of a numbered round (decision 3), keeps money in integer minor units
 * (decision 4), runs no timer (decision 5), lets no message body enter an event
 * (decision 6), stores no translation (decision 7), and holds no payment,
 * reputation or pricing-engine concern (decision 8).
 * Regenerate API types: pnpm --filter @wasla/contracts-negotiation generate
 */
export type * from "./api-types.js";
export type * from "./events-types.js";
export {
  NEGOTIATION_EVENT_TYPES,
  NEGOTIATION_EVENT_FORBIDDEN_FIELDS,
} from "./events-types.js";

import type { components, paths } from "./api-types.js";
export type { paths };
export type WaslaPublicId = components["schemas"]["WaslaPublicId"];
export type OrderPublicId = components["schemas"]["OrderPublicId"];
export type NegotiationThread = components["schemas"]["NegotiationThread"];
export type NegotiationThreadList = components["schemas"]["NegotiationThreadList"];
export type ThreadOpenRequest = components["schemas"]["ThreadOpenRequest"];
export type ThreadCancelRequest = components["schemas"]["ThreadCancelRequest"];
export type NegotiationRound = components["schemas"]["NegotiationRound"];
export type NegotiationRoundList = components["schemas"]["NegotiationRoundList"];
export type RoundProposal = components["schemas"]["RoundProposal"];
export type RoundDecision = components["schemas"]["RoundDecision"];
export type RoundRejection = components["schemas"]["RoundRejection"];
export type NegotiationMessage = components["schemas"]["NegotiationMessage"];
export type NegotiationMessageList = components["schemas"]["NegotiationMessageList"];
export type MessageSubmission = components["schemas"]["MessageSubmission"];
export type NegotiationAgreement = components["schemas"]["NegotiationAgreement"];
export type TickResult = components["schemas"]["TickResult"];
export type HealthStatus = components["schemas"]["HealthStatus"];
export type ErrorResponse = components["schemas"]["ErrorResponse"];

export const NEGOTIATION_ERROR_CODES = [
  "NEGOTIATION_VALIDATION_FAILED",
  "NEGOTIATION_IDEMPOTENCY_KEY_REQUIRED",
  "NEGOTIATION_FILTER_REQUIRED",
  "NEGOTIATION_LOCALE_UNSUPPORTED",
  "NEGOTIATION_MESSAGE_TOO_LONG",
  "NEGOTIATION_THREAD_NOT_FOUND",
  "NEGOTIATION_ROUND_NOT_FOUND",
  "NEGOTIATION_AGREEMENT_NOT_FOUND",
  "NEGOTIATION_IDEMPOTENCY_KEY_REUSED",
  "NEGOTIATION_THREAD_ALREADY_EXISTS",
  "NEGOTIATION_THREAD_CLOSED",
  "NEGOTIATION_ROUND_NOT_PENDING",
  "NEGOTIATION_ROUND_STALE",
  "NEGOTIATION_TURN_VIOLATION",
  "NEGOTIATION_ALREADY_AGREED",
  "NEGOTIATION_AMOUNT_OUT_OF_BOUNDS",
  "NEGOTIATION_CURRENCY_MISMATCH",
  "NEGOTIATION_CURRENCY_UNKNOWN",
  "NEGOTIATION_MAX_ROUNDS_REACHED",
  "NEGOTIATION_ROUND_EXPIRED",
  "NEGOTIATION_THREAD_EXPIRED",
  "NEGOTIATION_SELF_ACCEPT_FORBIDDEN",
  "NEGOTIATION_PARTY_MISMATCH",
  "NEGOTIATION_MESSAGE_LIMIT_REACHED",
  "NEGOTIATION_POLICY_NOT_FOUND",
  "NEGOTIATION_POLICY_NOT_FROZEN",
  "NEGOTIATION_ORDER_NOT_NEGOTIABLE",
  "NEGOTIATION_OFFER_NOT_ACTIVE",
  "NEGOTIATION_UNAVAILABLE",
] as const;
export type NegotiationErrorCode = (typeof NEGOTIATION_ERROR_CODES)[number];

/**
 * لا `bad_gateway` ولا `502` في هذا الكتالوج (ADR-013 القرار 2 · سابقة Phase 05 · MR 5/6).
 *
 * فشلُ تسليم السعر إلى محرّك الطلب **لا يُبطل الاتفاق**: القبول يُعيد اتفاقه بـ2xx ويُسجَّل
 * الفشل في `negotiation_price_handoffs` ويُقرأ من `handoff_state`. رمزُ فشلٍ على استجابةٍ
 * ناجحة يجعل الطرفين يظنّان أنّهما لم يتّفقا وقد اتّفقا. التفصيل في
 * `services/negotiations/contracts/errors.md` §القاعدة البند 3.
 */
export const NEGOTIATION_ERROR_CLASS_STATUS = {
  validation_error: 400,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  service_unavailable: 503,
} as const;
export type NegotiationErrorClass = keyof typeof NEGOTIATION_ERROR_CLASS_STATUS;

export const NEGOTIATION_ERROR_CODE_CLASS: Record<NegotiationErrorCode, NegotiationErrorClass> = {
  NEGOTIATION_VALIDATION_FAILED: "validation_error",
  NEGOTIATION_IDEMPOTENCY_KEY_REQUIRED: "validation_error",
  NEGOTIATION_FILTER_REQUIRED: "validation_error",
  NEGOTIATION_LOCALE_UNSUPPORTED: "validation_error",
  NEGOTIATION_MESSAGE_TOO_LONG: "validation_error",
  NEGOTIATION_THREAD_NOT_FOUND: "not_found",
  NEGOTIATION_ROUND_NOT_FOUND: "not_found",
  NEGOTIATION_AGREEMENT_NOT_FOUND: "not_found",
  NEGOTIATION_IDEMPOTENCY_KEY_REUSED: "conflict",
  NEGOTIATION_THREAD_ALREADY_EXISTS: "conflict",
  NEGOTIATION_THREAD_CLOSED: "conflict",
  NEGOTIATION_ROUND_NOT_PENDING: "conflict",
  NEGOTIATION_ROUND_STALE: "conflict",
  NEGOTIATION_TURN_VIOLATION: "conflict",
  NEGOTIATION_ALREADY_AGREED: "conflict",
  NEGOTIATION_AMOUNT_OUT_OF_BOUNDS: "unprocessable",
  NEGOTIATION_CURRENCY_MISMATCH: "unprocessable",
  NEGOTIATION_CURRENCY_UNKNOWN: "unprocessable",
  NEGOTIATION_MAX_ROUNDS_REACHED: "unprocessable",
  NEGOTIATION_ROUND_EXPIRED: "unprocessable",
  NEGOTIATION_THREAD_EXPIRED: "unprocessable",
  NEGOTIATION_SELF_ACCEPT_FORBIDDEN: "unprocessable",
  NEGOTIATION_PARTY_MISMATCH: "unprocessable",
  NEGOTIATION_MESSAGE_LIMIT_REACHED: "unprocessable",
  NEGOTIATION_POLICY_NOT_FOUND: "unprocessable",
  NEGOTIATION_POLICY_NOT_FROZEN: "unprocessable",
  NEGOTIATION_ORDER_NOT_NEGOTIABLE: "unprocessable",
  NEGOTIATION_OFFER_NOT_ACTIVE: "unprocessable",
  NEGOTIATION_UNAVAILABLE: "service_unavailable",
};

export function httpStatusForNegotiationError(code: NegotiationErrorCode): number {
  return NEGOTIATION_ERROR_CLASS_STATUS[NEGOTIATION_ERROR_CODE_CLASS[code]];
}

/** طرفان لا ثلاثة: النظام يُخبر ولا يساوم (لا `system` هنا). */
export const NEGOTIATION_PARTIES = ["customer", "driver"] as const;

export const NEGOTIATION_AUTHOR_ROLES = ["customer", "driver", "system"] as const;

export const NEGOTIATION_THREAD_STATES = [
  "open",
  "agreed",
  "declined",
  "expired",
  "cancelled",
] as const;

export const NEGOTIATION_ROUND_STATES = [
  "pending",
  "accepted",
  "rejected",
  "superseded",
  "expired",
] as const;

/** لا إغلاق بلا سبب. القائمة مُقفلة ومطابقة حرفياً لقيد `close_reason_code` في المخطّط. */
export const NEGOTIATION_CLOSE_REASON_CODES = [
  "agreed",
  "declined_by_customer",
  "declined_by_driver",
  "max_rounds_reached",
  "thread_expired",
  "cancelled_by_dispatch",
  "order_withdrawn",
] as const;

/** السببان الوحيدان المسموحان في `POST /cancel`: انسحاب طرفٍ رفضٌ لا إلغاء. */
export const NEGOTIATION_CANCEL_REASON_CODES = [
  "cancelled_by_dispatch",
  "order_withdrawn",
] as const;

export const NEGOTIATION_HANDOFF_STATES = [
  "pending",
  "handed_off",
  "rejected",
  "abandoned",
] as const;

export const NEGOTIATION_HANDOFF_OUTCOMES = ["accepted", "rejected", "unavailable"] as const;

/** أنواع الخدمة: مُقفلة ومطابقة حرفياً لعقد الطلب وعقد السائق. */
export const NEGOTIATION_SERVICE_KINDS = ["ride", "delivery"] as const;

/** Route values are kept for contract clients and drift-guarded against OpenAPI. */
export const NEGOTIATION_API_PATHS = [
  "/health",
  "/negotiations",
  "/negotiations/tick",
  "/negotiations/{threadId}",
  "/negotiations/{threadId}/agreement",
  "/negotiations/{threadId}/cancel",
  "/negotiations/{threadId}/messages",
  "/negotiations/{threadId}/rounds",
  "/negotiations/{threadId}/rounds/{roundNo}/accept",
  "/negotiations/{threadId}/rounds/{roundNo}/reject",
] as const;

/** لا `502`: انظر §القاعدة البند 3 في `services/negotiations/contracts/errors.md`. */
export const NEGOTIATION_HTTP_STATUS_CODES = [200, 201, 400, 404, 409, 422, 503] as const;

/**
 * نسخة سياسة الإطلاق المجمَّدة (`saudi-launch-v1`) كما تُزرع في `schema.sql`.
 *
 * تقيم هنا لا في كود الخدمة لأنّ طبقة التوصيل تحتاج العدّاد التنازلي (`round_ttl_seconds`)
 * والحدود لتعرض رسالةً صحيحة قبل أن يُرسل المستخدم مبلغاً يُرفض؛ ولو نسخَتها لصار لدينا
 * حقيقتان تتباعدان بصمت. والقيَم **عقدٌ لا تفضيل**: تغييرها نسخة سياسة جديدة.
 */
export const NEGOTIATION_LAUNCH_POLICY_VERSION = 1;
export const NEGOTIATION_LAUNCH_POLICY_LABEL = "saudi-launch-v1";

/**
 * منفذ خدمة التفاوض والمحادثة (CONTAINERS §4.9).
 *
 * يقيم الثابت في حزمة العقد لا في الخدمة لأن المستهلك (بوت العميل · بوت السائق · الإدارة)
 * يحتاج المنفذ ليبني عنوان العميل، ولو نسخه لصار لدينا حقيقتان تتباعدان بصمت.
 */
export const NEGOTIATION_SERVICE_PORT = 8091;
