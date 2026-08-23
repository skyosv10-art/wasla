/**
 * @wasla/contracts-subscription
 *
 * تبرير الحزمة (§7): تضع العقود الكنسية لاشتراك السائق والإحالة في سطح TypeScript واحد كي
 * لا ينسخ المستهلكون الحقيقة أو يبتكروا عقداً موازياً. مستهلكوها المعلومون اليوم: بوت
 * السائق (حالةُ الاشتراك والامتيازات)، طبقةُ التوصيل (`accept_orders` · `priority_dispatch`)،
 * لوحةُ الإدارة (Phase 15)، وطورُ الفوترة (Phase 17) الذي يستهلك `payment_reference` ولا
 * يستهلك مبلغاً من هنا لأنّه هو مالكُ المال.
 *
 * These are Contract First artifacts (ADR-004), NOT a runtime implementation;
 * implementation lands in later MRs of Phase 10. ADR-015 binds this service to a
 * single shape: one service owns subscription AND referral because a reward is a
 * PERIOD in the subscription ledger (decision 1), periods are stored and state is
 * DERIVED (decision 2), renewal is a period and not a transition so there is no
 * `active → active` edge (decision 3), the service NEVER punishes — `community`
 * is an entitlement FLOOR and suspension belongs to `services/drivers`
 * (decision 4), time moves by tick not by timer (decision 5), NO MONEY column and
 * no money field exist anywhere in the contract because Phase 17 owns money and
 * this service only carries an opaque `payment_reference` (decision 6), every
 * number lives in a FROZEN versioned plan and every derived row carries its
 * `plan_version` (decision 7), referral qualification is DERIVED from recorded
 * reputation facts with a closed rejection reason code and rejection is not an
 * event (decision 8), and one reward per referral is enforced by
 * `ux_referral_rewards_referral` and applied as a period (decision 9).
 * Regenerate API types: pnpm --filter @wasla/contracts-subscription generate
 */
export type * from "./api-types.js";
export type * from "./events-types.js";
export {
  SUBSCRIPTION_EVENT_TYPES,
  SUBSCRIPTION_EVENT_PRODUCER,
  SUBSCRIPTION_EVENT_FORBIDDEN_FIELDS,
  SUBSCRIPTION_FORBIDDEN_EVENT_TYPES,
} from "./events-types.js";

import type { components, paths } from "./api-types.js";
export type { paths };
export type WaslaPublicId = components["schemas"]["WaslaPublicId"];
export type ReferralCode = components["schemas"]["ReferralCode"];
export type SubscriptionPlan = components["schemas"]["SubscriptionPlan"];
export type SubscriptionPlanList = components["schemas"]["SubscriptionPlanList"];
export type SubscriptionPlanEntitlement = components["schemas"]["SubscriptionPlanEntitlement"];
export type SubscriptionStateResource = components["schemas"]["SubscriptionState"];
export type SubscriptionStartRequest = components["schemas"]["SubscriptionStartRequest"];
export type SubscriptionStartResult = components["schemas"]["SubscriptionStartResult"];
export type SubscriptionActivateRequest = components["schemas"]["SubscriptionActivateRequest"];
export type SubscriptionActivateResult = components["schemas"]["SubscriptionActivateResult"];
export type SubscriptionRecomputeResult = components["schemas"]["SubscriptionRecomputeResult"];
export type SubscriptionPeriod = components["schemas"]["SubscriptionPeriod"];
export type SubscriptionPeriodList = components["schemas"]["SubscriptionPeriodList"];
export type Referral = components["schemas"]["Referral"];
export type ReferralList = components["schemas"]["ReferralList"];
export type ReferralClaimRequest = components["schemas"]["ReferralClaimRequest"];
export type ReferralClaimResult = components["schemas"]["ReferralClaimResult"];
export type ReferralReward = components["schemas"]["ReferralReward"];
export type TickResult = components["schemas"]["TickResult"];
export type HealthStatus = components["schemas"]["HealthStatus"];
export type ErrorResponse = components["schemas"]["ErrorResponse"];

export const SUBSCRIPTION_ERROR_CODES = [
  "SUBSCRIPTION_VALIDATION_FAILED",
  "SUBSCRIPTION_IDEMPOTENCY_KEY_REQUIRED",
  "SUBSCRIPTION_FILTER_REQUIRED",
  "SUBSCRIPTION_NOT_FOUND",
  "SUBSCRIPTION_PLAN_NOT_FOUND",
  "REFERRAL_CODE_NOT_FOUND",
  "SUBSCRIPTION_IDEMPOTENCY_KEY_REUSED",
  "SUBSCRIPTION_ALREADY_EXISTS",
  "SUBSCRIPTION_TRANSITION_NOT_ALLOWED",
  "REFERRAL_REFEREE_ALREADY_REFERRED",
  "REFERRAL_REWARD_ALREADY_GRANTED",
  "SUBSCRIPTION_PLAN_NOT_FROZEN",
  "SUBSCRIPTION_PAYMENT_REFERENCE_REQUIRED",
  "REFERRAL_SELF_FORBIDDEN",
  "REFERRAL_WINDOW_CLOSED",
  "REFERRAL_REFEREE_NOT_QUALIFIED",
  "SUBSCRIPTION_UNAVAILABLE",
] as const;
export type SubscriptionErrorCode = (typeof SUBSCRIPTION_ERROR_CODES)[number];

/**
 * لا `bad_gateway` ولا `502` في هذا الكتالوج (سابقة Phase 05 · MR 5/6 وPhase 08 وPhase 09):
 * لا تابعَ متزامناً يُنتظر جوابه هنا. وتعثّرُ النبضة يظهر في `GET /health` و`last_tick_at`
 * لا في رمز خطأ على استجابةٍ ناجحة.
 *
 * ولا رمزَ يتكلّم عن المال (ADR-015 القرار 6): لا `PAYMENT_FAILED` ولا `INVOICE_NOT_FOUND`.
 * رمزٌ يقول «فشل الدفع» يجعل مستهلكاً يعتقد أنّ هذه الخدمة بوّابةُ سداد فيُرسل إليها ما لا
 * يجوز أن تراه. ولا رمزَ عقابيّاً (القرار 4): لا `DRIVER_SUSPENDED` ولا `SUBSCRIPTION_BLOCKED`.
 * التفصيل في `services/subscriptions/contracts/errors.md` §القاعدة البنود 3 و4.
 */
export const SUBSCRIPTION_ERROR_CLASS_STATUS = {
  validation_error: 400,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  service_unavailable: 503,
} as const;
export type SubscriptionErrorClass = keyof typeof SUBSCRIPTION_ERROR_CLASS_STATUS;

export const SUBSCRIPTION_ERROR_CODE_CLASS: Record<SubscriptionErrorCode, SubscriptionErrorClass> = {
  SUBSCRIPTION_VALIDATION_FAILED: "validation_error",
  SUBSCRIPTION_IDEMPOTENCY_KEY_REQUIRED: "validation_error",
  SUBSCRIPTION_FILTER_REQUIRED: "validation_error",
  SUBSCRIPTION_NOT_FOUND: "not_found",
  SUBSCRIPTION_PLAN_NOT_FOUND: "not_found",
  REFERRAL_CODE_NOT_FOUND: "not_found",
  SUBSCRIPTION_IDEMPOTENCY_KEY_REUSED: "conflict",
  SUBSCRIPTION_ALREADY_EXISTS: "conflict",
  SUBSCRIPTION_TRANSITION_NOT_ALLOWED: "conflict",
  REFERRAL_REFEREE_ALREADY_REFERRED: "conflict",
  REFERRAL_REWARD_ALREADY_GRANTED: "conflict",
  SUBSCRIPTION_PLAN_NOT_FROZEN: "unprocessable",
  SUBSCRIPTION_PAYMENT_REFERENCE_REQUIRED: "unprocessable",
  REFERRAL_SELF_FORBIDDEN: "unprocessable",
  REFERRAL_WINDOW_CLOSED: "unprocessable",
  REFERRAL_REFEREE_NOT_QUALIFIED: "unprocessable",
  SUBSCRIPTION_UNAVAILABLE: "service_unavailable",
};

export function httpStatusForSubscriptionError(code: SubscriptionErrorCode): number {
  return SUBSCRIPTION_ERROR_CLASS_STATUS[SUBSCRIPTION_ERROR_CODE_CLASS[code]];
}

/** مُقفلة ومطابقة حرفياً لقيد `state` في `subscriptions` وللتعداد في كتالوج الأحداث. */
export const SUBSCRIPTION_STATES = ["trial", "active", "expired", "community"] as const;

/** مطابقة لقيد `reason_code` في `subscription_transitions`. لا `renewed` (القرار 3). */
export const SUBSCRIPTION_TRANSITION_REASONS = [
  "trial_granted",
  "payment_activated",
  "referral_reward_applied",
  "period_ended",
  "community_grace_ended",
] as const;

/** مطابقة لقيد `source` في `subscription_periods`. */
export const SUBSCRIPTION_PERIOD_SOURCES = ["trial", "payment", "referral_reward"] as const;

/** مطابقة لقيد `entitlement_code` في `subscription_plan_entitlements`. */
export const SUBSCRIPTION_ENTITLEMENTS = [
  "accept_orders",
  "daily_order_cap",
  "priority_dispatch",
  "zone_multi_select",
] as const;

/** مطابقة لقيد `state` في `referrals`. */
export const REFERRAL_STATES = ["pending", "qualified", "rewarded", "rejected"] as const;

/** مطابقة لقيد `reason_code` في `referrals`. */
export const REFERRAL_REJECTION_REASONS = [
  "self_referral",
  "referrer_not_active",
  "referee_already_referred",
  "referee_no_qualifying_facts",
  "referral_window_expired",
  "referee_subscription_never_activated",
] as const;

/**
 * جدولُ الانتقالات المسموحة، مُعلَناً في العقد لا مُستنتَجاً من الكود.
 *
 * `null` مفتاحُ الإنشاء (∅ → trial) ويقع مرّةً واحدةً لكلّ سائق. و**لا `active → active`**
 * (ADR-015 القرار 3): التجديدُ مُدّةٌ تُضاف إلى الدفتر لا انتقالٌ يُسجَّل، ولو سُجّل لصار
 * دفترُ الانتقالات مليئاً بأسطرٍ لا تقول شيئاً ولاختلط «فُعِّل بعد انقضاء» بـ«جدّد قبل
 * انتهائه» — وهما رسالتان مختلفتان للسائق.
 *
 * و`community` لا مَخرجَ منها إلّا `active`: من نزل إلى الأرضيّة يعود بمُدّةٍ مدفوعةٍ أو
 * بمكافأةٍ لا بمرور الوقت.
 */
export const SUBSCRIPTION_ALLOWED_TRANSITIONS: ReadonlyArray<
  readonly [(typeof SUBSCRIPTION_STATES)[number] | null, (typeof SUBSCRIPTION_STATES)[number]]
> = [
  [null, "trial"],
  ["trial", "active"],
  ["trial", "expired"],
  ["active", "expired"],
  ["expired", "active"],
  ["expired", "community"],
  ["community", "active"],
] as const;

/** Route values are kept for contract clients and drift-guarded against OpenAPI. */
export const SUBSCRIPTION_API_PATHS = [
  "/health",
  "/referrals",
  "/referrals/codes/{ownerPublicId}",
  "/subscriptions",
  "/subscriptions/plans",
  "/subscriptions/plans/{planCode}/{planVersion}",
  "/subscriptions/tick",
  "/subscriptions/{driverPublicId}",
  "/subscriptions/{driverPublicId}/activate",
  "/subscriptions/{driverPublicId}/periods",
  "/subscriptions/{driverPublicId}/recompute",
] as const;

/** أحدَ عشرَ مساراً فريداً تحمل اثنتَي عشرةَ عمليّة: `/referrals` تحمل `GET` و`POST`. */
export const SUBSCRIPTION_API_OPERATION_COUNT = 12;

/** لا `502`: انظر §القاعدة البند 3 في `services/subscriptions/contracts/errors.md`. */
export const SUBSCRIPTION_HTTP_STATUS_CODES = [200, 201, 400, 404, 409, 422, 503] as const;

/**
 * خطّةُ الإطلاق المجمَّدة كما تُزرع في المراجعة 2/6 (`saudi-driver-monthly` v1).
 *
 * الأرقامُ هنا **عقدٌ لا تفضيل**: تغييرُ أيٍّ منها نسخةُ خطّةٍ جديدة (ADR-015 القرار 7)،
 * لأنّ تعديلَ `trial_days` في مكانه يُغيّر ما وُعد به سائقٌ أمس بأثرٍ رجعيّ فلا يبقى في
 * النظام ما يُثبت الوعدَ الأوّل. وتقيم في حزمة العقد لا في الخدمة لأنّ البوت يعرض
 * «14 يوم تجربة» و«30 يوم مكافأة» للسائق، ولو نسخهما لصار لدينا حقيقتان تتباعدان بصمت.
 */
export const SUBSCRIPTION_LAUNCH_PLAN_CODE = "saudi-driver-monthly";
export const SUBSCRIPTION_LAUNCH_PLAN_VERSION = 1;
export const SUBSCRIPTION_LAUNCH_TRIAL_DAYS = 14;
export const SUBSCRIPTION_LAUNCH_DURATION_DAYS = 30;
export const SUBSCRIPTION_LAUNCH_COMMUNITY_GRACE_DAYS = 7;

/**
 * سقفُ الطلبات اليوميُّ على أرضيّة المجتمع في نسخةِ خطّةِ الإطلاق (ملحقُ ADR-015 · المراجعة 2/6).
 *
 * لماذا رقمٌ مُعلَن هنا: القرارُ 4 يقول إنّ `community` **أرضيّةُ استحقاقٍ لا عقوبة**، وأرضيّةٌ
 * بلا رقمٍ ليست أرضيّة. والبوتُ يقول للسائق «ثلاثةُ طلبات يومياً بعد انقضاء اشتراكك»، فلو
 * سكن الرقمُ في الخدمة لقال البوتُ رقماً وقالت الخدمةُ آخر.
 *
 * النسخةُ الخاطئةُ الأرخص: أن يورّث `community` سقفَ الخطّةِ المدفوعة (`daily_order_cap`)،
 * فيصير «بلا سقف» (‎-1) أرضيّةً مجانيّةً دائمة، ويسقط سببُ الدفع من أصله.
 */
export const SUBSCRIPTION_LAUNCH_COMMUNITY_DAILY_ORDER_CAP = 3;

/** عنوانُ نسخةِ خطّةِ الإطلاق كما يظهر للسائق؛ نصٌّ واحدٌ لا يُترجم مرّتَين. */
export const SUBSCRIPTION_LAUNCH_PLAN_LABEL = "اشتراك السائق الشهري";

/**
 * رموزُ الاستحقاق التي تبقى على الأرضيّة، ورموزُ ما يُفقَد بانقضاء المدة المدفوعة.
 *
 * القائمتان **متكاملتان لا متقاطعتان** ومجموعُهما `SUBSCRIPTION_ENTITLEMENTS` بحرفه،
 * و`contracts.test.ts` يحرس ذلك: رمزٌ جديدٌ لا يُصنَّف يبقى معلَّقاً بلا قرار، فيقرّر
 * أوّلُ فرعٍ في الكود مصيرَه صمتاً.
 */
export const SUBSCRIPTION_COMMUNITY_FLOOR_ENTITLEMENTS = ["accept_orders", "daily_order_cap"] as const;
export const SUBSCRIPTION_PAID_ONLY_ENTITLEMENTS = ["priority_dispatch", "zone_multi_select"] as const;

/**
 * أرقامُ الإحالة في نسخةِ خطّةِ الإطلاق. العتبةُ **وقائعُ مُسجَّلة** لا تسجيلٌ مجرّد
 * (القرار 8): مكافأةٌ على حسابٍ فُتِح ثمّ نام هي بابُ الحسابات الوهمية بعينه.
 */
export const REFERRAL_REWARD_DAYS = 30;
export const REFERRAL_QUALIFYING_FACT_COUNT = 5;
export const REFERRAL_WINDOW_DAYS = 30;

/** صيغةُ رمز الإحالة. حروفٌ وأرقامٌ كبيرةٌ فقط: رمزٌ يُقرأ في رسالةٍ صوتيّةٍ ويُكتب بلا لبس. */
export const REFERRAL_CODE_PATTERN = /^WR-[0-9A-Z]{8}$/;

/** صيغةُ مُعرّف السائق العلنيّ كما في كل الأطوار السابقة. */
export const WASLA_PUBLIC_ID_PATTERN = /^WS-[0-9]{10}$/;

/**
 * منفذ خدمة الاشتراك والإحالة (CONTAINERS §4.7).
 *
 * يقيم الثابت في حزمة العقد لا في الخدمة لأنّ المستهلك (بوتُ السائق · طبقةُ التوصيل ·
 * الإدارةُ · Billing) يحتاج المنفذ ليبني عنوان العميل، ولو نسخه لصار لدينا حقيقتان
 * تتباعدان بصمت. والرقمُ 8093 لا يصطدم بمنفذٍ لطورٍ سابق، و`boundary.test.ts` يحرس ذلك.
 */
export const SUBSCRIPTION_SERVICE_PORT = 8093;
