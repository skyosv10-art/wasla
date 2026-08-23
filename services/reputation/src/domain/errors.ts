/**
 * أخطاء خدمة السمعة وإشارات الاحتيال.
 *
 * الكتالوج **لا يُعاد تعريفه هنا**: الرموز السبعة عشر وأصنافها ورمزُ HTTP المُشتقّ من
 * الصنف تقيم في `@wasla/contracts-reputation` محروسةً ضد
 * `services/reputation/contracts/errors.md`. هذا الملف يلفّها في خطأٍ قابلٍ للرمي
 * فقط، فترفع حالةُ الاستخدام رمزَ عقدٍ وتُسقطه طبقةُ HTTP (المراجعة 4/6) بلا إعادة تصنيف.
 *
 * الاختبارات تؤكّد `code` لا نصّ الرسالة العربية.
 *
 * ## ثلاث قواعد يوجد هذا الملف لحمايتها
 *
 * **1) لا رمز عقابيّ بحال** (ADR-014 القرار 7 · `errors.md` §القاعدة البند 3). لا
 * `SUBJECT_SUSPENDED` ولا `SUBJECT_BLOCKED` ولا `FRAUD_DETECTED` ولا مصنعَ أدناه
 * يُنتج شيئاً من هذا المعنى. رمزٌ يقول «موقوف» يجعل مستهلكاً يفترض أنّ السمعة تحجب،
 * فيبني عليه سلوكاً لا مالكَ لقراره؛ والإيقاف يملكه `services/drivers` والقرارُ
 * الإداريّ يملكه Phase 15.
 *
 * **2) لا `502` ولا صنف `bad_gateway`.** الخدمة **مستهلكٌ** لأحداث محرّك الطلب ولا
 * تابعَ متزامناً تنتظر جوابه، وتعثّرُ الناقل يظهر في `GET /health` و`last_tick_at` لا
 * في رمز خطأ على استجابةٍ ناجحة.
 *
 * **3) إعادةُ التسليم ليست خطأً** (`errors.md` §القاعدة البند 4). واقعةٌ وصلت مرّتين
 * **بنفس الحمولة** تُعاد بنجاحٍ و`duplicate: true`؛ و`REPUTATION_FACT_ALREADY_RECORDED`
 * لحالةٍ واحدة: نفس المصدر بحمولةٍ **مختلفة**. ولذلك لا مصنعَ هنا اسمُه
 * `factDuplicated`: وجودُه كان سيجعل الطريق الأقصر لكاتبٍ عجول هو ردُّ 409 على أمرٍ
 * يقع كل يوم، فيُشوّش عدّادَ الأخطاء على حالةٍ عادية.
 *
 * ## الخصوصية (`errors.md` §ما لا يُعاد في أي خطأ)
 *
 * لا رسالةً هنا ولا حقلَ `details` يحمل اسماً ولا هاتفاً ولا إحداثية ولا مُعرّف قناة
 * ولا نصّاً حرّاً. `field` يسمّي الحقل ولا يردّ ما كُتب فيه. وحقولُ `details` **معدودة**
 * مطابقةً لـ`ErrorResponse.error.details` في OpenAPI الذي يُعلن
 * `additionalProperties: false`: مفتاحٌ غير مُعلَن كان سيُفشل تحقّقَ مستهلكٍ صارم على
 * استجابةٍ صحيحة فيما عدا ذلك (درسُ Phase 05 · المراجعة 4/6).
 */

import {
  REPUTATION_ERROR_CODE_CLASS,
  httpStatusForReputationError,
  type ReputationErrorClass,
  type ReputationErrorCode,
} from "@wasla/contracts-reputation";

import type { ReputationFactKind, ReputationSubjectType } from "./contract-sets.js";

export type { ReputationErrorClass, ReputationErrorCode };

/**
 * تفصيلٌ مُهيكل يُقرأ آلياً بجوار الرمز.
 *
 * حقولٌ اختيارية مُسمّاة لا كِيسٌ حرّ، بالضبط كي لا يكون «ضع القيمة في التفاصيل» طريقاً
 * مطروقاً. والمجموعةُ مطابقةٌ لما يُعلنه العقد ولا تزيد عليه.
 */
export interface ReputationErrorDetails {
  readonly field?: string;
  readonly expected?: string;
  readonly subjectType?: ReputationSubjectType;
  readonly factKind?: ReputationFactKind;
  readonly rulesetVersion?: number;
  readonly recordedSequence?: number;
  readonly ratingWindowHours?: number;
  readonly constraint?: string;
}

/** خطأُ مجالٍ يحمل رمز عقدٍ مستقرّاً. */
export class ReputationError extends Error {
  readonly code: ReputationErrorCode;
  readonly class: ReputationErrorClass;
  readonly httpStatus: number;
  readonly traceId?: string;
  readonly details: ReputationErrorDetails;

  constructor(
    code: ReputationErrorCode,
    message: string,
    options: { traceId?: string; details?: ReputationErrorDetails } = {},
  ) {
    super(message);
    this.name = "ReputationError";
    this.code = code;
    this.class = REPUTATION_ERROR_CODE_CLASS[code];
    this.httpStatus = httpStatusForReputationError(code);
    this.traceId = options.traceId;
    this.details = options.details ?? {};
  }
}

export function isReputationError(value: unknown): value is ReputationError {
  return value instanceof ReputationError;
}

// ---------------------------------------------------------------------------
// 400 — الطلب نفسه لا يُقرأ
// ---------------------------------------------------------------------------

/** رفضُ شكلٍ يسمّي الحقل ولا يُعيد قيمته. */
export function validationFailed(field: string, expected: string): ReputationError {
  return new ReputationError("REPUTATION_VALIDATION_FAILED", `حقل غير صالح: ${field}`, {
    details: { field, expected },
  });
}

export function idempotencyKeyRequired(): ReputationError {
  return new ReputationError(
    "REPUTATION_IDEMPOTENCY_KEY_REQUIRED",
    "مفتاح المعالجة الواحدة مطلوب لهذه الكتابة",
    { details: { field: "idempotencyKey" } },
  );
}

/**
 * قراءةُ دفترٍ بلا مُرشِّح.
 *
 * تُرفَض ولا تُجاب بكل شيء: دفترٌ يُقرأ بلا مُرشِّح يعني تصديرَ سلوك كل الناس بطلبٍ
 * واحد، و«نسيتُ المُرشِّح» يجب ألّا يكون الاستعلامَ الذي يُعيد أكثر البيانات.
 */
export function filterRequired(): ReputationError {
  return new ReputationError(
    "REPUTATION_FILTER_REQUIRED",
    "قراءة الدفتر تحتاج مُرشِّحاً: شخصاً أو طلباً",
    { details: { field: "subjectPublicId" } },
  );
}

// ---------------------------------------------------------------------------
// 404 — موردٌ مُشار إليه غير موجود
// ---------------------------------------------------------------------------

/**
 * لا نتيجةَ لمن لا واقعةَ له.
 *
 * `404` ولا نتيجةٌ مُختلَقة بقيمة البداية: مستهلكٌ يرى 60 لا يعرف أهي حصيلةُ عملٍ أم
 * قيمةُ بدايةٍ لمن لم يعمل، فيُقارن رقمين لا يقيسان الشيء نفسه.
 */
export function scoreNotFound(
  subjectType: ReputationSubjectType,
  field = "subjectPublicId",
): ReputationError {
  return new ReputationError("REPUTATION_SCORE_NOT_FOUND", "لا نتيجة مسجّلة لهذا الشخص", {
    details: { field, subjectType },
  });
}

export function rulesetNotFound(rulesetVersion: number): ReputationError {
  return new ReputationError("REPUTATION_RULESET_NOT_FOUND", "نسخة قواعد غير موجودة", {
    details: { rulesetVersion, field: "rulesetVersion" },
  });
}

// ---------------------------------------------------------------------------
// 409 — الحالة الحاضرة تمنع الفعل، أو تسابقٌ كُشِف
// ---------------------------------------------------------------------------

export function idempotencyKeyReused(): ReputationError {
  return new ReputationError(
    "REPUTATION_IDEMPOTENCY_KEY_REUSED",
    "المفتاح نفسه أُعيد بحمولة مختلفة",
    { details: { field: "idempotencyKey" } },
  );
}

/**
 * نفس (شخص × نوع × طلب × ترتيب) بحمولةٍ **مختلفة**.
 *
 * لا لإعادة التسليم العادية — تلك تُعاد بنجاحٍ و`duplicate: true`. هنا واقعتان تدّعيان
 * نفس اللحظة من الطلب بمعنيين، وقبولُ الثانية يُضاعف نقطةً بلا أن يعرف أحد.
 * و`details.constraint` يسمّي حارسَ القاعدة كي يكون خطُّ الدفاع الثاني قابلاً للعثور.
 */
export function factAlreadyRecordedWithDifferentPayload(): ReputationError {
  return new ReputationError(
    "REPUTATION_FACT_ALREADY_RECORDED",
    "واقعة أخرى مسجّلة لنفس المصدر بمعنى مختلف",
    { details: { constraint: "ux_reputation_facts_source" } },
  );
}

export function ratingAlreadySubmitted(): ReputationError {
  return new ReputationError(
    "REPUTATION_RATING_ALREADY_SUBMITTED",
    "تقييم مسجّل لهذا الطلب من هذا المُقيِّم",
    { details: { constraint: "ux_reputation_ratings_order_pair" } },
  );
}

/**
 * دخلت واقعةٌ أثناء إعادة الحساب.
 *
 * تسابقٌ كُشِف: كتابةُ نتيجةٍ تجاهلت واقعةً وصلت للتوّ تُنتج رقماً يبدو حديثاً وهو ناقص.
 * و`recordedSequence` يُعيد المُرسل إلى الحقيقة بطلبٍ واحد بدل حلقةِ إعادةِ محاولةٍ عمياء.
 */
export function scoreStale(recordedSequence?: number): ReputationError {
  return new ReputationError("REPUTATION_SCORE_STALE", "النتيجة لم تعد شاملة لكل الوقائع", {
    details: recordedSequence === undefined ? {} : { recordedSequence },
  });
}

// ---------------------------------------------------------------------------
// 422 — مدخلٌ صالحٌ شكلياً ترفضه قاعدةُ عملٍ أو نسخةُ قواعد أو حالةُ الطلب
// ---------------------------------------------------------------------------

/**
 * نسخةُ قواعدٍ موجودةٌ وغير مجمّدة.
 *
 * تُرفَض ولا تُستعمل: أحكامٌ قابلة للتحرير تجعل تفسير نتيجة الأمس مستحيلاً، و«لماذا
 * صُنّف هذا الشخص هكذا؟» هو السؤال الذي وُجد ترقيمُ النسخ كلّه لأجله (سابقة ADR-013).
 */
export function rulesetNotFrozen(rulesetVersion: number): ReputationError {
  return new ReputationError("REPUTATION_RULESET_NOT_FROZEN", "نسخة القواعد غير مجمّدة", {
    details: { rulesetVersion },
  });
}

/**
 * نوعُ واقعةٍ لا وزنَ له في النسخة النشطة لهذا الجانب.
 *
 * **الصمت أخطر من الرفض**: وزنٌ افتراضيّ صفر يُخفي واقعةً لا يعرف أحدٌ أنّها أُهملت،
 * ويجعل الفارق بين «لا أثر لها» و«نسيناها» غير قابل للاكتشاف بعد شهر.
 */
export function ruleWeightMissing(
  subjectType: ReputationSubjectType,
  factKind: ReputationFactKind,
  rulesetVersion: number,
): ReputationError {
  return new ReputationError("REPUTATION_RULE_WEIGHT_MISSING", "لا وزن معلن لهذا النوع", {
    details: { subjectType, factKind, rulesetVersion },
  });
}

/**
 * `sourceSequence` أقدم من أحدثِ ترتيبٍ مسجَّل لهذا الطلب.
 *
 * الحمولة سليمة والحدث حقيقيّ، لكنّه **متأخّرٌ في الوصول** (at-least-once)، وتطبيقُه
 * يُعيد كتابة تاريخٍ مضى.
 */
export function sourceEventStale(recordedSequence: number): ReputationError {
  return new ReputationError("REPUTATION_SOURCE_EVENT_STALE", "حدث المصدر متأخّر في الوصول", {
    details: { recordedSequence, field: "sourceSequence" },
  });
}

/**
 * تقييمٌ على طلبٍ لا واقعةَ اكتمالٍ له في الدفتر.
 *
 * والحكم **من الدفتر** لا من سؤال محرّك الطلب: لا تابعَ متزامناً هنا، فالسمعة مستهلكٌ
 * لا مُستعلِم.
 */
export function orderNotCompleted(): ReputationError {
  return new ReputationError("REPUTATION_ORDER_NOT_COMPLETED", "لا واقعة اكتمال لهذا الطلب", {
    details: { field: "orderPublicId" },
  });
}

/** حارسُ المجال لتقييم النفس، وحارسُ القاعدة `ck_reputation_ratings_no_self` وراءه. */
export function ratingSelfForbidden(): ReputationError {
  return new ReputationError("REPUTATION_RATING_SELF_FORBIDDEN", "لا يُقيّم أحد نفسه", {
    details: { constraint: "ck_reputation_ratings_no_self" },
  });
}

/**
 * المُقيِّم أو المُقيَّم ليس طرفاً في هذا الطلب بحسب الدفتر، أو الطرفان من جانبٍ واحد.
 *
 * حارسُ القاعدة `ck_reputation_ratings_cross_side` يمنع الثانية، والدفترُ يمنع الأولى.
 */
export function ratingPartyMismatch(): ReputationError {
  return new ReputationError("REPUTATION_RATING_PARTY_MISMATCH", "المُقيِّم ليس طرفاً مقابلاً", {
    details: { constraint: "ck_reputation_ratings_cross_side" },
  });
}

/** مضت `ratingWindowHours` من واقعة الاكتمال. الحدّ مُعلَن لأنّ حدّاً لا يُعرف يُصطدم به مرّتين. */
export function ratingWindowClosed(ratingWindowHours: number): ReputationError {
  return new ReputationError("REPUTATION_RATING_WINDOW_CLOSED", "نافذة التقييم أُغلقت", {
    details: { ratingWindowHours },
  });
}

// ---------------------------------------------------------------------------
// 503 — الاستمرارية أو الخدمة في وضعٍ لا تُعطي معه نتيجةً موثوقة
// ---------------------------------------------------------------------------

export function reputationUnavailable(): ReputationError {
  return new ReputationError("REPUTATION_UNAVAILABLE", "الخدمة في وضع متدهور", {});
}

/**
 * كسرُ ثابتٍ داخليّ كان قيدُ القاعدة سيرفضه.
 *
 * ليس هذا رمزاً لحالةٍ يُنتجها مستخدم: الوصول إليه يعني أنّ المجال حسب قيمةً مستحيلة
 * (نتيجةً سالبة، رتبةَ `new` بتاريخ، إشارةً دون عتبتها). يُرفَض **باسم القيد** عند
 * الحدّ بدل أن يُخزَّن، لأنّ صفّاً مستحيلاً في القاعدة يُكتشف بعد شهرٍ ولا يُفسَّر.
 *
 * ولا رمزَ خاصّاً له في الكتالوج عن قصد (`errors.md` §القاعدة البند 2: لا رمز بلا مسارٍ
 * يُنتجه)، فيُستعمل رمزُ الرفض الشكليّ ويُسمّى القيدُ في `details.constraint`.
 */
export function constraintViolated(constraint: string): ReputationError {
  return new ReputationError("REPUTATION_VALIDATION_FAILED", `قيد مكسور: ${constraint}`, {
    details: { constraint },
  });
}
