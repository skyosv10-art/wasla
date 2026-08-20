/**
 * Launch surfaces: which Mini App a bot opens, and how a deep link to that bot
 * is produced.
 *
 * This file is the direct subject of the Phase 03 Exit Gate. `getMiniAppLaunch`
 * answers «which app does this bot open» from injected configuration, so the
 * gate test can assert customer→customer, driver→driver, partner→partner without
 * any channel involved at all.
 *
 * Deep-link URLs are built by substituting the encoded payload into the bot's
 * configured template. The core never authors a channel URL shape.
 */

import type { BotKind, DeepLinkAction } from "@wasla/contracts-channel";

import { encodeDeepLinkPayload } from "../domain/deep-link.js";
import { channelError } from "../domain/errors.js";
import {
  DEEP_LINK_PAYLOAD_PLACEHOLDER,
  type GeneratedDeepLink,
  type MiniAppLaunchDescriptor,
} from "../domain/model.js";
import type { LaunchDeps } from "./deps.js";

/**
 * Resolve the Mini App descriptor of a bot.
 *
 * @throws ChannelError `CHANNEL_UNKNOWN_BOT` when the bot has no presence at all.
 * @throws ChannelError `CHANNEL_MINI_APP_NOT_CONFIGURED` when it has a presence
 *         but no Mini App URL — a configuration mistake, not an unknown bot.
 */
export function getMiniAppLaunch(deps: LaunchDeps, bot: BotKind): MiniAppLaunchDescriptor {
  const presence = deps.registry.presenceFor(bot);
  if (!presence) {
    throw channelError("CHANNEL_UNKNOWN_BOT", "بوت غير مُسجّل في سجل البوتات", {
      details: { bot },
    });
  }
  if (presence.miniAppUrl.length === 0) {
    throw channelError("CHANNEL_MINI_APP_NOT_CONFIGURED", "لا Mini App مُهيّأة لهذا البوت", {
      details: { bot },
    });
  }

  return {
    bot: presence.bot,
    miniApp: presence.miniApp,
    url: presence.miniAppUrl,
    label: presence.miniAppLabel,
  };
}

export interface CreateDeepLinkInput {
  readonly bot: BotKind;
  readonly action: DeepLinkAction;
  readonly params?: Readonly<Record<string, string>>;
}

/**
 * Generate a shareable deep link for a bot.
 *
 * @throws ChannelError `CHANNEL_UNKNOWN_BOT` for an unregistered bot, or when
 *         the bot has no deep-link template configured.
 * @throws ChannelError `CHANNEL_INVALID_DEEP_LINK` / `CHANNEL_DEEP_LINK_TOO_LONG`
 *         from the payload codec.
 */
export function createDeepLink(deps: LaunchDeps, input: CreateDeepLinkInput): GeneratedDeepLink {
  const presence = deps.registry.presenceFor(input.bot);
  if (!presence) {
    throw channelError("CHANNEL_UNKNOWN_BOT", "بوت غير مُسجّل في سجل البوتات", {
      details: { bot: input.bot },
    });
  }

  const template = presence.deepLinkTemplate;
  if (template === undefined || !template.includes(DEEP_LINK_PAYLOAD_PLACEHOLDER)) {
    throw channelError("CHANNEL_UNKNOWN_BOT", "لا قالب رابط عميق مُهيّأ لهذا البوت", {
      details: { bot: input.bot, placeholder: DEEP_LINK_PAYLOAD_PLACEHOLDER },
    });
  }

  const payload = encodeDeepLinkPayload(input.action, input.params ?? {});

  return {
    url: template.replace(DEEP_LINK_PAYLOAD_PLACEHOLDER, payload),
    payload,
    bot: input.bot,
    action: input.action,
  };
}
