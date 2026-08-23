/**
 * @wasla/contracts-reputation
 *
 * تبرير الحزمة (§7): تضع العقود الكنسية للسمعة وإشارات الاحتيال في سطح TypeScript واحد كي
 * لا ينسخ المستهلكون الحقيقة أو يبتكروا عقداً موازياً.
 *
 * These are Contract First artifacts (ADR-004), NOT a runtime implementation;
 * implementation lands in later MRs of Phase 09. ADR-014 binds this service to a
 * single shape: facts are stored and scores are DERIVED (decision 3), the only
 * source of truth is a published domain event keyed by `(order, sequence)`
 * because delivery is at-least-once (decision 2), every number lives in a frozen
 * ruleset and every derived value carries its `ruleset_version` (decision 4),
 * ratings are a score plus a closed reason code with no free text (decision 5),
 * fraud is named rules over facts and a signal is an OBSERVATION not a verdict
 * (decision 6), the service NEVER punishes — no suspension, no block, no
 * reputation-based pricing (decision 7), time moves by tick not by timer
 * (decision 8), and no personal data or channel id ever enters a contract
 * (decision 9).
 * Regenerate API types: pnpm --filter @wasla/contracts-reputation generate
 */
export type * from "./api-types.js";
export type * from "./events-types.js";
export {
  REPUTATION_EVENT_TYPES,
  REPUTATION_EVENT_FORBIDDEN_FIELDS,
  REPUTATION_FORBIDDEN_EVENT_TYPES,
} from "./events-types.js";

import type { components, paths } from "./api-types.js";
export type { paths };
export type WaslaPublicId = components["schemas"]["WaslaPublicId"];
export type OrderPublicId = components["schemas"]["OrderPublicId"];
export type ReputationFact = components["schemas"]["ReputationFact"];
export type ReputationFactList = components["schemas"]["ReputationFactList"];
export type FactRecordRequest = components["schemas"]["FactRecordRequest"];
export type FactRecordResult = components["schemas"]["FactRecordResult"];
export type ReputationScore = components["schemas"]["ReputationScore"];
export type ReputationRating = components["schemas"]["ReputationRating"];
export type ReputationRatingList = components["schemas"]["ReputationRatingList"];
export type RatingSubmitRequest = components["schemas"]["RatingSubmitRequest"];
export type RatingSubmitResult = components["schemas"]["RatingSubmitResult"];
export type FraudSignal = components["schemas"]["FraudSignal"];
export type FraudSignalList = components["schemas"]["FraudSignalList"];
export type ReputationRuleset = components["schemas"]["ReputationRuleset"];
export type ReputationRulesetList = components["schemas"]["ReputationRulesetList"];
export type ReputationRuleWeight = components["schemas"]["ReputationRuleWeight"];
export type ReputationFraudThreshold = components["schemas"]["ReputationFraudThreshold"];
export type TickResult = components["schemas"]["TickResult"];
export type HealthStatus = components["schemas"]["HealthStatus"];
export type ErrorResponse = components["schemas"]["ErrorResponse"];

export const REPUTATION_ERROR_CODES = [
  "REPUTATION_VALIDATION_FAILED",
  "REPUTATION_IDEMPOTENCY_KEY_REQUIRED",
  "REPUTATION_FILTER_REQUIRED",
  "REPUTATION_SCORE_NOT_FOUND",
  "REPUTATION_RULESET_NOT_FOUND",
  "REPUTATION_IDEMPOTENCY_KEY_REUSED",
  "REPUTATION_FACT_ALREADY_RECORDED",
  "REPUTATION_RATING_ALREADY_SUBMITTED",
  "REPUTATION_SCORE_STALE",
  "REPUTATION_RULESET_NOT_FROZEN",
  "REPUTATION_RULE_WEIGHT_MISSING",
  "REPUTATION_SOURCE_EVENT_STALE",
  "REPUTATION_ORDER_NOT_COMPLETED",
  "REPUTATION_RATING_SELF_FORBIDDEN",
  "REPUTATION_RATING_PARTY_MISMATCH",
  "REPUTATION_RATING_WINDOW_CLOSED",
  "REPUTATION_UNAVAILABLE",
] as const;
export type ReputationErrorCode = (typeof REPUTATION_ERROR_CODES)[number];

/**
 * لا `bad_gateway` ولا `502` في هذا الكتالوج (سابقة Phase 05 · MR 5/6 وPhase 08): لا تابعَ
 * متزامناً يُنتظر جوابه هنا، والخدمة **مستهلكٌ** لأحداث محرّك الطلب. وتعثّرُ الناقل يظهر في
 * `GET /health` و`last_tick_at` لا في رمز خطأ على استجابةٍ ناجحة.
 *
 * ولا رمزَ عقابيّاً بحال (ADR-014 القرار 7): لا `SUBJECT_SUSPENDED` ولا `SUBJECT_BLOCKED`
 * ولا `FRAUD_DETECTED`. رمزٌ يقول «موقوف» يجعل مستهلكاً يفترض أنّ السمعة تحجب فيبني عليه
 * سلوكاً لا مالك له. التفصيل في `services/reputation/contracts/errors.md` §القاعدة البند 3.
 */
export const REPUTATION_ERROR_CLASS_STATUS = {
  validation_error: 400,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  service_unavailable: 503,
} as const;
export type ReputationErrorClass = keyof typeof REPUTATION_ERROR_CLASS_STATUS;

export const REPUTATION_ERROR_CODE_CLASS: Record<ReputationErrorCode, ReputationErrorClass> = {
  REPUTATION_VALIDATION_FAILED: "validation_error",
  REPUTATION_IDEMPOTENCY_KEY_REQUIRED: "validation_error",
  REPUTATION_FILTER_REQUIRED: "validation_error",
  REPUTATION_SCORE_NOT_FOUND: "not_found",
  REPUTATION_RULESET_NOT_FOUND: "not_found",
  REPUTATION_IDEMPOTENCY_KEY_REUSED: "conflict",
  REPUTATION_FACT_ALREADY_RECORDED: "conflict",
  REPUTATION_RATING_ALREADY_SUBMITTED: "conflict",
  REPUTATION_SCORE_STALE: "conflict",
  REPUTATION_RULESET_NOT_FROZEN: "unprocessable",
  REPUTATION_RULE_WEIGHT_MISSING: "unprocessable",
  REPUTATION_SOURCE_EVENT_STALE: "unprocessable",
  REPUTATION_ORDER_NOT_COMPLETED: "unprocessable",
  REPUTATION_RATING_SELF_FORBIDDEN: "unprocessable",
  REPUTATION_RATING_PARTY_MISMATCH: "unprocessable",
  REPUTATION_RATING_WINDOW_CLOSED: "unprocessable",
  REPUTATION_UNAVAILABLE: "service_unavailable",
};

export function httpStatusForReputationError(code: ReputationErrorCode): number {
  return REPUTATION_ERROR_CLASS_STATUS[REPUTATION_ERROR_CODE_CLASS[code]];
}

/** الطرفان اللذان تُقاس سمعتهما. لا `system`: النظام لا سمعة له ولا يُقيَّم. */
export const REPUTATION_SUBJECT_TYPES = ["customer", "driver"] as const;

/** مُقفلة ومطابقة حرفياً لقيد `fact_kind` في المخطّط ولـ`FactKind` في كتالوج الأحداث. */
export const REPUTATION_FACT_KINDS = [
  "order_completed",
  "order_cancelled_by_customer",
  "order_cancelled_by_driver",
  "assignment_accepted",
  "assignment_rejected",
  "assignment_timed_out",
  "rating_received",
] as const;

/** رتبةٌ مُشتقّة. `under_watch` تسميةٌ تُقرأ ولا تُنفَّذ (ADR-014 القرار 7). */
export const REPUTATION_TIERS = ["new", "standard", "trusted", "under_watch"] as const;

export const REPUTATION_RECOMPUTE_TRIGGERS = [
  "fact_recorded",
  "tick",
  "manual_recompute",
] as const;

export const REPUTATION_RATING_REASON_CODES = [
  "on_time",
  "late_arrival",
  "courteous",
  "poor_conduct",
  "unsafe_driving",
  "vehicle_condition",
  "route_deviation",
  "no_show",
] as const;

/** أقلّ درجةٍ وأكثرها. الحدّان في العقد لا في الواجهة: واجهةٌ بعشر نجوم تُنتج بياناً لا يُقارَن. */
export const REPUTATION_RATING_MIN_STARS = 1;
export const REPUTATION_RATING_MAX_STARS = 5;

/** قواعد مُسمّاة لا احتمالٌ إحصائيّ (ADR-014 القرار 6). مطابقة لقيد `rule_code` في المخطّط. */
export const FRAUD_RULE_CODES = [
  "repeated_customer_cancellation",
  "repeated_driver_cancellation",
  "accept_then_abandon",
  "offer_timeout_streak",
  "rating_extremity_burst",
] as const;

export const FRAUD_SEVERITIES = ["low", "medium", "high"] as const;

/**
 * أحداثُ المصدر التي تُشتقّ منها الوقائع (ADR-014 القرار 2). تقيم هنا كي يكون مستهلكُ
 * الأحداث (المراجعة 5/6) مُعلَناً في العقد لا مخفيّاً في كود الخدمة: من يقرأ الحزمة يعرف
 * على ماذا تشترك السمعة بلا قراءة تنفيذها.
 */
export const REPUTATION_SOURCE_EVENT_TYPES = [
  "order.status_changed",
  "order.assignment_resolved",
] as const;

/** Route values are kept for contract clients and drift-guarded against OpenAPI. */
export const REPUTATION_API_PATHS = [
  "/health",
  "/reputation/facts",
  "/reputation/fraud-signals",
  "/reputation/ratings",
  "/reputation/rulesets",
  "/reputation/rulesets/{rulesetVersion}",
  "/reputation/scores/{subjectType}/{subjectPublicId}",
  "/reputation/scores/{subjectType}/{subjectPublicId}/recompute",
  "/reputation/tick",
] as const;

/** لا `502`: انظر §القاعدة البند 3 في `services/reputation/contracts/errors.md`. */
export const REPUTATION_HTTP_STATUS_CODES = [200, 201, 400, 404, 409, 422, 503] as const;

/**
 * نسخة قواعد الإطلاق المجمَّدة (`saudi-launch-v1`) كما تُزرع في `schema.sql`.
 *
 * الرقم واللافتة هنا لا في كود الخدمة لأنّ المستهلك يحتاج أن يعرف بأيّ قواعد حُسبت النتيجة
 * التي يقرؤها، ولو نسخهما لصار لدينا حقيقتان تتباعدان بصمت. والقيَم **عقدٌ لا تفضيل**:
 * تغييرها نسخةُ قواعد جديدة (ADR-014 القرار 4).
 */
export const REPUTATION_LAUNCH_RULESET_VERSION = 1;
export const REPUTATION_LAUNCH_RULESET_LABEL = "saudi-launch-v1";

/**
 * منفذ خدمة السمعة وإشارات الاحتيال (CONTAINERS §4.6).
 *
 * يقيم الثابت في حزمة العقد لا في الخدمة لأن المستهلك (مستهلكُ الأحداث · الإدارة · طورُ
 * الاشتراكات) يحتاج المنفذ ليبني عنوان العميل، ولو نسخه لصار لدينا حقيقتان تتباعدان بصمت.
 */
export const REPUTATION_SERVICE_PORT = 8092;
