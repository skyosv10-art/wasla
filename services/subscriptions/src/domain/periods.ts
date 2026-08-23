/**
 * صياغةُ المُدَد: التجربةُ والدفعُ والمكافأة — كلُّها **مدةٌ في نفس الدفتر**.
 *
 * ## لماذا مصنعٌ واحدٌ لثلاثةِ مصادر
 *
 * لأنّ الفرقَ بينها **حقلُ `source` ورقمُ الأيام**، لا شكلُ السجلّ ولا مكانُه. أوّلُ من
 * يكتب جدولاً ثانياً للمكافآت («رصيدُ أيامٍ» مثلاً) يخلق حقيقتَين للتغطية: دفترُ مُدَدٍ
 * ورصيدٌ، ثم يظهر سائقٌ رصيدُه ثلاثون يوماً وتغطيتُه منقضية، ولا أحدَ يعرف أيَّهما الصحيح.
 * ولذلك المكافأةُ هنا **مدةٌ** (القرار 9)، والتجديدُ **مدةٌ** (القرار 3)، والتجربةُ **مدةٌ**.
 *
 * ## الامتدادُ لا التقاطع
 *
 * مدةٌ جديدةٌ على سائقٍ تغطيتُه سارية تبدأ من **نهايةِ تغطيتِه** لا من الآن. لو بدأت من
 * الآن لضاع ما بقي من المدةِ المدفوعة: سائقٌ دفع ثم أُحيل في اليوم الخامس يخسر خمسةً
 * وعشرين يوماً دفع ثمنَها، ويكون في مصلحته أن يؤجّل مكافأتَه — وقاعدةٌ يكون التأجيلُ فيها
 * أنفعَ من التسليم قاعدةٌ مكسورة. وإن كانت تغطيتُه قد انقضت فالبدايةُ من الآن، لأنّ منحَه
 * مدةً تبدأ في الماضي تُنتج «مدةً مُنحت ولم تُستعمل» وهي حالةٌ لا يفهمها السائقُ ولا الدعم.
 */

import type { SubscriptionPeriodSource } from "./contract-sets.js";
import { paymentReferenceRequired, validationFailed } from "./errors.js";
import type { PeriodDraft, PlanVersion } from "./model.js";
import { addDays, assertTimestamp, laterOf } from "./time.js";

/**
 * صياغةُ مدةٍ بمصدرٍ وعددِ أيامٍ من نسخةِ الخطّة.
 *
 * `currentCoverageEnd` هو مُخرَجُ `state.currentCoverageEnd`: تُمرَّر ولا تُحسب هنا، كي
 * تبقى هذه الدالّةُ قابلةً للاستعمالِ في نبضةٍ قرأت الدفترَ مرّةً واحدة.
 */
export function draftPeriod(input: {
  readonly driverPublicId: string;
  readonly plan: PlanVersion;
  readonly source: SubscriptionPeriodSource;
  readonly grantedDays: number;
  readonly paymentReference?: string | null;
  readonly currentCoverageEnd: string | null;
  readonly now: string;
}): PeriodDraft {
  const { driverPublicId, plan, source, grantedDays, currentCoverageEnd, now } = input;
  assertTimestamp(now, "now");
  if (!Number.isSafeInteger(grantedDays) || grantedDays < 1) {
    // صفرُ أيامٍ ليس منحةً: مدةٌ لا تُغطّي شيئاً تُنتج صفّاً في الدفتر يُقرأ كأنّه منحةٌ ولا
    // يُغيّر حالةً، وهو أسوأُ من رفضٍ صريح.
    throw validationFailed("granted_days", "positive integer");
  }
  const paymentReference = input.paymentReference ?? null;
  if (source === "payment" && paymentReference === null) throw paymentReferenceRequired();
  if (source !== "payment" && paymentReference !== null) {
    // لا مرجعَ دفعٍ على منحةٍ ليست دفعاً (القرار 6): حقلٌ يُملأ خارج معناه يصير بابَ تسريبٍ
    // لبياناتِ سدادٍ لا يجوز أن تراها هذه الخدمة.
    throw validationFailed("payment_reference", "null for non-payment periods");
  }

  const startsAt = currentCoverageEnd ? laterOf(now, assertTimestamp(currentCoverageEnd, "coverage_end")) : now;
  return Object.freeze({
    driverPublicId,
    planCode: plan.planCode,
    planVersion: plan.planVersion,
    source,
    paymentReference,
    grantedDays,
    startsAt,
    endsAt: addDays(startsAt, grantedDays),
  } satisfies PeriodDraft);
}

/** مدةُ التجربة: أيّامُها من نسخةِ الخطّة، ولا مرجعَ دفعٍ لها بحال. */
export function draftTrialPeriod(input: {
  readonly driverPublicId: string;
  readonly plan: PlanVersion;
  readonly now: string;
}): PeriodDraft {
  return draftPeriod({
    driverPublicId: input.driverPublicId,
    plan: input.plan,
    source: "trial",
    grantedDays: input.plan.trialDays,
    currentCoverageEnd: null,
    now: input.now,
  });
}

/** مدةٌ مدفوعة: مدةُ الدورةِ من نسخةِ الخطّة، ومرجعٌ opaque واحدٌ لا أكثر. */
export function draftPaymentPeriod(input: {
  readonly driverPublicId: string;
  readonly plan: PlanVersion;
  readonly paymentReference: string;
  readonly currentCoverageEnd: string | null;
  readonly now: string;
}): PeriodDraft {
  return draftPeriod({
    driverPublicId: input.driverPublicId,
    plan: input.plan,
    source: "payment",
    grantedDays: input.plan.durationDays,
    paymentReference: input.paymentReference,
    currentCoverageEnd: input.currentCoverageEnd,
    now: input.now,
  });
}
