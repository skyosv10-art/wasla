/**
 * الاستحقاقاتُ الفعليّةُ لكلّ حالة — و«أرضيّةُ المجتمع» ما هي بالضبط (القرار 4).
 *
 * ## القاعدة
 *
 * - `trial` و`active`: استحقاقاتُ نسخةِ الخطّة **كما أُعلنت**، بلا زيادةٍ ولا نقصان.
 * - `expired` و`community`: **الأرضيّة** — `accept_orders` كما أعلنتها الخطّة، و`daily_order_cap`
 *   بقيمة `communityDailyOrderCap` من نسخةِ الخطّة. وتُحذَف الامتيازاتُ المدفوعةُ
 *   (`priority_dispatch` و`zone_multi_select`) لأنّها هي التي دُفع من أجلها.
 *
 * ## لماذا `expired` و`community` سواءٌ في الاستحقاق
 *
 * سؤالٌ يستحقّ جواباً صريحاً: إن كانت الأرضيّةُ واحدةً فما معنى مهلةِ
 * `community_grace_days`؟ معناها أنّ المهلةَ **نافذةُ تذكيرٍ لا نافذةُ امتياز**: الحالةُ
 * `expired` تقول «مدةٌ مدفوعةٌ انقضت للتوّ ونتوقّع تجديداً» فيُخاطب البوتُ صاحبَها بذلك،
 * و`community` تقول «مضت المهلةُ وهذا سائقٌ على الأرضيّة إلى أن يُجدّد». الفرقُ في **ما
 * يُقال وما يُقاس**، لا في ما يُسمح به.
 *
 * والنسختان الخاطئتان الأرخص، وكلتاهما مررت بها هنا صراحةً:
 *
 * **(أ) أن تمنح المهلةُ استحقاقاتِ الخطّةِ المدفوعةِ كاملةً.** حينها يصير كلُّ سائقٍ
 * قادراً على أخذِ سبعةِ أيامٍ مدفوعةِ المزايا مجاناً في نهايةِ كلّ دورة، فتتحوّل المهلةُ
 * إلى تمديدٍ دوريٍّ يُستهلَك عن قصد، ويصير الدفعُ في اليوم الأخيرِ سلوكاً غبياً.
 *
 * **(ب) أن تُجرّد `expired` من كلّ شيءٍ ثم تُعيد الأرضيّةَ في `community`.** حينها تصير
 * المهلةُ **أسوأَ** من نهايتها: يُمنع السائقُ من العمل سبعةَ أيامٍ ثم يُسمح له بثلاثةِ طلبات،
 * فيكون في مصلحته أن تمرَّ المهلةُ بسرعة. قاعدةٌ يكون الانتظارُ فيها أنفعَ من التصرّف
 * قاعدةٌ مكسورة.
 *
 * ## سقفٌ صفرٌ يُلغي الإذن
 *
 * لو أعلنت نسخةُ خطّةٍ `communityDailyOrderCap = 0` فالأرضيّةُ **بلا `accept_orders`**: إذنٌ
 * بقبولِ الطلبات مع سقفٍ صفرٍ عبارةٌ متناقضةٌ يقرأها كلُّ مستهلكٍ كما يشاء، والمستهلكُ
 * المتفائلُ سيقبل طلباً.
 */

import {
  SUBSCRIPTION_COMMUNITY_FLOOR_ENTITLEMENTS,
  SUBSCRIPTION_PAID_ONLY_ENTITLEMENTS,
  type SubscriptionState,
} from "./contract-sets.js";
import type { Entitlement, PlanVersion } from "./model.js";

/** الحالتان اللتان تعملان على الأرضيّة. تُصدَّر كي يقرأها الاختبارُ ولا يُعيد كتابتها. */
export const FLOOR_STATES: ReadonlyArray<SubscriptionState> = Object.freeze(["expired", "community"]);

function limitFor(plan: PlanVersion, code: string): number | undefined {
  return plan.entitlements.find((entitlement) => entitlement.entitlementCode === code)?.limitValue;
}

/**
 * استحقاقاتُ حالةٍ بعينها من نسخةِ خطّةٍ بعينها.
 *
 * الترتيبُ مُثبَّتٌ على ترتيب `SUBSCRIPTION_ENTITLEMENTS` عبر ترتيبِ الخطّة نفسِها، لأنّ
 * مستهلكاً يقارن استجابتَين بالتسلسل لا ينبغي أن يرى فرقاً سببُه الفرزُ وحده.
 */
export function effectiveEntitlements(
  plan: PlanVersion,
  state: SubscriptionState,
): ReadonlyArray<Entitlement> {
  if (!FLOOR_STATES.includes(state)) {
    return plan.entitlements.map((entitlement) => ({ ...entitlement }));
  }

  const floor: Entitlement[] = [];
  const acceptLimit = limitFor(plan, "accept_orders");
  if (acceptLimit !== undefined && plan.communityDailyOrderCap > 0) {
    floor.push({ entitlementCode: "accept_orders", limitValue: acceptLimit });
  }
  if (SUBSCRIPTION_COMMUNITY_FLOOR_ENTITLEMENTS.includes("daily_order_cap")) {
    floor.push({ entitlementCode: "daily_order_cap", limitValue: plan.communityDailyOrderCap });
  }
  return floor;
}

/** هل هذا الرمزُ مدفوعٌ فقط؟ يُصدَّر لأنّ طبقاتٍ لاحقةً ستحتاج السؤالَ ولا ينبغي أن تُجيبَه بنفسها. */
export function isPaidOnlyEntitlement(code: string): boolean {
  return (SUBSCRIPTION_PAID_ONLY_ENTITLEMENTS as ReadonlyArray<string>).includes(code);
}
