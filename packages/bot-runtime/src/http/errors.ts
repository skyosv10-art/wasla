/**
 * HTTP error mapping for the bots layer.
 *
 * Every failure that reaches the boundary is answered with the contract's
 * `Error` envelope `{ code, message, details? }` at the status the catalogue
 * assigns to the code (`statusForChannelError`) — the status is never chosen
 * here, so an error class can never mean 401 on one route and 403 on another.
 *
 * Anything that is *not* a `ChannelError` (a bad JSON body, an unexpected throw)
 * becomes `CHANNEL_INTERNAL_ERROR` (503), the catalogue's catch-all. Its message
 * is fixed and carries no detail: an internal failure must not describe itself to
 * an unauthenticated caller (SECURITY_RULES).
 */

import type { FastifyReply } from "fastify";

import { ChannelError } from "@wasla/channel-core";
import type { ChannelErrorResponse } from "@wasla/contracts-channel";

/** Status of the catch-all, kept next to the body that uses it. */
const INTERNAL_STATUS = 503;

/** Map a thrown error onto the contract error envelope and send it. */
export function sendChannelError(reply: FastifyReply, error: unknown): void {
  if (error instanceof ChannelError) {
    reply.status(error.status).send({
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    } satisfies ChannelErrorResponse);
    return;
  }

  reply.status(INTERNAL_STATUS).send({
    code: "CHANNEL_INTERNAL_ERROR",
    message: "خطأ داخلي غير متوقع",
  } satisfies ChannelErrorResponse);
}
