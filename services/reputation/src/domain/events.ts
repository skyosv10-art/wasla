/**
 * مصانعُ الأحداث — الشكلُ على السلك، بلا نشرٍ ولا ناقل.
 *
 * الخمسةُ في `services/reputation/contracts/events.json`، وحمولةُ كلٍّ منها
 * `additionalProperties: false`، فحقلٌ زائدٌ يُفشل تحقّقَ مستهلكٍ صارم. ولذلك تُبنى
 * الحمولةُ هنا بحقولٍ معدودةٍ صريحة ولا تُنسَخ من كائنِ صفٍّ بـ`...spread`: النسخُ
 * الشامل كان سيُهرّب `recordedAt` و`traceId` و`nextRecomputeAt` إلى السلك بأوّل حقلٍ
 * يُضاف إلى الصفّ، ولا شيء في `tsc` يمنع ذلك.
 *
 * ## `occurred_for` — الحقلُ الذي يجعل إعادة التشغيل غير مرئية
 *
 * كل حمولةٍ تُلزم `occurred_for`: **اللحظةُ التي صار فيها الأمر حقيقةً**، لا لحظةُ
 * اكتشافنا له. فحين تُسجَّل واقعةُ إكمالٍ وقعت 12:02 في نبضةٍ ركضت 12:05، يحمل الحدث
 * **12:02**. تأخّرُ الناقل أو إعادةُ التشغيل يُؤخّران الاكتشاف ولا يُغيّران متى وقع الشيء،
 * ومستهلكٌ يبني نافذةً زمنيةً على `occurred_at` (زمنُ الإصدار) يُنتج تقريراً يتحرّك بحسب
 * صحّة خادمنا.
 *
 * ## ما لا يُنشَر
 *
 * لا حدثَ لهبوط نتيجةٍ («`reputation.score_dropped`») ولا لتجاوز عتبةٍ إداريّة: نتيجةٌ
 * منخفضة حصيلةُ حسابٍ لا واقعةَ تُعلن. ولا حدثَ للبتّ في إشارة: لا مسارَ له أصلاً
 * (ADR-014 القرار 6). ولا اسمَ ولا هاتفَ ولا إحداثيةَ ولا مُعرّفَ قناةٍ في أي حمولة، ولا
 * نصَّ تقييمٍ لأنّ العقد لا يعرف حقلاً كهذا (القرار 5).
 *
 * ## لا نشرَ هنا
 *
 * هذه دوالُّ بناءٍ نقيّة تُعيد كائناً. مَن يكتبه إلى `reputation_outbox` هو حالةُ
 * الاستخدام في نفس المعاملة، ومَن ينشره من الصندوق ناشرٌ ليس من هذه المرحلة (نفسُ الدَّين
 * المُعلَن في الأطوار 06 و07 و08). لا `fetch` ولا عميلَ ناقلٍ في هذه الحزمة بحال.
 */

import type {
  FraudRuleCode,
  FraudSeverity,
  ReputationFactKind,
  ReputationRatingReasonCode,
  ReputationRecomputeTrigger,
  ReputationSubjectType,
  ReputationTier,
} from "./contract-sets.js";
import type { ReputationActorType } from "./model.js";

export const REPUTATION_EVENT_PRODUCER = "reputation-service" as const;

export const REPUTATION_AGGREGATE_TYPES = [
  "reputation_fact",
  "reputation_score",
  "reputation_rating",
  "fraud_signal",
] as const;
export type ReputationAggregateType = (typeof REPUTATION_AGGREGATE_TYPES)[number];

/**
 * ما يجب أن يُمرّره المستدعي لكل حدث: مُعرّفُ الحدث ولحظةُ إصداره.
 *
 * الاثنان **مُمرَّران** لا مُولَّدان داخلياً: `uuid()` داخل مصنعٍ يجعل الحدثَ غيرَ قابلٍ
 * للاختبار بمساواةٍ تامّة، و`Date.now()` داخله يكسر نقاء المجال كلَّه.
 */
export interface EventMeta {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly traceId?: string | null;
}

interface Envelope {
  readonly event_id: string;
  readonly event_type: string;
  readonly event_version: "v1";
  readonly occurred_at: string;
  readonly producer: typeof REPUTATION_EVENT_PRODUCER;
  readonly aggregate: { readonly type: ReputationAggregateType; readonly id: string };
  readonly trace_id: string | null;
}

function envelope(
  meta: EventMeta,
  eventType: string,
  aggregateType: ReputationAggregateType,
  aggregateId: string,
): Envelope {
  return {
    event_id: meta.eventId,
    event_type: eventType,
    event_version: "v1",
    occurred_at: meta.occurredAt,
    producer: REPUTATION_EVENT_PRODUCER,
    aggregate: { type: aggregateType, id: aggregateId },
    trace_id: meta.traceId ?? null,
  };
}

// ---------------------------------------------------------------------------
// reputation.fact_recorded
// ---------------------------------------------------------------------------

export interface FactRecordedEvent extends Envelope {
  readonly event_type: "reputation.fact_recorded";
  readonly data: {
    readonly fact_id: string;
    readonly subject_type: ReputationSubjectType;
    readonly subject_public_id: string;
    readonly fact_kind: ReputationFactKind;
    readonly order_public_id: string;
    readonly source_event_type: string;
    readonly source_event_id: string;
    readonly source_sequence: number;
    readonly actor_type: ReputationActorType;
    readonly reason_code: string | null;
    readonly occurred_for: string;
  };
}

/**
 * `occurred_for` = `occurredAt` الواقعة، لا لحظةُ تسجيلها.
 *
 * هذا هو الفرق الذي يجعل حدثاً وصل متأخّراً يومين يُبنى عليه تقريرٌ صحيح. ويؤكّده اختبارٌ
 * صريح، لأنّه الفرقُ الذي يختفي بهدوءٍ أوّلَ ما «يُبسّط» أحدٌ مصنعاً ليستعمل اللحظة التي
 * بين يديه.
 */
export function factRecorded(input: {
  readonly meta: EventMeta;
  readonly factId: string;
  readonly subjectType: ReputationSubjectType;
  readonly subjectPublicId: string;
  readonly factKind: ReputationFactKind;
  readonly orderPublicId: string;
  readonly sourceEventType: string;
  readonly sourceEventId: string;
  readonly sourceSequence: number;
  readonly actorType: ReputationActorType;
  readonly reasonCode: string | null;
  readonly factOccurredAt: string;
}): FactRecordedEvent {
  return {
    ...envelope(input.meta, "reputation.fact_recorded", "reputation_fact", input.factId),
    event_type: "reputation.fact_recorded",
    data: {
      fact_id: input.factId,
      subject_type: input.subjectType,
      subject_public_id: input.subjectPublicId,
      fact_kind: input.factKind,
      order_public_id: input.orderPublicId,
      source_event_type: input.sourceEventType,
      source_event_id: input.sourceEventId,
      source_sequence: input.sourceSequence,
      actor_type: input.actorType,
      reason_code: input.reasonCode,
      occurred_for: input.factOccurredAt,
    },
  };
}

// ---------------------------------------------------------------------------
// reputation.score_recomputed
// ---------------------------------------------------------------------------

export interface ScoreRecomputedEvent extends Envelope {
  readonly event_type: "reputation.score_recomputed";
  readonly data: {
    readonly subject_type: ReputationSubjectType;
    readonly subject_public_id: string;
    readonly ruleset_version: number;
    readonly score_points: number;
    readonly previous_score_points: number | null;
    readonly tier: ReputationTier;
    readonly fact_count: number;
    readonly computed_through_fact_id: string | null;
    readonly trigger: ReputationRecomputeTrigger;
    readonly occurred_for: string;
  };
}

/**
 * `occurred_for` = لحظةُ الحساب (`computedAt`).
 *
 * وهي هنا **نفسُها** اللحظة التي صار فيها الرقم حقيقةً: النتيجةُ ليست شيئاً وقع في
 * العالم ثم بلغَنا، بل شيءٌ نحن أنشأناه بحسابٍ عند لحظةٍ بعينها. ووجودُ الحقل مع ذلك
 * إلزاميٌّ في العقد كي لا يحتاج المستهلك أن يعرف أيَّ الأحداث يُشتقّ من العالم وأيّها من
 * حسابنا ليعرف أيَّ حقلٍ يقرأ.
 *
 * و`previous_score_points` قد يكون `null`: أوّلُ حسابٍ لا سابقَ له. `0` بدلاً من الغياب
 * كان سيجعل أوّلَ حسابٍ يُقرأ كهبوطٍ من الصفر.
 */
export function scoreRecomputed(input: {
  readonly meta: EventMeta;
  readonly subjectType: ReputationSubjectType;
  readonly subjectPublicId: string;
  readonly rulesetVersion: number;
  readonly scorePoints: number;
  readonly previousScorePoints: number | null;
  readonly tier: ReputationTier;
  readonly factCount: number;
  readonly computedThroughFactId: string | null;
  readonly trigger: ReputationRecomputeTrigger;
  readonly computedAt: string;
}): ScoreRecomputedEvent {
  return {
    ...envelope(
      input.meta,
      "reputation.score_recomputed",
      "reputation_score",
      `${input.subjectType}:${input.subjectPublicId}`,
    ),
    event_type: "reputation.score_recomputed",
    data: {
      subject_type: input.subjectType,
      subject_public_id: input.subjectPublicId,
      ruleset_version: input.rulesetVersion,
      score_points: input.scorePoints,
      previous_score_points: input.previousScorePoints,
      tier: input.tier,
      fact_count: input.factCount,
      computed_through_fact_id: input.computedThroughFactId,
      trigger: input.trigger,
      occurred_for: input.computedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// reputation.tier_changed
// ---------------------------------------------------------------------------

export interface TierChangedEvent extends Envelope {
  readonly event_type: "reputation.tier_changed";
  readonly data: {
    readonly subject_type: ReputationSubjectType;
    readonly subject_public_id: string;
    readonly from_tier: ReputationTier | null;
    readonly to_tier: ReputationTier;
    readonly score_points: number;
    readonly ruleset_version: number;
    readonly occurred_for: string;
  };
}

/**
 * حدثٌ **منفصل** عن `score_recomputed` عن قصد.
 *
 * النتيجةُ تُعاد حسابها كل يومٍ لكل من له دفتر، والرتبةُ تتغيّر مرّاتٍ في عمر الحساب.
 * مستهلكٌ يريد «تغيّرت رتبة» — لوحةُ الإدارة، أو طورُ الاشتراكات لاحقاً — لا يجوز أن
 * يُلزَم بترشيح تيّارٍ يومي كامل ليجد فيه ما يهمّه، وإلّا فهو يشترك على كل شيءٍ ويُرشِّح
 * تسعةً وتسعين في المئة.
 *
 * و`from_tier` قابلٌ للغياب: أوّلُ رتبةٍ لشخصٍ لا سابقَ لها.
 */
export function tierChanged(input: {
  readonly meta: EventMeta;
  readonly subjectType: ReputationSubjectType;
  readonly subjectPublicId: string;
  readonly fromTier: ReputationTier | null;
  readonly toTier: ReputationTier;
  readonly scorePoints: number;
  readonly rulesetVersion: number;
  readonly computedAt: string;
}): TierChangedEvent {
  return {
    ...envelope(
      input.meta,
      "reputation.tier_changed",
      "reputation_score",
      `${input.subjectType}:${input.subjectPublicId}`,
    ),
    event_type: "reputation.tier_changed",
    data: {
      subject_type: input.subjectType,
      subject_public_id: input.subjectPublicId,
      from_tier: input.fromTier,
      to_tier: input.toTier,
      score_points: input.scorePoints,
      ruleset_version: input.rulesetVersion,
      occurred_for: input.computedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// reputation.rating_submitted
// ---------------------------------------------------------------------------

export interface RatingSubmittedEvent extends Envelope {
  readonly event_type: "reputation.rating_submitted";
  readonly data: {
    readonly rating_id: string;
    readonly order_public_id: string;
    readonly rater_type: ReputationSubjectType;
    readonly rater_public_id: string;
    readonly subject_type: ReputationSubjectType;
    readonly subject_public_id: string;
    readonly stars: number;
    readonly reason_code: ReputationRatingReasonCode | null;
    readonly ruleset_version: number;
    readonly occurred_for: string;
  };
}

export function ratingSubmitted(input: {
  readonly meta: EventMeta;
  readonly ratingId: string;
  readonly orderPublicId: string;
  readonly raterType: ReputationSubjectType;
  readonly raterPublicId: string;
  readonly subjectType: ReputationSubjectType;
  readonly subjectPublicId: string;
  readonly stars: number;
  readonly reasonCode: ReputationRatingReasonCode | null;
  readonly rulesetVersion: number;
  readonly submittedAt: string;
}): RatingSubmittedEvent {
  return {
    ...envelope(input.meta, "reputation.rating_submitted", "reputation_rating", input.ratingId),
    event_type: "reputation.rating_submitted",
    data: {
      rating_id: input.ratingId,
      order_public_id: input.orderPublicId,
      rater_type: input.raterType,
      rater_public_id: input.raterPublicId,
      subject_type: input.subjectType,
      subject_public_id: input.subjectPublicId,
      stars: input.stars,
      reason_code: input.reasonCode,
      ruleset_version: input.rulesetVersion,
      occurred_for: input.submittedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// reputation.fraud_signal_raised
// ---------------------------------------------------------------------------

export interface FraudSignalRaisedEvent extends Envelope {
  readonly event_type: "reputation.fraud_signal_raised";
  readonly data: {
    readonly signal_id: string;
    readonly subject_type: ReputationSubjectType;
    readonly subject_public_id: string;
    readonly rule_code: FraudRuleCode;
    readonly severity: FraudSeverity;
    readonly observed_count: number;
    readonly threshold_count: number;
    readonly window_started_at: string;
    readonly window_ended_at: string;
    readonly ruleset_version: number;
    readonly occurred_for: string;
  };
}

/**
 * `occurred_for` = **حدُّ النافذة** (`window_ended_at`)، لا لحظةُ رفع الإشارة.
 *
 * النمطُ صار حقيقةً في نافذته هو، والنبضةُ التي رصدَته قد تركض بعدها بساعاتٍ أو بعد
 * إعادة تشغيلٍ في اليوم التالي. ومستهلكٌ يُرتّب الإشارات بـ`raised_at` يقرأ ترتيبَ
 * نبضاتنا؛ ومن يُرتّبها بـ`occurred_for` يقرأ ترتيبَ ما وقع.
 *
 * ولا حقلَ في هذه الحمولة يقول «افعل شيئاً»: لا `action` ولا `suspend` ولا `until`. حدثٌ
 * كهذا لا يأمر أحداً بشيء (القرار 7).
 */
export function fraudSignalRaised(input: {
  readonly meta: EventMeta;
  readonly signalId: string;
  readonly subjectType: ReputationSubjectType;
  readonly subjectPublicId: string;
  readonly ruleCode: FraudRuleCode;
  readonly severity: FraudSeverity;
  readonly observedCount: number;
  readonly thresholdCount: number;
  readonly windowStartedAt: string;
  readonly windowEndedAt: string;
  readonly rulesetVersion: number;
}): FraudSignalRaisedEvent {
  return {
    ...envelope(input.meta, "reputation.fraud_signal_raised", "fraud_signal", input.signalId),
    event_type: "reputation.fraud_signal_raised",
    data: {
      signal_id: input.signalId,
      subject_type: input.subjectType,
      subject_public_id: input.subjectPublicId,
      rule_code: input.ruleCode,
      severity: input.severity,
      observed_count: input.observedCount,
      threshold_count: input.thresholdCount,
      window_started_at: input.windowStartedAt,
      window_ended_at: input.windowEndedAt,
      ruleset_version: input.rulesetVersion,
      occurred_for: input.windowEndedAt,
    },
  };
}

export type ReputationDomainEvent =
  | FactRecordedEvent
  | ScoreRecomputedEvent
  | TierChangedEvent
  | RatingSubmittedEvent
  | FraudSignalRaisedEvent;
