/**
 * أنواعُ المجال: ما تقرأه الدالّاتُ النقيّةُ وما تُعيده.
 *
 * ## لماذا أنواعٌ داخليّةٌ بجوار أنواعِ العقد
 *
 * أنواعُ `@wasla/contracts-subscription` هي **سطحُ الشبكة**: أسماءُ حقولها `snake_case`،
 * وفيها ما لا يملكه المجالُ أصلاً (`subscription_id` تُنشئه القاعدة، `state_sequence` يعدّه
 * جدولُ الانتقالات، `is_stale` يقيسه صفٌّ متحقّق). لو حسبَ المجالُ على نفس الشكل لصار كلُّ
 * اختبارٍ يُلفّق مُعرّفاتٍ ورقماً متسلسلاً لا علاقةَ لهما بالقاعدة التي يختبرها، ولصار
 * تغييرُ اسم حقلٍ في OpenAPI يُعيد كتابةَ منطقٍ لا يعرف الشبكةَ. فالمجالُ يحسب `camelCase`
 * ويُعيد **مسوّداتٍ** بلا مُعرّفات، وطبقةُ الاستمرارية (3/6) هي التي تُسند المُعرّفاتَ
 * والتسلسل، وطبقةُ HTTP (4/6) هي التي تُترجم إلى شكل العقد.
 *
 * وليس هذا نسخاً لحقيقةٍ: **الأعضاءُ المُقفلةُ كلُّها** (الحالاتُ · المصادرُ · الرموزُ ·
 * أسبابُ الرفض) مُشتقّةٌ من حزمة العقد في `contract-sets.ts`، ولا مصفوفةَ أعضاءٍ ثانيةً هنا.
 */

import type {
  ReferralRejectionReason,
  ReferralState,
  SubscriptionEntitlementCode,
  SubscriptionPeriodSource,
  SubscriptionState,
  SubscriptionTransitionReason,
} from "./contract-sets.js";

/** استحقاقٌ واحدٌ بقيمةٍ عدديّة. `‎-1` تعني «بلا سقف»، وصفرٌ يعني «ممنوعٌ فعلياً». */
export interface Entitlement {
  readonly entitlementCode: SubscriptionEntitlementCode;
  readonly limitValue: number;
}

/**
 * لقطةُ نسخةِ خطّةٍ مجمَّدة — **بياناتٌ لا كود** (القرار 7).
 *
 * كلُّ رقمٍ يؤثّر في حالةِ سائقٍ يسكن هنا: مدةُ التجربة، مدةُ الدورة، مهلةُ ما بعد
 * الانقضاء، سقفُ أرضيّةِ المجتمع، وأرقامُ الإحالة. لا واحدَ منها ثابتٌ في دالّة، لأنّ
 * ثابتاً في دالّةٍ يُغيَّر بنشرةٍ ولا يُبقي أثراً يقول ما كان أمس، فيصير سؤالُ «على أيّ
 * وعدٍ مُنحت هذه المدة؟» بلا جوابٍ في النظام.
 */
export interface PlanVersion {
  readonly planCode: string;
  readonly planVersion: number;
  readonly label: string;
  readonly trialDays: number;
  readonly durationDays: number;
  readonly communityGraceDays: number;
  readonly communityDailyOrderCap: number;
  readonly referralRewardDays: number;
  readonly referralQualifyingFacts: number;
  readonly referralWindowDays: number;
  readonly isFrozen: boolean;
  readonly entitlements: ReadonlyArray<Entitlement>;
}

/**
 * مدةٌ مُسجّلةٌ في الدفتر — **الحقيقةُ الوحيدةُ** التي تُشتقّ منها الحالة (القرار 2).
 *
 * `paymentReference` مرجعٌ opaque ولا شيءَ غيره: لا مبلغَ ولا عملةَ ولا وسيلةَ دفع ولا
 * حالةَ فاتورة (القرار 6). الحقلُ موجودٌ لمدّةِ `payment` وحدَها، ولا حقلَ بديلَ له لمنحةِ
 * التجربةِ أو الإحالة — كي لا يجد كاتبٌ عجولٌ «مكاناً فارغاً» يضع فيه رقمَ عملية.
 */
export interface Period {
  readonly periodId: string;
  readonly driverPublicId: string;
  readonly planCode: string;
  readonly planVersion: number;
  readonly source: SubscriptionPeriodSource;
  readonly paymentReference: string | null;
  readonly grantedDays: number;
  readonly startsAt: string;
  readonly endsAt: string;
}

/**
 * مسوّدةُ مدّةٍ قبل أن تُسنَد لها هويّة.
 *
 * لماذا بلا `periodId`: المُعرّفُ تُنشئه القاعدةُ في نفس المعاملة التي تكتب الصفَّ (3/6).
 * دالّةٌ نقيّةٌ تُنتج `uuid` تحتاج عشوائيةً، والعشوائيةُ تُبطل «نفسُ المُدخل ⇒ نفسُ المُخرج»
 * فتُصبح المسوّدةُ غيرَ قابلةٍ للمقارنة في اختبار.
 */
export type PeriodDraft = Omit<Period, "periodId">;

/**
 * الحالةُ المُشتقّة — **مخرَجُ حسابٍ لا صفٌّ يُكتب بحرّية** (القرار 2).
 *
 * `expiresAt` غيرُ فارغةٍ في `trial` و`active` وفارغةٌ في `expired` و`community`، مطابقةً
 * لقيد `ck_subscriptions_period_state` في `schema.sql`: القيدُ في القاعدة والنوعُ هنا
 * يقولان الشيءَ نفسَه، فلا تُكتب حالةٌ لا يقبلها المخزن.
 *
 * `stateStartedAt` لحظةُ ابتداءِ **هذه الحالة** لا لحظةُ ابتداءِ الاشتراك كلِّه: للتغطية
 * بدايةُ سلسلتِها، وللانقضاءِ نهايةُ التغطية، وللأرضيّة نهايةُ المهلة. لماذا؟ لأنّ السؤالَ
 * الذي يُسأل في الدعم هو «منذ متى هو على هذه الحال؟» لا «متى سجّل أوّلَ مرّة».
 */
export interface DerivedSubscription {
  readonly state: SubscriptionState;
  readonly planCode: string;
  readonly planVersion: number;
  readonly stateStartedAt: string;
  readonly expiresAt: string | null;
  readonly coverageEndedAt: string | null;
  readonly entitlements: ReadonlyArray<Entitlement>;
  readonly computedAt: string;
}

/** انتقالٌ مُقترَحٌ بسببٍ من القائمة المُقفلة؛ يكتبه صفٌّ في `subscription_transitions` (3/6). */
export interface TransitionDraft {
  readonly fromState: SubscriptionState | null;
  readonly toState: SubscriptionState;
  readonly reasonCode: SubscriptionTransitionReason;
  readonly occurredAt: string;
}

/**
 * وقائعُ المُحال إليه كما تُقرأ من خدمة السمعة (Phase 09) — **حقائقٌ لا أحكام**.
 *
 * لماذا عددٌ ولا قائمةُ وقائع: التأهيلُ عتبةُ عددٍ في نسخةِ الخطّة، والمجالُ لا يحتاج أن
 * يرى محتوى الواقعة. وقراءةُ العدد تبقى في مستهلكِ الأحداث (5/6)؛ أمّا هنا فهو مُدخَل.
 */
export interface RefereeEvidence {
  readonly qualifyingFactCount: number;
  readonly hasActivatedPaidPeriod: boolean;
  readonly alreadyReferredByAnother: boolean;
}

/** إحالةٌ كما تُقرأ قبل الحكم عليها؛ `rewardedAt` غيرُ فارغةٍ يعني أنّ المكافأةَ مُنحت. */
export interface Referral {
  readonly referralId: string;
  readonly referralCode: string;
  readonly referrerPublicId: string;
  readonly refereePublicId: string;
  readonly state: ReferralState;
  readonly reasonCode: ReferralRejectionReason | null;
  readonly qualifyingFactCount: number;
  readonly windowEndsAt: string;
}

/** حكمُ التأهيل: حالةٌ واحدةٌ وسببٌ مُقفلٌ عند الرفض، ولا صمتَ بينهما. */
export interface ReferralJudgement {
  readonly state: Extract<ReferralState, "qualified" | "rejected">;
  readonly reasonCode: ReferralRejectionReason | null;
  readonly qualifyingFactCount: number;
  readonly judgedAt: string;
}

/** مكافأةٌ مُقترَحة: مدةٌ في الدفتر ورقمُ أيامٍ من نسخةِ الخطّة، ولا رصيدَ ولا مال. */
export interface ReferralRewardDraft {
  readonly referralId: string;
  readonly rewardDays: number;
  readonly planCode: string;
  readonly planVersion: number;
  readonly period: PeriodDraft;
}
