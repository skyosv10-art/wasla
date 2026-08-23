/**
 * تأهيلُ الإحالة ومكافأتُها — ADR-015 القراران 8 و9.
 *
 * ## القاعدة
 *
 * المكافأةُ **لا تُمنح على تسجيل**. تُمنح على أن يكون المُحال إليه سائقاً عاملاً فعلاً:
 * وقائعُ مُسجّلةٌ في خدمة السمعة (Phase 09) تبلغ عتبةَ نسخةِ الخطّة، ومدةٌ مدفوعةٌ فُعّلت له
 * مرّةً على الأقل، وكلُّ ذلك داخل نافذةٍ زمنيةٍ مُعلَنة.
 *
 * النسخةُ الخاطئةُ الأرخص هنا معروفةٌ ومكلفة: مكافأةٌ على التسجيل. تُنتج مصنعَ حساباتٍ
 * وهميّة — رمزٌ يُوزَّع، وحساباتٌ تُفتَح، وثلاثون يوماً تُمنح لكلّ حسابٍ نام فوراً. ولا
 * يظهر ذلك في مقياسٍ إلّا بعد أن يصير الجزءُ الأكبرُ من «النموّ» ورقاً.
 *
 * ## ترتيبُ التقييمِ **مُعلَنٌ ومختبَر**
 *
 * الأسبابُ الستةُ مُقفلةٌ في العقد، والترتيبُ الذي تُفحَص به ليس تفصيلاً: إحالةٌ ذاتيةٌ
 * بنافذةٍ منقضيةٍ يجب أن تُعطي **نفسَ** السببِ في كلّ مرّة، وإلّا صار سببُ الرفضِ خاصيّةً
 * للتنفيذِ لا للقاعدة، ولا يمكن قياسُ «كم إحالةً رُفضت لأنّها ذاتية».
 *
 * الترتيبُ: (1) `self_referral` (2) `referee_already_referred` (3) `referral_window_expired`
 * (4) `referrer_not_active` (5) `referee_subscription_never_activated`
 * (6) `referee_no_qualifying_facts`.
 *
 * ولماذا هذا الترتيبُ بعينه؟ من **الأثبتِ إلى الأكثرِ تقلّباً**. الإحالةُ الذاتيةُ حقيقةٌ
 * بنيويةٌ لا تتغيّر أبداً؛ والمُحال إليه الذي أحاله غيرُه أوّلاً حقيقةٌ لا تُنقَض؛ والنافذةُ
 * المنقضيةُ لا تُعاد فتحُها. أمّا حالةُ المُحيلِ فتتغيّر غداً بدفعة، ووقائعُ المُحال إليه
 * تزيد كلَّ يوم. فلو فُحصت المتقلّبةُ أوّلاً لأعطت نفسُ الإحالةِ سببَين في يومَين، ولصار
 * الرمزُ المُعاد رسالةً غيرَ مستقرّة يبني عليها البوتُ نصّاً متناقضاً.
 *
 * وحالةُ المُحيلِ **يجب أن تكون `active`** لا `trial`: مُحيلٌ في تجربتِه يجمع مكافآتٍ ثم
 * يخرج بلا أن يدفع ريالاً — وهي النسخةُ الخاطئةُ الأرخصُ الثانية في هذا الملف.
 */

import { REFERRAL_REJECTION_REASONS, type ReferralRejectionReason, type SubscriptionState } from "./contract-sets.js";
import { referralNotQualified, referralRewardAlreadyGranted, validationFailed } from "./errors.js";
import type {
  PlanVersion,
  Referral,
  ReferralJudgement,
  ReferralRewardDraft,
  RefereeEvidence,
} from "./model.js";
import { draftPeriod } from "./periods.js";
import { addDays, assertTimestamp, isAtOrAfter } from "./time.js";

/** الترتيبُ المُعلَنُ للفحص. يُصدَّر كي يقرأه الاختبارُ ولا يُعيد كتابتَه بيده. */
export const REFERRAL_REJECTION_ORDER: ReadonlyArray<ReferralRejectionReason> = Object.freeze([
  "self_referral",
  "referee_already_referred",
  "referral_window_expired",
  "referrer_not_active",
  "referee_subscription_never_activated",
  "referee_no_qualifying_facts",
]);

/** نهايةُ نافذةِ الإحالة من لحظةِ المطالبة وأيّامِ النافذةِ في نسخةِ الخطّة. */
export function referralWindowEnd(claimedAt: string, plan: PlanVersion): string {
  return addDays(assertTimestamp(claimedAt, "claimed_at"), plan.referralWindowDays);
}

/**
 * حكمُ التأهيل: `qualified` بلا سببٍ، أو `rejected` بسببٍ واحدٍ من القائمة المُقفلة.
 *
 * ولا حالةَ ثالثة: `pending` حالةُ **تخزينٍ** قبل الحكم لا مُخرَجُ حكم. دالّةٌ تُعيد
 * «لا أعرف» تجعل المُنادي يخترع سلوكاً لحالةٍ لا مالكَ لقرارها.
 */
export function qualifyReferral(input: {
  readonly referrerPublicId: string;
  readonly refereePublicId: string;
  readonly referrerState: SubscriptionState | null;
  readonly evidence: RefereeEvidence;
  readonly windowEndsAt: string;
  readonly plan: PlanVersion;
  readonly now: string;
}): ReferralJudgement {
  const { referrerPublicId, refereePublicId, referrerState, evidence, windowEndsAt, plan, now } = input;
  assertTimestamp(now, "now");
  assertTimestamp(windowEndsAt, "window_ends_at");
  if (!Number.isSafeInteger(evidence.qualifyingFactCount) || evidence.qualifyingFactCount < 0) {
    throw validationFailed("qualifying_fact_count", "non-negative integer");
  }

  const rejection = ((): ReferralRejectionReason | null => {
    if (referrerPublicId === refereePublicId) return "self_referral";
    if (evidence.alreadyReferredByAnother) return "referee_already_referred";
    if (isAtOrAfter(now, windowEndsAt)) return "referral_window_expired";
    if (referrerState !== "active") return "referrer_not_active";
    if (!evidence.hasActivatedPaidPeriod) return "referee_subscription_never_activated";
    if (evidence.qualifyingFactCount < plan.referralQualifyingFacts) {
      return "referee_no_qualifying_facts";
    }
    return null;
  })();

  return Object.freeze({
    state: rejection ? "rejected" : "qualified",
    reasonCode: rejection,
    qualifyingFactCount: evidence.qualifyingFactCount,
    judgedAt: now,
  } satisfies ReferralJudgement);
}

/**
 * مكافأةُ إحالةٍ متأهّلة: **مدةٌ واحدةٌ** مصدرُها `referral_reward` بلا مرجعِ دفعٍ.
 *
 * الحرّاسُ ثلاثة، وكلُّ واحدٍ منها يمنع خطأً مختلفاً:
 *
 * 1. إحالةٌ حالتُها `rewarded` ⇒ `REFERRAL_REWARD_ALREADY_GRANTED`. مكافأةٌ ثانيةٌ لنفس
 *    الإحالة تعني أنّ إعادةَ تسليمِ حادثةٍ تُنتج ثلاثين يوماً مجانيةً في كلّ مرّة.
 * 2. إحالةٌ ليست `qualified` ⇒ `REFERRAL_REFEREE_NOT_QUALIFIED`. منحُ مكافأةٍ لإحالةٍ
 *    `pending` يُلغي معنى التأهيل أصلاً.
 * 3. نسخةُ الخطّةِ يجب أن تكون هي نسخةَ الإحالةِ نفسِها — تُمرَّر من المُنادي ويُطابقها
 *    `requireGrantablePlan` في طبقةِ الاستعمال؛ وهنا نتحقّق من التجميدِ ضمناً عبر
 *    `draftPeriod` الذي يقرأ الأرقامَ من النسخةِ الممرَّرة لا من ثابت.
 *
 * والامتدادُ من نهايةِ التغطية لا من الآن (انظر `periods.ts`): مكافأةٌ تُحرق ما بقي من
 * مدةٍ مدفوعةٍ تجعل السائقَ يؤجّل تسليمَها.
 */
export function applyReferralReward(input: {
  readonly referral: Referral;
  readonly plan: PlanVersion;
  readonly currentCoverageEnd: string | null;
  readonly now: string;
}): ReferralRewardDraft {
  const { referral, plan, currentCoverageEnd, now } = input;
  if (referral.state === "rewarded") throw referralRewardAlreadyGranted(referral.state);
  if (referral.state !== "qualified") throw referralNotQualified(referral.state);

  const period = draftPeriod({
    driverPublicId: referral.referrerPublicId,
    plan,
    source: "referral_reward",
    grantedDays: plan.referralRewardDays,
    currentCoverageEnd,
    now,
  });

  return Object.freeze({
    referralId: referral.referralId,
    rewardDays: plan.referralRewardDays,
    planCode: plan.planCode,
    planVersion: plan.planVersion,
    period,
  } satisfies ReferralRewardDraft);
}

/** كلُّ سببٍ في الترتيبِ المُعلَن هو سببٌ في العقد، ولا سببَ في العقد بلا موضعٍ في الترتيب. */
export function rejectionOrderMatchesContract(): boolean {
  return (
    REFERRAL_REJECTION_ORDER.length === REFERRAL_REJECTION_REASONS.length &&
    REFERRAL_REJECTION_ORDER.every((reason) =>
      (REFERRAL_REJECTION_REASONS as ReadonlyArray<string>).includes(reason),
    )
  );
}
