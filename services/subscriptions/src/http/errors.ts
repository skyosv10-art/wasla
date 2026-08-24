/**
 * الموضعُ **الوحيد** الذي يصير فيه خطأٌ مرفوعٌ جواباً على السلك (المراجعة 4/6).
 *
 * ## لا خطأَ يُعاد تصنيفُه هنا
 *
 * رمزُ HTTP يأتي من `SubscriptionError.httpStatus`، وهو من صنفِ الرمز في
 * `@wasla/contracts-subscription`، وهو محروسٌ ضدّ `contracts/errors.md`. فلا يستطيع هذا
 * الملفُّ أن يخالف الكتالوجَ في معنى رمز: الطريقُ الوحيدُ لتغيير حالةٍ هو تغييرُ الصنفِ في
 * الملفِّ الواحدِ الذي يملكه — ولا `try`/`catch` في أيّ معالجٍ لهذا السبب بعينه (معالجٌ
 * يلتقط خطأَه يستطيع أن يُخفيه، ومعالجُ الخطأِ الواحدُ لا يستطيع).
 *
 * ## الأخطاءُ التي ليست من عندنا — ثلاثةُ فروعٍ لا أكثر
 *
 * **1) قيدُ تماسكٍ من Postgres لم يُترجمه المخزن.** يُترجم `db/` القيودَ التي يستطيع
 * مُتّصلٌ معالجتها (سباقُ التسلسل ⇒ إعادةُ محاولةٍ في وحدةِ العمل، تفرّدُ السائق ⇒
 * `SUBSCRIPTION_ALREADY_EXISTS`)، وما بقي **كسرُ ثابتٍ لا يستطيع مُتّصلٌ أن يبلغه**:
 * `ck_subscriptions_period_state` مثلاً لا يُكسر إلّا بعطبٍ في اشتقاقِنا نحن. فلا يجوز أن
 * يصير `4xx` («أصلح طلبك» وطلبُه صحيح) ولا `503` («أعد المحاولة» وإعادتُها تُنتج الكسرَ
 * نفسَه)، بل `500` برمزٍ خارجَ الكتالوج.
 *
 * **2) جسمٌ مشوّهٌ أو نوعُ محتوى خاطئ.** يرفعه Fastify قبل أن يعمل أيُّ معالج، فيصير
 * `SUBSCRIPTION_VALIDATION_FAILED`: «JSON عندك مكسور» و«حقلُك غير صالح» تعليمةٌ واحدةٌ من
 * جهةِ المُرسِل.
 *
 * **3) كلُّ ما بقي بلا تصنيف** يصير `SUBSCRIPTION_UNAVAILABLE` (`503`) لا `500`: الرمياتُ
 * المجهولةُ في خدمةٍ كلُّ عملِها قراءةُ دفترٍ وكتابتُه هي عملياً منفذُ فشلٍ — بركةُ اتصالٍ،
 * معاملةٌ أُجهضت — و`503` يقول للمُرسِل إنّ إعادةَ المحاولةِ قد تنجح وهو صحيح. ويبقى `500`
 * لمعناه الواحد: «عندنا كسرٌ لا نفهمه بعد».
 *
 * ## و`500` غيرُ مُعلَنٍ في العقد، وذاك انحرافٌ مقصودٌ مكتوب
 *
 * `SUBSCRIPTION_HTTP_STATUS_CODES` تُعلن `[200,201,400,404,409,422,503]`، فـ`500` خارجَها،
 * ورمزُه `SUBSCRIPTION_INTERNAL_ERROR` **مقصودٌ غيابُه** عن `SUBSCRIPTION_ERROR_CODES`:
 * الكتالوجُ يُعلن ما يتعاقد عليه مستهلك، وكسرُ ثابتٍ عندنا ليس شيئاً يبني عليه أحدٌ منطقاً.
 * و`__tests__/http-drift.test.ts` يحرس هذا الغيابَ صراحةً كي لا يُضاف يوماً بحسنِ نيّة.
 *
 * ## ولا `502` في أيّ فرعٍ من هذا الملف
 *
 * نصُّ `contracts/errors.md`: لا تابعَ متزامناً تُنتظر إجابتُه هنا، فلا معنى لـ«بوّابةٍ
 * سيّئة». وتعثّرُ النبضة يظهر في `GET /health` و`last_tick_at` لا في رمزِ خطأ.
 *
 * ## و`404` الخاصُّ بـFastify يُترك على شكله
 *
 * «لا مسارَ بهذا العنوان» و«لا اشتراكَ لهذا السائق» حقيقتان مختلفتان؛ ومستهلكٌ يعامل
 * الثانيةَ معاملةَ الأولى يُعيد المحاولةَ إلى الأبد على عنوانٍ لا وجودَ له.
 */

import type { FastifyReply } from "fastify";

import { constraintOf } from "../db/constraints.js";
import { isSubscriptionError, type SubscriptionErrorDetails } from "../domain/errors.js";

/**
 * رمزُ الكسرِ الداخليّ — **ليس** في `SUBSCRIPTION_ERROR_CODES` عمداً.
 *
 * يُصدَّر كي يُثبت الاختبارُ غيابَه عن الكتالوجِ ووجودَه على هذا المسارِ الواحد.
 */
export const SUBSCRIPTION_INTERNAL_ERROR_CODE = "SUBSCRIPTION_INTERNAL_ERROR";

/**
 * مفاتيحُ `details` المُعلَنةُ في العقد — `additionalProperties: false` فلا مفتاحَ سواها.
 *
 * والقائمةُ مُقتطعةٌ من `contracts/api.openapi.yml` حرفاً، و`__tests__/http-drift.test.ts`
 * يقابلها بالورقةِ نفسِها. ومفتاحٌ زائدٌ هنا ليس تفصيلاً إضافيّاً بل جوابٌ **مرفوضٌ**
 * عند مستهلكٍ صارمٍ يُدقّق المخطّط، وسجلّاتُنا ستقول `4xx` سليماً في حين يرى العميلُ
 * خللاً لا يفهمه.
 */
export interface SubscriptionErrorWireDetails {
  readonly field?: string;
  readonly expected?: string;
  readonly driver_public_id?: string;
  readonly plan_code?: string;
  readonly plan_version?: number;
  readonly referral_code?: string;
  readonly state?: string;
  readonly constraint?: string;
}

export interface SubscriptionErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: SubscriptionErrorWireDetails;
  };
  readonly trace_id: string;
}

/**
 * `SubscriptionErrorDetails` (المجال، `camelCase`) → مفاتيحُ العقد (`snake_case`).
 *
 * مكتوبٌ مفتاحاً مفتاحاً لا بمحوّلٍ عامّ من camel إلى snake: العقدُ يُعلن `details` بقائمةِ
 * خصائصَ **معدودةٍ** و`additionalProperties: false`، فمحوّلٌ عامٌّ سيُمرّر بسرورٍ أوّلَ
 * تفصيلٍ يُضاف إلى المجال، فتفشل استجابتُنا عند مستهلكٍ صارمٍ بينما سجلّاتُنا تقول `4xx`
 * سليم. والقائمةُ الصريحةُ تفشل في الترجمةِ بدل أن تفشل عند العميل.
 *
 * ## وما لا يُعلنه العقدُ لا يُخترع له مفتاح
 *
 * المجالُ يعرف `fromState`/`toState`/`periodSource`/`rejectionReason`، والعقدُ يُعلن `state`
 * و`expected` ولا يُعلن تلك المفاتيح. وإخراجُ `from_state` مع `additionalProperties: false`
 * كان يجعل جوابَنا مرفوضاً عند مستهلكٍ يُدقّق المخطّط. فالحالةُ تنزل في `state`،
 * والقاعدةُ المكسورةُ تنزل في `expected` بصيغةٍ بنيويّةٍ ثابتة (`transition:trial>active`)،
 * وتوسيعُ العقدِ متروكٌ لمراجعةٍ تملك حزمةَ العقد — لا لطبقةٍ تكتب حقلاً لم يُعلن
 * وتسمّيه تحسيناً.
 */
export function toWireDetails(
  details: SubscriptionErrorDetails,
): SubscriptionErrorWireDetails | undefined {
  const wire: Record<string, string | number> = {};
  if (details.field !== undefined) wire.field = details.field;
  if (details.planCode !== undefined) wire.plan_code = details.planCode;
  if (details.planVersion !== undefined) wire.plan_version = details.planVersion;
  if (details.constraint !== undefined) wire.constraint = details.constraint;
  // حالةٌ واحدةٌ في `state`: حالةُ الإحالةِ إن وُجدت، وإلّا الحالةُ التي مُنِع الانتقالُ
  // منها — وهي الحالةُ التي يملكها الموردُ فعلاً وقتَ الرفض.
  const state = details.referralState ?? details.fromState;
  if (state !== undefined && state !== null) wire.state = state;
  const expected = details.expected ?? structuralExpectation(details);
  if (expected !== undefined) wire.expected = expected;
  // غائبٌ لا `{}`: كائنٌ فارغٌ في جسمِ خطأٍ يُقرأ «نعرف شيئاً ولن نقوله».
  return Object.keys(wire).length === 0 ? undefined : (wire as SubscriptionErrorWireDetails);
}

/**
 * قاعدةٌ مكسورةٌ بلا مفتاحٍ في العقد تُكتب في `expected` بصيغةٍ واحدةٍ قابلةِ للتفريق.
 *
 * `transition:<من>><إلى>` و`period_source:<المصدر>` و`rejection:<السبب>` — بلا نصٍّ عربيٍّ في
 * القيمة: الرسالةُ للإنسان و`expected` للأداة، وخلطُهما يجعل تحسينَ صياغةٍ تغييراً في عقدٍ
 * يُفرّقه مُتّصل.
 */
function structuralExpectation(details: SubscriptionErrorDetails): string | undefined {
  const parts: string[] = [];
  if (details.toState !== undefined) {
    parts.push(`transition:${details.fromState ?? "none"}>${details.toState}`);
  }
  if (details.periodSource !== undefined) parts.push(`period_source:${details.periodSource}`);
  if (details.rejectionReason !== undefined) parts.push(`rejection:${details.rejectionReason}`);
  return parts.length === 0 ? undefined : parts.join(" ");
}

function isMalformedRequest(error: unknown): boolean {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 400 || statusCode === 415;
}

export function sendSubscriptionError(
  reply: FastifyReply,
  error: unknown,
  traceId: string,
): void {
  if (isSubscriptionError(error)) {
    const details = toWireDetails(error.details);
    reply.status(error.httpStatus).send({
      error:
        details === undefined
          ? { code: error.code, message: error.message }
          : { code: error.code, message: error.message, details },
      trace_id: traceId,
    } satisfies SubscriptionErrorEnvelope);
    return;
  }

  // نفسُ `constraintOf` الذي يستعمله المخزن: لا قائمةَ قيودٍ ثانيةً هنا، والسؤالُ واحد —
  // أيحمل الخطأُ اسمَ قيدٍ في سلسلةِ `cause` أم لا.
  const constraint = constraintOf(error);
  if (constraint !== undefined) {
    reply.status(500).send({
      error: {
        code: SUBSCRIPTION_INTERNAL_ERROR_CODE,
        message: "خلل داخلي في تماسك البيانات",
        // اسمُ القيدِ اسمُ الموضعِ الذي يجب إصلاحُه، ولا يحمل شيئاً من حمولةِ المستخدم.
        details: { constraint },
      },
      trace_id: traceId,
    } satisfies SubscriptionErrorEnvelope);
    return;
  }

  if (isMalformedRequest(error)) {
    reply.status(400).send({
      error: {
        code: "SUBSCRIPTION_VALIDATION_FAILED",
        message: "جسم الطلب غير صالح",
        details: { field: "payload" },
      },
      trace_id: traceId,
    } satisfies SubscriptionErrorEnvelope);
    return;
  }

  reply.status(503).send({
    error: { code: "SUBSCRIPTION_UNAVAILABLE", message: "الاستمرارية غير متاحة" },
    trace_id: traceId,
  } satisfies SubscriptionErrorEnvelope);
}
