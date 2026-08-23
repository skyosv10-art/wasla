/**
 * الموضع الوحيد الذي يصير فيه الخطأ المرفوع جواباً على السلك (Phase 08 · MR 4/6).
 *
 * ## لا خطأ يُعاد تصنيفه هنا
 *
 * رمز HTTP يأتي من `NegotiationError.httpStatus`، وهو يأتي من صنف الرمز في
 * `@wasla/contracts-negotiation`، وهو محروسٌ ضدّ انحرافه عن `contracts/errors.md`. لذلك
 * لا يستطيع هذا الملف أن يخالف الكتالوج في معنى رمز: الطريق الوحيد لتغيير حالةٍ هو
 * تغييرُ الصنف في الملف الواحد الذي يملكه.
 *
 * ## الأخطاء الثلاثة التي ليست من عندنا
 *
 * 1. **جسمٌ مشوّه أو نوع محتوى خاطئ**: يرفعه Fastify بنفسه (`400`/`415`) قبل أن يعمل أي
 *    معالج. يصير `NEGOTIATION_VALIDATION_FAILED`، لأنّ «JSON عندك مكسور» و«حقلك غير صالح»
 *    تعليمةٌ واحدة من جهة المُتَّصل.
 *
 * 2. **`NegotiationConstraintViolation`**: قيدُ تماسكٍ لا يستطيع مُتَّصلٌ أن يبلغه
 *    (`infrastructure/in-memory.ts`). لا رمزَ منشوراً له، و**لا يجوز أن يصير `4xx` ولا
 *    `503`**: الأول يقول للمُتَّصل «أصلح طلبك» وطلبه صحيح، والثاني يقول «أعد المحاولة»
 *    وإعادةُ المحاولة تُنتج الخللَ نفسه. يصير `500` برمز `NEGOTIATION_INTERNAL_ERROR`،
 *    وهو رمزٌ **مقصودٌ غيابه** عن `NEGOTIATION_ERROR_CODES` لأنّه إشارةُ خللٍ لا عقد —
 *    ويحرس `__tests__/http-contract.test.ts` هذا الغياب صراحةً كي لا يُضاف يوماً بحسن نيّة
 *    إلى الكتالوج فيصير حالةً يتعاقد عليها مستهلك.
 *
 * 3. **خطأ Postgres يحمل اسم قيدٍ لم يُترجِمه المستودع**: يترجِم
 *    `infrastructure/drizzle/repository.ts` القُيود التي يستطيع مُتَّصلٌ معالجتها ويُعيد
 *    رمي ما بقي. ما بقي قيدُ تماسكٍ مثله مثل `NegotiationConstraintViolation`
 *    الذاكري، فيصير `500` لا `503`. ولولا هذا الفرع لأجاب المحوّلان جوابين
 *    مختلفين عن الخلل نفسه (`500` في الذاكرة و`503` على محرّك حقيقي)، وهو بعينه ما
 *    تمنعه مجموعة اختبارات التكافؤ. والتمييز هنا **تصنيف لا ترجمة**: لا قائمة
 *    قُيود ثالثة تُكتب هنا، بل مجرّد سؤال: أيحمل الخطأ اسم قيدٍ أم لا.
 *
 * 4. **كل ما بقي بلا تصنيف**: يصير `NEGOTIATION_UNAVAILABLE` (`503`) لا `500`. الرمياتُ
 *    غيرُ المعروفة في هذه الخدمة هي عملياً منفذٌ فشل — بركةُ الاتصال، الصادر، منفذ
 *    التوزيع — و`503` يقول للمُتَّصل إنّ إعادة المحاولة قد تنجح، وهو صحيح؛ ويُبقي `500`
 *    محفوظاً لمعناه: «عندنا خللٌ لا نفهمه بعد».
 *
 * ## و`404` الخاصّ بـFastify يُترك على شكله
 *
 * «لا مسار بهذا العنوان» و«لا خيط بهذا المُعرّف» حقيقتان مختلفتان، ومستهلكٌ يعامل الثانية
 * معاملةَ الأولى يُعيد المحاولة إلى الأبد على عنوانٍ لا وجود له.
 */

import type { FastifyReply } from "fastify";

import { isNegotiationError, type NegotiationErrorDetails } from "../domain/errors.js";
import { NegotiationConstraintViolation } from "../infrastructure/in-memory.js";

/**
 * رمزُ الخلل الداخلي — **ليس** في `NEGOTIATION_ERROR_CODES` عمداً.
 *
 * يُصدَّر كي يستطيع الاختبار أن يؤكّد غيابه عن الكتالوج ووجودَه على هذا المسار الواحد.
 */
export const NEGOTIATION_INTERNAL_ERROR_CODE = "NEGOTIATION_INTERNAL_ERROR";

export interface NegotiationErrorWireDetails {
  readonly field?: string;
  readonly expected?: string;
  readonly thread_state?: string;
  readonly round_state?: string;
  readonly current_round_no?: number;
  readonly max_rounds?: number;
  readonly min_amount_minor?: number;
  readonly max_amount_minor?: number;
  readonly policy_version?: number;
  readonly constraint?: string;
}

export interface NegotiationErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: NegotiationErrorWireDetails;
  };
  readonly trace_id: string;
}

/**
 * `NegotiationErrorDetails` (المجال، camelCase) → مفاتيح `details` المُعلَنة (snake_case).
 *
 * مكتوبٌ مفتاحاً مفتاحاً لا بمحوّلٍ عامّ من camel إلى snake، لأنّ `details` في العقد
 * `additionalProperties: false` بقائمة خصائص **معدودة**: محوّلٌ عامّ سيُمرّر بسرور أوّلَ
 * تفصيلٍ يُضاف إلى المجال، فتفشل استجابتُنا عند مستهلكٍ صارم بينما سجلّاتنا تقول `4xx`
 * سليم. القائمة الصريحة تفشل في الترجمة بدل أن تفشل عند العميل.
 *
 * ولاحظ ما ليس هنا: `expectedRoundNo` و`currency` موجودان في `NegotiationErrorDetails`
 * وغيرُ مُعلَنين في العقد، فلا يُمرَّران. حذفُهما ليس ضياعَ معلومة: `ROUND_STALE` يُعيد
 * `current_round_no` وهو ما يُعيد المُرسل إلى الحقيقة بطلبٍ واحد، و`CURRENCY_MISMATCH`
 * عملتُه الصحيحة في الخيط الذي يقرؤه المستهلك أصلاً.
 */
export function toWireDetails(
  details: NegotiationErrorDetails,
): NegotiationErrorWireDetails | undefined {
  const wire: Record<string, string | number> = {};
  if (details.field !== undefined) wire.field = details.field;
  if (details.expected !== undefined) wire.expected = details.expected;
  if (details.threadState !== undefined) wire.thread_state = details.threadState;
  if (details.roundState !== undefined) wire.round_state = details.roundState;
  if (details.currentRoundNo !== undefined) wire.current_round_no = details.currentRoundNo;
  if (details.maxRounds !== undefined) wire.max_rounds = details.maxRounds;
  if (details.minAmountMinor !== undefined) wire.min_amount_minor = details.minAmountMinor;
  if (details.maxAmountMinor !== undefined) wire.max_amount_minor = details.maxAmountMinor;
  if (details.policyVersion !== undefined) wire.policy_version = details.policyVersion;
  if (details.constraint !== undefined) wire.constraint = details.constraint;
  // غائبٌ لا `undefined`: `JSON.stringify` يُسقط `undefined`، لكن `details: {}` سيُرسَل،
  // وكائنٌ فارغ في جسم خطأ يُقرأ «نعرف شيئاً ولن نقوله».
  return Object.keys(wire).length === 0 ? undefined : (wire as NegotiationErrorWireDetails);
}

function isMalformedRequest(error: unknown): boolean {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 400 || statusCode === 415;
}

/**
 * اسم قيد قاعدة البيانات إن كان في سلسلة `cause`، وإلا `undefined`.
 *
 * يلفّ drizzle-orm خطأَ المُشغّل داخل `cause`، فقراءة `error.constraint` مباشرةً تقول
 * `undefined` على خطأٍ يحمل اسم قيدٍ فعلاً — وهي الزلّة التي أحمرت سبعة اختبارات في
 * Phase 05 (HANDOFF §2-ج). والحلقة محدودة بعمق معقول لأنّ `cause` دائرٌ في بعض
 * المكتبات، وحلقةٌ لا تنتهي في معالج خطأ تُعلّق الطلب بلا جواب.
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

export function sendNegotiationError(
  reply: FastifyReply,
  error: unknown,
  traceId: string,
): void {
  if (isNegotiationError(error)) {
    const details = toWireDetails(error.details);
    reply.status(error.httpStatus).send({
      error:
        details === undefined
          ? { code: error.code, message: error.message }
          : { code: error.code, message: error.message, details },
      // `error.traceId` حين أُخبر المجال بالتتبّع، وإلّا تتبّعُ الطلب: جوابٌ واحد يحمل
      // تتبّعاً دائماً، لأنّ أوّل سؤال عن كتابةٍ فاشلة هو أيّ محاولةٍ كانت.
      trace_id: error.traceId ?? traceId,
    } satisfies NegotiationErrorBody);
    return;
  }
  const constraint =
    error instanceof NegotiationConstraintViolation ? error.constraint : constraintName(error);
  if (constraint !== undefined) {
    reply.status(500).send({
      error: {
        code: NEGOTIATION_INTERNAL_ERROR_CODE,
        message: "خلل داخلي في تماسك البيانات",
        // اسم القيد يُعاد لأنّه اسمُ الموضع الذي يجب إصلاحه، ولا يحمل شيئاً من حمولة
        // المستخدم؛ وهو مُعلَن في `details.constraint` في العقد أصلاً.
        details: { constraint },
      },
      trace_id: traceId,
    } satisfies NegotiationErrorBody);
    return;
  }
  if (isMalformedRequest(error)) {
    reply.status(400).send({
      error: {
        code: "NEGOTIATION_VALIDATION_FAILED",
        message: "جسم الطلب غير صالح",
        details: { field: "body" },
      },
      trace_id: traceId,
    } satisfies NegotiationErrorBody);
    return;
  }
  reply.status(503).send({
    error: { code: "NEGOTIATION_UNAVAILABLE", message: "منفذ إلزامي أو استمرارية غير متاحة" },
    trace_id: traceId,
  } satisfies NegotiationErrorBody);
}
