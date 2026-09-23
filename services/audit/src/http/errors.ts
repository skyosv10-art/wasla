/**
 * HTTP error mapping for the Audit service.
 *
 * Flat error shape: { code, message, trace_id }.
 * Status codes come from AuditError.httpStatus.
 * Unknown errors become 503 AUDIT_INTERNAL_ERROR.
 */

import type { FastifyReply } from "fastify";

import { AuditError } from "../domain/errors.js";

export interface AuditErrorBody {
  readonly code: string;
  readonly message: string;
  readonly trace_id: string;
}

function isMalformedRequest(error: unknown): boolean {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 400 || statusCode === 415;
}

export function sendAuditError(reply: FastifyReply, error: unknown, traceId: string): void {
  if (error instanceof AuditError) {
    reply.status(error.httpStatus).send({
      code: error.code,
      message: error.message,
      trace_id: error.traceId ?? traceId,
    } satisfies AuditErrorBody);
    return;
  }
  if (isMalformedRequest(error)) {
    reply.status(400).send({
      code: "AUDIT_INVALID_REQUEST_BODY",
      message: "جسم الطلب غير صالح",
      trace_id: traceId,
    } satisfies AuditErrorBody);
    return;
  }
  reply.status(503).send({
    code: "AUDIT_INTERNAL_ERROR",
    message: "خطأ داخلي غير متوقّع",
    trace_id: traceId,
  } satisfies AuditErrorBody);
}
