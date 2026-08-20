/**
 * Wiring of the partner bot (الشريك) — importable, and with no side effects.
 *
 * Reads PARTNER_BOT_TOKEN, PARTNER_BOT_WEBHOOK_SECRET and PARTNER_BOT_MINI_APP_URL from
 * the environment (docs/02-architecture/CHANNEL_BOTS.md → Configuration) and
 * serves the channel contract on PARTNER_BOT_PORT, default 8085.
 */

import { buildBotApp, type BotApp, type BotRuntimeOverrides } from "@wasla/bot-runtime";

/** The bot this deployable serves. Nothing else in this package may vary. */
export const BOT = "partner" as const;

/**
 * Builds the partner bot without binding a port.
 *
 * This is the seam the tests use, so what they assert is the real composition
 * root and not a re-creation of it.
 */
export function buildApp(overrides?: BotRuntimeOverrides): BotApp {
  return buildBotApp(BOT, overrides);
}
