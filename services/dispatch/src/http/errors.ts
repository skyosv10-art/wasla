import type { FastifyReply } from "fastify";

import { isDispatchError } from "../domain/errors.js";

export interface DispatchErrorBody {
  code: string;
  message: string;
  trace_id: string;
}

function isClientBodyError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 400 || statusCode === 415;
}

export function sendDispatchError(reply: FastifyReply, error: unknown, traceId: string): void {
  if (isDispatchError(error)) {
    reply.status(error.httpStatus).send({
      code: error.code,
      message: error.message,
      trace_id: error.traceId ?? traceId,
    } satisfies DispatchErrorBody);
    return;
  }
  if (isClientBodyError(error)) {
    reply.status(400).send({
      code: "DISPATCH_VALIDATION_FAILED",
      message: "جسم الطلب غير صالح",
      trace_id: traceId,
    } satisfies DispatchErrorBody);
    return;
  }
  reply.status(503).send({
    code: "DISPATCH_ENGINE_UNAVAILABLE",
    message: "منفذ إلزامي غير متاح",
    trace_id: traceId,
  } satisfies DispatchErrorBody);
}
