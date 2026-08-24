/**
 * حرّاسُ المُعرّفات — في المجال، لا على الحدّ.
 *
 * ## لماذا هنا ولا في `http/requests.ts`
 *
 * لأنّ الحدَّ ليس المُنادي الوحيد. النبضةُ تنادي `recompute` من داخل العمليّة، والمراجعةُ
 * 5/6 ستنادي منحَ المكافأةِ من مستهلكِ أحداث، وكلاهما يُمرّر مُعرّفاتٍ لا تعبر HTTP. فحرسٌ
 * يسكن على الحدِّ وحدَه يقول عمليّاً «القاعدةُ تسري على الغرباء لا علينا» — وأخطرُ صفٍّ
 * مشوّهٍ في الدفتر هو الذي كتبناه نحن.
 *
 * ## وأنماطُ المُعرّفاتِ تُستورَد ولا تُكتب
 *
 * `WASLA_PUBLIC_ID_PATTERN` و`REFERRAL_CODE_PATTERN` يأتيان من `@wasla/contracts-subscription`
 * حيث يحرسهما `contract-drift` ضدّ `api.openapi.yml`. ونسخةٌ مكتوبةٌ بيدٍ هنا كانت ستصير
 * موضعاً ثانياً عليه أن يوافق، وأرخصُ نسخةٍ خاطئةٍ أن يوافق أحدُهما ويُنسى الآخر — فيُقبل
 * `WS-123` في خدمةٍ ويُرفض في أخرى، والسائقُ واحد.
 *
 * ## و`planCode` نمطُه في المخطّط لا في الكتالوج
 *
 * `PLAN_CATALOG` بذرةٌ فيها رمزٌ واحدٌ اليوم، فلا يجوز أن يصير حرسَ الشكل: خطّةٌ تُضاف غداً
 * ستُرفض بحرسٍ يقيس على البذرة. والحدُّ الحقيقيُّ عمودُ القاعدةِ ومخطّطُ العقد
 * (`^[a-z0-9]+(?:-[a-z0-9]+)*$` بطولِ 3..64)، وهو ما يُفحص هنا. والوجودُ الفعليُّ سؤالٌ آخر
 * يجيب عنه المخزنُ بـ`SUBSCRIPTION_PLAN_NOT_FOUND`.
 */

import { REFERRAL_CODE_PATTERN, WASLA_PUBLIC_ID_PATTERN } from "@wasla/contracts-subscription";

import { validationFailed } from "./errors.js";

/** نفسُ حدِّ `plan_code` في `SubscriptionPlan` وفي عمودِ `subscription_plans`. */
const PLAN_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLAN_CODE_MIN = 3;
const PLAN_CODE_MAX = 64;

export function assertWaslaPublicId(value: unknown, field = "driver_public_id"): string {
  if (typeof value !== "string" || !WASLA_PUBLIC_ID_PATTERN.test(value)) {
    throw validationFailed(field, "WS-##########");
  }
  return value;
}

export function assertReferralCode(value: unknown, field = "referral_code"): string {
  if (typeof value !== "string" || !REFERRAL_CODE_PATTERN.test(value)) {
    throw validationFailed(field, "WR-XXXXXXXX");
  }
  return value;
}

export function assertPlanCode(value: unknown, field = "plan_code"): string {
  if (
    typeof value !== "string" ||
    value.length < PLAN_CODE_MIN ||
    value.length > PLAN_CODE_MAX ||
    !PLAN_CODE_PATTERN.test(value)
  ) {
    throw validationFailed(field, "رمز خطّة بأحرف صغيرة وشُرَط");
  }
  return value;
}

/**
 * نسخةُ الخطّة عددٌ صحيحٌ ≥ 1 — و`1.0` مرفوضٌ لا مُقرَّب.
 *
 * لأنّ النسخةَ مفتاحٌ مركّبٌ في القاعدة: `1.0` يمرّ من `Number.isInteger` فعلاً، لكن
 * `1.5` القادمَ من JSON كان سيُقرَّب بصمتٍ إلى خطّةٍ أخرى — أي يُمنح السائقُ وعدَ نسخةٍ لم
 * يطلبها أحد.
 */
export function assertPlanVersion(value: unknown, field = "plan_version"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw validationFailed(field, "عدد صحيح ≥ 1");
  }
  return value;
}
