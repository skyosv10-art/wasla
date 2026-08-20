/**
 * HTTP error mapping for the Geography service (MR 5).
 *
 * Domain use cases throw `GeographyError` (stable `code` + `class` +
 * `httpStatus` per contracts/errors.md). The Fastify error handler maps those
 * to the contract Error shape `{ code, message, trace_id }` at the matching
 * HTTP status.
 *
 * Unclassified errors (anything that is not a GeographyError — e.g. malformed
 * JSON, an unexpected throw) fall back to GEO_INTERNAL_ERROR (503
 * service_unavailable), the contract catch-all for "خطأ داخلي غير متوقع".
 * Request-shape validation (locale / body) happens in app.ts and throws the
 * stable validation codes, so only truly unclassified failures land in 503.
 */

import type { FastifyReply } from "fastify";

import { GeographyError } from "../domain/errors.js";

export interface GeographyErrorBody {
  code: string;
  message: string;
  trace_id: string;
}

/** Map a thrown error to the contract Error body and set the HTTP status. */
export function sendGeographyError(
  reply: FastifyReply,
  error: unknown,
  traceId: string,
): void {
  if (error instanceof GeographyError) {
    reply.status(error.httpStatus).send({
      code: error.code,
      message: error.message,
      trace_id: error.traceId ?? traceId,
    } satisfies GeographyErrorBody);
    return;
  }

  reply.status(503).send({
    code: "GEO_INTERNAL_ERROR",
    message: "an unexpected internal error occurred",
    trace_id: traceId,
  } satisfies GeographyErrorBody);
}
