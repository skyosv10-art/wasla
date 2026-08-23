/**
 * Driver Subscription & Referral Domain Event types — hand-derived from
 * services/subscriptions/contracts/events.json (JSON Schema 2020-12).
 *
 * Drift guards read the canonical schema at test time. ADR-015 decision 2: an
 * event is the TRACE OF A PERIOD THAT ENTERED THE LEDGER or of a TRANSITION THAT
 * WAS RECORDED — never a declaration of intent and never the output of a timer.
 * Every payload therefore carries what makes it reproducible: a transition
 * carries its previous state, its next state, its closed reason code and its
 * per-driver sequence; a period carries its source and its frozen plan version;
 * a reward carries the period id that actually granted the days.
 *
 * Decision 6: NO MONEY crosses this boundary — no `amount`, no `currency`, no
 * `price`, no `invoice_id`. Activation carries an opaque `payment_reference` and
 * nothing more; money belongs to Phase 17 (Billing).
 *
 * Decision 4: no event punishes. Dropping to `community` is an entitlement
 * FLOOR, not a block — suspension belongs to `services/drivers` (ADR-012
 * decision 3) and administrative action belongs to Phase 15.
 *
 * Decision 8: rejection is NOT an event. A rejected referral is read from
 * `GET /referrals?state=rejected` with its closed reason code, because
 * publishing a rejection invites a consumer to build a penalty nobody owns.
 */
export type SubscriptionAggregateType = "subscription" | "referral";

/**
 * الحالات الأربع. **مُشتقّةٌ من دفتر المُدد** لا مكتوبةٌ بيدٍ (ADR-015 القرار 2):
 * `GET /subscriptions/{driverPublicId}/recompute` يُعيد بناءها من الدفتر، فما في العمود
 * ذاكرةٌ سريعةٌ لا حقيقةٌ منفصلة. و`community` أرضيّةٌ لا عقوبة (القرار 4).
 */
export type SubscriptionState = "trial" | "active" | "expired" | "community";

/**
 * قائمة مُقفلة. كلُّ سببٍ فيها يقابل انتقالاً واحداً في الجدول المُعلَن في ورقة المجال،
 * وسببٌ حرٌّ كان سيجعل «لماذا انتقل هذا السائق؟» سؤالاً يُجاب بالقراءة لا بالعدّ.
 * ولا `renewed` هنا: التجديدُ مُدّةٌ تُضاف ولا انتقالَ معها (القرار 3).
 */
export type SubscriptionTransitionReason =
  | "trial_granted"
  | "payment_activated"
  | "referral_reward_applied"
  | "period_ended"
  | "community_grace_ended";

/**
 * من أين جاءت أيّامُ المُدّة. ثلاثةٌ لا أكثر، ولكلٍّ أثرٌ مختلفٌ في التدقيق: التجربةُ
 * مرّةً واحدة، والدفعُ يُطابَق مع Billing لاحقاً بـ`payment_reference`، والمكافأةُ
 * تُطابَق مع إحالةٍ مؤهَّلة.
 */
export type SubscriptionPeriodSource = "trial" | "payment" | "referral_reward";

/**
 * الامتيازاتُ الأربعة. **قائمةٌ مغلقةٌ في العقد** لا مفتاحٌ حرٌّ في جدول: امتيازٌ
 * يُختلَق في صفٍّ يجعل بوتاً يفحص اسماً لا يعرفه أحد. والقيَمُ تُقرأ من نسخةِ الخطّة
 * لا من الكود (القرار 7): `daily_order_cap` رقمٌ في `subscription_plan_entitlements`.
 */
export type SubscriptionEntitlementCode =
  | "accept_orders"
  | "daily_order_cap"
  | "priority_dispatch"
  | "zone_multi_select";

/** حالاتُ الإحالة الأربع. `rejected` حالةٌ في الدفتر لا حدثٌ منشور (القرار 8). */
export type ReferralState = "pending" | "qualified" | "rewarded" | "rejected";

/**
 * أسبابُ الرفض السّتّة، قائمةٌ مغلقةٌ تُحصى وتُقارَن. «رُفضت» بلا سببٍ مُسمّى تُنتج
 * تذكرةَ دعمٍ لكلّ حالة، ونصٌّ حرٌّ يُقرأ ولا يُقاس (سابقة ADR-014 القرار 5).
 */
export type ReferralRejectionReason =
  | "self_referral"
  | "referrer_not_active"
  | "referee_already_referred"
  | "referee_no_qualifying_facts"
  | "referral_window_expired"
  | "referee_subscription_never_activated";

export interface SubscriptionEventEnvelope {
  event_id: string;
  event_type: string;
  event_version: string;
  occurred_at: string;
  producer: "subscriptions-service";
  aggregate: { type: SubscriptionAggregateType; id: string };
  trace_id?: string | null;
}

/**
 * الحقولُ المشتركةُ لكلّ حدثِ انتقال. لا حدثَ انتقالٍ بلا `from_state` و`to_state`
 * و`state_sequence`: مستهلكٌ يرى «صار active» بلا ما قبلَها لا يعرف إن كان تفعيلاً أوّلَ
 * أم رجوعاً من انقضاء، والفرقُ يغيّر كلَّ رسالةٍ تُرسل للسائق.
 */
export interface SubscriptionTransitionData {
  driver_public_id: string;
  subscription_id: string;
  /** `null` تعني الإنشاء (∅ → trial) لا «حالةً مجهولة». */
  from_state?: SubscriptionState | null;
  to_state: SubscriptionState;
  reason_code: SubscriptionTransitionReason;
  /** تسلسلُ الانتقال على السائق. مفتاحُ الترتيب وعدمِ التكرار: التسليمُ at-least-once. */
  state_sequence: number;
  plan_code: string;
  plan_version: number;
  period_id?: string | null;
  expires_at?: string | null;
  occurred_for: string;
}

/**
 * بدأت تجربة: أوّلُ مُدّةٍ في دفترِ سائقٍ لم يكن له اشتراك. يُنشَر مرّةً واحدةً لكلّ
 * سائقٍ لأنّ `ux_subscriptions_driver` يمنع الثانية.
 */
export interface SubscriptionTrialStartedV1 extends SubscriptionEventEnvelope {
  event_type: "subscription.trial_started";
  event_version: "v1";
  data: SubscriptionTransitionData;
}

/**
 * صار الاشتراكُ `active`. و`reason_code` يفرّق بين الدفع والمكافأة فلا يحتاج مستهلكٌ
 * أن يخمّن مصدرَ الأيّام. **ولا مبلغَ في الحمولة** (القرار 6). والتجديدُ ليس هذا الحدث:
 * مُدّةٌ تُضاف على `active` لا تُنتج انتقالاً (القرار 3).
 */
export interface SubscriptionActivatedV1 extends SubscriptionEventEnvelope {
  event_type: "subscription.activated";
  event_version: "v1";
  data: {
    driver_public_id: string;
    subscription_id: string;
    from_state?: SubscriptionState | null;
    to_state: "active";
    reason_code: SubscriptionTransitionReason;
    state_sequence: number;
    plan_code: string;
    plan_version: number;
    period_id?: string | null;
    period_source: SubscriptionPeriodSource;
    granted_days: number;
    /** مرجعٌ **مُعتِمٌ** يُنقَل ولا يُفسَّر. `null` حين يكون المصدرُ مكافأةَ إحالة. */
    payment_reference?: string | null;
    expires_at: string;
    occurred_for: string;
  };
}

/**
 * انقضت المُدّة. الحدثُ **أثرُ نبضةٍ** لا أثرُ مؤقّت (القرار 5): الانقضاءُ مُشتَقٌّ من
 * `ends_at ≤ now` وتُحقِّقه `POST /subscriptions/tick`، فإعادةُ تشغيلِ الخدمة لا تُفقِد
 * انقضاءً ولا تُنتج اثنين.
 */
export interface SubscriptionExpiredV1 extends SubscriptionEventEnvelope {
  event_type: "subscription.expired";
  event_version: "v1";
  data: SubscriptionTransitionData;
}

/**
 * انتهت مهلةُ ما بعد الانقضاء فنزل السائقُ إلى `community`: أرضيّةُ الاستحقاقِ لا نهايتُه.
 * والحمولةُ تحمل `plan_version` كي يُفسَّر التوقيتُ بعد سنة (القرار 7).
 */
export interface SubscriptionMovedToCommunityV1 extends SubscriptionEventEnvelope {
  event_type: "subscription.moved_to_community";
  event_version: "v1";
  data: SubscriptionTransitionData;
}

/**
 * تأهّلت إحالة. الحمولةُ تحمل **العدَّ والعتبةَ معاً** لأنّ «تأهّل» بلا رقمين لا
 * يُدافَع عنه ولا يُراجَع. والتأهيلُ ليس منحاً: المكافأةُ حدثٌ ثانٍ (القرار 9).
 */
export interface ReferralQualifiedV1 extends SubscriptionEventEnvelope {
  event_type: "referral.qualified";
  event_version: "v1";
  data: {
    referral_id: string;
    referral_code: string;
    referrer_public_id: string;
    referee_public_id: string;
    /** يُنقَل ولا يُستعلَم عبر الحدّ: **لا مفتاحَ أجنبيّاً** إلى دفتر وقائع السمعة. */
    qualifying_fact_count: number;
    required_fact_count: number;
    plan_code: string;
    plan_version: number;
    occurred_for: string;
  };
}

/**
 * مُنحت مكافأةٌ **بمُدّةٍ في الدفتر** (`granted_period_id`) لا بعدّادٍ زِيد (القرار 9).
 * ويُنشَر مرّةً واحدةً لكلّ إحالةٍ لأنّ `ux_referral_rewards_referral` يمنع الثانية.
 * والمستفيدُ مُسمّىً صراحةً ولا يُستنتَج من الدور.
 */
export interface ReferralRewardedV1 extends SubscriptionEventEnvelope {
  event_type: "referral.rewarded";
  event_version: "v1";
  data: {
    referral_id: string;
    reward_id: string;
    beneficiary_public_id: string;
    granted_period_id: string;
    reward_days: number;
    plan_code: string;
    plan_version: number;
    occurred_for: string;
  };
}

export type SubscriptionDomainEvent =
  | SubscriptionTrialStartedV1
  | SubscriptionActivatedV1
  | SubscriptionExpiredV1
  | SubscriptionMovedToCommunityV1
  | ReferralQualifiedV1
  | ReferralRewardedV1;

export const SUBSCRIPTION_EVENT_TYPES = [
  "subscription.trial_started",
  "subscription.activated",
  "subscription.expired",
  "subscription.moved_to_community",
  "referral.qualified",
  "referral.rewarded",
] as const;
export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number];

/** منتجٌ واحدٌ لكلّ أحداث هذا المجال: خدمةٌ واحدةٌ تملك الاشتراكَ والإحالة (القرار 1). */
export const SUBSCRIPTION_EVENT_PRODUCER = "subscriptions-service";

/**
 * الحقول التي **لا يجوز** أن تظهر في أي حمولة حدث. القائمة أسماءُ مفاتيح كاملة لا
 * أجزاءً منها: `reward_days` مسموح و`amount` ممنوع، والفرقُ هو الفرقُ بين أيّامٍ تُمنَح
 * وبين مالٍ يُحاسَب عليه غيرُنا. وحقولُ المال هنا **قرارُ حدٍّ لا احتياط** (القرار 6):
 * Phase 17 يملك المبلغَ والعملةَ والفاتورة، وهذه الخدمة تنقل مرجعاً مُعتِماً.
 */
export const SUBSCRIPTION_EVENT_FORBIDDEN_FIELDS = [
  "amount",
  "amount_minor",
  "currency",
  "price",
  "total",
  "vat",
  "invoice_id",
  "invoice_number",
  "payment_method",
  "card_last4",
  "iban",
  "comment",
  "note",
  "message",
  "text",
  "display_name",
  "full_name",
  "name",
  "phone",
  "phone_number",
  "lat",
  "lng",
  "latitude",
  "longitude",
  "chat_id",
  "telegram_id",
  "telegram_user_id",
  "channel_user_id",
  "is_fraudster",
] as const;

/**
 * أنواعُ أحداثٍ **ممنوعة** في هذا المجال، لا ناقصة:
 * - العقوبةُ ليست ملكاً لهذه الخدمة (القرار 4): الإيقافُ في `services/drivers` والقرارُ
 *   الإداريّ في Phase 15.
 * - الرفضُ ليس حدثاً (القرار 8): يُقرأ بمُرشِّحٍ على الدفتر.
 * - المالُ ليس حدثاً هنا (القرار 6): Phase 17 يملك دورةَ الحياة الماليّة.
 * والحارس في `events.test.ts` يمنع إضافتها لاحقاً بحسن نيّة.
 */
export const SUBSCRIPTION_FORBIDDEN_EVENT_TYPES = [
  "subscription.driver_suspended",
  "subscription.driver_blocked",
  "subscription.penalty_applied",
  "referral.rejected",
  "referral.fraud_detected",
  "subscription.payment_received",
  "subscription.payment_failed",
  "subscription.invoice_issued",
  "subscription.refunded",
] as const;
