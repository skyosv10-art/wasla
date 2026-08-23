/**
 * الموضعُ الوحيد الذي يصير فيه الخطأُ المرفوعُ جواباً على السلك (Phase 09 · المراجعة 4/6).
 *
 * ## لا خطأَ يُعاد تصنيفه هنا
 *
 * رمزُ HTTP يأتي من `ReputationError.httpStatus`، وهو يأتي من صنف الرمز في
 * `@wasla/contracts-reputation`، وهو محروسٌ ضدّ انحرافه عن `contracts/errors.md`. فلا
 * يستطيع هذا الملف أن يخالف الكتالوجَ في معنى رمز: الطريقُ الوحيد لتغيير حالةٍ هو تغييرُ
 * الصنف في الملف الواحد الذي يملكه.
 *
 * ## الأخطاء التي ليست من عندنا
 *
 * 1. **قيدُ تماسكٍ من Postgres لم يُترجِمه المستودع**: يترجِم
 *    `infrastructure/drizzle/repository.ts` القُيودَ التي يستطيع مُتَّصلٌ معالجتها (تفرّدُ
 *    مفتاح المصدر، تفرّدُ التقييم، تفرّدُ مفتاح المعالجة) ويُعيد رمي ما بقي. وما بقي كسرُ
 *    ثابتٍ لا يستطيع مُتَّصلٌ أن يبلغه، فلا يجوز أن يصير `4xx` («أصلح طلبك» وطلبُه صحيح)
 *    ولا `503` («أعد المحاولة» وإعادتُها تُنتج الكسرَ نفسه). يصير `500` برمز
 *    `REPUTATION_INTERNAL_ERROR`.
 *
 *    والتمييزُ هنا **تصنيفٌ لا ترجمة**: لا قائمةَ قُيودٍ ثانية تُكتب في هذا الملف، بل سؤالٌ
 *    واحد: أيحمل الخطأُ اسمَ قيدٍ في سلسلة `cause` أم لا.
 *
 *    ولاحظ أنّ الطريقَ الذاكريّ لا يمرّ من هنا أصلاً: الثوابتُ الذاكرية تُرفَع بـ
 *    `constraintViolated(name)` وهو `ReputationError` بـ`400` و`details.constraint`
 *    (`domain/errors.ts` يشرح لماذا لا رمزَ خاصّاً له). فالمحوّلان يختلفان في الرمز عن
 *    الكسر نفسه، وذاك انحرافٌ **مُعلَن** لا سهو: الكسرُ الذاكريّ يُكتشف داخل المجال قبل
 *    الكتابة (نتيجةٌ سالبة، رتبةُ `new` بتاريخ)، والكسرُ في القاعدة يُكتشف بعد أن قَبِل
 *    المجالُ الصفَّ — وهما خللان في موضعين مختلفين لا حالةٌ واحدة.
 *
 * 2. **جسمٌ مشوّه أو نوعُ محتوى خاطئ**: يرفعه Fastify بنفسه (`400`/`415`) قبل أن يعمل أيُّ
 *    معالج. يصير `REPUTATION_VALIDATION_FAILED`، لأنّ «JSON عندك مكسور» و«حقلُك غير صالح»
 *    تعليمةٌ واحدة من جهة المُتَّصل.
 *
 * 3. **كلُّ ما بقي بلا تصنيف**: يصير `REPUTATION_UNAVAILABLE` (`503`) لا `500`. الرمياتُ
 *    غيرُ المعروفة في هذه الخدمة هي عملياً منفذٌ فشل — بركةُ الاتصال، الصادر، منفذُ
 *    الطلبات — و`503` يقول للمُتَّصل إنّ إعادة المحاولة قد تنجح وهو صحيح؛ ويُبقي `500`
 *    محفوظاً لمعناه: «عندنا كسرٌ لا نفهمه بعد».
 *
 * ## ولا `502` في أيّ فرعٍ من هذا الملف
 *
 * ذاك شرطٌ صريحٌ في `contracts/errors.md`: خدمةُ السمعة لا تُنشئ حالةَ «بوّابةٌ سيّئة»
 * لأنّها ليست بوّابة، وفشلُ منفذٍ خلفَها حالةُ **عدمِ توفّرٍ** يُعيد المُتَّصل المحاولة
 * عليها، لا خللَ بروتوكولٍ بينه وبيننا.
 *
 * ## و`500` غيرُ مُعلَنٍ في العقد، وذاك انحرافٌ مقصودٌ مكتوب
 *
 * `REPUTATION_HTTP_STATUS_CODES` تُعلن `[200, 201, 400, 404, 409, 422, 503]`، فـ`500` خارجَها.
 * وهو مقصود: الكتالوج يُعلن الحالاتَ التي **يتعاقد** عليها مستهلك، وكسرُ الثابت الداخليّ
 * ليس حالةً يتعاقد عليها أحد — بل إشارةُ خللٍ عندنا. والرمزُ `REPUTATION_INTERNAL_ERROR`
 * **مقصودٌ غيابُه** عن `REPUTATION_ERROR_CODES` للسبب نفسه، ويحرس
 * `__tests__/http-drift.test.ts` هذا الغيابَ صراحةً كي لا يُضاف يوماً بحسن نيّةٍ إلى
 * الكتالوج فيصير حالةً يبني عليها مستهلكٌ منطقاً.
 *
 * ## و`404` الخاصّ بـFastify يُترك على شكله
 *
 * «لا مسارَ بهذا العنوان» و«لا نتيجةَ لهذا الشخص» حقيقتان مختلفتان، ومستهلكٌ يعامل الثانية
 * معاملةَ الأولى يُعيد المحاولة إلى الأبد على عنوانٍ لا وجود له.
 */

import type { FastifyReply } from "fastify";

import { isReputationError, type ReputationErrorDetails } from "../domain/errors.js";

/**
 * رمزُ الكسر الداخليّ — **ليس** في `REPUTATION_ERROR_CODES` عمداً.
 *
 * يُصدَّر كي يستطيع الاختبارُ أن يؤكّد غيابَه عن الكتالوج ووجودَه على هذا المسار الواحد.
 */
export const REPUTATION_INTERNAL_ERROR_CODE = "REPUTATION_INTERNAL_ERROR";

export interface ReputationErrorWireDetails {
  readonly field?: string;
  readonly expected?: string;
  readonly subject_type?: string;
  readonly fact_kind?: string;
  readonly ruleset_version?: number;
  readonly recorded_sequence?: number;
  readonly rating_window_hours?: number;
  readonly constraint?: string;
}

export interface ReputationErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: ReputationErrorWireDetails;
  };
  readonly trace_id: string;
}

/**
 * `ReputationErrorDetails` (المجال، `camelCase`) → مفاتيحُ `details` المُعلَنة (`snake_case`).
 *
 * مكتوبٌ مفتاحاً مفتاحاً لا بمحوّلٍ عامّ من camel إلى snake، لأنّ `details` في العقد
 * `additionalProperties: false` بقائمةِ خصائصَ **معدودة**: محوّلٌ عامّ سيُمرّر بسرورٍ أوّلَ
 * تفصيلٍ يُضاف إلى المجال، فتفشل استجابتُنا عند مستهلكٍ صارمٍ بينما سجلّاتنا تقول `4xx`
 * سليم. والقائمةُ الصريحة تفشل في الترجمة بدل أن تفشل عند العميل.
 */
export function toWireDetails(
  details: ReputationErrorDetails,
): ReputationErrorWireDetails | undefined {
  const wire: Record<string, string | number> = {};
  if (details.field !== undefined) wire.field = details.field;
  if (details.expected !== undefined) wire.expected = details.expected;
  if (details.subjectType !== undefined) wire.subject_type = details.subjectType;
  if (details.factKind !== undefined) wire.fact_kind = details.factKind;
  if (details.rulesetVersion !== undefined) wire.ruleset_version = details.rulesetVersion;
  if (details.recordedSequence !== undefined) wire.recorded_sequence = details.recordedSequence;
  if (details.ratingWindowHours !== undefined) {
    wire.rating_window_hours = details.ratingWindowHours;
  }
  if (details.constraint !== undefined) wire.constraint = details.constraint;
  // غائبٌ لا `undefined`: `JSON.stringify` يُسقط `undefined`، لكن `details: {}` سيُرسَل،
  // وكائنٌ فارغٌ في جسم خطأٍ يُقرأ «نعرف شيئاً ولن نقوله».
  return Object.keys(wire).length === 0 ? undefined : (wire as ReputationErrorWireDetails);
}

function isMalformedRequest(error: unknown): boolean {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 400 || statusCode === 415;
}

/**
 * اسمُ قيدِ قاعدة البيانات إن كان في سلسلة `cause`، وإلّا `undefined`.
 *
 * يلفّ drizzle-orm خطأَ المُشغّل داخل `cause`، فقراءةُ `error.constraint` مباشرةً تقول
 * `undefined` على خطأٍ يحمل اسمَ قيدٍ فعلاً — وهي الزلّةُ التي أحمرت سبعةَ اختبارات في
 * المرحلة 05 (HANDOFF §2-ج). والحلقةُ محدودةُ العمق لأنّ `cause` دائرٌ في بعض المكتبات،
 * وحلقةٌ لا تنتهي في معالج خطأٍ تُعلّق الطلبَ بلا جواب.
 */
function constraintName(error: unknown): string | undefined {
  let cursor: unknown = error;
  for (let depth = 0; depth < 8 && cursor !== null && typeof cursor === "object"; depth += 1) {
    const candidate = (cursor as { constraint?: unknown }).constraint;
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
    const next = (cursor as { cause?: unknown }).cause;
    if (next === cursor) return undefined;
    cursor = next;
  }
  return undefined;
}

export function sendReputationError(reply: FastifyReply, error: unknown, traceId: string): void {
  if (isReputationError(error)) {
    const details = toWireDetails(error.details);
    reply.status(error.httpStatus).send({
      error:
        details === undefined
          ? { code: error.code, message: error.message }
          : { code: error.code, message: error.message, details },
      // `error.traceId` حين أُخبر المجالُ بالتتبّع، وإلّا تتبّعُ الطلب: جوابٌ واحد يحمل
      // تتبّعاً دائماً، لأنّ أوّلَ سؤالٍ عن كتابةٍ فاشلة هو أيُّ محاولةٍ كانت.
      trace_id: error.traceId ?? traceId,
    } satisfies ReputationErrorBody);
    return;
  }
  const constraint = constraintName(error);
  if (constraint !== undefined) {
    reply.status(500).send({
      error: {
        code: REPUTATION_INTERNAL_ERROR_CODE,
        message: "خلل داخلي في تماسك البيانات",
        // اسمُ القيد يُعاد لأنّه اسمُ الموضع الذي يجب إصلاحه، ولا يحمل شيئاً من حمولة
        // المستخدم؛ وهو مُعلَنٌ في `details.constraint` في العقد أصلاً.
        details: { constraint },
      },
      trace_id: traceId,
    } satisfies ReputationErrorBody);
    return;
  }
  if (isMalformedRequest(error)) {
    reply.status(400).send({
      error: {
        code: "REPUTATION_VALIDATION_FAILED",
        message: "جسم الطلب غير صالح",
        details: { field: "body" },
      },
      trace_id: traceId,
    } satisfies ReputationErrorBody);
    return;
  }
  reply.status(503).send({
    error: { code: "REPUTATION_UNAVAILABLE", message: "منفذ إلزامي أو استمرارية غير متاحة" },
    trace_id: traceId,
  } satisfies ReputationErrorBody);
}
