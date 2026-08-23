/**
 * المجموعات المُقفلة، مُشتقّةً من حزمة العقد ولا مُعلَنةً هنا.
 *
 * حزمة `@wasla/contracts-reputation` تُصدّر المصفوفات المجمَّدة (`REPUTATION_TIERS`،
 * `FRAUD_RULE_CODES`، …) ولا تُصدّر أسماء أنواعٍ لها. هذا الملف يُشتقّ الأنواع من نفس
 * المصفوفات بـ`typeof … [number]` ويُعيد تصديرها، فلا تُكتب قائمةُ أعضاءٍ ثانية في
 * هذا المستودع بحال.
 *
 * الفرق ليس شكلياً: قائمةٌ مكتوبةً بيدٍ ثانية تُصبح صحيحةً اليوم وكاذبةً يومَ يُضاف عضو،
 * ويكون الكاذبُ هو النسخة التي لا يحرسها أحد. أمّا الاشتقاق فيفشل في `tsc` في نفس
 * اللحظة التي تتغيّر فيها المصفوفة.
 *
 * وهذا الملف **لا منطق فيه**: لا تحويل ولا افتراض ولا قيمة جديدة. من أراد إضافة عضوٍ
 * يُعدّل العقد ويُعيد توليد الأنواع ويُمرّر الحرّاس الـ81، لا يُعدّل هنا.
 */

import {
  FRAUD_RULE_CODES,
  FRAUD_SEVERITIES,
  REPUTATION_FACT_KINDS,
  REPUTATION_RATING_REASON_CODES,
  REPUTATION_RECOMPUTE_TRIGGERS,
  REPUTATION_SOURCE_EVENT_TYPES,
  REPUTATION_SUBJECT_TYPES,
  REPUTATION_TIERS,
} from "@wasla/contracts-reputation";

export {
  FRAUD_RULE_CODES,
  FRAUD_SEVERITIES,
  REPUTATION_FACT_KINDS,
  REPUTATION_RATING_MAX_STARS,
  REPUTATION_RATING_MIN_STARS,
  REPUTATION_RATING_REASON_CODES,
  REPUTATION_RECOMPUTE_TRIGGERS,
  REPUTATION_SERVICE_PORT,
  REPUTATION_SOURCE_EVENT_TYPES,
  REPUTATION_SUBJECT_TYPES,
  REPUTATION_TIERS,
  REPUTATION_LAUNCH_RULESET_LABEL,
  REPUTATION_LAUNCH_RULESET_VERSION,
} from "@wasla/contracts-reputation";

export type ReputationSubjectType = (typeof REPUTATION_SUBJECT_TYPES)[number];
export type ReputationFactKind = (typeof REPUTATION_FACT_KINDS)[number];
export type ReputationTier = (typeof REPUTATION_TIERS)[number];
export type ReputationRecomputeTrigger = (typeof REPUTATION_RECOMPUTE_TRIGGERS)[number];
export type ReputationRatingReasonCode = (typeof REPUTATION_RATING_REASON_CODES)[number];
export type FraudRuleCode = (typeof FRAUD_RULE_CODES)[number];
export type FraudSeverity = (typeof FRAUD_SEVERITIES)[number];
export type ReputationSourceEventType = (typeof REPUTATION_SOURCE_EVENT_TYPES)[number];
