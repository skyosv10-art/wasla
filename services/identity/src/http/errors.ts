/**
 * HTTP error mapping for the Identity service.
 *
 * Domain use cases throw `IdentityError` (stable `code` + `class` + `httpStatus`
 * per contracts/errors.md). The Fastify error handler maps those to the
 * contract Error shape `{ code, message, trace_id }` at the right HTTP status.
 *
 * Unclassified errors (anything that is not an IdentityError — e.g. a
 * malformed JSON body, an unexpected throw) fall back to
 * IDENTITY_INTERNAL_ERROR (503 service_unavailable), the contract's catch-all
 * for "خطأ داخلي غير متوقّع". Body-shape and domain validation is delegated to
 * the use cases, which throw the stable codes; only truly unclassified
 * failures land in the 503 bucket.
 */

import type { FastifyReply } from "fastify";

import { IdentityError } from "../domain/errors.js";

export interface IdentityErrorBody {
  code: string;
  message: string;
  trace_id: string;
}

/** Map a thrown error to the contract Error body and set the HTTP status. */
export function sendIdentityError(
  reply: FastifyReply,
  error: unknown,
  traceId: string,
): void {
  if (error instanceof IdentityError) {
    reply.status(error.httpStatus).send({
      code: error.code,
      message: error.message,
      trace_id: error.traceId ?? traceId,
    } satisfies IdentityErrorBody);
    return;
  }

  reply.status(503).send({
    code: "IDENTITY_INTERNAL_ERROR",
    message: "an unexpected internal error occurred",
    trace_id: traceId,
  } satisfies IdentityErrorBody);
}
