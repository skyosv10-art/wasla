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
