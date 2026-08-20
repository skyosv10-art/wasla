/**
 * Wiring of the driver bot (السائق) — importable, and with no side effects.
 *
 * Reads DRIVER_BOT_TOKEN, DRIVER_BOT_WEBHOOK_SECRET and DRIVER_BOT_MINI_APP_URL from
 * the environment (docs/02-architecture/CHANNEL_BOTS.md → Configuration) and
 * serves the channel contract on DRIVER_BOT_PORT, default 8084.
 */

import { buildBotApp, type BotApp, type BotRuntimeOverrides } from "@wasla/bot-runtime";

/** The bot this deployable serves. Nothing else in this package may vary. */
export const BOT = "driver" as const;

/**
 * Builds the driver bot without binding a port.
 *
 * This is the seam the tests use, so what they assert is the real composition
 * root and not a re-creation of it.
 */
export function buildApp(overrides?: BotRuntimeOverrides): BotApp {
  return buildBotApp(BOT, overrides);
}
