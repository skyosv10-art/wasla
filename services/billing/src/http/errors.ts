/**
 * ترجمةُ أخطاءِ المجالِ إلى رموزِ HTTP (Phase 17 · ADR-050).
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import { isBillingError } from "../domain/errors.js";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (isBillingError(error)) {
      reply.status(error.httpStatus).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ?? {}),
        },
      });
      return;
    }

    reply.status(503).send({
      error: {
        code: "BILLING_UNAVAILABLE",
        message: "Service temporarily unavailable",
      },
    });
  });
}

export function sendError(reply: FastifyReply, code: string, message: string, status: number): void {
  reply.status(status).send({
    error: { code, message },
  });
}
