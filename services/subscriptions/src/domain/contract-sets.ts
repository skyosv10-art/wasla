/**
 * المجموعاتُ المُقفلة، مُشتقّةً من حزمة العقد ولا مُعلَنةً هنا (سابقةُ Phase 09:
 * `services/reputation/src/domain/contract-sets.ts`).
 *
 * حزمةُ `@wasla/contracts-subscription` تُصدّر المصفوفاتِ المجمَّدة (`SUBSCRIPTION_STATES`،
 * `SUBSCRIPTION_PERIOD_SOURCES`، `REFERRAL_STATES`، …) ولا تُصدّر أسماءَ أنواعٍ لها. هذا
 * الملفّ يشتقّ الأنواعَ من نفس المصفوفات بـ`typeof … [number]` ويُعيد تصديرَها، فلا تُكتب
 * قائمةُ أعضاءٍ ثانيةٌ في هذا المستودع بحال.
 *
 * الفرقُ ليس شكلياً: قائمةٌ مكتوبةٌ بيدٍ ثانيةٍ تكون صحيحةً اليومَ وكاذبةً يومَ يُضاف عضوٌ،
 * ويكون الكاذبُ هو النسخةَ التي لا يحرسها أحد. أمّا الاشتقاقُ فيفشل في `tsc` في نفس
 * اللحظة التي تتغيّر فيها المصفوفة.
 *
 * ملاحظةُ اسمٍ مقصودة: `SubscriptionState` هنا **اتحادُ الحالات الأربع**، أمّا موردُ
 * OpenAPI فيُصدَّر من الحزمة باسم `SubscriptionStateResource`. الاسمان مفصولان لأنّ خلطَهما
 * كان سيجعل «الحالة» تعني مرّةً كلمةً ومرّةً كائناً بأحدَ عشرَ حقلاً.
 *
 * وهذا الملفّ **لا منطقَ فيه**: لا تحويلَ ولا افتراضَ ولا قيمةً جديدة. من أراد إضافةَ عضوٍ
 * يُعدّل العقدَ ويُعيد توليدَ الأنواع ويُمرّر حرّاسَ حزمة العقد، لا يُعدّل هنا.
 */

import {
  REFERRAL_REJECTION_REASONS,
  REFERRAL_STATES,
  SUBSCRIPTION_ALLOWED_TRANSITIONS,
  SUBSCRIPTION_COMMUNITY_FLOOR_ENTITLEMENTS,
  SUBSCRIPTION_ENTITLEMENTS,
  SUBSCRIPTION_PAID_ONLY_ENTITLEMENTS,
  SUBSCRIPTION_PERIOD_SOURCES,
  SUBSCRIPTION_STATES,
  SUBSCRIPTION_TRANSITION_REASONS,
} from "@wasla/contracts-subscription";

export {
  REFERRAL_REJECTION_REASONS,
  REFERRAL_STATES,
  SUBSCRIPTION_ALLOWED_TRANSITIONS,
  SUBSCRIPTION_COMMUNITY_FLOOR_ENTITLEMENTS,
  SUBSCRIPTION_ENTITLEMENTS,
  SUBSCRIPTION_PAID_ONLY_ENTITLEMENTS,
  SUBSCRIPTION_PERIOD_SOURCES,
  SUBSCRIPTION_STATES,
  SUBSCRIPTION_TRANSITION_REASONS,
};

export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];
export type SubscriptionTransitionReason = (typeof SUBSCRIPTION_TRANSITION_REASONS)[number];
export type SubscriptionPeriodSource = (typeof SUBSCRIPTION_PERIOD_SOURCES)[number];
export type SubscriptionEntitlementCode = (typeof SUBSCRIPTION_ENTITLEMENTS)[number];
export type ReferralState = (typeof REFERRAL_STATES)[number];
export type ReferralRejectionReason = (typeof REFERRAL_REJECTION_REASONS)[number];
