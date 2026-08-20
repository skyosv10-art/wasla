/**
 * Telegram failure → `CHANNEL_*` translation (ADR-007 rule 7).
 *
 * This table is the reason the core can decide "retry or give up" without ever
 * reading a Telegram error string. Two properties matter more than completeness:
 *
 * - **Retryable is a decision, not a guess.** A blocked chat retried 5 times is
 *   5 wasted calls against a per-bot rate budget, and a 500 treated as final
 *   loses a message the channel would have accepted a second later.
 * - **Nothing from Telegram travels upward.** The description is matched here
 *   and dropped; only the code and an optional cooldown cross the boundary. That
 *   keeps channel text out of logs, events and API responses.
 *
 * Unknown descriptions fall back on the HTTP status, so an unrecognised Bot API
 * message degrades to a sane class instead of crashing the send path.
 */

import type { ChannelErrorCode } from "@wasla/contracts-channel";

/** Outcome of translating a channel-native failure. */
export interface MappedFailure {
  readonly errorCode: ChannelErrorCode;
  /** Cooldown Telegram asked for, when it supplied one. */
  readonly retryAfterSeconds?: number;
}

/** What the client observed, already stripped of Telegram-specific structure. */
export interface FailureInput {
  /** HTTP status, or undefined when the request never produced a response. */
  readonly status?: number;
  /** `description` from the Bot API envelope, when present. */
  readonly description?: string;
  /** `parameters.retry_after`, in seconds. */
  readonly retryAfterSeconds?: number;
  /** True when the request timed out or the socket failed. */
  readonly transportFailed?: boolean;
}

/**
 * Descriptions that identify a *permanently* undeliverable chat.
 *
 * Telegram reports all of these with 400 or 403, mixed in with genuine
 * validation errors, so the status alone is not enough to tell "this chat will
 * never accept a message" from "this request was malformed".
 */
const UNREACHABLE_DESCRIPTIONS: readonly string[] = [
  "bot was blocked by the user",
  "user is deactivated",
  "chat not found",
  "bot was kicked",
  "the group chat was upgraded",
  "peer_id_invalid",
  "bot can't initiate conversation",
  "bot can't send messages to bots",
  "have no rights to send a message",
  "not enough rights",
] as const;

/** Descriptions that mean our payload was wrong — a code defect, never a retry. */
const INVALID_DESCRIPTIONS: readonly string[] = [
  "message text is empty",
  "message is too long",
  "button_url_invalid",
  "inline keyboard expected",
  "button type is invalid",
  "can't parse entities",
  "web_app_url_invalid",
  "buttons_too_much",
] as const;

function matches(description: string, table: readonly string[]): boolean {
  const haystack = description.toLowerCase();
  return table.some((needle) => haystack.includes(needle));
}

/**
 * Translates one Telegram failure into the WASLA vocabulary.
 *
 * Status handling, and why:
 *
 * | observed | code | retryable | reasoning |
 * |---|---|---|---|
 * | transport/timeout | `CHANNEL_TRANSPORT_ERROR` | yes | the message may never have left |
 * | 429 | `CHANNEL_RATE_LIMITED` | yes | with Telegram's own cooldown |
 * | 5xx | `CHANNEL_TRANSPORT_ERROR` | yes | Telegram-side, transient |
 * | 401 / 404 | `CHANNEL_INTERNAL_ERROR` | no | bad token or method: our misconfiguration; retrying cannot fix it |
 * | 403 | `CHANNEL_CHAT_UNREACHABLE` | no | user blocked the bot or it was removed |
 * | 400 | by description | no | unreachable chat vs. invalid payload |
 */
export function mapTelegramFailure(input: FailureInput): MappedFailure {
  const cooldown =
    input.retryAfterSeconds !== undefined ? { retryAfterSeconds: input.retryAfterSeconds } : {};

  if (input.transportFailed || input.status === undefined) {
    return { errorCode: "CHANNEL_TRANSPORT_ERROR", ...cooldown };
  }

  const description = input.description ?? "";

  if (input.status === 429) {
    return { errorCode: "CHANNEL_RATE_LIMITED", ...cooldown };
  }
  if (input.status >= 500) {
    return { errorCode: "CHANNEL_TRANSPORT_ERROR", ...cooldown };
  }
  if (input.status === 401 || input.status === 404) {
    return { errorCode: "CHANNEL_INTERNAL_ERROR" };
  }
  if (matches(description, UNREACHABLE_DESCRIPTIONS)) {
    return { errorCode: "CHANNEL_CHAT_UNREACHABLE" };
  }
  if (input.status === 403) {
    return { errorCode: "CHANNEL_CHAT_UNREACHABLE" };
  }
  if (matches(description, INVALID_DESCRIPTIONS)) {
    return { errorCode: "CHANNEL_INVALID_MESSAGE" };
  }
  if (input.status === 400) {
    return { errorCode: "CHANNEL_INVALID_MESSAGE" };
  }

  // 402/409/418 and anything else unclassified: do not retry blindly.
  return { errorCode: "CHANNEL_INTERNAL_ERROR" };
}
