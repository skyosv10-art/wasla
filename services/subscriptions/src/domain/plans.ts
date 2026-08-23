/**
 * كتالوجُ نسخِ الخطط المجمَّدة — بذرةُ الإطلاق (القرار 7).
 *
 * ## لماذا بذرةٌ في المجال ولا صفوفُ `INSERT` في `schema.sql`
 *
 * المراجعة 1/6 أعلنت هذا الدَّين صريحاً: المخطّطُ يُنشئ الجداولَ ولا يزرع صفّاً. والسببُ
 * أنّ الزرعَ في DDL يجعل بذرةَ الخطّة تركض مرّةً واحدةً بلا اختبارٍ يقرؤها؛ فإن اختلف
 * الرقمُ المزروعُ عن الرقم الذي يُعرضه البوتُ لا يفشل شيء. أمّا البذرةُ هنا فيقرؤها اختبارٌ
 * يقارنها حرفياً بثوابتِ حزمة العقد، ومُهاجرةُ 3/6 تكتبها إلى القاعدة من هذا المصدر الواحد.
 *
 * ## لماذا مُجمَّدةٌ فعلياً (`Object.freeze`) لا موصوفةٌ بمجمَّدة
 *
 * `readonly` في TypeScript وعدٌ يختفي عند التصريف. ولو عدّل مسارٌ واحدٌ عنصراً من مصفوفة
 * الاستحقاقات في الذاكرة لصار سائقٌ يرى سقفاً ما رآه غيرُه في نفس العملية، ولا شيءَ في
 * السجلّ يقول لماذا. والتجميدُ يجعل المحاولةَ تفشل في نفس السطر الذي حاولها.
 *
 * ## النسخةُ الخاطئةُ الأرخص
 *
 * أن تُقرأ هذه الأرقامُ من `process.env` أو من ملفِّ إعدادات: تصير مدةُ التجربةِ خاصيّةً
 * للبيئةِ لا للوعد، فيمنح جهازٌ 14 يوماً وجهازٌ 30، ولا يبقى في النظام ما يُثبت ما وُعد به
 * سائقٌ بعينه. ولذلك لا `process.env` في هذا الملف، و`purity.test.ts` يحرس ذلك.
 */

import {
  REFERRAL_QUALIFYING_FACT_COUNT,
  REFERRAL_REWARD_DAYS,
  REFERRAL_WINDOW_DAYS,
  SUBSCRIPTION_LAUNCH_COMMUNITY_DAILY_ORDER_CAP,
  SUBSCRIPTION_LAUNCH_COMMUNITY_GRACE_DAYS,
  SUBSCRIPTION_LAUNCH_DURATION_DAYS,
  SUBSCRIPTION_LAUNCH_PLAN_CODE,
  SUBSCRIPTION_LAUNCH_PLAN_LABEL,
  SUBSCRIPTION_LAUNCH_PLAN_VERSION,
  SUBSCRIPTION_LAUNCH_TRIAL_DAYS,
} from "@wasla/contracts-subscription";

import { planNotFound, planNotFrozen } from "./errors.js";
import type { PlanVersion } from "./model.js";

/**
 * نسخةُ خطّةِ الإطلاق `saudi-driver-monthly` v1.
 *
 * الأرقامُ الأربعةُ الأولى والإحالةُ كلُّها **مُشتقّةٌ من حزمة العقد** لا مكتوبةً هنا: البوتُ
 * يقول للسائق «14 يوم تجربة» و«30 يوم مكافأة»، ولو كُتبت هنا مرّةً وهناك مرّةً لصار لدينا
 * حقيقتان تتباعدان بصمت.
 *
 * أمّا قيمُ الاستحقاقات فتقيم هنا وحدَها لأنّها **بياناتُ كتالوجٍ** لا يعرضها البوتُ رقماً
 * ثابتاً: `accept_orders = -1` إذنٌ بلا سقفٍ في ذاته، والسقفُ اليوميُّ رقمٌ منفصل
 * (`daily_order_cap = 12`) كي لا يحمل رمزٌ واحدٌ معنيَين. و`priority_dispatch = 1` تشغيلٌ
 * لا مقدار، و`zone_multi_select = 3` عددُ النطاقات.
 */
export const LAUNCH_PLAN: PlanVersion = Object.freeze({
  planCode: SUBSCRIPTION_LAUNCH_PLAN_CODE,
  planVersion: SUBSCRIPTION_LAUNCH_PLAN_VERSION,
  label: SUBSCRIPTION_LAUNCH_PLAN_LABEL,
  trialDays: SUBSCRIPTION_LAUNCH_TRIAL_DAYS,
  durationDays: SUBSCRIPTION_LAUNCH_DURATION_DAYS,
  communityGraceDays: SUBSCRIPTION_LAUNCH_COMMUNITY_GRACE_DAYS,
  communityDailyOrderCap: SUBSCRIPTION_LAUNCH_COMMUNITY_DAILY_ORDER_CAP,
  referralRewardDays: REFERRAL_REWARD_DAYS,
  referralQualifyingFacts: REFERRAL_QUALIFYING_FACT_COUNT,
  referralWindowDays: REFERRAL_WINDOW_DAYS,
  isFrozen: true,
  entitlements: Object.freeze([
    Object.freeze({ entitlementCode: "accept_orders", limitValue: -1 }),
    Object.freeze({ entitlementCode: "daily_order_cap", limitValue: 12 }),
    Object.freeze({ entitlementCode: "priority_dispatch", limitValue: 1 }),
    Object.freeze({ entitlementCode: "zone_multi_select", limitValue: 3 }),
  ]),
} satisfies PlanVersion);

/**
 * الكتالوجُ المجمَّدُ عند الإطلاق: نسخةٌ واحدة.
 *
 * ولمَ كتالوجٌ لنسخةٍ واحدة؟ لأنّ النسخةَ الثانيةَ ستوجد يوماً بجوار الأولى لا مكانَها،
 * ومن كتب دالّةً تعرف خطّةً واحدةً بالاسم سيكتب فرعاً `if planCode === …` يومَ تُضاف الثانية.
 */
export const PLAN_CATALOG: ReadonlyArray<PlanVersion> = Object.freeze([LAUNCH_PLAN]);

/** قراءةُ نسخةِ خطّةٍ بالرمز والنسخة معاً: الرمزُ وحده ليس مرجعاً تاريخياً كافياً. */
export function findPlanVersion(planCode: string, planVersion: number): PlanVersion | undefined {
  return PLAN_CATALOG.find(
    (plan) => plan.planCode === planCode && plan.planVersion === planVersion,
  );
}

/**
 * قراءةُ نسخةٍ **صالحةٍ للمنح**: موجودةٌ ومجمَّدة.
 *
 * الفصلُ بين «غيرُ موجودة» (404) و«غيرُ مجمَّدة» (422) مقصود: الأولى خطأٌ في المرجع
 * والثانيةُ حالةٌ في الكتالوج، ودمجُهما في رمزٍ واحدٍ يجعل مستهلكاً يُعيد المحاولةَ على ما
 * لن يتغيّر أو يستسلم لما كان سيُصلَح بتجميد.
 */
export function requireGrantablePlan(planCode: string, planVersion: number): PlanVersion {
  const plan = findPlanVersion(planCode, planVersion);
  if (!plan) throw planNotFound(planCode, planVersion);
  if (!plan.isFrozen) throw planNotFrozen(planCode, planVersion);
  return plan;
}
