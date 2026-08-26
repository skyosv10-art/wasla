/**
 * ترجمةُ الخطأِ إلى سلك — الموضعُ الوحيدُ الذي يعرف رموزَ HTTP في الخدمة.
 *
 * ## لماذا لا `500` في المسارِ الأخير
 *
 * الرجوعُ الأخيرُ هنا `503 MARKETPLACE_UNAVAILABLE` لا `500`. و`500` تقول للمُتَّصل: «عيبٌ في
 * المنطقِ، لا تُعِد المحاولةَ»، و`503` تقول: «تعذّرَ الآن، أعِد». وخطأٌ غيرُ مُصنَّفٍ في خدمةٍ
 * تعتمد قاعدةَ بياناتٍ سببُه الغالبُ انقطاعُ اتّصالٍ أو مُهلةٌ — وهي حالةُ إعادةٍ. وتصنيفُها
 * `500` كان سيجعل عميلاً محتاطاً يتخلّى عن عمليّةٍ كانت ستنجح بعد ثانيتَين.
 *
 * ## والقيدُ المُنتهَكُ غيرُ المُترجَمِ `500` عن قصد
 *
 * ستّةُ قيودٍ لها رموزُ عقدٍ (`ux_stores_slug_lower` وأخواتُها). وقيدٌ سابعٌ يُنتهَك يعني أنّ
 * القاعدةَ رفضت كتابةً لم يمنعها المجالُ — وهذا عيبُ برمجةٍ لا خطأُ مُتَّصل. فيُعاد `500`
 * ومعه اسمُ القيدِ في `details.constraint`، لأنّ إخفاءَه يجعل تشخيصَ العيبِ استنتاجاً من
 * سجلاّت. ورمزُ الخطأِ الداخليُّ **ليس** في فهرسِ العقدِ عن قصدٍ: لا يُوعَد به مُتَّصلٌ.
 *
 * ## و`details` تمرّ كما هي لأنّ نوعَها **هو** نوعُ العقد
 *
 * `MarketplaceErrorDetails` مُشتَقٌّ من `ErrorResponse` في حزمةِ العقد، فمفاتيحُه العشرةُ
 * بأسمائها السلكيّةِ ومغلقةٌ بـ`additionalProperties: false`. ولذلك لا خريطةَ تحويلٍ هنا:
 * خريطةٌ تعني نسخةً ثانيةً من قائمةِ المفاتيح تُنسى عند إضافةِ مفتاحٍ في العقد. ومفتاحٌ
 * داخليٌّ يُخترَع في المجالِ يسقط في `typecheck` لا في جسمِ جوابٍ عامّ.
 */

import type { FastifyReply } from "fastify";
import { isReplayedResponse } from "../app/idempotency.js";
import { constraintOf } from "../db/constraints.js";
import { httpStatusForMarketplaceError, type ErrorResponse } from "../domain/contract-sets.js";
import { isMarketplaceError, type MarketplaceErrorDetails } from "../domain/errors.js";

/** رمزٌ داخليٌّ خارجَ فهرسِ العقد — لا يُوعَد به مُتَّصلٌ ولا يُبنى عليه. */
export const MARKETPLACE_INTERNAL_ERROR_CODE = "MARKETPLACE_INTERNAL_DEFECT";

type WireDetails = MarketplaceErrorDetails;

/** جسمٌ مُشوَّهٌ أو نوعُ محتوًى مرفوضٌ — يُعرَف برمزِ الحالةِ الذي يُرفقه المُحلِّل. */
function isMalformedRequest(error: unknown): boolean {
  const status = (error as { statusCode?: unknown } | undefined)?.statusCode;
  return status === 400 || status === 415;
}

function body(
  code: string,
  message: string,
  traceId: string,
  details?: WireDetails,
): ErrorResponse {
  const error = details === undefined ? { code, message } : { code, message, details };
  return { error, trace_id: traceId } as ErrorResponse;
}

/**
 * مُعالِجُ الخطأِ الواحدُ — وترتيبُ فروعِه مقصودٌ ومفحوص.
 *
 * الإعادةُ أوّلاً لأنّها ليست خطأً بل جوابٌ محفوظٌ يُعاد **حرفاً بحرف** برمزِه المخزَّن؛ ولو
 * جاءت بعدَ فرعِ المجالِ لَتحوّلت إعادةُ `201` ناجحةٍ إلى `409`. ثمّ خطأُ المجالِ برمزِ عقده.
 * ثمّ القيدُ غيرُ المُترجَم. ثمّ الجسمُ المُشوَّه. ثمّ الرجوعُ الأخير.
 */
export function sendMarketplaceError(
  reply: FastifyReply,
  error: unknown,
  traceId: string,
): FastifyReply {
  if (isReplayedResponse(error)) {
    return reply.status(error.stored.responseStatus).send(error.stored.responseBody);
  }

  if (isMarketplaceError(error)) {
    return reply
      .status(httpStatusForMarketplaceError(error.code))
      .send(body(error.code, error.message, traceId, error.details));
  }

  const constraint = constraintOf(error);
  if (constraint !== undefined) {
    return reply
      .status(500)
      .send(
        body(MARKETPLACE_INTERNAL_ERROR_CODE, "a database constraint rejected a write the domain allowed", traceId, {
          constraint,
        }),
      );
  }

  if (isMalformedRequest(error)) {
    return reply
      .status(400)
      .send(
        body("MARKETPLACE_VALIDATION_FAILED", "the request body could not be read", traceId, {
          field: "payload",
          expected: "a JSON object matching the contract",
        }),
      );
  }

  return reply
    .status(503)
    .send(body("MARKETPLACE_UNAVAILABLE", "the marketplace service is unavailable", traceId));
}
