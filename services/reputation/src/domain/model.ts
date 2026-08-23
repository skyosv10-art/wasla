/**
 * نموذج مجال السمعة وإشارات الاحتيال.
 *
 * صفوف `services/reputation/contracts/schema.sql` بلغة TypeScript وبأسماء camelCase.
 * شكلُ السلك snake_case شأنُ تحويلٍ يقيم في `mappers.ts` (المراجعة 4/6)، فلا يتعلّم
 * المجال اسمين لحقلٍ واحد.
 *
 * ## ما لا يُعاد تعريفه هنا
 *
 * كل مجموعةٍ مُقفلة — الجانبان، أنواع الوقائع، الرتب، رموز أسباب التقييم، قواعد
 * الاحتيال، الشدّات، مُحرّضات إعادة الحساب — **تُعاد تصديراً** من
 * `@wasla/contracts-reputation` ولا تُعلَن ثانية. نسخةٌ ثانية لمجموعةٍ مُقفلة حقيقةٌ
 * ثانية، والنسخةُ هي التي تنسى العضو الجديد دائماً. وحزمة العقد نفسها محروسةٌ ضد
 * الـDDL بـ81 حارساً (المراجعة 1/6)، فما صحّ هنا صحّ في القاعدة.
 *
 * ## ما يرفض النموذج تمثيله
 *
 * لا حقل `isFraudster` ولا `state` على الإشارة ولا `suspendedUntil` على النتيجة
 * (ADR-014 القرار 7): هذه الخدمة **لا تعاقب**، وحقلٌ كهذا دعوةٌ لمستهلكٍ أن يحجب
 * بناءً على رقمٍ لا مالك لقراره.
 *
 * لا حقل `comment` ولا `note` ولا `body` على التقييم (القرار 5). غيابُه مقصودٌ
 * ومُعلَن كي لا يُضاف لاحقاً بحسن نيّة: النصّ يحتاج تنقيحاً وحجباً ومالكاً، وذاك Phase 16.
 *
 * لا حقل `decayedWeight` مُخزَّن على الواقعة. الوقائع **لا تتغيّر**: يُحسب التلاشي
 * لحظةَ الحساب من `occurredAt` ومن اللحظة المُمرَّرة، فلو خُزِّن لصار الدفتر يتحرّك
 * تحت من يقرؤه، ولانتهى «حذفُ جدول النتائج عملٌ بلا خسارة».
 *
 * لا حقل `isExpired` على نافذة تقييم ولا `remainingHours`: الانتهاء مقارنةٌ بين
 * `occurredAt` وساعةِ نسخة القواعد وساعةِ الحاقن، تُحسب في `time.ts`. قيمةٌ مُخزّنة
 * كهذه تكون صادقةً حتى الثانية التالية فقط.
 */

import type {
  FraudRuleCode,
  FraudSeverity,
  ReputationFactKind,
  ReputationRatingReasonCode,
  ReputationRecomputeTrigger,
  ReputationSubjectType,
  ReputationTier,
} from "./contract-sets.js";

export type {
  FraudRuleCode,
  FraudSeverity,
  ReputationFactKind,
  ReputationRatingReasonCode,
  ReputationRecomputeTrigger,
  ReputationSubjectType,
  ReputationTier,
};

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
} from "./contract-sets.js";

/**
 * الفاعل كما يسمّيه محرّك الطلب. مرجعٌ لا حُكم.
 *
 * ليس في حزمة العقد مجموعةٌ مُصدَّرة له لأنّ مالكَ المفردات هو محرّك الطلب لا السمعة،
 * فيُعلَن هنا مطابقاً لقيد `actor_type` في `reputation_facts` ويحرسه اختبارُ انحراف
 * يقرأ الـDDL.
 */
export const REPUTATION_ACTOR_TYPES = [
  "system",
  "customer",
  "driver",
  "partner",
  "admin",
] as const;
export type ReputationActorType = (typeof REPUTATION_ACTOR_TYPES)[number];

/** نمط المُعرّف العامّ للشخص، مطابقاً لقيد `subject_public_id ~ '^WS-[0-9]{10}$'`. */
export const WASLA_PUBLIC_ID_PATTERN = /^WS-[0-9]{10}$/;

/** نمط مُعرّف الطلب، مطابقاً لقيد `order_public_id ~ '^ORD-[0-9]{10}$'`. */
export const ORDER_PUBLIC_ID_PATTERN = /^ORD-[0-9]{10}$/;

// ---------------------------------------------------------------------------
// نسخة القواعد — الأحكام بياناً مُرقّماً
// ---------------------------------------------------------------------------

/** وزن نوعِ واقعةٍ لجانبٍ في نسخةٍ. لا وزن افتراضيّ: الغياب يُرفَض لا يُصفَّر. */
export interface ReputationRuleWeightRow {
  readonly rulesetVersion: number;
  readonly subjectType: ReputationSubjectType;
  readonly factKind: ReputationFactKind;
  readonly weightPoints: number;
}

/** عتبةُ قاعدةِ احتيالٍ في نسخةٍ. الشدّة تُقرأ ولا تُنفَّذ. */
export interface ReputationFraudThresholdRow {
  readonly rulesetVersion: number;
  readonly ruleCode: FraudRuleCode;
  readonly subjectType: ReputationSubjectType;
  readonly thresholdCount: number;
  readonly severity: FraudSeverity;
}

/**
 * نسخة القواعد: كل رقمٍ يدخل الحساب، مُعلَناً ومُجمَّداً.
 *
 * الحسابُ لا يقرأ ثابتاً من الكود ولا متغيّرَ بيئة: يقرأ **هذا الكائن**، ويقيم رقمُ
 * النسخة مع كل نتيجةٍ ومع كل إشارة. وهذا وحده ما يجعل جواب «بأيّ أحكامٍ حُكم على هذا
 * الشخص قبل شهر؟» قابلاً للاستخراج بلا أثريّات.
 */
export interface ReputationRulesetRow {
  readonly rulesetVersion: number;
  readonly label: string;
  readonly scoreFloor: number;
  readonly scoreCeiling: number;
  readonly startingScore: number;
  readonly minFactsForScore: number;
  readonly decayHalfLifeDays: number;
  readonly tierStandardAt: number;
  readonly tierTrustedAt: number;
  readonly tierUnderWatchBelow: number;
  readonly ratingWindowHours: number;
  readonly fraudWindowDays: number;
  readonly recomputeIntervalHours: number;
  readonly isFrozen: boolean;
  readonly weights: readonly ReputationRuleWeightRow[];
  readonly fraudThresholds: readonly ReputationFraudThresholdRow[];
}

// ---------------------------------------------------------------------------
// الدفتر — الوقائع
// ---------------------------------------------------------------------------

/**
 * واقعةٌ مسجَّلة: ما حدث، لمن، على أي طلب، ومن أي حدثٍ اشتُقّت.
 *
 * `occurredAt` زمن الحدوث في العالم، و`recordedAt` زمن التسجيل عندنا. الفرقُ بينهما
 * تأخّرُ الناقل، وخلطُهما يجعل النافذة المتحرّكة تكذب عند أوّل إعادة تسليم — ولذلك
 * كلُّ حسابٍ في هذه الخدمة يستعمل `occurredAt` وحده، و`recordedAt` للتشخيص فقط.
 */
export interface ReputationFactRow {
  readonly id: string;
  readonly subjectType: ReputationSubjectType;
  readonly subjectPublicId: string;
  readonly factKind: ReputationFactKind;
  readonly orderPublicId: string;
  readonly sourceEventType: string;
  readonly sourceEventId: string;
  readonly sourceSequence: number;
  readonly actorType: ReputationActorType;
  readonly reasonCode: string | null;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly traceId?: string | null;
}

/** الحمولة التي يطلبها تسجيلُ واقعة. لا `id` ولا `recordedAt`: تملكهما الخدمة. */
export interface ReputationFactDraft {
  readonly subjectType: ReputationSubjectType;
  readonly subjectPublicId: string;
  readonly factKind: ReputationFactKind;
  readonly orderPublicId: string;
  readonly sourceEventType: string;
  readonly sourceEventId: string;
  readonly sourceSequence: number;
  readonly actorType: ReputationActorType;
  readonly reasonCode: string | null;
  readonly occurredAt: string;
  readonly traceId?: string | null;
}

// ---------------------------------------------------------------------------
// النتيجة — مُشتقّةٌ لا محفوظة
// ---------------------------------------------------------------------------

/**
 * النتيجة كما تُخزَّن: صورةٌ عن حسابٍ يُمكن إعادةُ إنتاجه حرفياً.
 *
 * حذفُ كل صفوف `reputation_scores` يجب أن يكون عملاً بلا خسارة، ولذلك لا حقل هنا
 * يستحيل استخراجُه من (الدفتر + نسخة القواعد + لحظة الحساب). أي حقلٍ يخالف ذلك يُحوّل
 * الجدول من ذاكرةٍ مؤقّتة إلى مصدرِ حقيقةٍ ثانٍ.
 */
export interface ReputationScoreRow {
  readonly subjectType: ReputationSubjectType;
  readonly subjectPublicId: string;
  readonly rulesetVersion: number;
  readonly scorePoints: number;
  readonly tier: ReputationTier;
  readonly factCount: number;
  readonly computedThroughFactId: string | null;
  readonly computedAt: string;
  readonly nextRecomputeAt: string;
  readonly traceId?: string | null;
}

// ---------------------------------------------------------------------------
// التقييم — درجةٌ ورمزُ سبب، بلا نصّ
// ---------------------------------------------------------------------------

export interface ReputationRatingRow {
  readonly id: string;
  readonly orderPublicId: string;
  readonly raterType: ReputationSubjectType;
  readonly raterPublicId: string;
  readonly subjectType: ReputationSubjectType;
  readonly subjectPublicId: string;
  readonly stars: number;
  readonly reasonCode: ReputationRatingReasonCode | null;
  readonly rulesetVersion: number;
  readonly submittedAt: string;
  readonly traceId?: string | null;
}

export interface ReputationRatingDraft {
  readonly orderPublicId: string;
  readonly raterType: ReputationSubjectType;
  readonly raterPublicId: string;
  readonly subjectPublicId: string;
  readonly stars: number;
  readonly reasonCode: ReputationRatingReasonCode | null;
  readonly submittedAt?: string;
  readonly traceId?: string | null;
}

// ---------------------------------------------------------------------------
// إشارة الاحتيال — ملاحظةُ رصدٍ تشرح نفسها
// ---------------------------------------------------------------------------

/**
 * النافذة التي رُصد فيها النمط. حدّاها **محسوبان** من نسخة القواعد ومن الساعة، لا
 * مُخزَّنان من تشغيلٍ سابق: «آخرُ مرّةٍ ركضنا فيها» رقمٌ يجعل النافذة تتحرّك بحسب صحّة
 * الخادم لا بحسب الزمن، فتُصبح إشارتان لنفس السلوك أو لا إشارة بحال.
 */
export interface FraudWindow {
  readonly startedAt: string;
  readonly endedAt: string;
}

/**
 * الإشارة: قاعدةٌ مُسمّاة، ونافذةٌ محدّدة، وعددٌ مرصود، والعتبةُ التي تجاوزها.
 *
 * لا `state` ولا `resolution` ولا `confidence` ولا `probability` (القرار 6): البتّ
 * مراجعةٌ بشرية لا يملكها هذا الطور، واحتمالٌ إحصائيّ يجعل الإشارة غير قابلة للشرح
 * لمن تُرفع عليه.
 */
export interface FraudSignalRow {
  readonly id: string;
  readonly subjectType: ReputationSubjectType;
  readonly subjectPublicId: string;
  readonly ruleCode: FraudRuleCode;
  readonly severity: FraudSeverity;
  readonly windowStartedAt: string;
  readonly windowEndedAt: string;
  readonly observedCount: number;
  readonly thresholdCount: number;
  readonly rulesetVersion: number;
  readonly raisedAt: string;
  readonly traceId?: string | null;
}

/** ما تُنتجه قاعدةٌ عندما تجاوز العددُ العتبة. لا مُعرّف ولا `raisedAt`: تملكهما الخدمة. */
export interface FraudSignalDraft {
  readonly subjectType: ReputationSubjectType;
  readonly subjectPublicId: string;
  readonly ruleCode: FraudRuleCode;
  readonly severity: FraudSeverity;
  readonly windowStartedAt: string;
  readonly windowEndedAt: string;
  readonly observedCount: number;
  readonly thresholdCount: number;
  readonly rulesetVersion: number;
}

// ---------------------------------------------------------------------------
// سجلّ المعالجة الواحدة
// ---------------------------------------------------------------------------

/**
 * صفُّ المعالجة الواحدة — أعمدةُ العقد وحدها.
 *
 * `operation` هو `scope` في `contracts/schema.sql` (اسمان لمعنى واحد، تُترجَم في
 * المستودع)، و`requestFingerprint` هو `payload_fingerprint`.
 *
 * ولا حقلَ `subjectType` هنا: لا عمودَ له في العقد المُجمَّد، ولا شيءَ يقرؤه. وإضافةُ
 * حقلٍ يعيش في الذاكرة ويختفي في Postgres كانت ستجعل `find()` في المُهيئين تُعيد صفّين
 * غيرَ متساويين — فتُصلَح المطابقةُ بمُحوّلٍ يتغاضى عن الحقل، وذاك تغاضٍ يُخفي أوّلَ فرقٍ
 * حقيقيّ. والانحرافُ مُعلَنٌ في `docs/02-architecture/REPUTATION_PERSISTENCE.md`
 * §الانحرافات.
 */
export interface ReputationIdempotencyRow {
  readonly idempotencyKey: string;
  readonly operation: string;
  readonly requestFingerprint: string;
  readonly subjectPublicId: string | null;
  readonly createdAt: string;
}
