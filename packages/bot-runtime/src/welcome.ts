/**
 * The `/start` answer — the one piece of bot-facing copy this layer owns.
 *
 * ADR-007 keeps *behaviour* in the core and *translation* in the adapter, which
 * leaves «what does a bot say when a user opens it» to the composition root.
 * It lives here, once, instead of three times in three bot roots: the Exit Gate
 * asserts each bot opens its own Mini App, and a rule that must hold for three
 * bots is a rule that must have one implementation.
 *
 * The reply is expressed as an `OutboundMessageCommand` — the same shape any
 * other service would post to `POST /channel/messages` — so the welcome message
 * gets de-duplication, retry and delivery accounting for free instead of being a
 * privileged side-channel.
 */

import type { MiniAppLaunchDescriptor, OutboundMessageCommand } from "@wasla/channel-core";
import type { BotKind, ChannelName } from "@wasla/contracts-channel";

/** Default Arabic welcome copy per bot (product language is Arabic-first). */
export const DEFAULT_WELCOME_TEXT: Readonly<Record<BotKind, string>> = {
  customer: "أهلاً بك في وصلة. اضغط الزر أدناه لفتح التطبيق وإتمام طلبك.",
  driver: "أهلاً كابتن. اضغط الزر أدناه لفتح تطبيق الكابتن ومتابعة رحلاتك.",
  partner: "أهلاً بك شريكنا. اضغط الزر أدناه لفتح تطبيق الشريك وإدارة متجرك.",
};

export interface StartReplyInput {
  readonly bot: BotKind;
  readonly channel: ChannelName;
  readonly chatRef: string;
  /** The update that triggered the reply — it makes the reply idempotent. */
  readonly channelUpdateId: string;
  readonly launch: MiniAppLaunchDescriptor;
  readonly text?: string;
  readonly traceId?: string;
}

/**
 * Build the `/start` reply.
 *
 * The idempotency key is derived from the update id, not generated: Telegram
 * re-sends a webhook it believes failed, and the core's de-duplication stops the
 * *update* — this key is what stops a second *message* if the reply is ever
 * re-attempted from a different path (a retry worker, a manual replay).
 */
export function buildStartReply(input: StartReplyInput): OutboundMessageCommand {
  return {
    channel: input.channel,
    chatRef: input.chatRef,
    kind: "text_with_buttons",
    text: input.text ?? DEFAULT_WELCOME_TEXT[input.bot],
    buttons: [
      {
        type: "mini_app",
        label: input.launch.label,
        miniApp: input.launch.miniApp,
      },
    ],
    priority: "high",
    idempotencyKey: `start:${input.bot}:${input.channelUpdateId}`,
    ...(input.traceId ? { traceId: input.traceId } : {}),
  };
}
