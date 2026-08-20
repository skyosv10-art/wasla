/**
 * Button intent → Telegram inline keyboard (ADR-007 rule 5).
 *
 * The core declares *what* a button should do (`open the driver Mini App`,
 * `share a track_order link`); this file is the only place that knows those
 * intents become `web_app` and `url` buttons inside `reply_markup`.
 *
 * URLs are never authored here either: they come from the injected `BotPresence`
 * (environment configuration), so no address is compiled into the source
 * (SECURITY_RULES). What this file owns is the *shape* of the keyboard and the
 * validation Telegram would otherwise reject with an opaque 400.
 */

import {
  DEEP_LINK_PAYLOAD_PLACEHOLDER,
  LIMITS,
  channelError,
  encodeDeepLinkPayload,
  type BotPresence,
  type ButtonIntent,
} from "@wasla/channel-core";
import type { DeepLinkAction } from "@wasla/contracts-channel";

/** One Telegram inline button, in the two variants WASLA emits. */
export type InlineButton =
  | { readonly text: string; readonly web_app: { readonly url: string } }
  | { readonly text: string; readonly url: string };

/** `reply_markup` for a message carrying buttons. */
export interface InlineKeyboardMarkup {
  readonly inline_keyboard: readonly (readonly InlineButton[])[];
}

/**
 * Composes a Mini App address from configuration plus an optional path.
 *
 * HTTPS is enforced because Telegram refuses to open a `web_app` button over
 * plain HTTP; failing here produces a precise WASLA error instead of a generic
 * Bot API rejection at send time.
 */
function miniAppUrl(presence: BotPresence, path?: string): string {
  let base: URL;
  try {
    base = new URL(presence.miniAppUrl);
  } catch {
    throw channelError("CHANNEL_MINI_APP_NOT_CONFIGURED", "عنوان Mini App المُهيّأ غير صالح", {
      details: { bot: presence.bot },
    });
  }
  if (base.protocol !== "https:") {
    throw channelError("CHANNEL_MINI_APP_NOT_CONFIGURED", "عنوان Mini App يجب أن يكون HTTPS", {
      details: { bot: presence.bot },
    });
  }
  if (!path) return base.toString();

  if (path.length > LIMITS.miniAppPathMax) {
    throw channelError("CHANNEL_INVALID_MESSAGE", "مسار Mini App يتجاوز الحد", {
      details: { max: LIMITS.miniAppPathMax },
    });
  }
  // Resolved against the configured base, so a path can never point the button
  // at another origin — an absolute URL in `path` would otherwise do exactly that.
  const resolved = new URL(path, base);
  if (resolved.origin !== base.origin) {
    throw channelError("CHANNEL_INVALID_MESSAGE", "مسار Mini App يشير خارج النطاق المُهيّأ", {
      details: { bot: presence.bot },
    });
  }
  return resolved.toString();
}

/** Builds a shareable bot link by substituting an encoded payload into the template. */
function deepLinkUrl(
  presence: BotPresence,
  action: DeepLinkAction,
  params?: Readonly<Record<string, string>>,
): string {
  const template = presence.deepLinkTemplate;
  if (!template || !template.includes(DEEP_LINK_PAYLOAD_PLACEHOLDER)) {
    throw channelError("CHANNEL_UNKNOWN_BOT", "لا قالب رابط عميق مُهيّأ لهذا البوت", {
      details: { bot: presence.bot },
    });
  }
  const payload = encodeDeepLinkPayload(action, params ?? {});
  return template.replace(DEEP_LINK_PAYLOAD_PLACEHOLDER, encodeURIComponent(payload));
}

/**
 * Translates button intents into `reply_markup`.
 *
 * One button per row: labels are Arabic and long, and Telegram truncates
 * side-by-side buttons on narrow screens, which would hide the action.
 *
 * @throws ChannelError with a `CHANNEL_*` code when an intent cannot be
 *         rendered (misconfigured Mini App, missing link template, oversized
 *         label). The caller turns it into a `ChannelSendFailure`.
 */
export function buildInlineKeyboard(
  intents: readonly ButtonIntent[],
  presence: BotPresence,
): InlineKeyboardMarkup {
  if (intents.length === 0) {
    throw channelError("CHANNEL_INVALID_MESSAGE", "رسالة بأزرار بلا أي زر");
  }
  if (intents.length > LIMITS.buttonsMax) {
    throw channelError("CHANNEL_INVALID_MESSAGE", `عدد الأزرار يتجاوز الحد (${LIMITS.buttonsMax})`, {
      details: { received: intents.length },
    });
  }

  const rows = intents.map((intent) => {
    const label = intent.label.trim();
    if (label.length === 0 || label.length > LIMITS.buttonLabelMax) {
      throw channelError("CHANNEL_INVALID_MESSAGE", "عنوان الزر فارغ أو يتجاوز الحد", {
        details: { max: LIMITS.buttonLabelMax },
      });
    }
    if (intent.type === "mini_app") {
      if (intent.miniApp !== presence.miniApp) {
        throw channelError(
          "CHANNEL_MINI_APP_NOT_CONFIGURED",
          "زر يطلب Mini App لا يفتحها هذا البوت",
          { details: { bot: presence.bot, requested: intent.miniApp } },
        );
      }
      return [{ text: label, web_app: { url: miniAppUrl(presence, intent.path) } }];
    }
    return [{ text: label, url: deepLinkUrl(presence, intent.action, intent.params) }];
  });

  return { inline_keyboard: rows };
}
