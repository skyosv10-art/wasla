/**
 * حاسبةُ النتيجة — دالّةٌ نقيّة، وهي **الملفُّ الذي يقوم عليه الطور**.
 *
 * التوقيع كلُّه في سطر: (دفترُ وقائع + نسخةُ قواعد + لحظة) ⇒ (نتيجة · رتبة · لحظةُ
 * إعادةِ الحساب القادمة).
 *
 * لا ساعةَ تُسأل، ولا حالةَ تُقرأ، ولا نتيجةٌ سابقة تدخل الحساب، ولا عشوائيّة، ولا I/O.
 * ونفسُ المدخل يُنتج نفس المخرج دائماً — وهذا ليس ترفاً هندسياً بل هو **ما يجعل
 * `recompute` عمليةً ذات معنى**: حذفُ كل صفوف `reputation_scores` وإعادةُ بنائها من
 * الدفتر يجب أن يُعيد الأرقام كما كانت حرفياً، وإلّا صار الجدولُ المشتقُّ مصدرَ حقيقةٍ
 * ثانياً يتباعد بصمت (ADR-014 القرار 3).
 *
 * ## ما لا تفعله هذه الحاسبة
 *
 * **لا تقرأ نتيجة الأمس.** لا وسيط `previousScore` ولا `previousTier` في أي دالّةٍ
 * أدناه. الطريق الأرخص كان «خُذ رقم الأمس، اضربه في معامل نسيان، أضف وقائع اليوم» —
 * وهو يجعل النتيجة تابعةً لعدد مرّاتِ ركضِ النبضة لا للزمن، ويُلغي إمكان إعادة البناء
 * (التفصيل في رأس `time.ts` عند `decayFactor`).
 *
 * **لا تُصفّر وزناً مجهولاً.** نوعُ واقعةٍ لا وزنَ له في النسخة يرفع
 * `REPUTATION_RULE_WEIGHT_MISSING` من `weightFor`، ولا يُعدّ صفراً بصمت.
 *
 * **لا تُنتج رتبةً بمصادفةٍ حسابية.** `deriveTier` سلّمٌ من فروعٍ مُسمّاة، و`new` فرعٌ
 * صريح لحالة المعرفة لا نتيجةُ مقارنةِ أرقام.
 *
 * **لا تعاقب.** المخرج رقمٌ ورتبةٌ ولحظة. لا `blocked` ولا `allowedActions` ولا
 * `priorityPenalty` (القرار 7).
 */

import type { ReputationRecomputeTrigger, ReputationSubjectType, ReputationTier } from "./contract-sets.js";
import { constraintViolated } from "./errors.js";
import type { ReputationFactRow, ReputationRulesetRow, ReputationScoreRow } from "./model.js";
import { weightFor } from "./ruleset.js";
import { addHours, daysBetween, decayFactor, toEpochMillis } from "./time.js";

/** ما تُنتجه الحاسبة قبل أن تُلبَس هويةَ صفٍّ (شخصاً ولحظةَ حسابٍ ورقمَ نسخة). */
export interface ScoreComputation {
  readonly scorePoints: number;
  readonly tier: ReputationTier;
  readonly factCount: number;
  readonly computedThroughFactId: string | null;
  readonly nextRecomputeAt: string;
  /** المجموع قبل التقريب والقصر — للتشخيص وللاختبارات، ولا يُخزَّن في `reputation_scores`. */
  readonly rawPoints: number;
}

/**
 * تقريبٌ إلى أقرب صحيحٍ بقاعدةٍ مُعلَنة: النصفُ يصعد.
 *
 * `Math.round` في JavaScript هو `floor(x + 0.5)`، فيصعد النصفُ نحو \(+\infty\) في
 * الموجب والسالب معاً (‎-2.5 ⇒ -2‎). يُغلَّف باسمٍ هنا كي تكون القاعدة **مكتوبة** لا
 * مُستنبطةً من سلوك دالّةٍ مضمَّنة: عمود `score_points` صحيحٌ في القاعدة، وتقريبٌ لا
 * يعرفه القارئ يجعل فرقَ نقطةٍ بين بيئتين ألغازاً.
 */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/** قصرٌ إلى حدَّي النسخة. النتيجةُ خارج حدودها لا تُفسَّر ولا تُقارَن. */
export function clampToRulesetBounds(value: number, ruleset: ReputationRulesetRow): number {
  if (value < ruleset.scoreFloor) return ruleset.scoreFloor;
  if (value > ruleset.scoreCeiling) return ruleset.scoreCeiling;
  return value;
}

/**
 * الرتبةُ من النتيجة وعددِ الوقائع، بعتباتٍ **مُعلَنة**.
 *
 * السلّم بترتيبه، وكلُّ فرعٍ يقول ما يعنيه:
 *
 *   1. **`new` — حالةُ معرفةٍ لا حُكم.** وقائعُ أقلُّ من `minFactsForScore` تعني أنّنا لا
 *      نعرف بعد، ولا شأن لقيمة النقاط بذلك. هذا فرعٌ صريحٌ أوّلٌ ولا مصادفةٌ حسابية،
 *      مطابقاً لنيّة `ck_reputation_scores_new_has_no_history`: شخصٌ بأربع وقائع رتبته
 *      `new` وإن كانت نقاطه 95، لأنّ 95 من أربع وقائع رأيٌ لا قياس.
 *   2. **`under_watch` — دون `tierUnderWatchBelow`.** تسميةٌ تُقرأ ولا تُنفَّذ: لا شيء
 *      في وَصْلة يحجب بناءً عليها (القرار 7).
 *   3. **`trusted` — عند `tierTrustedAt` أو فوقه.**
 *   4. **`standard` — كلُّ ما بينهما.**
 *
 * ## النطاق بين `tierUnderWatchBelow` و`tierStandardAt`
 *
 * الرتب أربعٌ مُقفلةٌ في العقد، والعتبات ثلاث، فالنطاق [35, 50) يجب أن ينتمي إلى رتبةٍ
 * قائمة. **قرارُنا المُعلَن أنّه `standard`**، ومعنى `tierStandardAt` هو أرضُ النطاق
 * الذي تُسمّيه النسخة عادياً بيقين، لا حدٌّ يُسقِط من تحته إلى المراقبة. والسببُ أنّ
 * الاحتمال الآخر — «دون 50 مراقبةٌ» — كان سيُفرغ `tierUnderWatchBelow` من معناه ويجعل
 * رقمين لحدٍّ واحد. ولو أردنا نطاقاً خامساً فهو **نسخة قواعد جديدة ورتبةٌ جديدة في
 * العقد وADR**، لا فرعٌ يُضاف هنا.
 *
 * ويحرس هذا القرارَ اختبارٌ صريح (`38 ⇒ standard`) كي لا يُقرأ لاحقاً كسهو.
 */
export function deriveTier(
  scorePoints: number,
  factCount: number,
  ruleset: ReputationRulesetRow,
): ReputationTier {
  if (factCount < ruleset.minFactsForScore) return "new";
  if (scorePoints < ruleset.tierUnderWatchBelow) return "under_watch";
  if (scorePoints >= ruleset.tierTrustedAt) return "trusted";
  return "standard";
}

/**
 * ترتيبٌ كامل للوقائع لا يعتمد على ترتيب المُهيئ.
 *
 * الحسابُ نفسه جمعٌ فلا يهمّه الترتيب، لكن `computedThroughFactId` يهمّه: لو اعتمد على
 * ترتيب ما أعادته القاعدة لصار حقلاً يتغيّر بتغيّر خطّة الاستعلام، فيُنتج مُهيئان
 * قيمتين لنفس الدفتر وتفشل مطابقةُ المُهيئات في المراجعة 3/6 بلا سببٍ حقيقيّ.
 *
 * المفتاح: (`occurredAt` ثم `sourceSequence` ثم `id`). الثالث فاصلُ تعادلٍ **حتميّ**
 * لأنّ `id` مفتاحٌ أوّليّ فريد، فلا تعادلَ يبقى بعده.
 */
export function orderFactsForComputation(
  facts: readonly ReputationFactRow[],
): readonly ReputationFactRow[] {
  return [...facts].sort((left, right) => {
    const byInstant =
      toEpochMillis(left.occurredAt, "occurred_at") - toEpochMillis(right.occurredAt, "occurred_at");
    if (byInstant !== 0) return byInstant;
    if (left.sourceSequence !== right.sourceSequence) {
      return left.sourceSequence - right.sourceSequence;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

/**
 * **حاسبةُ النتيجة.** دالّةٌ نقيّة: نفس المدخل ⇒ نفس المخرج، دائماً.
 *
 * \[
 *   \text{raw} = \text{startingScore} + \sum_{f \in \text{facts}}
 *                w(\text{subjectType}, f.\text{factKind}) \cdot 2^{-\,\text{age}(f)/H}
 * \]
 *
 * حيث \(H\) نصفُ العمر بالأيام، و\(\text{age}(f)\) عمرُ الواقعة بالأيام من
 * `f.occurredAt` إلى `at`. **التلاشي مجموعٌ على وقائع مؤرّخة**، ولا معاملَ نسيانٍ
 * يُضرَب في نتيجةٍ سابقة (انظر رأس الملف ورأس `decayFactor`).
 *
 * والوقائع تُقرأ بـ`occurredAt` لا بـ`recordedAt`: الأول زمنُ الحدوث في العالم، والثاني
 * زمنُ وصوله عندنا، وخلطُهما يجعل حدثاً تأخّر يومين يُوزَن كأنّه اليوم فتكذب النافذةُ
 * والتلاشي معاً عند أوّل إعادة تسليم.
 *
 * ونتيجةُ من لا واقعةَ له = `startingScore` بالضبط (المجموعُ الخالي صفرٌ)، ورتبتُه
 * `new`، و`computedThroughFactId` غيابٌ. وهذه الحالة تُحسب ولا تُخزَّن من تلقاء نفسها:
 * `GET` لشخصٍ بلا دفتر يردّ `404` ولا يختلق له نتيجة (`errors.md` §
 * `REPUTATION_SCORE_NOT_FOUND`).
 */
export function computeScore(input: {
  readonly subjectType: ReputationSubjectType;
  readonly facts: readonly ReputationFactRow[];
  readonly ruleset: ReputationRulesetRow;
  readonly at: string;
}): ScoreComputation {
  const ordered = orderFactsForComputation(input.facts);

  let raw = input.ruleset.startingScore;
  for (const fact of ordered) {
    const weight = weightFor(input.ruleset, input.subjectType, fact.factKind);
    const ageDays = daysBetween(fact.occurredAt, input.at);
    raw += weight * decayFactor(ageDays, input.ruleset.decayHalfLifeDays);
  }

  const scorePoints = clampToRulesetBounds(roundHalfUp(raw), input.ruleset);
  const factCount = ordered.length;
  const tier = deriveTier(scorePoints, factCount, input.ruleset);
  const last = ordered.at(-1);

  return {
    scorePoints,
    tier,
    factCount,
    computedThroughFactId: last === undefined ? null : last.id,
    nextRecomputeAt: addHours(input.at, input.ruleset.recomputeIntervalHours),
    rawPoints: raw,
  };
}

/** حسابٌ ثم إلباسُه هويةَ صفٍّ في `reputation_scores`. */
export function toScoreRow(input: {
  readonly subjectType: ReputationSubjectType;
  readonly subjectPublicId: string;
  readonly ruleset: ReputationRulesetRow;
  readonly computation: ScoreComputation;
  readonly at: string;
  readonly traceId?: string | null;
}): ReputationScoreRow {
  const row: ReputationScoreRow = {
    subjectType: input.subjectType,
    subjectPublicId: input.subjectPublicId,
    rulesetVersion: input.ruleset.rulesetVersion,
    scorePoints: input.computation.scorePoints,
    tier: input.computation.tier,
    factCount: input.computation.factCount,
    computedThroughFactId: input.computation.computedThroughFactId,
    computedAt: input.at,
    nextRecomputeAt: input.computation.nextRecomputeAt,
    traceId: input.traceId ?? null,
  };
  return assertScoreInvariants(row);
}

/**
 * ثوابتُ صفّ النتيجة، **بأسماء قيود القاعدة**.
 *
 * تُفحَص في المجال قبل الوصول إلى أي مُهيئ. الوصولُ إلى أحدها يعني أنّ الحاسبة أنتجت
 * قيمةً مستحيلة، ورفضُها هنا يجعل العلّة تظهر عند مصدرها بدل أن تُخزَّن وتُكتشَف بعد شهرٍ
 * كصفٍّ لا يُفسَّر.
 */
export function assertScoreInvariants(row: ReputationScoreRow): ReputationScoreRow {
  if (row.scorePoints < 0) throw constraintViolated("ck_reputation_scores_non_negative");
  if (row.factCount < 0) throw constraintViolated("ck_reputation_scores_non_negative");
  // tier <> 'new' OR fact_count = 0 OR computed_through_fact_id IS NOT NULL
  if (row.tier === "new" && row.factCount !== 0 && row.computedThroughFactId === null) {
    throw constraintViolated("ck_reputation_scores_new_has_no_history");
  }
  return row;
}

/**
 * هل استحقّت النتيجةُ إعادةَ حسابٍ عند `now`؟
 *
 * مقارنةٌ مع `nextRecomputeAt` المُخزَّن — وهو فهرسُ النبضة (`ix_reputation_scores_recompute_due`).
 * لا مؤقّتَ في الذاكرة ولا طابورَ تأخير: إعادةُ التشغيل تُؤخّر الاكتشاف ولا تُلغي
 * الاستحقاق.
 */
export function isRecomputeDue(row: ReputationScoreRow, now: string): boolean {
  return toEpochMillis(row.nextRecomputeAt, "next_recompute_at") <= toEpochMillis(now, "now");
}

/** المُحرّضاتُ التي يُعلنها العقد لإعادة الحساب. تُمرَّر إلى الحدث ولا تُخمَّن فيه. */
export function isRecomputeTrigger(value: string): value is ReputationRecomputeTrigger {
  return value === "fact_recorded" || value === "tick" || value === "manual_recompute";
}
