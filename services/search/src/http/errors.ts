/**
 * Search HTTP error translation — the ONE place that knows HTTP status codes
 * for the search service (ADR-025 §5 / errors.md).
 *
 * ## One error handler, no per-route try/catch
 *
 * Handlers throw typed search errors; a single `setErrorHandler` (see app.ts)
 * calls `sendSearchError`. A `try/catch` inside a handler would mean a second
 * translation of the same error in a place nobody reads — and the first route
 * that forgets the shape returns a body that does not match `ErrorResponse`.
 *
 * ## 503 as the last resort, not 500
 *
 * The final fallback is `503 SEARCH_INTERNAL_ERROR`, not `500`. The search read
 * model depends on a derived index whose failures are overwhelmingly transient
 * (connection, timeout, relay lag) — a retryable state. `500` tells a caller
 * "logic defect, do not retry"; `503` tells it "retry". A search that would
 * succeed in two seconds must not be abandoned by a cautious client.
 *
 * ## Error body shape
 *
 * Flat `{ code, message, trace_id }` per `contracts/errors.md` — NOT a nested
 * `{ error: {...} }`. The contract `ErrorResponse` (api-types.ts) is the source.
 */

import type { FastifyReply } from "fastify";

/** A validation failure (400). Code MUST be a `validation_error` code from errors.md. */
export class SearchValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SearchValidationError";
  }
}

/**
 * مطلوبٌ غيرُ موجودٍ (404) — `G5` موجةُ اليدِ (`CLM-0248`).
 *
 * ولمَ صنفٌ جديدٌ لا `SearchValidationError`؟ لأنَّ 400 يقولُ «طلبُكَ مُشوَّهٌ»
 * و404 يقولُ «طلبُكَ سليمٌ ولا صفَّ بهِ». ومُشغِّلٌ في حادثةٍ يقرأُ 400 فيُراجِعُ
 * شكلَ نداءِهِ ساعةً، والعيبُ أنَّ المُعرِّفَ من دفترٍ آخرَ. وهذانِ صنفانِ
 * **حدّيّانِ** لا مجاليّانِ: القرارُ كلُّهُ في `domain/relay-requeue.ts`، وهذا
 * نقلُهُ إلى لغةِ HTTP في الموضعِ الوحيدِ الذي يعرِفُ الأكوادَ.
 */
export class SearchNotFoundError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SearchNotFoundError";
  }
}

/**
 * تنازعُ حالةٍ (409) — الصفُّ موجودٌ وحالتُهُ تمنعُ الفعلَ.
 *
 * و409 لا 200 صامتٌ: إعادةُ صفٍّ `applied` تعني إعادةَ تطبيقِ أثرٍ وقعَ؛
 * والتماثُليّةُ تحميهِ فعلاً، لكنَّ **قبولَ النداءِ** يجعلُ خطأَ مُشغِّلٍ في نسخِ
 * مُعرِّفٍ مقبولاً بلا أثرٍ مرئيٍّ فلا يتعلَّمُ أنَّهُ أخطأَ.
 */
export class SearchConflictError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SearchConflictError";
  }
}

/** A degraded/unavailable read-model failure (503). Code is a `service_unavailable` code. */
export class SearchUnavailableError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SearchUnavailableError";
  }
}

/** Wire body shape — matches `ErrorResponse` in the search contract exactly. */
interface SearchErrorBody {
  readonly code: string;
  readonly message: string;
  readonly trace_id?: string;
}

function body(code: string, message: string, traceId: string): SearchErrorBody {
  return { code, message, trace_id: traceId };
}

/**
 * The single error translator. Branch order is intentional and tested:
 * validation first (client mistake, 400), then not-found (404), then conflict
 * (409), then unavailable (degraded, 503), then the fallback (503). No `500` is
 * ever returned.
 *
 * وترتيبُ 404 و409 قبلَ 503 ليسَ ذوقاً: الفرعُ الأخيرُ يبتلعُ كلَّ ما لم
 * يُصنَّفْ، فصنفٌ يُضافُ ولا فرعَ لهُ يُقرأُ «خدمةٌ متعطّلةٌ» — أي حكمٌ كاذبٌ
 * على الخدمةِ بسببِ خطأِ منادٍ.
 */
export function sendSearchError(
  reply: FastifyReply,
  error: unknown,
  traceId: string,
): FastifyReply {
  if (error instanceof SearchValidationError) {
    return reply.status(400).send(body(error.code, error.message, traceId));
  }
  if (error instanceof SearchNotFoundError) {
    return reply.status(404).send(body(error.code, error.message, traceId));
  }
  if (error instanceof SearchConflictError) {
    return reply.status(409).send(body(error.code, error.message, traceId));
  }
  if (error instanceof SearchUnavailableError) {
    return reply.status(503).send(body(error.code, error.message, traceId));
  }
  // Unknown — treat as degraded, never 500 (see file header).
  const message =
    error instanceof Error ? error.message : "unexpected search failure";
  return reply
    .status(503)
    .send(body("SEARCH_INTERNAL_ERROR", message, traceId));
}
