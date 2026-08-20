/**
 * @wasla/contracts-channel
 *
 * Typed Channel Layer contracts:
 *  - API types generated from the OpenAPI source-of-truth via `openapi-typescript`.
 *  - Event types hand-derived from the JSON Schema Event Contract (events.json).
 *  - Error codes mirrored from the error catalogue (errors.md), drift-guarded.
 *
 * These are Contract First artifacts (ADR-004) — NOT a runtime implementation.
 * Consumers (@wasla/channel-core, @wasla/telegram-adapter, bots/*, and later
 * the notifications service) import these types to stay aligned with the
 * published Channel API + Event contracts.
 *
 * Channel-agnostic by contract (ADR-007): nothing here names Telegram. The
 * channel is a value (`ChannelName`), never a type or a field name.
 *
 * Regenerate API types: pnpm --filter @wasla/contracts-channel generate
 */

export type * from "./api-types.js";
export type * from "./events-types.js";
export { CHANNEL_EVENT_TYPES } from "./events-types.js";

import type { paths, components } from "./api-types.js";

/** All API paths and their operations. */
export type { paths };

// --- API contract types (from OpenAPI) --------------------------------

/** Response of `POST /channel/{bot}/webhook` — accepted or duplicate. */
export type UpdateAccepted = components["schemas"]["UpdateAccepted"];

/** An outbound message request (the single exit point for all channels). */
export type OutboundMessage = components["schemas"]["OutboundMessage"];

/** A button on an outbound message (Mini App launch or Deep Link). */
export type MessageButton = components["schemas"]["MessageButton"];

/** A Mini App launch button — the adapter turns this into a channel button. */
export type MiniAppButton = components["schemas"]["MiniAppButton"];

/** A Deep Link button. */
export type DeepLinkButton = components["schemas"]["DeepLinkButton"];

/** Supported Deep Link actions (extend by addition only). */
export type DeepLinkAction = components["schemas"]["DeepLinkAction"];

/** Request body for generating a Deep Link. */
export type DeepLinkRequest = components["schemas"]["DeepLinkRequest"];

/** Generated Deep Link (url + encoded payload). */
export type DeepLinkResponse = components["schemas"]["DeepLinkResponse"];

/** Which Mini App a given bot launches. */
export type MiniAppLaunch = components["schemas"]["MiniAppLaunch"];

/** Response of `POST /channel/messages`. */
export type DeliveryAccepted = components["schemas"]["DeliveryAccepted"];

/** The stable error envelope shared by all channel endpoints. */
export type ChannelErrorResponse = components["schemas"]["Error"];

// --- Event contract types (from events.json) --------------------------
import type {
  ChannelName,
  BotKind,
  MiniAppKind,
  InboundUpdateKind,
  EventEnvelope,
  UpdateReceivedV1,
  MessageDeliveredV1,
  MessageFailedV1,
  MiniAppLaunchedV1,
  ChannelEvent,
  ChannelEventType,
  ChannelEventByType,
} from "./events-types.js";

export type {
  ChannelName,
  BotKind,
  MiniAppKind,
  InboundUpdateKind,
  EventEnvelope,
  UpdateReceivedV1,
  MessageDeliveredV1,
  MessageFailedV1,
  MiniAppLaunchedV1,
  ChannelEvent,
  ChannelEventType,
  ChannelEventByType,
};

// --- Shared primitives ------------------------------------------------

/** The channel implemented in Phase 03. Others are contract-reserved only. */
export const IMPLEMENTED_CHANNEL: ChannelName = "telegram";

/** The three bots, in canonical order. */
export const BOT_KINDS: readonly BotKind[] = ["customer", "driver", "partner"] as const;

/**
 * Which Mini App each bot launches (Phase 03 Exit Gate: 1:1 mapping).
 * The URL itself is environment configuration, never hard-coded.
 */
export const BOT_MINI_APP: Record<BotKind, MiniAppKind> = {
  customer: "customer",
  driver: "driver",
  partner: "partner",
};

/** Channel-imposed maximum length of an encoded Deep Link payload. */
export const DEEP_LINK_MAX_PAYLOAD_LENGTH = 64;

/** The webhook header carrying the shared secret token (verified before parsing). */
export const WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";

// --- Error contract (from errors.md) ----------------------------------

/** Error classes and their HTTP status, per errors.md. */
export const CHANNEL_ERROR_CLASS_STATUS = {
  validation_error: 400,
  unauthorized: 401,
  not_found: 404,
  unprocessable: 422,
  rate_limited: 429,
  service_unavailable: 503,
} as const;

/** A channel error class. */
export type ChannelErrorClass = keyof typeof CHANNEL_ERROR_CLASS_STATUS;

/**
 * The stable channel error catalogue (errors.md is the canonical source).
 * `retryable` drives the retry policy: only retryable codes are re-attempted.
 * Drift-guarded by `__tests__/errors.test.ts`.
 */
export const CHANNEL_ERRORS = {
  CHANNEL_INVALID_UPDATE: { class: "validation_error", retryable: false },
  CHANNEL_INVALID_MESSAGE: { class: "validation_error", retryable: false },
  CHANNEL_INVALID_DEEP_LINK: { class: "validation_error", retryable: false },
  CHANNEL_UNAUTHORIZED_WEBHOOK: { class: "unauthorized", retryable: false },
  CHANNEL_UNKNOWN_BOT: { class: "not_found", retryable: false },
  CHANNEL_MINI_APP_NOT_CONFIGURED: { class: "not_found", retryable: false },
  CHANNEL_UNSUPPORTED_UPDATE: { class: "unprocessable", retryable: false },
  CHANNEL_UNSUPPORTED_COMMAND: { class: "unprocessable", retryable: false },
  CHANNEL_DEEP_LINK_TOO_LONG: { class: "unprocessable", retryable: false },
  CHANNEL_CHAT_UNREACHABLE: { class: "unprocessable", retryable: false },
  CHANNEL_RATE_LIMITED: { class: "rate_limited", retryable: true },
  CHANNEL_IDENTITY_BOOTSTRAP_FAILED: { class: "service_unavailable", retryable: true },
  CHANNEL_TRANSPORT_ERROR: { class: "service_unavailable", retryable: true },
  CHANNEL_INTERNAL_ERROR: { class: "service_unavailable", retryable: false },
} as const satisfies Record<string, { class: ChannelErrorClass; retryable: boolean }>;

/** A stable channel error code. */
export type ChannelErrorCode = keyof typeof CHANNEL_ERRORS;

/** Codes that a retry policy may re-attempt (see errors.md → Retry Policy). */
export const RETRYABLE_CHANNEL_ERROR_CODES: readonly ChannelErrorCode[] = (
  Object.keys(CHANNEL_ERRORS) as ChannelErrorCode[]
).filter((code) => CHANNEL_ERRORS[code].retryable);

/** Maximum delivery attempts for a retryable failure (errors.md → Retry Policy). */
export const MAX_DELIVERY_ATTEMPTS = 5;

/** Type guard: is this string a known channel error code? */
export function isChannelErrorCode(value: string): value is ChannelErrorCode {
  return Object.prototype.hasOwnProperty.call(CHANNEL_ERRORS, value);
}

/** The HTTP status a given channel error code maps to. */
export function statusForChannelError(code: ChannelErrorCode): number {
  return CHANNEL_ERROR_CLASS_STATUS[CHANNEL_ERRORS[code].class];
}
