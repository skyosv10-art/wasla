/**
 * HTTP error mapping for the Customer Core service (MR 4/6).
 *
 * Use cases throw `CustomerError`, which already carries the stable contract
 * code, its documented class and the HTTP status derived from that class
 * (@wasla/contracts-customer, drift-guarded against contracts/errors.md). This
 * file does not re-classify anything: it only writes the contract Error shape
 * `{ code, message, trace_id }` at the status the catalog already decided.
 *
 * Two kinds of non-domain error still have to be answered:
 *
 *  - Fastify's own transport-level client errors — a body that is not valid JSON
 *    (FST_ERR_CTP_INVALID_JSON) or an unsupported content type — are mapped to
 *    CUSTOMER_INVALID_REQUEST_BODY (400). They are caller mistakes, and calling
 *    them a 503 would tell the bot to retry a request that can never succeed;
 *  - everything else — a bug, a driver error escaping the repository — becomes
 *    CUSTOMER_INTERNAL_ERROR (503 service_unavailable), the documented catch-all
 *    for «خطأ داخلي غير متوقّع».
 *
 * Request-shape validation happens in requests.ts and throws the stable
 * validation codes, so only genuinely unclassified failures land in 503.
 *
 * Fastify's own 404 (an unknown route) is deliberately NOT mapped to a customer
 * code: an unrouted path is not a missing customer entity, and reusing
 * CUSTOMER_PROFILE_NOT_FOUND for it would make a typo in a URL look like a
 * business outcome.
 */

import type { FastifyReply } from "fastify";

import { CustomerError } from "../domain/errors.js";

/**
 * Fastify marks its transport errors with a 4xx `statusCode`. Only the two
 * request-body statuses are treated as caller mistakes; a 4xx invented by any
 * other plugin is not silently blessed as a validation error.
 */
function isClientBodyError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 400 || statusCode === 415;
}

export interface CustomerErrorBody {
  code: string;
  message: string;
  trace_id: string;
}

/** Map a thrown error to the contract Error body and set the HTTP status. */
export function sendCustomerError(
  reply: FastifyReply,
  error: unknown,
  traceId: string,
): void {
  if (error instanceof CustomerError) {
    reply.status(error.httpStatus).send({
      code: error.code,
      message: error.message,
      trace_id: error.traceId ?? traceId,
    } satisfies CustomerErrorBody);
    return;
  }

  if (isClientBodyError(error)) {
    reply.status(400).send({
      code: "CUSTOMER_INVALID_REQUEST_BODY",
      message: "جسم الطلب غير صالح",
      trace_id: traceId,
    } satisfies CustomerErrorBody);
    return;
  }

  reply.status(503).send({
    code: "CUSTOMER_INTERNAL_ERROR",
    message: "خطأ داخلي غير متوقّع",
    trace_id: traceId,
  } satisfies CustomerErrorBody);
}
