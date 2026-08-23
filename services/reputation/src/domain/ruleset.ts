/**
 * نسخةُ القواعد: الأحكام **بياناً** في نسخةٍ مُرقّمةٍ مجمَّدة.
 *
 * هذه الثوابت مطابقةٌ لزرع `services/reputation/contracts/schema.sql` §1..§3، ويحرسها
 * اختبارُ انحرافٍ يقرأ `INSERT` من الـDDL بعد حذف التعليقات. وتقيم هنا — لا في القاعدة
 * وحدها — كي تركض حزمةُ الاختبارات كلّها بلا Postgres، وهو نفسُ سبب وجود
 * `SEEDED_POLICIES` في التفاوض و`SEEDED_RULESETS` في المطابقة.
 *
 * ## لماذا الأرقام مُعلَنةٌ ولا مُفترَضة
 *
 *   - **0..100 والبداية 60** — مستخدمٌ جديد لا يبدأ من الصفر فيُظلَم، ولا من القمّة
 *     فتُصبح الرتبة بلا معنى. و60 فوق حدّ المراقبة (35) ودون الثقة (80) بحسابٍ مقصود.
 *   - **خمسُ وقائع قبل إعلان نتيجة** — نتيجةٌ من واقعةٍ واحدة رأيٌ لا قياس، ورقمٌ كهذا
 *     يُقارَن بغيره فيُظلَم به من عمل مرّة.
 *   - **نصفُ عمرٍ 180 يوماً** — خطأُ العام الماضي لا يساوي خطأ الأمس. والرقم بالأيام لا
 *     «بالنبضات»، فلا علاقةَ له بجدولِ تشغيلٍ ولا بتعطّلٍ.
 *   - **نافذةُ تقييمٍ 72 ساعة** — بعدها يُغلق الباب: تقييمٌ بعد شهرين ذاكرةٌ لا شهادة.
 *   - **نافذةُ رصدٍ 30 يوماً، وإعادةُ حسابٍ كل 24 ساعة** — النافذة تسأل «كم مرّة في
 *     آخر شهر؟»، والفاصلُ يجعل التلاشي مرئياً بلا أن يُثقل النبضة.
 *
 * رقمٌ آخر = **نسخة 2 وADR**، لا تحريرٌ هنا: كل نتيجةٍ وكل إشارةٍ تحمل
 * `rulesetVersion`، وذاك وحده ما يُبقي حُكمَ الأمس قابلاً للشرح بالأحكام التي أنتجته.
 */

import {
  REPUTATION_LAUNCH_RULESET_LABEL,
  REPUTATION_LAUNCH_RULESET_VERSION,
  type ReputationFactKind,
  type ReputationSubjectType,
} from "./contract-sets.js";
import { constraintViolated, ruleWeightMissing, rulesetNotFound, rulesetNotFrozen } from "./errors.js";
import type {
  ReputationFraudThresholdRow,
  ReputationRuleWeightRow,
  ReputationRulesetRow,
} from "./model.js";

export const LAUNCH_RULESET_VERSION = REPUTATION_LAUNCH_RULESET_VERSION;
export const LAUNCH_RULESET_LABEL = REPUTATION_LAUNCH_RULESET_LABEL;

/**
 * أوزانُ النسخة 1.
 *
 * الإكمال يُضيف والإلغاء يخصم، والخصمُ **أكبر** من الإضافة في الجانبين: الإكمال هو
 * الأصل المتوقّع، والإلغاء انحرافٌ عنه يُكلّف الطرف الآخر رحلةً. و`assignment_rejected`
 * وزنُه **صفرٌ مُعلَن** لا وزنٌ غائب: رفضُ عرضٍ حقٌّ للسائق لا مخالفة، وفرقُ الصفر
 * المُعلَن عن الغياب هو أنّ الأول قرارٌ يُقرأ والثاني نسيانٌ يُرفَض
 * (`REPUTATION_RULE_WEIGHT_MISSING`).
 *
 * ولا وزنَ لـ`order_cancelled_by_driver` على العميل ولا لـ`order_cancelled_by_customer`
 * على السائق: واقعةٌ لا يملكها الشخص لا تدخل سمعته. وغيابُهما مقصودٌ ويُرفَض صريحاً لو
 * وصلت واقعةٌ كهذه، فلا تُحسب صفراً بصمت.
 */
export const LAUNCH_RULE_WEIGHTS: readonly ReputationRuleWeightRow[] = Object.freeze([
  Object.freeze({ rulesetVersion: 1, subjectType: "customer", factKind: "order_completed", weightPoints: 3 }),
  Object.freeze({ rulesetVersion: 1, subjectType: "customer", factKind: "order_cancelled_by_customer", weightPoints: -6 }),
  Object.freeze({ rulesetVersion: 1, subjectType: "customer", factKind: "rating_received", weightPoints: 2 }),
  Object.freeze({ rulesetVersion: 1, subjectType: "driver", factKind: "order_completed", weightPoints: 4 }),
  Object.freeze({ rulesetVersion: 1, subjectType: "driver", factKind: "order_cancelled_by_driver", weightPoints: -9 }),
  Object.freeze({ rulesetVersion: 1, subjectType: "driver", factKind: "assignment_accepted", weightPoints: 1 }),
  Object.freeze({ rulesetVersion: 1, subjectType: "driver", factKind: "assignment_rejected", weightPoints: 0 }),
  Object.freeze({ rulesetVersion: 1, subjectType: "driver", factKind: "assignment_timed_out", weightPoints: -2 }),
  Object.freeze({ rulesetVersion: 1, subjectType: "driver", factKind: "rating_received", weightPoints: 2 }),
]) as readonly ReputationRuleWeightRow[];

/**
 * عتباتُ قواعد الاحتيال في النسخة 1، وشدّةُ كلٍّ منها.
 *
 * الشدّة **تُقرأ ولا تُنفَّذ** (ADR-014 القرار 7): `high` لا تحجب ولا توقف ولا تُخفض
 * أولوية، وإنّما تُرتّب قائمةَ مراجعةٍ بشرية لا يملكها هذا الطور. ولذلك ليست في العتبة
 * حقلُ `action`: عمودٌ كهذا كان سيصير أمراً ينفّذه مستهلكٌ بلا مالكٍ لقراره.
 *
 * وكلُّ عتبةٍ مربوطةٌ بجانبٍ واحد: `accept_then_abandon` للسائق ولا معنى لها على العميل،
 * و`rating_extremity_burst` للعميل لأنّه المُقيِّم الغالب. قاعدةٌ تُطبَّق على جانبٍ لا
 * يملك الفعل تُنتج إشاراتٍ لا تُشرح لمن تُرفع عليه.
 */
export const LAUNCH_FRAUD_THRESHOLDS: readonly ReputationFraudThresholdRow[] = Object.freeze([
  Object.freeze({ rulesetVersion: 1, ruleCode: "repeated_customer_cancellation", subjectType: "customer", thresholdCount: 5, severity: "medium" }),
  Object.freeze({ rulesetVersion: 1, ruleCode: "repeated_driver_cancellation", subjectType: "driver", thresholdCount: 4, severity: "medium" }),
  Object.freeze({ rulesetVersion: 1, ruleCode: "accept_then_abandon", subjectType: "driver", thresholdCount: 3, severity: "high" }),
  Object.freeze({ rulesetVersion: 1, ruleCode: "offer_timeout_streak", subjectType: "driver", thresholdCount: 10, severity: "low" }),
  Object.freeze({ rulesetVersion: 1, ruleCode: "rating_extremity_burst", subjectType: "customer", thresholdCount: 8, severity: "low" }),
]) as readonly ReputationFraudThresholdRow[];

export const SEEDED_RULESETS: readonly ReputationRulesetRow[] = Object.freeze([
  Object.freeze({
    rulesetVersion: LAUNCH_RULESET_VERSION,
    label: LAUNCH_RULESET_LABEL,
    scoreFloor: 0,
    scoreCeiling: 100,
    startingScore: 60,
    minFactsForScore: 5,
    decayHalfLifeDays: 180,
    tierStandardAt: 50,
    tierTrustedAt: 80,
    tierUnderWatchBelow: 35,
    ratingWindowHours: 72,
    fraudWindowDays: 30,
    recomputeIntervalHours: 24,
    isFrozen: true,
    weights: LAUNCH_RULE_WEIGHTS,
    fraudThresholds: LAUNCH_FRAUD_THRESHOLDS,
  }),
]) as readonly ReputationRulesetRow[];

export function findSeededRuleset(rulesetVersion: number): ReputationRulesetRow | null {
  return SEEDED_RULESETS.find((row) => row.rulesetVersion === rulesetVersion) ?? null;
}

/**
 * ثوابتُ النسخة نفسها، بأسماء قيود القاعدة.
 *
 * تُفحَص عند القراءة لا عند الزرع فقط: نسخةٌ مقروءةٌ من مُهيئٍ خارجيّ (المراجعة 3/6
 * تقرؤها من Postgres) قد تكون مكسورةً بترحيلٍ يدويّ، ورتبةٌ موثوقة أدنى من رتبةٍ عادية
 * تجعل التصنيف عبثاً بلا أن يفشل شيء.
 */
export function assertRulesetInvariants(ruleset: ReputationRulesetRow): ReputationRulesetRow {
  if (!(ruleset.scoreCeiling > ruleset.scoreFloor)) {
    throw constraintViolated("ck_reputation_rulesets_score_bounds");
  }
  if (ruleset.startingScore < ruleset.scoreFloor || ruleset.startingScore > ruleset.scoreCeiling) {
    throw constraintViolated("ck_reputation_rulesets_start_in_bounds");
  }
  if (
    !(ruleset.tierTrustedAt > ruleset.tierStandardAt) ||
    !(ruleset.tierUnderWatchBelow <= ruleset.tierStandardAt)
  ) {
    throw constraintViolated("ck_reputation_rulesets_tier_order");
  }
  return ruleset;
}

/**
 * النسخةُ التي يجوز الحساب بها.
 *
 * غيرُ المجمَّدة تُرفَض ولا تُستعمل: نتيجةٌ حُسبت بأحكامٍ تغيّرت بعدها لا تُفسَّر، و«لماذا
 * صُنّف هذا الشخص هكذا؟» هو السؤال الذي وُجد ترقيمُ النسخ كلّه لأجله.
 */
export function requireUsableRuleset(
  ruleset: ReputationRulesetRow | null,
  rulesetVersion: number,
): ReputationRulesetRow {
  if (ruleset === null) throw rulesetNotFound(rulesetVersion);
  if (!ruleset.isFrozen) throw rulesetNotFrozen(rulesetVersion);
  return assertRulesetInvariants(ruleset);
}

/**
 * وزنُ نوعِ واقعةٍ لجانبٍ — أو **رفضٌ مُسمّى**.
 *
 * لا `?? 0` هنا ولا في أي مستدعٍ. وزنٌ افتراضيٌّ صفر يُخفي واقعةً لا يعرف أحدٌ أنّها
 * أُهملت، ويجعل الفارق بين «لا أثر لها» و«نسيناها» غير قابل للاكتشاف بعد شهر. والصفرُ
 * المقصود مُعلَنٌ صفّاً في `LAUNCH_RULE_WEIGHTS` (انظر `assignment_rejected`)، فالفرق
 * بين القرار والنسيان مرئيٌّ في البيانات لا مُستنبطٌ من الكود.
 */
export function weightFor(
  ruleset: ReputationRulesetRow,
  subjectType: ReputationSubjectType,
  factKind: ReputationFactKind,
): number {
  const row = ruleset.weights.find(
    (candidate) => candidate.subjectType === subjectType && candidate.factKind === factKind,
  );
  if (row === undefined) {
    throw ruleWeightMissing(subjectType, factKind, ruleset.rulesetVersion);
  }
  return row.weightPoints;
}

/** عتبةُ قاعدةٍ في نسخةٍ، أو `null` إن كانت القاعدة غير مُعتَّبة في هذه النسخة. */
export function thresholdFor(
  ruleset: ReputationRulesetRow,
  ruleCode: ReputationFraudThresholdRow["ruleCode"],
): ReputationFraudThresholdRow | null {
  return ruleset.fraudThresholds.find((row) => row.ruleCode === ruleCode) ?? null;
}
