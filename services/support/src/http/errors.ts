/**
 * ترجمةُ أخطاءِ المجالِ إلى رموزِ HTTP (Phase 16 · ADR-049).
 *
 * لا خطأَ يُعاد تصنيفه هنا — رمزُ HTTP يأتي من `SupportError.httpStatus` المُشتقّ من
 * `@wasla/contracts-support`. والأخطاءُ غيرُ المعروفة تصير `503` لا `500` لأنّها
 * عملياً منفذٌ فشل (بركةُ اتصال، صادر)، و`503` يقول للمُتَّصل إنّ إعادة المحاولة قد تنجح.
 */

import type { FastifyInstance, FastifyReply } from "fastify";

import { isSupportError } from "../domain/errors.js";

/** يُسجِّلُ معالجَ الأخطاءِ على تطبيقِ Fastify. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (isSupportError(error)) {
      reply.status(error.httpStatus).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ?? {}),
        },
      });
      return;
    }

    // Unknown errors → 503 (port failure, not a domain error)
    reply.status(503).send({
      error: {
        code: "SUPPORT_UNAVAILABLE",
        message: "Service temporarily unavailable",
      },
    });
  });
}

/** يُرسلُ خطأً كهيكلِ الاستجابةِ المعياريّ — للمعالجاتِ التي تُريدُ الرفضَ يدويّاً. */
export function sendError(reply: FastifyReply, code: string, message: string, status: number): void {
  reply.status(status).send({
    error: { code, message },
  });
}
