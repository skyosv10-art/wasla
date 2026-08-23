/**
 * الموضعُ الوحيد الذي يصير فيه نموذجُ المجال (`camelCase`) شكلَ السلك (`snake_case`)
 * المُعلَن في `contracts/api.openapi.yml` (Phase 09 · المراجعة 4/6).
 *
 * ## لماذا موضعٌ واحد
 *
 * البديلُ أن يظهر مفتاحُ `snake_case` في كل موضعٍ تُبنى فيه استجابة، فيصير يومُ إعادة
 * تسمية حقلٍ يوماً تكتمل فيه التسميةُ في أربعة ملفاتٍ من خمسة. ومحوّلٌ يعيش وحده يمكن
 * مقارنتُه بقوائم `required` في العقد على القرص — وهو ما يفعله
 * `__tests__/http-drift.test.ts`، فيفشل البناءُ عند تغيير عقدٍ بلا تغيير محوّل، لا يفشل
 * العميل.
 *
 * ## لماذا واجهاتٌ صريحةٌ لا `Record<string, unknown>`
 *
 * لأنّ المُترجم يصير حينها هو أوّلَ من يقرأ العقد: حقلٌ يُنسى في محوّلٍ يُكسر البناءَ فوراً،
 * وحقلٌ يُزاد بلا إعلانٍ في العقد لا يمرّ من هنا صامتاً. والقوائمُ `readonly` كي لا يُعدَّل
 * ما خرج للسلك بعد بنائه.
 *
 * ## ما لا يخرج من هنا
 *
 * لا `traceId` في أي صفّ منشور: مُعرّفُ التتبّع أثرٌ تشغيليّ يعيش في السجلّ وفي
 * `ErrorResponse.trace_id`، وإدراجُه في صفوف الدفتر كان سيجعله حمولةَ عملٍ يتعاقد عليها
 * مستهلكٌ ثم يُقرأ كدليلٍ على شيءٍ لا يقوله. ولا حقلَ نصٍّ حرّ (القرار 5 في ADR-014)، ولا
 * `response_status`/`response_body` من سجلّ المعالجة الواحدة: ذاك جوابٌ **يُعاد كما هو**
 * لا صفٌّ يُنشَر.
 */

import type {
  FraudSignalRow,
  ReputationFactRow,
  ReputationFraudThresholdRow,
  ReputationRatingRow,
  ReputationRulesetRow,
  ReputationRuleWeightRow,
  ReputationScoreRow,
} from "./domain/model.js";
import type { TickResult } from "./use-cases/run-tick.js";

// ---------------------------------------------------------------------------
// الوقائع
// ---------------------------------------------------------------------------

export interface ReputationFactWire {
  readonly id: string;
  readonly subject_type: string;
  readonly subject_public_id: string;
  readonly fact_kind: string;
  readonly order_public_id: string;
  readonly source_event_type: string;
  readonly source_event_id: string;
  readonly source_sequence: number;
  readonly actor_type: string;
  readonly reason_code: string | null;
  readonly occurred_at: string;
  readonly recorded_at: string;
}

export function factToWire(fact: ReputationFactRow): ReputationFactWire {
  return {
    id: fact.id,
    subject_type: fact.subjectType,
    subject_public_id: fact.subjectPublicId,
    fact_kind: fact.factKind,
    order_public_id: fact.orderPublicId,
    source_event_type: fact.sourceEventType,
    source_event_id: fact.sourceEventId,
    source_sequence: fact.sourceSequence,
    actor_type: fact.actorType,
    reason_code: fact.reasonCode,
    occurred_at: fact.occurredAt,
    recorded_at: fact.recordedAt,
  };
}

// ---------------------------------------------------------------------------
// النتيجة
// ---------------------------------------------------------------------------

export interface ReputationScoreWire {
  readonly subject_type: string;
  readonly subject_public_id: string;
  readonly ruleset_version: number;
  readonly score_points: number;
  readonly tier: string;
  readonly fact_count: number;
  readonly computed_through_fact_id: string | null;
  readonly computed_at: string;
  readonly next_recompute_at: string;
}

export function scoreToWire(score: ReputationScoreRow): ReputationScoreWire {
  return {
    subject_type: score.subjectType,
    subject_public_id: score.subjectPublicId,
    ruleset_version: score.rulesetVersion,
    score_points: score.scorePoints,
    tier: score.tier,
    fact_count: score.factCount,
    computed_through_fact_id: score.computedThroughFactId,
    computed_at: score.computedAt,
    next_recompute_at: score.nextRecomputeAt,
  };
}

// ---------------------------------------------------------------------------
// التقييمات
// ---------------------------------------------------------------------------

export interface ReputationRatingWire {
  readonly id: string;
  readonly order_public_id: string;
  readonly rater_type: string;
  readonly rater_public_id: string;
  readonly subject_type: string;
  readonly subject_public_id: string;
  readonly stars: number;
  readonly reason_code: string | null;
  readonly ruleset_version: number;
  readonly submitted_at: string;
}

export function ratingToWire(rating: ReputationRatingRow): ReputationRatingWire {
  return {
    id: rating.id,
    order_public_id: rating.orderPublicId,
    rater_type: rating.raterType,
    rater_public_id: rating.raterPublicId,
    subject_type: rating.subjectType,
    subject_public_id: rating.subjectPublicId,
    stars: rating.stars,
    reason_code: rating.reasonCode,
    ruleset_version: rating.rulesetVersion,
    submitted_at: rating.submittedAt,
  };
}

// ---------------------------------------------------------------------------
// إشارات الاحتيال
// ---------------------------------------------------------------------------

export interface FraudSignalWire {
  readonly id: string;
  readonly subject_type: string;
  readonly subject_public_id: string;
  readonly rule_code: string;
  readonly severity: string;
  readonly observed_count: number;
  readonly threshold_count: number;
  readonly window_started_at: string;
  readonly window_ended_at: string;
  readonly ruleset_version: number;
  readonly raised_at: string;
}

/**
 * إشارةٌ تُنشَر كما هي: قاعدةٌ مُسمّاة وعتبةٌ ومُشاهَدٌ ونافذة.
 *
 * ولا حقلَ «احتمال» ولا «درجة خطر» ولا وسمَ شخصٍ: الإشارةُ تقول «هذه القاعدة تجاوزت
 * عتبتَها في هذه النافذة»، ومن يقرؤها يرى بنفسه ما رأته. وهذا هو الفرقُ بين إشارةٍ
 * قابلةٍ للمراجعة وحُكمٍ لا مالكَ له (القرار 7 في ADR-014).
 */
export function fraudSignalToWire(signal: FraudSignalRow): FraudSignalWire {
  return {
    id: signal.id,
    subject_type: signal.subjectType,
    subject_public_id: signal.subjectPublicId,
    rule_code: signal.ruleCode,
    severity: signal.severity,
    observed_count: signal.observedCount,
    threshold_count: signal.thresholdCount,
    window_started_at: signal.windowStartedAt,
    window_ended_at: signal.windowEndedAt,
    ruleset_version: signal.rulesetVersion,
    raised_at: signal.raisedAt,
  };
}

// ---------------------------------------------------------------------------
// نسخة القواعد
// ---------------------------------------------------------------------------

export interface ReputationRuleWeightWire {
  readonly subject_type: string;
  readonly fact_kind: string;
  readonly weight_points: number;
}

export interface ReputationFraudThresholdWire {
  readonly rule_code: string;
  readonly subject_type: string;
  readonly threshold_count: number;
  readonly severity: string;
}

export interface ReputationRulesetWire {
  readonly ruleset_version: number;
  readonly label: string;
  readonly score_floor: number;
  readonly score_ceiling: number;
  readonly starting_score: number;
  readonly min_facts_for_score: number;
  readonly decay_half_life_days: number;
  readonly tier_standard_at: number;
  readonly tier_trusted_at: number;
  readonly tier_under_watch_below: number;
  readonly rating_window_hours: number;
  readonly fraud_window_days: number;
  readonly recompute_interval_hours: number;
  readonly is_frozen: boolean;
  readonly weights: readonly ReputationRuleWeightWire[];
  readonly fraud_thresholds: readonly ReputationFraudThresholdWire[];
}

/**
 * النسخةُ تُنشَر **كاملةً** بأوزانها وعتباتها.
 *
 * لا `rulesetVersion` داخل كل وزنٍ في السلك: هو مُعلَنٌ مرّةً في الأعلى، وتكرارُه في مئة
 * صفٍّ كان سيجعل حمولةً واحدةً تحمل مئةَ نسخةٍ من حقيقةٍ واحدة تتفارق عند أوّل خطأ
 * تحرير. والعقدُ يقول ذلك: `ReputationRuleWeight` لا حقلَ نسخةٍ فيه.
 *
 * ونشرُ الأحكام كاملةً هو ما يجعل رقمَ الأمس قابلاً للتفسير: من يرى `score_points` يقدر
 * أن يقرأ الأوزان التي أنتجته، بلا أن يطلب من أحدٍ أن يشرحها له.
 */
export function rulesetToWire(ruleset: ReputationRulesetRow): ReputationRulesetWire {
  return {
    ruleset_version: ruleset.rulesetVersion,
    label: ruleset.label,
    score_floor: ruleset.scoreFloor,
    score_ceiling: ruleset.scoreCeiling,
    starting_score: ruleset.startingScore,
    min_facts_for_score: ruleset.minFactsForScore,
    decay_half_life_days: ruleset.decayHalfLifeDays,
    tier_standard_at: ruleset.tierStandardAt,
    tier_trusted_at: ruleset.tierTrustedAt,
    tier_under_watch_below: ruleset.tierUnderWatchBelow,
    rating_window_hours: ruleset.ratingWindowHours,
    fraud_window_days: ruleset.fraudWindowDays,
    recompute_interval_hours: ruleset.recomputeIntervalHours,
    is_frozen: ruleset.isFrozen,
    weights: ruleset.weights.map(weightToWire),
    fraud_thresholds: ruleset.fraudThresholds.map(thresholdToWire),
  };
}

function weightToWire(weight: ReputationRuleWeightRow): ReputationRuleWeightWire {
  return {
    subject_type: weight.subjectType,
    fact_kind: weight.factKind,
    weight_points: weight.weightPoints,
  };
}

function thresholdToWire(
  threshold: ReputationFraudThresholdRow,
): ReputationFraudThresholdWire {
  return {
    rule_code: threshold.ruleCode,
    subject_type: threshold.subjectType,
    threshold_count: threshold.thresholdCount,
    severity: threshold.severity,
  };
}

// ---------------------------------------------------------------------------
// النبضة والصحّة
// ---------------------------------------------------------------------------

export interface TickResultWire {
  readonly ran_at: string;
  readonly scores_recomputed: number;
  readonly tiers_changed: number;
  readonly fraud_signals_raised: number;
  readonly failures: number;
}

/**
 * `failures` يُعدّ ولا يُرمى.
 *
 * النبضةُ عمليّةٌ جماعية، ورفعُ خطأٍ لأجل شخصٍ واحد كان سيُوقف بقيّةَ العمل ويُخفي الفشلَ
 * عن العدّاد الذي يُراقَب. ولذلك تُعاد `200` ومعها الرقمُ، ويظلّ الفشلُ مرئيّاً.
 */
export function tickResultToWire(result: TickResult): TickResultWire {
  return {
    ran_at: result.ranAt,
    scores_recomputed: result.scoresRecomputed,
    tiers_changed: result.tiersChanged,
    fraud_signals_raised: result.fraudSignalsRaised,
    failures: result.failures,
  };
}

export interface HealthStatusWire {
  readonly status: "ok" | "degraded";
  readonly persistence: "postgres" | "memory";
  readonly last_tick_at: string | null;
}

/**
 * الصحّةُ تقول ثلاثةَ أشياءَ تُقرأ آلياً ولا شيءَ رابعاً.
 *
 * و`memory` تعني `degraded` لا `ok`: عمليّةٌ تعمل بذاكرةٍ تُجيب صحيحاً وتنسى كلَّ شيءٍ عند
 * أوّل إعادة تشغيل، فردُّ `ok` عليها كان سيجعل مراقبةً خضراءَ تُغطّي فقدانَ دفترٍ كامل.
 * و`last_tick_at` لهذه العمليّة وحدها: لا يُقرأ من القاعدة كي لا يُفهم كأنّه ضمانُ نبضةٍ
 * على مستوى العنقود، وذاك ما لا تعرفه عمليّةٌ واحدة.
 */
export function healthToWire(input: {
  readonly persistence: "postgres" | "memory";
  readonly lastTickAt: string | null;
}): HealthStatusWire {
  return {
    status: input.persistence === "postgres" ? "ok" : "degraded",
    persistence: input.persistence,
    last_tick_at: input.lastTickAt,
  };
}
