/**
 * جدولُ الانتقالات: **قائمةٌ واحدةٌ مُعلَنة**، تُقرأ ولا تُكتب ثانيةً.
 *
 * `SUBSCRIPTION_ALLOWED_TRANSITIONS` تقيم في `@wasla/contracts-subscription` ويحرسها
 * `packages/contracts/subscription/src/__tests__/schema.test.ts`. هذا الملفُّ **لا يُعلن
 * جدولاً ثانياً** ولا يكتب أزواجَ حالاتٍ بيده: يقرأ القائمةَ ويرفض ما ليس فيها.
 *
 * لماذا هذا مهمٌّ لدرجةِ التصريح: جدولٌ ثانٍ في الخدمة يكون مطابقاً يومَ يُكتب، ثم يُضاف
 * انتقالٌ في مكانٍ واحدٍ فيصير أحدُ الجدولَين كاذباً — والكاذبُ هو الذي لا يحرسه اختبار،
 * ولا أحدَ يعرف أيُّهما.
 *
 * ## الانتقالاتُ السبعةُ المُعلَنة
 *
 * `∅ → trial` · `trial → active` · `trial → expired` · `active → expired` ·
 * `expired → active` · `expired → community` · `community → active`
 *
 * ولا `active → active`: **التجديدُ مدةٌ في الدفتر لا انتقال** (القرار 3). انتقالٌ من حالةٍ
 * إلى نفسِها لا يحمل معلومةً يقرؤها مُدقّق، ووجودُه في الجدول يجعله المكانَ الطبيعيّ الذي
 * يُسجّل فيه كاتبٌ عجولٌ «شيئاً حدث»، فيمتلئ الجدولُ بصفوفٍ لا تفرّق بين تجديدٍ حقيقيٍّ
 * وإعادةِ حسابٍ لا شيءَ تغيّر فيها.
 *
 * ولا `community → expired` ولا `community → trial`: الأرضيّةُ لا تسوء، والتجربةُ تُمنح
 * مرّةً. ولا `trial → community`: من لم يدفع قطُّ يمرّ بالانقضاء أوّلاً كما يمرّ من دفع،
 * فلا يكون لأصلِ المدة أثرٌ في مسار الحالات.
 */

import {
  SUBSCRIPTION_ALLOWED_TRANSITIONS,
  type SubscriptionPeriodSource,
  type SubscriptionState,
  type SubscriptionTransitionReason,
} from "./contract-sets.js";
import { transitionNotAllowed, validationFailed } from "./errors.js";
import type { TransitionDraft } from "./model.js";
import { assertTimestamp } from "./time.js";

/** هل الزوجُ مُعلَنٌ في العقد؟ سؤالٌ بلا استثناءات. */
export function isAllowedTransition(
  fromState: SubscriptionState | null,
  toState: SubscriptionState,
): boolean {
  return SUBSCRIPTION_ALLOWED_TRANSITIONS.some(
    ([from, to]) => from === fromState && to === toState,
  );
}

/** يرفع `SUBSCRIPTION_TRANSITION_NOT_ALLOWED` لكلّ زوجٍ غيرِ مُعلَن، وفيه `active → active`. */
export function assertTransition(
  fromState: SubscriptionState | null,
  toState: SubscriptionState,
): void {
  if (!isAllowedTransition(fromState, toState)) throw transitionNotAllowed(fromState, toState);
}

/**
 * سببُ الانتقال، مُشتقّاً من (الزوجِ · مصدرِ المدة المُسبِّبة).
 *
 * لماذا يُشتقّ ولا يُمرَّر: سببٌ يختاره المُنادي يجعل صفَّين متطابقَين في `subscriptions`
 * يحملان سببَين مختلفَين، فيسقط معنى العمود أصلاً. وهنا السببُ **دالّةٌ** من الزوج والمصدر،
 * فأيُّ سائقَين مرّا بنفس الطريق يحملان نفسَ السبب.
 *
 * والمصدرُ مطلوبٌ للانتقال إلى `active` وحدَه، ولذلك هو `null` في غيره: تمييزُ
 * `payment_activated` من `referral_reward_applied` هو الفرقُ بين «دفع» و«أُحيل»، وهو أهمُّ
 * سؤالٍ في تقريرِ نموّ الطور. أمّا الانقضاءُ فسببُه واحدٌ لا يحتاج مصدراً.
 */
export function reasonForTransition(
  fromState: SubscriptionState | null,
  toState: SubscriptionState,
  causingPeriodSource: SubscriptionPeriodSource | null,
): SubscriptionTransitionReason {
  assertTransition(fromState, toState);

  if (toState === "trial") {
    if (causingPeriodSource !== null && causingPeriodSource !== "trial") {
      throw validationFailed("source", "trial period as the cause of a trial state");
    }
    return "trial_granted";
  }

  if (toState === "active") {
    if (causingPeriodSource === "payment") return "payment_activated";
    if (causingPeriodSource === "referral_reward") return "referral_reward_applied";
    // تجربةٌ لا تُنتج `active`، وغيابُ المصدرِ لا يُخمَّن: لو خمّنّا «دفعاً» لصار تقريرُ
    // النموّ يُنسب إلى الدفعِ ما سببُه إحالة، وهو أسوأُ من غيابِ الرقم.
    throw validationFailed("source", "payment or referral_reward period as the cause");
  }

  if (toState === "expired") return "period_ended";
  return "community_grace_ended";
}

/** مسوّدةُ انتقالٍ مكتملة؛ تكتبها المعاملةُ في 3/6 بتسلسلٍ تُنشئه القاعدة لا المجال. */
export function draftTransition(
  fromState: SubscriptionState | null,
  toState: SubscriptionState,
  causingPeriodSource: SubscriptionPeriodSource | null,
  occurredAt: string,
): TransitionDraft {
  const reasonCode = reasonForTransition(fromState, toState, causingPeriodSource);
  return Object.freeze({
    fromState,
    toState,
    reasonCode,
    occurredAt: assertTimestamp(occurredAt, "occurred_at"),
  } satisfies TransitionDraft);
}

/**
 * أقصرُ طريقٍ **مُعلَنٍ** من حالةٍ إلى حالة — لا وثبةٌ واحدةٌ تتجاوز حالاتٍ وسطى.
 *
 * ## الخللُ الذي أوجد هذه الدالّة
 *
 * الاشتقاقُ يقرأ الدفترَ عند لحظةٍ واحدةٍ فيقول «هذا السائقُ في `community` الآن»، والصفُّ
 * المُتحقِّقُ ما زال يقول `trial` لأنّ نبضةً لم تمرّ عليه شهراً. و`[trial, community]` ليس
 * زوجاً مُعلَناً في `SUBSCRIPTION_ALLOWED_TRANSITIONS`، فكانت إعادةُ الحسابِ ترفع
 * `SUBSCRIPTION_TRANSITION_NOT_ALLOWED` (409) وتعدُّ النبضةُ العمليّةَ فشلاً — **إلى الأبد**:
 * كلُّ نبضةٍ تالية تجد نفسَ الصفّ وتفشل نفسَ الفشل، فيبقى سائقٌ انقضت مهلتُه معلَّقاً في
 * `trial` ولا مسارَ في النظام يُخرجه. اكتُشف في تكامل 4/6 (نبضةٌ بـ`failures: 1`).
 *
 * ## ولماذا طريقٌ لا زوجٌ إضافيّ
 *
 * النسخةُ الخاطئةُ الأرخص إضافةُ `[trial, community]` و`[active, community]` إلى العقد:
 * تُسكِت الخطأَ وتمحو من دفترِ الانتقالات أنّ السائقَ **انقضى** ثمّ نزل إلى الأرضيّة — وهما
 * حادثتان لكلِّ واحدةٍ منهما رسالةٌ للسائق وأثرٌ في تقريرِ الطور. فالطريقُ يُكتب كاملاً:
 * انتقالان بسببَيهما (`period_ended` ثمّ `community_grace_ended`) في نفس المعاملة.
 *
 * البحثُ بالعرضِ على الأزواجِ المُعلَنةِ نفسِها لا على جدولٍ ثانٍ مكتوبٍ بيدنا: جدولٌ ثانٍ
 * يجعل يومَ تُضاف حالةٌ خامسةٌ للعقدِ رأيَين على الرسمِ نفسِه. وأقصرُ طريقٍ لأنّ طريقاً أطولَ
 * يكتب في التاريخِ حادثةً لم تقع.
 */
export function transitionPath(
  fromState: SubscriptionState | null,
  toState: SubscriptionState,
): ReadonlyArray<readonly [SubscriptionState | null, SubscriptionState]> {
  if (fromState === toState) return Object.freeze([]);

  type Hop = readonly [SubscriptionState | null, SubscriptionState];
  const queue: Array<{ readonly state: SubscriptionState | null; readonly path: Hop[] }> = [
    { state: fromState, path: [] },
  ];
  // `null` حالةُ البداية ولها مفتاحُها: من دونه يصير «لا اشتراك» و«اشتراكٌ اسمُه null»
  // شيئاً واحداً في البحث.
  const seen = new Set<string>([String(fromState)]);

  while (queue.length > 0) {
    const { state, path } = queue.shift()!;
    for (const [from, to] of SUBSCRIPTION_ALLOWED_TRANSITIONS) {
      if (from !== state) continue;
      const extended: Hop[] = [...path, [state, to] as const];
      // فحصُ الهدفِ قبل `seen`: الهدفُ قد يكون حالةً زُرناها كجارٍ في مستوىً سابق.
      if (to === toState) return Object.freeze(extended);
      if (seen.has(to)) continue;
      seen.add(to);
      queue.push({ state: to, path: extended });
    }
  }

  // لا طريقَ في الرسمِ المُعلَن — والرفضُ بنفسِ رمزِ الزوجِ الواحد: من ينظر في السجلّ يسأل
  // «كيف يصل من هذه إلى هذه؟» لا «أيَّ خوارزميّةٍ استعملنا».
  throw transitionNotAllowed(fromState, toState);
}
