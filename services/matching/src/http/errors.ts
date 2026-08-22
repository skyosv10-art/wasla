/**
 * تحويل أخطاء المطابقة إلى رد العقد.
 *
 * الخطأ المجالي يحمل أصلاً الرمز الثابت وحالة HTTP، فلا تعيد هذه الطبقة تفسيره
 * حتى لا يصبح للرمز الواحد معنيان. أخطاء النقل التي يرفضها Fastify هي 400؛ وما
 * عدا ذلك 503 لأن العقد لا يعلن خطأ داخلياً آخر ولا يجوز كشف تفاصيله.
 */

import type { FastifyReply } from "fastify";

import { isMatchingError } from "../domain/errors.js";

/** شكل الخطأ الوحيد الذي تصدره الخدمة. */
export interface MatchingErrorBody {
  code: string;
  message: string;
  trace_id: string;
}

function isClientBodyError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 400 || statusCode === 415;
}

/** يرسل الخطأ دون تفاصيل داخلية أو قيمة المدخل المرفوضة. */
export function sendMatchingError(
  reply: FastifyReply,
  error: unknown,
  traceId: string,
): void {
  if (isMatchingError(error)) {
    reply.status(error.httpStatus).send({
      code: error.code,
      message: error.message,
      trace_id: error.traceId ?? traceId,
    } satisfies MatchingErrorBody);
    return;
  }

  if (isClientBodyError(error)) {
    reply.status(400).send({
      code: "MATCHING_VALIDATION_FAILED",
      message: "جسم الطلب غير صالح",
      trace_id: traceId,
    } satisfies MatchingErrorBody);
    return;
  }

  reply.status(503).send({
    code: "MATCHING_UNAVAILABLE",
    message: "خدمة المطابقة غير متاحة حالياً",
    trace_id: traceId,
  } satisfies MatchingErrorBody);
}
