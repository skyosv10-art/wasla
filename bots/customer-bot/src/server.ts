/**
 * Wiring of the customer bot (العميل) — importable, and with no side effects.
 *
 * Reads CUSTOMER_BOT_TOKEN, CUSTOMER_BOT_WEBHOOK_SECRET and CUSTOMER_BOT_MINI_APP_URL from
 * the environment (docs/02-architecture/CHANNEL_BOTS.md → Configuration) and
 * serves the channel contract on CUSTOMER_BOT_PORT, default 8083.
 */

import { buildBotApp, type BotApp, type BotRuntimeOverrides } from "@wasla/bot-runtime";

/** The bot this deployable serves. Nothing else in this package may vary. */
export const BOT = "customer" as const;

/**
 * Builds the customer bot without binding a port.
 *
 * This is the seam the tests use, so what they assert is the real composition
 * root and not a re-creation of it.
 */
export function buildApp(overrides?: BotRuntimeOverrides): BotApp {
  return buildBotApp(BOT, overrides);
}
