/**
 * قيودُ القاعدة، مُفروضةً في الذاكرة **بأسمائها نفسها**.
 *
 * كلُّ قيدٍ مُسمّى في `services/reputation/contracts/schema.sql` له هنا دالّةُ فرضٍ
 * واحدة، واسمُ القيد يُنقل حرفياً إلى `details.constraint` في الخطأ. وليست هذه زينة:
 *
 *   1. **مطابقةُ المُهيئات في المراجعة 3/6** تحتاج أن يرفض مُهيئُ الذاكرة ما ترفضه
 *      Postgres، وبنفس الاسم، وإلّا صارت «مخزنُ الذاكرة يُحاكي القيود» دعوى لا فحصاً.
 *      حزمةُ الاختبارات ستركض على المُهيئين معاً وتؤكّد الرمز **والاسم**.
 *   2. **العثورُ على خطّ الدفاع الثاني** (`errors.md` §القاعدة البند 6): من يقرأ خطأً
 *      يحمل `ux_reputation_facts_source` يعرف أنّ القاعدة تحرس الأمر أيضاً، فلا يفترض
 *      أنّ الحدَّ يعيش في TypeScript وحده ويحذفه وهو يظنّ أنّه يُزيل تكراراً.
 *
 * ## `ENFORCED_CONSTRAINTS` والحارسُ السلبيّ
 *
 * `ENFORCED_CONSTRAINTS` أدناه قائمةٌ **آليّة** يقرؤها اختبارُ انحرافٍ يستخرج كلّ
 * `CONSTRAINT <name>` من الـDDL **بعد حذف التعليقات** ويؤكّد أنّ كل اسمٍ مفروضٌ هنا.
 * وقراءةُ السطح الآليّ لا النثر مقصودة (HANDOFF §16-ج): حارسٌ يقرأ شرحاً يجعل أرخصَ
 * طريقةٍ لتخضير الاختبار هي حذفَ الشرح.
 *
 * وقيدٌ يُضاف إلى الـDDL بلا فرضٍ هنا يُفشل ذلك الاختبار، فلا يمرّ صفٌّ مستحيلٌ في
 * الذاكرة ويُكتشف أوّلَ مرّةٍ في Postgres.
 */

import { constraintViolated } from "../domain/errors.js";
import type {
  FraudSignalRow,
  ReputationFactRow,
  ReputationRatingRow,
  ReputationRulesetRow,
  ReputationScoreRow,
} from "../domain/model.js";
import { toEpochMillis } from "../domain/time.js";

/**
 * أسماءُ كل قيدٍ مُسمّى في `schema.sql` يفرضه هذا الملف.
 *
 * الترتيبُ ترتيبُ ظهورها في الـDDL كي تُقارَن القائمتان بالعين أيضاً.
 */
export const ENFORCED_CONSTRAINTS = [
  "ck_reputation_rulesets_score_bounds",
  "ck_reputation_rulesets_start_in_bounds",
  "ck_reputation_rulesets_tier_order",
  "pk_reputation_rule_weights",
  "pk_reputation_fraud_thresholds",
  "ux_reputation_facts_source",
  "pk_reputation_scores",
  "ck_reputation_scores_non_negative",
  "ck_reputation_scores_new_has_no_history",
  "ux_reputation_ratings_order_pair",
  "ck_reputation_ratings_no_self",
  "ck_reputation_ratings_cross_side",
  "ck_fraud_signals_window_order",
  "ck_fraud_signals_over_threshold",
  "ux_fraud_signals_rule_window",
] as const;

export type EnforcedConstraint = (typeof ENFORCED_CONSTRAINTS)[number];

/** رمي خطأٍ باسم القيد. الموضعُ الوحيد الذي تُسمّى فيه القيودُ في المُهيئ. */
export function violate(constraint: EnforcedConstraint): never {
  throw constraintViolated(constraint);
}

// ---------------------------------------------------------------------------
// reputation_rulesets · reputation_rule_weights · reputation_fraud_thresholds
// ---------------------------------------------------------------------------

export function enforceRulesetConstraints(row: ReputationRulesetRow): ReputationRulesetRow {
  if (!(row.scoreCeiling > row.scoreFloor)) violate("ck_reputation_rulesets_score_bounds");
  if (row.startingScore < row.scoreFloor || row.startingScore > row.scoreCeiling) {
    violate("ck_reputation_rulesets_start_in_bounds");
  }
  if (!(row.tierTrustedAt > row.tierStandardAt) || !(row.tierUnderWatchBelow <= row.tierStandardAt)) {
    violate("ck_reputation_rulesets_tier_order");
  }

  // pk_reputation_rule_weights = (ruleset_version, subject_type, fact_kind)
  const weightKeys = new Set<string>();
  for (const weight of row.weights) {
    const key = `${weight.rulesetVersion}|${weight.subjectType}|${weight.factKind}`;
    if (weightKeys.has(key)) violate("pk_reputation_rule_weights");
    weightKeys.add(key);
  }

  // pk_reputation_fraud_thresholds = (ruleset_version, rule_code)
  const thresholdKeys = new Set<string>();
  for (const threshold of row.fraudThresholds) {
    const key = `${threshold.rulesetVersion}|${threshold.ruleCode}`;
    if (thresholdKeys.has(key)) violate("pk_reputation_fraud_thresholds");
    thresholdKeys.add(key);
  }

  return row;
}

// ---------------------------------------------------------------------------
// reputation_facts
// ---------------------------------------------------------------------------

/** مفتاحُ `ux_reputation_facts_source` بأعمدته وترتيبها كما في الـDDL. */
export function factSourceUniqueKey(row: {
  readonly subjectType: string;
  readonly subjectPublicId: string;
  readonly factKind: string;
  readonly orderPublicId: string;
  readonly sourceSequence: number;
}): string {
  return [
    row.subjectType,
    row.subjectPublicId,
    row.factKind,
    row.orderPublicId,
    String(row.sourceSequence),
  ].join("|");
}

/**
 * تفرّدُ مصدر الواقعة.
 *
 * يُنادى **بعد** أن تكون حالةُ الاستخدام قد قرّرت أنّ هذه ليست إعادةَ تسليمٍ بنفس الحمولة.
 * الوصولُ إليه يعني صفّاً ثانياً بنفس المفتاح، وهو ما يُضاعف وزنَ نقطةٍ بلا أن يعرف أحد.
 */
export function enforceFactSourceUnique(
  existing: ReputationFactRow | null,
): void {
  if (existing !== null) violate("ux_reputation_facts_source");
}

// ---------------------------------------------------------------------------
// reputation_scores
// ---------------------------------------------------------------------------

/** مفتاحُ `pk_reputation_scores` = (subject_type, subject_public_id). */
export function scorePrimaryKey(row: {
  readonly subjectType: string;
  readonly subjectPublicId: string;
}): string {
  return `${row.subjectType}|${row.subjectPublicId}`;
}

export function enforceScoreConstraints(row: ReputationScoreRow): ReputationScoreRow {
  if (row.scorePoints < 0) violate("ck_reputation_scores_non_negative");
  if (row.factCount < 0) violate("ck_reputation_scores_non_negative");
  // tier <> 'new' OR fact_count = 0 OR computed_through_fact_id IS NOT NULL
  if (row.tier === "new" && row.factCount !== 0 && row.computedThroughFactId === null) {
    violate("ck_reputation_scores_new_has_no_history");
  }
  return row;
}

// ---------------------------------------------------------------------------
// reputation_ratings
// ---------------------------------------------------------------------------

/** مفتاحُ `ux_reputation_ratings_order_pair` = (order, rater, subject). */
export function ratingOrderPairKey(row: {
  readonly orderPublicId: string;
  readonly raterPublicId: string;
  readonly subjectPublicId: string;
}): string {
  return `${row.orderPublicId}|${row.raterPublicId}|${row.subjectPublicId}`;
}

export function enforceRatingConstraints(
  row: ReputationRatingRow,
  existing: ReputationRatingRow | null,
): ReputationRatingRow {
  if (existing !== null) violate("ux_reputation_ratings_order_pair");
  if (row.raterPublicId === row.subjectPublicId) violate("ck_reputation_ratings_no_self");
  if (row.raterType === row.subjectType) violate("ck_reputation_ratings_cross_side");
  return row;
}

// ---------------------------------------------------------------------------
// fraud_signals
// ---------------------------------------------------------------------------

/** مفتاحُ `ux_fraud_signals_rule_window` = (subject_type, subject_public_id, rule_code, window_ended_at). */
export function fraudSignalRuleWindowKey(row: {
  readonly subjectType: string;
  readonly subjectPublicId: string;
  readonly ruleCode: string;
  readonly windowEndedAt: string;
}): string {
  return `${row.subjectType}|${row.subjectPublicId}|${row.ruleCode}|${row.windowEndedAt}`;
}

export function enforceFraudSignalConstraints(
  row: FraudSignalRow,
  existing: FraudSignalRow | null,
): FraudSignalRow {
  if (
    !(
      toEpochMillis(row.windowEndedAt, "window_ended_at") >
      toEpochMillis(row.windowStartedAt, "window_started_at")
    )
  ) {
    violate("ck_fraud_signals_window_order");
  }
  if (row.observedCount < row.thresholdCount) violate("ck_fraud_signals_over_threshold");
  if (existing !== null) violate("ux_fraud_signals_rule_window");
  return row;
}
