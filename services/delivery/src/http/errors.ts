/**
 * Delivery HTTP error translation — the ONE place that turns a domain error
 * into a wire response (ADR-026 §2.6 · contracts/errors.md).
 *
 * ## Nothing is re-classified here
 *
 * `DeliveryError` already carries `class` and `httpStatus`, derived in
 * @wasla/contracts-delivery from the drift-guarded catalog. This file reads
 * `error.httpStatus`; it does not own a status table. A second table would
 * be a second truth, and the first divergence would be invisible — the
 * catalog says 409, the route answers 400, and both look intentional.
 *
 * ## The delivery error body is NOT the search error body
 *
 * Delivery's `ErrorResponse` is `{error_code, message, trace_id}`; the search
 * service publishes `{code, message, trace_id}`. Copying search's shape here
 * (the file is otherwise a close sibling) would break every delivery client
 * that reads `error_code`. The field name is part of the contract, so it is
 * asserted in the tests rather than trusted to a reviewer's eye.
 *
 * ## Unknown errors are 500, not 503 — the opposite of search, on purpose
 *
 * The search boundary falls back to `503` because its failures are dominated
 * by transient read-model degradation and a retry is safe. Delivery's write
 * path is not: `POST /store-orders` carries no idempotency key in this
 * contract (declared debt, ADR-026 §4.9-3), so telling a client "retry" can
 * mint a second real order. `500 DELIVERY_INTERNAL_ERROR` says "do not
 * retry", which is the honest answer for an unclassified failure on a
 * non-idempotent command. Genuine dependency outages are still `503`,
 * because the use cases raise `DELIVERY_MARKETPLACE_UNAVAILABLE` /
 * `DELIVERY_DISPATCH_UNAVAILABLE` explicitly — the fallback exists for
 * defects, and a defect is not a retry hint.
 */

import type { FastifyReply } from "fastify";

import { isDeliveryError } from "../domain/errors.js";

/** Wire body — matches `ErrorResponse` in the delivery contract exactly. */
export interface DeliveryErrorBody {
  readonly error_code: string;
  readonly message: string;
  readonly trace_id: string;
}

/**
 * The single error translator. `DeliveryError` → its own status and code;
 * anything else → `500 DELIVERY_INTERNAL_ERROR`.
 */
export function sendDeliveryError(
  reply: FastifyReply,
  error: unknown,
  traceId: string,
): FastifyReply {
  if (isDeliveryError(error)) {
    return reply.status(error.httpStatus).send({
      error_code: error.code,
      message: error.message,
      trace_id: traceId,
    } satisfies DeliveryErrorBody);
  }

  // Unknown: keep the message for the log, keep the code stable for clients.
  const message = error instanceof Error ? error.message : "خطأٌ غيرُ متوقَّعٍ في خدمةِ التوصيلِ";
  return reply.status(500).send({
    error_code: "DELIVERY_INTERNAL_ERROR",
    message,
    trace_id: traceId,
  } satisfies DeliveryErrorBody);
}
