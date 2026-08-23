/**
 * Reputation & Fraud Domain Event types — hand-derived from
 * services/reputation/contracts/events.json (JSON Schema 2020-12).
 *
 * Drift guards read the canonical schema at test time. ADR-014 decision 3: an
 * event is the COMPUTED RESULT of a RECORDED FACT — never a human opinion and
 * never a model score. Every payload therefore carries what makes it
 * reproducible: the fact carries its source event id and per-order sequence, the
 * score carries its ruleset version and fact count, the fraud signal carries its
 * rule, window, observed count and threshold.
 *
 * Decision 7: no event punishes. There is no `reputation.subject_suspended` and
 * there never will be one here — suspension belongs to `services/drivers`
 * (ADR-012 decision 3) and administrative action belongs to Phase 15.
 */
export type ReputationAggregateType =
  | "reputation_fact"
  | "reputation_score"
  | "reputation_rating"
  | "fraud_signal";

/** من تُقاس سمعته. الطرفان لا طرفٌ واحد: قياسُ جانبٍ واحد يُحمّله كلفةَ سوء سلوك الآخر. */
export type ReputationSubjectType = "customer" | "driver";

/**
 * قائمة مُقفلة، كل نوعٍ فيها له حدثٌ منشور يُنتجه اليوم (`order.status_changed` ·
 * `order.assignment_resolved`) أو تقييمٌ مسجَّل. نوعٌ لا مصدر له لا يُضاف: واقعةٌ لا
 * يُنتجها شيء تدعو أوّل من يقرأها أن يجد لها مُنتِجاً.
 */
export type ReputationFactKind =
  | "order_completed"
  | "order_cancelled_by_customer"
  | "order_cancelled_by_driver"
  | "assignment_accepted"
  | "assignment_rejected"
  | "assignment_timed_out"
  | "rating_received";

/** بمفردات محرّك الطلب كما وصلت في الحدث. مرجعٌ لا حُكم. */
export type ReputationActorType = "system" | "customer" | "driver" | "partner" | "admin";

/**
 * رتبةٌ مُشتقّة من النتيجة وعتبات نسخة القواعد. **تسميةٌ تُقرأ ولا تُنفَّذ** (ADR-014
 * القرار 7): `under_watch` لا تُوقف أحداً ولا تحجبه، ومن يبني عليها قراراً يبنيه في
 * خدمته ويملك أثره.
 */
export type ReputationTier = "new" | "standard" | "trusted" | "under_watch";

/**
 * لماذا أُعيد الحساب. من يقرأ سلسلة النتائج يحتاج أن يفرّق بين حسابٍ سبّبته واقعة
 * وحسابٍ سبّبته نبضة وحسابٍ طلبه إنسان: الثلاثة تُقرأ مختلفةً في التدقيق.
 */
export type ReputationRecomputeTrigger = "fact_recorded" | "tick" | "manual_recompute";

/** قائمة مُقفلة تُحصى وتُقارَن، بخلاف نصٍّ حرّ يُقرأ ولا يُقاس (ADR-014 القرار 5). */
export type ReputationRatingReasonCode =
  | "on_time"
  | "late_arrival"
  | "courteous"
  | "poor_conduct"
  | "unsafe_driving"
  | "vehicle_condition"
  | "route_deviation"
  | "no_show";

/**
 * قواعد مُسمّاة على وقائع نملكها فعلاً (ADR-014 القرار 6). لا احتمالٌ إحصائيّ:
 * إشارةٌ تقول «0.87» لا يمكن مراجعتها ولا الردّ عليها.
 */
export type FraudRuleCode =
  | "repeated_customer_cancellation"
  | "repeated_driver_cancellation"
  | "accept_then_abandon"
  | "offer_timeout_streak"
  | "rating_extremity_burst";

export type FraudSeverity = "low" | "medium" | "high";

export interface ReputationEventEnvelope {
  event_id: string;
  event_type: string;
  event_version: string;
  occurred_at: string;
  producer: "reputation-service";
  aggregate: { type: ReputationAggregateType; id: string };
  trace_id?: string | null;
}

/**
 * الحدث الذي تُثبت بوابة خروج الطور 09 وجوده لكل طلبٍ مكتمل. يُنشَر مرّةً واحدة لكل
 * (شخص × نوع × طلب × ترتيب): قيدُ التفرّد في القاعدة يمنع الثانية، فإعادةُ تسليم الحدث
 * الأصلي لا تُنتج واقعةً ثانية ولا نقطةً مضاعفة.
 */
export interface ReputationFactRecordedV1 extends ReputationEventEnvelope {
  event_type: "reputation.fact_recorded";
  event_version: "v1";
  data: {
    fact_id: string;
    subject_type: ReputationSubjectType;
    subject_public_id: string;
    fact_kind: ReputationFactKind;
    order_public_id: string;
    source_event_type: string;
    source_event_id: string;
    source_sequence: number;
    actor_type: ReputationActorType;
    reason_code?: string | null;
    occurred_for: string;
  };
}

/**
 * النتيجة السابقة تعبر مع الجديدة لأنّ «تغيّر إلى 62» بلا «من 71» يُجبر كل مستهلك على
 * أن يحفظ نسخته، ونسخةٌ في مستهلك تتباعد بصمت.
 */
export interface ReputationScoreRecomputedV1 extends ReputationEventEnvelope {
  event_type: "reputation.score_recomputed";
  event_version: "v1";
  data: {
    subject_type: ReputationSubjectType;
    subject_public_id: string;
    ruleset_version: number;
    score_points: number;
    previous_score_points?: number | null;
    tier: ReputationTier;
    fact_count: number;
    computed_through_fact_id?: string | null;
    trigger: ReputationRecomputeTrigger;
    occurred_for: string;
  };
}

/**
 * مفصولٌ عن `score_recomputed` عمداً: النتيجة تتغيّر كل يوم والرتبة تتغيّر نادراً،
 * ومستهلكٌ يهمّه الحدّ لا يجب أن يفلتر ألف حدثٍ ليجد عشرة.
 */
export interface ReputationTierChangedV1 extends ReputationEventEnvelope {
  event_type: "reputation.tier_changed";
  event_version: "v1";
  data: {
    subject_type: ReputationSubjectType;
    subject_public_id: string;
    /** null مرّة واحدة فقط: أوّل نتيجةٍ تُحسب لهذا الشخص. */
    from_tier?: ReputationTier | null;
    to_tier: ReputationTier;
    score_points: number;
    ruleset_version: number;
    occurred_for: string;
  };
}

/**
 * الدرجة ورمزُ السبب يعبران لأنّهما **هما** ما تغيّر؛ ولا تعليق نصّي في العقد أصلاً
 * (ADR-014 القرار 5).
 */
export interface ReputationRatingSubmittedV1 extends ReputationEventEnvelope {
  event_type: "reputation.rating_submitted";
  event_version: "v1";
  data: {
    rating_id: string;
    order_public_id: string;
    rater_type: ReputationSubjectType;
    rater_public_id: string;
    subject_type: ReputationSubjectType;
    subject_public_id: string;
    stars: number;
    reason_code?: ReputationRatingReasonCode | null;
    ruleset_version: number;
    occurred_for: string;
  };
}

/**
 * **ملاحظةٌ لا حُكم**: الحمولة تحمل القاعدة والنافذة والعدد والعتبة كي تكون قابلة
 * للمراجعة، ولا تحمل قراراً ولا توصيةً بعقوبة (ADR-014 القرار 6 · 7).
 */
export interface FraudSignalRaisedV1 extends ReputationEventEnvelope {
  event_type: "reputation.fraud_signal_raised";
  event_version: "v1";
  data: {
    signal_id: string;
    subject_type: ReputationSubjectType;
    subject_public_id: string;
    rule_code: FraudRuleCode;
    severity: FraudSeverity;
    observed_count: number;
    threshold_count: number;
    window_started_at: string;
    window_ended_at: string;
    ruleset_version: number;
    occurred_for: string;
  };
}

export type ReputationDomainEvent =
  | ReputationFactRecordedV1
  | ReputationScoreRecomputedV1
  | ReputationTierChangedV1
  | ReputationRatingSubmittedV1
  | FraudSignalRaisedV1;

export const REPUTATION_EVENT_TYPES = [
  "reputation.fact_recorded",
  "reputation.score_recomputed",
  "reputation.tier_changed",
  "reputation.rating_submitted",
  "reputation.fraud_signal_raised",
] as const;
export type ReputationEventType = (typeof REPUTATION_EVENT_TYPES)[number];

/**
 * الحقول التي **لا يجوز** أن تظهر في أي حمولة حدث. القائمة أسماءُ مفاتيح كاملة لا
 * أجزاءً منها: `comment_count` مسموح و`comment` ممنوع، والفرق هو الفرق بين عدّادٍ
 * يُقاس وبين كلام الناس. والحارس آليّ لأنّ الانضباط اليدويّ ينهار عند أول تعديل مستعجل.
 */
export const REPUTATION_EVENT_FORBIDDEN_FIELDS = [
  "comment",
  "note",
  "body",
  "message",
  "text",
  "review_text",
  "display_name",
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
] as const;

/**
 * أنواعُ أحداثٍ **ممنوعة** في هذا المجال، لا ناقصة. الخدمة تُعلن حقائق ولا تعاقب
 * (ADR-014 القرار 7)، فحدثٌ يقول «أوقفتُ فلاناً» يجعل مستهلكاً يفترض أنّ السمعة تحجب
 * ويبني عليه سلوكاً لا مالك له. والحارس في `events.test.ts` يمنع إضافتها لاحقاً.
 */
export const REPUTATION_FORBIDDEN_EVENT_TYPES = [
  "reputation.subject_suspended",
  "reputation.subject_banned",
  "reputation.subject_blocked",
  "reputation.fraud_confirmed",
  "reputation.penalty_applied",
] as const;
