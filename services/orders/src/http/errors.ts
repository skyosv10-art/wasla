/**
 * HTTP error mapping for the Order Engine service (MR 4/6).
 *
 * The use cases throw `OrderError`, which already carries the stable contract
 * code, its documented class and the HTTP status derived from that class
 * (`httpStatusForOrderError`, drift-guarded against contracts/errors.md). This
 * file classifies NOTHING: it writes the contract error shape
 * `{ code, message, trace_id }` at the status the catalog already decided. A
 * second opinion here would mean two answers to "what is a 409?", and the caller
 * — the customers service in MR 5/6 — keys its retry policy on exactly that.
 *
 * Two families of non-domain error still need an answer:
 *
 *  - Fastify's own transport-level client errors — a body that is not valid JSON
 *    (`FST_ERR_CTP_INVALID_JSON`), a missing body on a route that requires one,
 *    an unsupported content type — become `ORDER_VALIDATION_FAILED` (400). They
 *    are caller mistakes: answering 503 would tell the customers service to
 *    retry a request that can never succeed, and the Phase 04 exit gate already
 *    fixed the meaning of 400 at this boundary ("the handover treats it as ITS
 *    OWN bug, not as a business rejection");
 *  - everything else — a bug here, a driver error escaping the repository, a
 *    transaction that could not be opened — becomes `ORDER_ENGINE_UNAVAILABLE`
 *    (503), the documented catch-all. 503 is chosen over 500 deliberately: the
 *    error catalog has no `service_error` class, and the caller's documented
 *    reaction to 503 (retry with the same `Idempotency-Key`) is the correct one
 *    for a transient internal failure. Intake is idempotent, so that retry
 *    cannot produce a second order.
 *
 * Request-shape validation lives in requests.ts and throws the stable validation
 * codes, so nothing that has a proper code can fall through to the 503 branch.
 *
 * Fastify's own 404 for an unknown route is deliberately NOT mapped to
 * `ORDER_NOT_FOUND`: an unrouted path is not a missing order, and reusing the
 * business code would make a typo in a URL indistinguishable from "this order
 * does not exist" in the caller's logs.
 */

import type { FastifyReply } from "fastify";

import { isOrderError } from "../domain/errors.js";

/**
 * Fastify marks its transport errors with a 4xx `statusCode`. Only the two
 * request-body statuses are treated as caller mistakes; a 4xx invented by some
 * other plugin is not silently blessed as a validation error.
 */
function isClientBodyError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 400 || statusCode === 415;
}

/** The contract `ErrorResponse` shape — the only error body this service emits. */
export interface OrderErrorBody {
  code: string;
  message: string;
  trace_id: string;
}

/**
 * Map a thrown error to the contract error body and set the HTTP status.
 *
 * `traceId` is the per-request correlation id (`x-request-id` when the caller
 * sent one). A domain error that already carries its own trace id wins, because
 * it was raised deeper with the id that was recorded in the audit row and in the
 * event envelope — reporting a different one in the response would break the
 * single thread a support agent follows.
 */
export function sendOrderError(
  reply: FastifyReply,
  error: unknown,
  traceId: string,
): void {
  if (isOrderError(error)) {
    reply.status(error.httpStatus).send({
      code: error.code,
      message: error.message,
      trace_id: error.traceId ?? traceId,
    } satisfies OrderErrorBody);
    return;
  }

  if (isClientBodyError(error)) {
    reply.status(400).send({
      code: "ORDER_VALIDATION_FAILED",
      message: "جسم الطلب غير صالح",
      trace_id: traceId,
    } satisfies OrderErrorBody);
    return;
  }

  reply.status(503).send({
    code: "ORDER_ENGINE_UNAVAILABLE",
    message: "محرّك الطلبات غير متاح حالياً",
    trace_id: traceId,
  } satisfies OrderErrorBody);
}
