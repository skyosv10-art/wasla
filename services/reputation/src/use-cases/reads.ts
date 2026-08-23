/**
 * القراءاتُ: نتيجةٌ واحدة، ونسخُ القواعد، وقوائمُ الوقائع والتقييمات والإشارات.
 *
 * ## لماذا القوائمُ تُلزم مُرشِّحاً
 *
 * `REPUTATION_FILTER_REQUIRED` (400) على قائمةٍ بلا مُرشِّح. الدفترُ ينمو مع كل طلبٍ في
 * المنصّة، و«أعطِني الوقائع» بلا قيدٍ استعلامٌ يعمل في الأسبوع الأول ويُسقط القاعدة في
 * الشهر السادس. والرفضُ صريحاً أفضلُ من حدٍّ افتراضيٍّ صامت: من يُرجع أوّلَ مئةٍ بلا أن
 * يُخبر يُنتج تقاريرَ ناقصةً لا يعرف أحدٌ أنّها ناقصة.
 *
 * وهذه القراءاتُ **لا تُنشئ نتيجة**. `GET` لشخصٍ بلا دفترٍ يردّ `404` ولا يختلق له نتيجةَ
 * بداية: النتيجةُ حصيلةُ وقائع، ومن لا وقائعَ له لا نتيجةَ له بعد.
 */

import type { ReputationSubjectType } from "../domain/contract-sets.js";
import { filterRequired, rulesetNotFound, scoreNotFound } from "../domain/errors.js";
import type {
  FraudSignalRow,
  ReputationFactRow,
  ReputationRatingRow,
  ReputationRulesetRow,
  ReputationScoreRow,
} from "../domain/model.js";
import { requireUsableRuleset } from "../domain/ruleset.js";
import { assertSubjectType, assertWaslaPublicId } from "../domain/validation.js";
import type {
  FactFilter,
  FraudSignalFilter,
  RatingFilter,
  ReputationDependencies,
} from "../ports.js";

/** هل في المُرشِّح قيدٌ واحدٌ فعليّ على الأقل؟ الغيابُ والفراغُ سواء. */
function hasAnyFilter(filter: Record<string, unknown>): boolean {
  return Object.values(filter).some(
    (value) => value !== undefined && value !== null && value !== "",
  );
}

export async function readScore(
  deps: ReputationDependencies,
  input: { readonly subjectType: ReputationSubjectType; readonly subjectPublicId: string },
): Promise<ReputationScoreRow> {
  const subjectType = assertSubjectType(input.subjectType);
  const subjectPublicId = assertWaslaPublicId(input.subjectPublicId);
  const score = await deps.scores.find(subjectType, subjectPublicId);
  if (score === null) throw scoreNotFound(subjectType, subjectPublicId);
  return score;
}

export async function listFacts(
  deps: ReputationDependencies,
  filter: FactFilter,
): Promise<readonly ReputationFactRow[]> {
  if (!hasAnyFilter(filter as Record<string, unknown>)) throw filterRequired();
  return await deps.facts.list(filter);
}

export async function listRatings(
  deps: ReputationDependencies,
  filter: RatingFilter,
): Promise<readonly ReputationRatingRow[]> {
  if (!hasAnyFilter(filter as Record<string, unknown>)) throw filterRequired();
  return await deps.ratings.list(filter);
}

export async function listFraudSignals(
  deps: ReputationDependencies,
  filter: FraudSignalFilter,
): Promise<readonly FraudSignalRow[]> {
  if (!hasAnyFilter(filter as Record<string, unknown>)) throw filterRequired();
  return await deps.fraudSignals.list(filter);
}

/**
 * نسخُ القواعد كلُّها — **بلا مُرشِّح**، وهو الاستثناء الوحيد.
 *
 * لأنّها مجموعةٌ محدودةٌ تنمو بإصدارٍ لا بحركةِ مستخدمين: نسخةٌ في السنة لا ألفٌ في اليوم.
 * وإلزامُ مُرشِّحٍ هنا كان تزمّتاً بلا سبب.
 */
export async function listRulesets(
  deps: ReputationDependencies,
): Promise<readonly ReputationRulesetRow[]> {
  return await deps.rulesets.list();
}

/**
 * نسخةٌ بعينها.
 *
 * تُعاد **حتى لو لم تكن مجمَّدة**: من يقرأ نسخةً للمراجعة يحتاج أن يرى ما فيها بما فيه
 * `is_frozen: false`. والتجميدُ شرطٌ **للحساب** بها لا للنظر إليها، وحرسُه في
 * `requireActiveRuleset` لا هنا.
 */
export async function readRuleset(
  deps: ReputationDependencies,
  rulesetVersion: number,
): Promise<ReputationRulesetRow> {
  const ruleset = await deps.rulesets.find(rulesetVersion);
  if (ruleset === null) throw rulesetNotFound(rulesetVersion);
  return ruleset;
}

/** نسخةٌ **صالحةٌ للحساب**: موجودةٌ ومجمَّدةٌ وثوابتُها سليمة. تُستعمل في التشخيص. */
export async function readUsableRuleset(
  deps: ReputationDependencies,
  rulesetVersion: number,
): Promise<ReputationRulesetRow> {
  return requireUsableRuleset(await deps.rulesets.find(rulesetVersion), rulesetVersion);
}
