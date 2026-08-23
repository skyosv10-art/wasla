/**
 * تحقّقُ الحدّ: كلُّ ما يدخل المجال يُقرأ مرّةً واحدة ويُرفَض هنا أو يُقبَل مُنمَّطاً.
 *
 * الحرّاس هنا **نفسها** قيودُ `CHECK` في `schema.sql`، مكتوبةً بلغة TypeScript. وليس
 * هذا تكراراً بلا داعٍ بل خطّا دفاعٍ مقصودان (`errors.md` §القاعدة البند 6): المجال
 * يرفض مبكراً برمزٍ يُفسَّر للمستدعي، والقاعدة ترفض متأخراً باسم قيدٍ يُعثَر عليه. من
 * يحذف أحدهما يظنّ أنّه أزال تكراراً، وهو أزال خطّ دفاع.
 *
 * ولا دالّةَ هنا تُصلح مدخلاً: لا تشذيبَ مسافات ولا رفعَ حالةِ أحرف ولا تحويلَ نصٍّ إلى
 * رقم. «الإصلاح الودود» يجعل مُعرّفين مختلفين نفس الشخص، ويُخفي علّةً في المُنتِج تظهر
 * بعد شهورٍ كسمعتين لواحد.
 */

import {
  FRAUD_RULE_CODES,
  FRAUD_SEVERITIES,
  REPUTATION_FACT_KINDS,
  REPUTATION_RATING_MAX_STARS,
  REPUTATION_RATING_MIN_STARS,
  REPUTATION_RATING_REASON_CODES,
  REPUTATION_SUBJECT_TYPES,
  REPUTATION_TIERS,
  type FraudRuleCode,
  type FraudSeverity,
  type ReputationFactKind,
  type ReputationRatingReasonCode,
  type ReputationSubjectType,
  type ReputationTier,
} from "./contract-sets.js";
import { validationFailed } from "./errors.js";
import {
  ORDER_PUBLIC_ID_PATTERN,
  REPUTATION_ACTOR_TYPES,
  WASLA_PUBLIC_ID_PATTERN,
  type ReputationActorType,
} from "./model.js";

function assertMember<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw validationFailed(field, allowed.join(" | "));
  }
  return value as T;
}

export function assertSubjectType(value: unknown, field = "subjectType"): ReputationSubjectType {
  return assertMember(value, REPUTATION_SUBJECT_TYPES, field);
}

export function assertFactKind(value: unknown, field = "factKind"): ReputationFactKind {
  return assertMember(value, REPUTATION_FACT_KINDS, field);
}

export function assertTier(value: unknown, field = "tier"): ReputationTier {
  return assertMember(value, REPUTATION_TIERS, field);
}

export function assertActorType(value: unknown, field = "actorType"): ReputationActorType {
  return assertMember(value, REPUTATION_ACTOR_TYPES, field);
}

export function assertFraudRuleCode(value: unknown, field = "ruleCode"): FraudRuleCode {
  return assertMember(value, FRAUD_RULE_CODES, field);
}

export function assertSeverity(value: unknown, field = "severity"): FraudSeverity {
  return assertMember(value, FRAUD_SEVERITIES, field);
}

/** المُعرّف العامّ للشخص: `WS-` وعشرةُ أرقام. مرجعٌ opaque لا ملفَّ مستخدمٍ ولا مفتاحَ أجنبي. */
export function assertWaslaPublicId(value: unknown, field = "subjectPublicId"): string {
  if (typeof value !== "string" || !WASLA_PUBLIC_ID_PATTERN.test(value)) {
    throw validationFailed(field, "WS-<10 digits>");
  }
  return value;
}

export function assertOrderPublicId(value: unknown, field = "orderPublicId"): string {
  if (typeof value !== "string" || !ORDER_PUBLIC_ID_PATTERN.test(value)) {
    throw validationFailed(field, "ORD-<10 digits>");
  }
  return value;
}

/**
 * ترتيبُ الانتقال على الطلب كما جاء في الحدث. صحيحٌ ≥ 1.
 *
 * مفتاحُ عدم التكرار لا معلومةٌ زائدة: به وحده تُميَّز إعادةُ التسليم من واقعةٍ ثانية
 * حقيقية على نفس الطلب.
 */
export function assertSourceSequence(value: unknown, field = "sourceSequence"): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw validationFailed(field, "integer >= 1");
  }
  return value as number;
}

export function assertSourceEventType(value: unknown, field = "sourceEventType"): string {
  if (typeof value !== "string" || value.length < 3) {
    throw validationFailed(field, "string with length >= 3");
  }
  return value;
}

/** مُعرّف الحدث: نصٌّ غيرُ فارغ. شكلُ UUID يحرسه العقد، والمجال لا يُعيد تحليله. */
export function assertSourceEventId(value: unknown, field = "sourceEventId"): string {
  if (typeof value !== "string" || value.length === 0) {
    throw validationFailed(field, "non-empty identifier");
  }
  return value;
}

/**
 * الدرجة: صحيحٌ في 1..5، والحدّان من العقد لا من الواجهة.
 *
 * واجهةٌ بعشر نجومٍ تُنتج بياناً لا يُقارَن بما قبله، ونصفُ نجمةٍ يُنتج عاشرياً في عمودٍ
 * صحيح فيُقرَّب بصمت.
 */
export function assertStars(value: unknown, field = "stars"): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < REPUTATION_RATING_MIN_STARS ||
    (value as number) > REPUTATION_RATING_MAX_STARS
  ) {
    throw validationFailed(field, `integer ${REPUTATION_RATING_MIN_STARS}..${REPUTATION_RATING_MAX_STARS}`);
  }
  return value as number;
}

/** رمزُ سببٍ من قائمةٍ مُقفلة، أو غيابُه. لا نصَّ حرّاً بحال (ADR-014 القرار 5). */
export function assertRatingReasonCode(
  value: unknown,
  field = "reasonCode",
): ReputationRatingReasonCode | null {
  if (value === null || value === undefined) return null;
  return assertMember(value, REPUTATION_RATING_REASON_CODES, field);
}

/** رمزُ سببِ الواقعة: نصٌّ من مفردات محرّك الطلب بطولٍ 2..64، أو غيابُه. */
export function assertFactReasonCode(value: unknown, field = "reasonCode"): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length < 2 || value.length > 64) {
    throw validationFailed(field, "string with length 2..64, or null");
  }
  return value;
}

/**
 * رفضُ أيّ مفتاحٍ غير مُعلَن في حمولةٍ.
 *
 * `additionalProperties: false` في العقد يعني أنّ مفتاحاً زائداً خطأٌ لا تفصيلاً
 * يُتجاهَل. وتجاهُلُه هو ما يجعل خطأً مطبعياً في اسم حقلٍ يمرّ بنجاحٍ ظاهر وقيمةٍ
 * افتراضيةٍ صامتة، ثم يُكتشَف كسلوكٍ ناقصٍ لا كخطأ.
 */
export function onlyKeys<T extends object>(payload: T, allowed: readonly string[]): T {
  for (const key of Object.keys(payload)) {
    if (!allowed.includes(key)) throw validationFailed(key, `one of: ${allowed.join(", ")}`);
  }
  return payload;
}
