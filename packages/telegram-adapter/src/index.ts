/**
 * `@wasla/telegram-adapter` — the only package that knows Telegram Bot API
 * (ADR-007).
 *
 * It implements exactly two ports of `@wasla/channel-core`, `ChannelPort` and
 * `UpdateParserPort`, plus the edge concerns that are Telegram vocabulary:
 * webhook secret verification, error translation and the outbound rate budget.
 *
 * It contains **no use case**. Anything that decides "what should happen when a
 * customer sends /start" lives in the core; this package only translates. The
 * dependency direction is one-way — `bots/*` → `telegram-adapter` →
 * `channel-core` — and the core's architecture guard test fails the build if any
 * Telegram vocabulary crosses back the other way.
 */

export { TelegramUpdateParser } from "./update-parser.js";
export { TelegramChannelAdapter, type TelegramChannelAdapterOptions } from "./channel-adapter.js";
export {
  BotApiClient,
  BOT_API_DEFAULTS,
  type BotApiClientOptions,
  type BotApiOutcome,
  type FetchLike,
} from "./bot-api-client.js";
export { mapTelegramFailure, type FailureInput, type MappedFailure } from "./error-mapping.js";
export {
  buildInlineKeyboard,
  isGroupChatRef,
  type InlineButton,
  type InlineKeyboardMarkup,
} from "./keyboard.js";
export {
  TokenBucketRateLimiter,
  RATE_DEFAULTS,
  type RateLimitOptions,
  type RateVerdict,
} from "./rate-limit.js";
export {
  assertWebhookSecret,
  MIN_WEBHOOK_SECRET_LENGTH,
  WEBHOOK_SECRET_HEADER,
  type HeaderBag,
} from "./webhook-auth.js";
export { cleanLanguageCode, cleanLine, cleanText } from "./sanitize.js";
