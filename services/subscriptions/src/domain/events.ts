/**
 * مصانعُ الأحداث الستّة — **الشكلُ على السلك، بلا نشرٍ ولا ناقل**.
 *
 * ## الحمولةُ تُبنى بحقولٍ معدودةٍ ولا تُنسَخ بـ`...`
 *
 * كلُّ حمولةٍ في `contracts/events.json` تحمل `additionalProperties: false`، فحقلٌ زائدٌ
 * يُفشل تحقّقَ مستهلكٍ صارم. والنسخُ الشاملُ من صفِّ قاعدةٍ (`...period` أو `...projection`)
 * كان سيُهرّب `created_at` و`updated_at` و`trace_id` و`payment_reference` إلى السلك بأوّلِ
 * عمودٍ يُضاف إلى الجدول — و`tsc` لا يمنع ذلك ولا يراه. فالحقولُ مكتوبةٌ واحداً واحداً.
 *
 * ## `occurred_for` ≠ `occurred_at`
 *
 * `occurred_at` لحظةُ **إصدارِ** الحدث، و`occurred_for` اللحظةُ التي **صار فيها الأمرُ
 * حقيقةً**. والفرقُ ليس تجميلاً: نبضةٌ تركض 03:10 وتُثبّت انقضاءً وقع 03:00 تُصدر حدثاً
 * `occurred_at = 03:10` و`occurred_for = 03:00`. ومستهلكٌ يبني نافذةً على لحظةِ الإصدار
 * يُنتج تقريراً يتحرّك بحسب صحّةِ خادمِنا وتأخّرِ ناقلِنا لا بحسب ما جرى للسائق.
 *
 * ## ولا مالَ في أيّ حمولة (ADR-015 القرار 6)
 *
 * `payment_reference` مرجعٌ **مُعتِمٌ** يُنقَل ولا يُفسَّر، و`null` حين يكون المصدرُ مكافأةَ
 * إحالة. ولا مبلغَ ولا عملةَ ولا وسيلةَ دفعٍ في أيّ حدث — ومن أراد المالَ سأل Billing.
 * وكذلك لا اسمَ ولا هاتفَ ولا إحداثية: المُعرِّفاتُ العامّةُ (`WS-`) وحدَها.
 *
 * ## وما لا يُنشَر أصلاً
 *
 * **الرفضُ ليس حدثاً**: إحالةٌ رُفضت لا تُنشر (`referral.rejected` لا وجودَ له في العقد).
 * والسببُ قرارٌ لا سهو: حدثُ رفضٍ يُغري أوّلَ مستهلكٍ برسالةٍ للسائق تقول «إحالتُك مرفوضةٌ
 * لأنّ المُحال إليه لم يعمل بعد» — وهي رسالةٌ تُقال قبل أن تُغلق النافذةُ، أي عن حكمٍ لم
 * يستقرّ. والتجديدُ ليس حدثاً كذلك: مُدّةٌ تُضاف على `active` لا تُنتج انتقالاً (القرار 3)،
 * فلا حدثَ لها — والمُدّةُ في الدفتر هي أثرُها.
 *
 * ## ولا مُعرِّفَ يُولَّد هنا ولا ساعةَ تُقرأ
 *
 * `eventId` و`occurredAt` **مُمرَّران** في `EventMeta`. و`randomUUID()` داخل مصنعٍ يجعل
 * الحدثَ غيرَ قابلٍ للمقارنةِ بمساواةٍ تامّةٍ في اختبار، و`Date.now()` داخلَه ينقض نقاءَ
 * المجال كلَّه (`purity.test.ts` يحرس الاثنين). ومُعرِّفُ الحدثِ هو **نفسُه** مفتاحُ صفِّ
 * الصادر، فيُولَّد مرّةً واحدةً في طبقةِ التطبيقِ ويدخل الحمولةَ والمفتاحَ معاً.
 */

import type {
  ReferralState,
  SubscriptionPeriodSource,
  SubscriptionState,
  SubscriptionTransitionReason,
} from "./contract-sets.js";

export const SUBSCRIPTION_EVENT_PRODUCER = "subscriptions-service" as const;
export const SUBSCRIPTION_EVENT_VERSION = "v1" as const;

/** التجميعتان اللتان تُنسَب إليهما أحداثُ هذه الخدمة — لا ثالثةَ في العقد. */
export const SUBSCRIPTION_AGGREGATE_TYPES = ["subscription", "referral"] as const;
export type SubscriptionAggregateType = (typeof SUBSCRIPTION_AGGREGATE_TYPES)[number];

/** أنواعُ الأحداثِ الستّة كما في `contracts/events.json` — تُقرأ في الاختبارِ ولا تُكتب بيد. */
export const SUBSCRIPTION_EVENT_TYPES = [
  "subscription.trial_started",
  "subscription.activated",
  "subscription.expired",
  "subscription.moved_to_community",
  "referral.qualified",
  "referral.rewarded",
] as const;
export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number];

/** ما يُمرّره المُنادي لكلّ حدث: مُعرِّفُه ولحظةُ إصدارِه وأثرُ الطلبِ إن وُجد. */
export interface EventMeta {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly traceId?: string | null;
}

interface Envelope {
  readonly event_id: string;
  readonly event_type: SubscriptionEventType;
  readonly event_version: typeof SUBSCRIPTION_EVENT_VERSION;
  readonly occurred_at: string;
  readonly producer: typeof SUBSCRIPTION_EVENT_PRODUCER;
  readonly aggregate: {
    readonly type: SubscriptionAggregateType;
    readonly id: string;
  };
  readonly trace_id: string | null;
}

function envelope(
  meta: EventMeta,
  eventType: SubscriptionEventType,
  aggregateType: SubscriptionAggregateType,
  aggregateId: string,
): Envelope {
  return {
    event_id: meta.eventId,
    event_type: eventType,
    event_version: SUBSCRIPTION_EVENT_VERSION,
    occurred_at: meta.occurredAt,
    producer: SUBSCRIPTION_EVENT_PRODUCER,
    aggregate: { type: aggregateType, id: aggregateId },
    trace_id: meta.traceId ?? null,
  };
}

/**
 * الحقولُ المشتركةُ لكلّ حدثِ انتقال.
 *
 * `from_state` و`state_sequence` ليسا زيادةً: مستهلكٌ يرى «صار `active`» بلا ما قبلَها لا
 * يعرف إن كان تفعيلاً أوّلَ أم رجوعاً من انقضاء — والفرقُ يقلب كلَّ رسالةٍ يُرسلها للسائق.
 * و`state_sequence` مفتاحُ الترتيبِ وإهمالِ المُكرَّر: التسليمُ at-least-once، ومستهلكٌ يرى
 * تسلسلاً أقدمَ ممّا عنده يُهمِله بلا سؤال.
 */
export interface TransitionEventData {
  readonly driver_public_id: string;
  readonly subscription_id: string;
  readonly from_state: SubscriptionState | null;
  readonly to_state: SubscriptionState;
  readonly reason_code: SubscriptionTransitionReason;
  readonly state_sequence: number;
  readonly plan_code: string;
  readonly plan_version: number;
  readonly period_id: string | null;
  readonly expires_at: string | null;
  readonly occurred_for: string;
}

/** ما يُمرَّر لبناءِ حدثِ انتقال — بأسماءِ الكود، والتحويلُ إلى السلك هنا وحدَه. */
export interface TransitionEventInput {
  readonly meta: EventMeta;
  readonly driverPublicId: string;
  readonly subscriptionId: string;
  readonly fromState: SubscriptionState | null;
  readonly toState: SubscriptionState;
  readonly reasonCode: SubscriptionTransitionReason;
  readonly stateSequence: number;
  readonly planCode: string;
  readonly planVersion: number;
  readonly periodId: string | null;
  readonly expiresAt: string | null;
  /** لحظةُ **وقوعِ** الانتقالِ لا لحظةُ إصدارِ الحدث. */
  readonly transitionOccurredAt: string;
}

function transitionData(input: TransitionEventInput): TransitionEventData {
  return {
    driver_public_id: input.driverPublicId,
    subscription_id: input.subscriptionId,
    from_state: input.fromState,
    to_state: input.toState,
    reason_code: input.reasonCode,
    state_sequence: input.stateSequence,
    plan_code: input.planCode,
    plan_version: input.planVersion,
    period_id: input.periodId,
    expires_at: input.expiresAt,
    occurred_for: input.transitionOccurredAt,
  };
}

// ---------------------------------------------------------------------------
// subscription.trial_started
// ---------------------------------------------------------------------------

export interface TrialStartedEvent extends Envelope {
  readonly event_type: "subscription.trial_started";
  readonly data: TransitionEventData;
}

/** يُنشَر مرّةً واحدةً لكلّ سائقٍ لأنّ `ux_subscriptions_driver` يمنع الثانية. */
export function trialStarted(input: TransitionEventInput): TrialStartedEvent {
  return {
    ...envelope(input.meta, "subscription.trial_started", "subscription", input.subscriptionId),
    event_type: "subscription.trial_started",
    data: transitionData(input),
  };
}

// ---------------------------------------------------------------------------
// subscription.activated
// ---------------------------------------------------------------------------

export interface ActivatedEventData extends TransitionEventData {
  readonly to_state: "active";
  readonly period_source: SubscriptionPeriodSource;
  readonly granted_days: number;
  readonly payment_reference: string | null;
  readonly expires_at: string;
}

export interface ActivatedEvent extends Envelope {
  readonly event_type: "subscription.activated";
  readonly data: ActivatedEventData;
}

/**
 * `reason_code` يفرّق مصدرَ الأيّام (`payment_activated` · `referral_reward_applied`) فلا
 * يحتاج مستهلكٌ أن يخمّن، و`expires_at` **غيرُ قابلٍ للغياب** هنا: حدثُ تفعيلٍ بلا نهايةٍ
 * كان سيجعل المستهلكَ يفترض دواماً لا يقوله الدفتر.
 */
export function activated(
  input: TransitionEventInput & {
    readonly toState: "active";
    readonly periodSource: SubscriptionPeriodSource;
    readonly grantedDays: number;
    readonly paymentReference: string | null;
    readonly expiresAt: string;
  },
): ActivatedEvent {
  return {
    ...envelope(input.meta, "subscription.activated", "subscription", input.subscriptionId),
    event_type: "subscription.activated",
    data: {
      ...transitionData(input),
      to_state: "active",
      period_source: input.periodSource,
      granted_days: input.grantedDays,
      payment_reference: input.paymentReference,
      expires_at: input.expiresAt,
    },
  };
}

// ---------------------------------------------------------------------------
// subscription.expired · subscription.moved_to_community
// ---------------------------------------------------------------------------

export interface ExpiredEvent extends Envelope {
  readonly event_type: "subscription.expired";
  readonly data: TransitionEventData;
}

/** انقضاءٌ **مُثبَّتٌ** لا محسوبٌ في القراءة: النبضةُ وحدَها تُصدره (القرار 5). */
export function expired(input: TransitionEventInput): ExpiredEvent {
  return {
    ...envelope(input.meta, "subscription.expired", "subscription", input.subscriptionId),
    event_type: "subscription.expired",
    data: transitionData(input),
  };
}

export interface MovedToCommunityEvent extends Envelope {
  readonly event_type: "subscription.moved_to_community";
  readonly data: TransitionEventData;
}

/**
 * نزولٌ إلى **أرضيّةِ استحقاقٍ** لا عقوبة (القرار 4).
 *
 * ولذلك لا حقلَ سببٍ إداريٍّ في الحمولةِ ولا وسمَ سلوك: مستهلكٌ يقرأ الحدثَ يعرف أنّ
 * الاستحقاقاتَ صارت أضيقَ، ولا يعرف — ولا يجوز أن يعرف — حكماً على السائق.
 */
export function movedToCommunity(input: TransitionEventInput): MovedToCommunityEvent {
  return {
    ...envelope(input.meta, "subscription.moved_to_community", "subscription", input.subscriptionId),
    event_type: "subscription.moved_to_community",
    data: transitionData(input),
  };
}

// ---------------------------------------------------------------------------
// referral.qualified
// ---------------------------------------------------------------------------

export interface ReferralQualifiedEvent extends Envelope {
  readonly event_type: "referral.qualified";
  readonly data: {
    readonly referral_id: string;
    readonly referral_code: string;
    readonly referrer_public_id: string;
    readonly referee_public_id: string;
    readonly qualifying_fact_count: number;
    readonly required_fact_count: number;
    readonly plan_code: string;
    readonly plan_version: number;
    readonly occurred_for: string;
  };
}

/**
 * `required_fact_count` يُنشَر مع العدّ الفعليّ، ولا يُترك للمستهلك أن يقرأ العتبة.
 *
 * العتبةُ في **نسخةِ الخطّة**، وتتغيّر بنسخةٍ جديدة. فمستهلكٌ يقرؤها من إعدادٍ عندَه يصير
 * يقول «5 من 5» عن إحالةٍ تأهّلت بعتبةِ نسختِها القديمة — أي يشرح قراراً بأرقامٍ لم تُتَّخذ به.
 */
export function referralQualified(input: {
  readonly meta: EventMeta;
  readonly referralId: string;
  readonly referralCode: string;
  readonly referrerPublicId: string;
  readonly refereePublicId: string;
  readonly qualifyingFactCount: number;
  readonly requiredFactCount: number;
  readonly planCode: string;
  readonly planVersion: number;
  /** لحظةُ الحكمِ بالتأهّل (`judgedAt`) لا لحظةُ إصدارِ الحدث. */
  readonly qualifiedAt: string;
}): ReferralQualifiedEvent {
  return {
    ...envelope(input.meta, "referral.qualified", "referral", input.referralId),
    event_type: "referral.qualified",
    data: {
      referral_id: input.referralId,
      referral_code: input.referralCode,
      referrer_public_id: input.referrerPublicId,
      referee_public_id: input.refereePublicId,
      qualifying_fact_count: input.qualifyingFactCount,
      required_fact_count: input.requiredFactCount,
      plan_code: input.planCode,
      plan_version: input.planVersion,
      occurred_for: input.qualifiedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// referral.rewarded
// ---------------------------------------------------------------------------

export interface ReferralRewardedEvent extends Envelope {
  readonly event_type: "referral.rewarded";
  readonly data: {
    readonly referral_id: string;
    readonly reward_id: string;
    readonly beneficiary_public_id: string;
    readonly granted_period_id: string;
    readonly reward_days: number;
    readonly plan_code: string;
    readonly plan_version: number;
    readonly occurred_for: string;
  };
}

/**
 * `granted_period_id` إلزاميٌّ: المكافأةُ **أيّامٌ دخلت الدفترَ فعلاً** لا وعدٌ بها.
 *
 * وحدثٌ يقول «مُنِحت 30 يوماً» بلا مُدّةٍ يُشير إليها كان سيجعل تسويةَ الحساباتِ مستحيلة:
 * لا سبيلَ للمستهلك أن يعرف هل الأيّامُ في التغطيةِ أم في نيّةِ خدمةٍ سقطت قبل أن تكتبها.
 * والأيّامُ **مُدّةٌ لا رصيد**: لا محفظةَ في هذه الخدمة ولا نقطةَ تُصرَف.
 */
export function referralRewarded(input: {
  readonly meta: EventMeta;
  readonly referralId: string;
  readonly rewardId: string;
  readonly beneficiaryPublicId: string;
  readonly grantedPeriodId: string;
  readonly rewardDays: number;
  readonly planCode: string;
  readonly planVersion: number;
  /** لحظةُ منحِ المكافأة (`grantedAt`) لا لحظةُ إصدارِ الحدث. */
  readonly rewardedAt: string;
}): ReferralRewardedEvent {
  return {
    ...envelope(input.meta, "referral.rewarded", "referral", input.referralId),
    event_type: "referral.rewarded",
    data: {
      referral_id: input.referralId,
      reward_id: input.rewardId,
      beneficiary_public_id: input.beneficiaryPublicId,
      granted_period_id: input.grantedPeriodId,
      reward_days: input.rewardDays,
      plan_code: input.planCode,
      plan_version: input.planVersion,
      occurred_for: input.rewardedAt,
    },
  };
}

/** أيُّ حدثٍ من الستّة — يُستعمل حيث يُنقَل الحدثُ ولا يُفسَّر. */
export type SubscriptionDomainEvent =
  | TrialStartedEvent
  | ActivatedEvent
  | ExpiredEvent
  | MovedToCommunityEvent
  | ReferralQualifiedEvent
  | ReferralRewardedEvent;

/** حالةُ إحالةٍ يُنشَر لها حدثٌ — والرفضُ ليس منها بقصد (انظر الترويسة). */
export const REFERRAL_PUBLISHED_STATES: ReadonlyArray<ReferralState> = Object.freeze([
  "qualified",
  "rewarded",
]);

/**
 * ## النطاق
 *
 * مصانعُ الأحداثِ الستّة: بناءُ المغلَّفِ والحمولةِ بحقولٍ صريحة، بلا نشرٍ ولا ناقلٍ ولا
 * ساعةٍ ولا مُعرِّفٍ مُولَّد.
 *
 * ## آخر تحديث
 *
 * المراجعة 5/6 — الملفُّ جديد.
 *
 * ## الحالة
 *
 * مُستعمَلٌ من `app/sync.ts` (أحداثُ الانتقال) و`app/facts.ts` (أحداثُ الإحالة)، ويُكتب
 * مُخرَجُه في `subscription_outbox` داخلَ نفسِ معاملةِ القرار.
 *
 * ## كودٌ ذو صلة
 *
 * `contracts/events.json` · `services/reputation/src/domain/events.ts` (السابقة) ·
 * `db/outbox.ts` · `app/events.ts`.
 *
 * ## الفريق
 *
 * Platform / Subscriptions.
 */
