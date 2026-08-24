/**
 * أخطاءُ مجال الاشتراك والإحالة.
 *
 * الكتالوجُ **لا يُعاد تعريفه هنا**: الرموزُ السبعةَ عشرَ وأصنافُها ورمزُ HTTP المُشتقُّ من
 * الصنف تقيم في `@wasla/contracts-subscription` محروسةً ضدّ
 * `services/subscriptions/contracts/errors.md`. هذا الملف يلفّها في خطأٍ قابلٍ للرمي فقط،
 * فترفع دالّةُ المجال رمزَ عقدٍ وتُسقطه طبقةُ HTTP (المراجعة 4/6) بلا إعادة تصنيف.
 *
 * الاختباراتُ تؤكّد `code` لا نصَّ الرسالة العربية: رسالةٌ تُعاد صياغتُها لا يجوز أن تُسقط بناءً.
 *
 * ## أربعُ قواعدَ يوجد هذا الملفّ لحمايتها
 *
 * **1) لا رمزَ يتكلّم عن المال** (ADR-015 القرار 6). لا `PAYMENT_FAILED` ولا
 * `INVOICE_NOT_FOUND` ولا `CARD_DECLINED`، ولا مصنعَ أدناه يُنتج شيئاً من هذا المعنى.
 * رمزٌ يقول «فشل الدفع» يجعل مستهلكاً يعتقد أنّ هذه الخدمة بوّابةُ سداد، فيُرسل إليها ما لا
 * يجوز أن تراه، ويصير تسريبُ بياناتِ الدفع مسألةَ وقتٍ لا مسألةَ قرار. الفوترةُ يملكها
 * Phase 17، وكلُّ ما يعبر هذا الحدَّ مرجعٌ opaque واحدٌ اسمُه `payment_reference`.
 *
 * **2) لا رمزَ عقابيّاً** (القرار 4). لا `DRIVER_SUSPENDED` ولا `SUBSCRIPTION_BLOCKED`.
 * `community` **أرضيّةُ استحقاقٍ لا عقوبة**؛ ورمزٌ يقول «موقوف» يجعل مستهلكاً يفترض أنّ
 * الاشتراكَ يحجب سائقاً، فيبني عليه سلوكاً لا مالكَ لقراره. الإيقافُ يملكه
 * `services/drivers` والقرارُ الإداريّ يملكه Phase 15.
 *
 * **3) لا `502` ولا صنفَ `bad_gateway`.** لا تابعَ متزامناً تُنتظر إجابتُه هنا؛ وتعثّرُ
 * النبضة يظهر في `GET /health` و`last_tick_at` لا في رمز خطأٍ على استجابةٍ ناجحة.
 *
 * **4) الخصوصية.** لا رسالةً هنا ولا حقلَ `details` يحمل اسماً ولا هاتفاً ولا إحداثيةً ولا
 * مرجعَ دفعٍ ولا نصّاً حرّاً. `field` يسمّي الحقلَ ولا يردُّ ما كُتب فيه، وحقولُ `details`
 * **معدودةٌ** مطابقةً لـ`ErrorResponse.error.details` في OpenAPI الذي يُعلن
 * `additionalProperties: false`: مفتاحٌ غيرُ مُعلَنٍ كان سيُفشل تحقّقَ مستهلكٍ صارمٍ على
 * استجابةٍ صحيحةٍ فيما عدا ذلك (درسُ Phase 05 · المراجعة 4/6).
 */

import {
  SUBSCRIPTION_ERROR_CODE_CLASS,
  httpStatusForSubscriptionError,
  type SubscriptionErrorClass,
  type SubscriptionErrorCode,
} from "@wasla/contracts-subscription";

import type {
  ReferralRejectionReason,
  ReferralState,
  SubscriptionPeriodSource,
  SubscriptionState,
} from "./contract-sets.js";

export type { SubscriptionErrorClass, SubscriptionErrorCode };

/**
 * تفصيلٌ مُهيكلٌ يُقرأ آلياً بجوار الرمز.
 *
 * حقولٌ اختياريةٌ مُسمّاةٌ لا كِيسٌ حرّ، بالضبط كي لا يكون «ضعِ القيمةَ في التفاصيل» طريقاً
 * مطروقاً. ولا حقلَ هنا يحمل مرجعَ دفعٍ ولا مبلغاً.
 */
export interface SubscriptionErrorDetails {
  readonly field?: string;
  readonly expected?: string;
  readonly planCode?: string;
  readonly planVersion?: number;
  readonly fromState?: SubscriptionState | null;
  readonly toState?: SubscriptionState;
  readonly periodSource?: SubscriptionPeriodSource;
  readonly referralState?: ReferralState;
  readonly rejectionReason?: ReferralRejectionReason;
  readonly constraint?: string;
}

/** خطأُ مجالٍ يحمل رمزَ عقدٍ مستقرّاً وصنفَه ورمزَ HTTP المُشتقَّ منه. */
export class SubscriptionError extends Error {
  readonly code: SubscriptionErrorCode;
  readonly class: SubscriptionErrorClass;
  readonly httpStatus: number;
  readonly details: SubscriptionErrorDetails;

  constructor(
    code: SubscriptionErrorCode,
    message: string,
    options: { details?: SubscriptionErrorDetails } = {},
  ) {
    super(message);
    this.name = "SubscriptionError";
    this.code = code;
    this.class = SUBSCRIPTION_ERROR_CODE_CLASS[code];
    this.httpStatus = httpStatusForSubscriptionError(code);
    this.details = options.details ?? {};
  }
}

export function isSubscriptionError(error: unknown): error is SubscriptionError {
  return error instanceof SubscriptionError;
}

/** حقلٌ لم يُطابق الشكلَ المُعلَن. يسمّي الحقلَ والمتوقَّعَ ولا يردُّ ما كُتب. */
export function validationFailed(field: string, expected: string): SubscriptionError {
  return new SubscriptionError("SUBSCRIPTION_VALIDATION_FAILED", `حقل غير صالح: ${field}`, {
    details: { field, expected },
  });
}

/**
 * انتقالٌ غيرُ مُعلَنٍ في `SUBSCRIPTION_ALLOWED_TRANSITIONS`.
 *
 * `conflict` لا `validation_error`: المُدخلُ سليمُ الشكل، والحالةُ الراهنةُ هي التي تمنع.
 */
export function transitionNotAllowed(
  fromState: SubscriptionState | null,
  toState: SubscriptionState,
): SubscriptionError {
  return new SubscriptionError(
    "SUBSCRIPTION_TRANSITION_NOT_ALLOWED",
    `انتقال غير معلن: ${fromState ?? "∅"} → ${toState}`,
    { details: { fromState, toState, constraint: "SUBSCRIPTION_ALLOWED_TRANSITIONS" } },
  );
}

/**
 * نسخةُ خطّةٍ غيرُ مجمَّدةٍ لا تُمنح منها مدّة (القرار 7).
 *
 * النسخةُ الخاطئةُ الأرخص: منحُ مدةٍ من نسخةٍ قابلةٍ للتحرير، فيُعدّل أحدُهم `duration_days`
 * غداً فتتغيّر مدّةٌ مُنحت أمس بأثرٍ رجعيّ ولا يبقى في النظام ما يُثبت الوعدَ الأوّل.
 */
export function planNotFrozen(planCode: string, planVersion: number): SubscriptionError {
  return new SubscriptionError("SUBSCRIPTION_PLAN_NOT_FROZEN", "نسخة الخطة غير مجمدة", {
    details: { planCode, planVersion, constraint: "is_frozen" },
  });
}

/** نسخةُ خطّةٍ غيرُ موجودةٍ في الكتالوج المُجمَّد. */
export function planNotFound(planCode: string, planVersion: number): SubscriptionError {
  return new SubscriptionError("SUBSCRIPTION_PLAN_NOT_FOUND", "نسخة الخطة غير موجودة", {
    details: { planCode, planVersion },
  });
}

/** مدةُ `payment` بلا مرجعِ دفعٍ opaque (القرار 6): المرجعُ أثرُ السبب، لا مبلغَه. */
export function paymentReferenceRequired(): SubscriptionError {
  return new SubscriptionError(
    "SUBSCRIPTION_PAYMENT_REFERENCE_REQUIRED",
    "مدة مصدرها payment تحتاج مرجع دفع",
    { details: { field: "payment_reference", periodSource: "payment" } },
  );
}

/** إحالةٌ إلى النفس. `unprocessable` لأنّ الشكلَ سليمٌ والمعنى مرفوض. */
export function referralSelfForbidden(): SubscriptionError {
  return new SubscriptionError("REFERRAL_SELF_FORBIDDEN", "لا إحالة إلى النفس", {
    details: { rejectionReason: "self_referral", constraint: "ck_referrals_not_self" },
  });
}

/** مكافأةٌ ثانيةٌ لنفس الإحالة (القرار 9): مكافأةٌ واحدةٌ لكلّ إحالةٍ إلى الأبد. */
export function referralRewardAlreadyGranted(referralState: ReferralState): SubscriptionError {
  return new SubscriptionError("REFERRAL_REWARD_ALREADY_GRANTED", "مكافأة هذه الإحالة مُنحت", {
    details: { referralState, constraint: "ux_referral_rewards_referral" },
  });
}

/** إحالةٌ لم تتأهّل بعد، فلا تُمنح مكافأتُها. */
export function referralNotQualified(referralState: ReferralState): SubscriptionError {
  return new SubscriptionError("REFERRAL_REFEREE_NOT_QUALIFIED", "الإحالة لم تتأهل", {
    details: { referralState },
  });
}

/**
 * سائقٌ لا اشتراكَ له. **يُختلَق اشتراكٌ لغريبٍ؟ لا** (errors.md §`SUBSCRIPTION_NOT_FOUND`).
 *
 * النسخةُ الخاطئةُ الأرخص هنا إعادةُ `community` لمن لم يشترك يوماً: تجعل «الأرضيّة» تعني
 * شيئين في استجابةٍ واحدة — من انقضت مُدّتُه، ومن لا وجودَ له — فيبني البوتُ رسالةً واحدةً
 * لحالتين مختلفتين تماماً.
 */
export function subscriptionNotFound(): SubscriptionError {
  return new SubscriptionError("SUBSCRIPTION_NOT_FOUND", "لا اشتراك لهذا السائق", {
    details: { field: "driver_public_id" },
  });
}

/**
 * اشتراكٌ ثانٍ لسائقٍ له اشتراكٌ قائم بأيِّ حالة.
 *
 * والتجديدُ ليس إنشاءً: من انقضت مُدّتُه يُفعَّل بـ`activate` فتُضاف مُدّةٌ إلى دفترِه
 * القائم. وحارسُه الثاني في القاعدة `ux_subscriptions_driver`؛ فلو مرّ فحصٌ هنا في سباقٍ،
 * القيدُ يمنع الصفَّ الثاني ولا يبقى للسائقِ دفترانِ وحالتان.
 */
export function subscriptionAlreadyExists(state: SubscriptionState): SubscriptionError {
  return new SubscriptionError("SUBSCRIPTION_ALREADY_EXISTS", "للسائق اشتراك قائم", {
    details: { fromState: state, constraint: "ux_subscriptions_driver" },
  });
}

/** رمزُ إحالةٍ لا مالكَ له، أو مالكٌ لا رمزَ له. ولا يُنشأ رمزٌ في `GET` (errors.md §`REFERRAL_CODE_NOT_FOUND`). */
export function referralCodeNotFound(): SubscriptionError {
  return new SubscriptionError("REFERRAL_CODE_NOT_FOUND", "رمز الإحالة غير موجود", {
    details: { field: "referral_code" },
  });
}

/**
 * مُحالٌ له إحالةٌ مسجَّلةٌ من قبل — **بأيّ حالة، بما فيها `rejected`**.
 *
 * ولمَ تُحسب `rejected`؟ لأنّ إعادةَ المحاولةِ بعد رفضٍ تُلغي معنى الرفض: يُطالب برمزٍ آخرَ
 * حتى يمرّ أحدُها. وحارسُه الثاني `ux_referrals_referee`.
 */
export function refereeAlreadyReferred(state: ReferralState): SubscriptionError {
  return new SubscriptionError("REFERRAL_REFEREE_ALREADY_REFERRED", "للمُحال إحالة مسجلة", {
    details: { referralState: state, constraint: "ux_referrals_referee" },
  });
}

/**
 * فعلٌ يُغيّر حالةً بلا رأس `Idempotency-Key`.
 *
 * `validation_error` لا `conflict`: الخدمةُ لم تُقارن مفتاحاً قائماً بعد. ومنحُ أيّامٍ بلا
 * مفتاحٍ يجعل إعادةَ محاولةٍ واحدةً عند انقطاعِ شبكةٍ تُضاعف شهراً مجّاناً.
 */
export function idempotencyKeyRequired(): SubscriptionError {
  return new SubscriptionError(
    "SUBSCRIPTION_IDEMPOTENCY_KEY_REQUIRED",
    "الفعل يحتاج رأس Idempotency-Key",
    { details: { field: "Idempotency-Key", expected: "8..128 chars" } },
  );
}

/**
 * نفسُ `Idempotency-Key` لطلبٍ **مختلفِ البصمة**.
 *
 * `conflict` لا `validation_error`: شكلُ الطلبِ سليمٌ، والمانعُ مفتاحٌ استقرّ لطلبٍ آخر.
 * وإعادةُ الجوابِ المحفوظِ هنا كانت ستكون أسوأَ عيبٍ ممكن: عميلٌ يطلب «فعّل اشتراكَ سائقٍ»
 * بمفتاحٍ استعمله قبلَها لسائقٍ غيرِه فيتلقّى نجاحاً عن عملٍ **لم يُنفَّذ له**.
 *
 * ولا يردُّ الخطأُ البصمةَ ولا الجوابَ المحفوظ: مقارنةٌ يُعطاها المُهاجمُ طرفاها تصير أداةَ
 * استكشافٍ لطلباتِ غيره.
 */
export function idempotencyKeyReused(routeKey: string): SubscriptionError {
  return new SubscriptionError(
    "SUBSCRIPTION_IDEMPOTENCY_KEY_REUSED",
    "المفتاح مستعمل لطلب مختلف",
    { details: { field: "Idempotency-Key", expected: `same request for ${routeKey}` } },
  );
}

/** `GET /referrals` بلا مُرشِّح: قراءةٌ بلا مُرشِّحٍ تُصدّر شبكةَ إحالاتِ كلِّ السائقين بطلبٍ واحد. */
export function referralFilterRequired(): SubscriptionError {
  return new SubscriptionError("SUBSCRIPTION_FILTER_REQUIRED", "القراءة تحتاج مُرشحاً واحداً على الأقل", {
    details: { expected: "referrer_public_id | referee_public_id | state" },
  });
}

/** مضت `referral_window_days` من نسخةِ الخطّة، فلا مطالبةَ بعدها. */
export function referralWindowClosed(planCode: string, planVersion: number): SubscriptionError {
  return new SubscriptionError("REFERRAL_WINDOW_CLOSED", "نافذة الإحالة مغلقة", {
    details: { planCode, planVersion, rejectionReason: "referral_window_expired" },
  });
}

/**
 * الاستمراريةُ غيرُ متاحة، فلا حالةَ تُعطى.
 *
 * **حالةٌ مُشتقّةٌ من دفترٍ لا يُقرأ ليست حالة**: إعادةُ `community` عند تعذّرِ القراءة تُوقف
 * سائقاً مشتركاً عن العمل. و`503` تقول للمستهلك «أعِد المحاولةَ»، لا «أمرُك مرفوض».
 */
export function subscriptionUnavailable(reason: string): SubscriptionError {
  return new SubscriptionError("SUBSCRIPTION_UNAVAILABLE", "الخدمة لا تعطي حالة موثوقة الآن", {
    details: { expected: reason },
  });
}
