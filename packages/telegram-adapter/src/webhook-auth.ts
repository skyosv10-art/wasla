/**
 * Webhook authentication (ADR-007 rule 1, SECURITY_RULES).
 *
 * Telegram echoes a secret we registered with `setWebhook` in a request header.
 * That header is the *only* thing separating our webhook from an open endpoint
 * that lets anyone inject updates on behalf of any user, so verification runs
 * before parsing, before de-duplication, before any I/O.
 *
 * Lives in the adapter because the header name is Telegram vocabulary; the bots
 * only call `assertWebhookSecret` and translate the thrown error into a 401.
 */

import { timingSafeEqual } from "node:crypto";

import { channelError } from "@wasla/channel-core";
import { WEBHOOK_SECRET_HEADER } from "@wasla/contracts-channel";

export { WEBHOOK_SECRET_HEADER };

/** Minimum length accepted for a configured secret. */
export const MIN_WEBHOOK_SECRET_LENGTH = 16;

/** Header bag shape shared by Node's `http` and Fastify. */
export type HeaderBag = Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * Case-insensitive header lookup.
 *
 * Node lowercases incoming header names, but a proxy, a test harness or a
 * framework wrapper may not — and reading the header under one casing only would
 * turn a working deployment into a wall of 401s.
 */
function headerValue(headers: HeaderBag, name: string): string | undefined {
  const wanted = name.toLowerCase();
  const direct = headers[wanted];
  const found =
    direct ??
    Object.entries(headers).find(([key]) => key.toLowerCase() === wanted)?.[1];
  const value = Array.isArray(found) ? found[0] : found;
  return typeof value === "string" ? value : undefined;
}

/** Length-independent comparison, so a rejection leaks nothing about the secret. */
function equals(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verifies the webhook secret token.
 *
 * A missing configured secret is treated as a failure, not as "authentication
 * disabled": a deployment that forgot the variable must stop accepting updates
 * rather than silently accept everything.
 *
 * @throws ChannelError `CHANNEL_UNAUTHORIZED_WEBHOOK` — always with the same
 *         message and no details, so the response cannot be used as an oracle
 *         for which part of the check failed.
 */
export function assertWebhookSecret(headers: HeaderBag, expectedSecret: string | undefined): void {
  const unauthorized = (): never => {
    throw channelError("CHANNEL_UNAUTHORIZED_WEBHOOK", "طلب webhook غير مُصرّح به");
  };

  if (!expectedSecret || expectedSecret.length < MIN_WEBHOOK_SECRET_LENGTH) unauthorized();
  const provided = headerValue(headers, WEBHOOK_SECRET_HEADER);
  if (!provided) unauthorized();
  if (!equals(provided as string, expectedSecret as string)) unauthorized();
}
