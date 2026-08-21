/**
 * The seam a *domain* flow attaches to — and the reason the channel layer still
 * knows no domain (ADR-007 rule 2).
 *
 * Phase 03 gave every bot one behaviour: answer `/start` with its Mini App
 * button. Phase 04 needs more from the customer bot — «is there a profile for
 * this person», «list my saved places» — and those questions belong to the
 * Customer Core, not to a channel. Two shapes were possible:
 *
 *   1. teach the channel layer about customers (a `customer` branch in the
 *      webhook route), or
 *   2. let the composition root hand the channel layer *one function* that
 *      answers a neutral conversation event with neutral text.
 *
 * This file is (2). Everything crossing the boundary here is channel-neutral —
 * a chat reference, an update id, a command name, optional actor attributes,
 * plain text back — so `@wasla/bot-runtime` can serve a bot whose domain it has
 * never heard of, and a domain flow can be unit-tested without a webhook,
 * a token, or Telegram.
 *
 * What deliberately does *not* cross it: the raw payload, channel-native ids,
 * buttons other than «open my Mini App», and any error text. A flow returns
 * text or nothing; failures are its own to translate, because an error message
 * a user reads is product copy, not transport behaviour.
 */

import type {
  ConversationScope,
  InboundUpdate,
  MiniAppLaunchDescriptor,
  OutboundMessageCommand,
} from "@wasla/channel-core";
import type { BotKind, ChannelName } from "@wasla/contracts-channel";

/** The WASLA identity behind the conversation, once resolved. */
export interface ConversationIdentity {
  readonly waslaPublicId: string;
  /** True when resolving it created the identity rather than fetching one. */
  readonly created: boolean;
}

/**
 * One update, as a domain flow sees it.
 *
 * `identity` is present only when the update itself bootstrapped one (a fresh
 * `/start`). Any other command must ask for it through `resolveIdentity`, which
 * is lazy on purpose: a flow that answers from the update alone must not cost an
 * identity round-trip, and a flow that needs an id must not be tempted to invent
 * one from the chat reference (ADR-001 — the channel never stores that mapping).
 */
export interface ConversationEvent {
  readonly bot: BotKind;
  readonly channel: ChannelName;
  readonly chatRef: string;
  /** The update this reply answers — what makes any reply idempotent. */
  readonly channelUpdateId: string;
  readonly kind: InboundUpdate["kind"];
  /** Present when `kind === "command"`; already validated as supported. */
  readonly command?: string;
  readonly scope: ConversationScope;
  /** Display name as the channel reported it, when it did. */
  readonly displayName?: string;
  /** Language tag as the channel reported it, when it did (e.g. `ar`). */
  readonly languageCode?: string;
  readonly traceId: string;
  readonly identity?: ConversationIdentity;
  /**
   * Resolve (and cache) the identity of the actor.
   *
   * Throws `CHANNEL_IDENTITY_BOOTSTRAP_FAILED` when the update carried no actor
   * or identity is unreachable — a flow that cannot know *whose* data it is
   * being asked for must fail, never guess.
   */
  resolveIdentity(): Promise<ConversationIdentity>;
}

/** What a flow may answer with: text, optionally with the Mini App button. */
export interface ConversationReply {
  readonly text: string;
  /**
   * Appends the bot's Mini App button. The flow says «this answer continues in
   * the app»; which app, and under which label, stays configuration the root
   * resolves (SECURITY_RULES: no URL in behaviour code).
   */
  readonly withMiniApp?: boolean;
  /**
   * Distinguishes several replies derived from one update. Part of the
   * idempotency key, so two different answers to the same update are two
   * messages while a retry of the same answer is one.
   */
  readonly step?: string;
}

/**
 * A domain flow: neutral event in, neutral reply (or silence) out.
 *
 * Returning `null`/`undefined` means «handled, nothing to say» — the normal
 * answer for an update a flow only reacted to internally, and the reason a flow
 * can bootstrap a profile on `/start` without producing a second message next to
 * the welcome.
 */
export type ConversationHandler = (
  event: ConversationEvent,
) => Promise<ConversationReply | null | undefined>;

export interface ConversationReplyInput {
  readonly bot: BotKind;
  readonly channel: ChannelName;
  readonly chatRef: string;
  readonly channelUpdateId: string;
  readonly reply: ConversationReply;
  /** Required only when the reply asks for the Mini App button. */
  readonly launch?: MiniAppLaunchDescriptor;
  readonly traceId?: string;
}

/**
 * Turn a flow's reply into the same `OutboundMessageCommand` any other caller
 * would post to `POST /channel/messages`.
 *
 * The key is derived from the update (and the step), never generated: Telegram
 * re-sends a webhook it believes failed, and while the core stops the duplicate
 * *update*, a reply re-attempted from another path (a retry worker, a manual
 * replay) is stopped only by this key. Same rule as `buildStartReply`, same
 * shape, so a flow reply gets de-duplication, retry and delivery accounting
 * instead of a privileged side channel.
 */
export function buildConversationReply(
  input: ConversationReplyInput,
): OutboundMessageCommand {
  const step = input.reply.step === undefined ? "" : `:${input.reply.step}`;
  const base = {
    channel: input.channel,
    chatRef: input.chatRef,
    text: input.reply.text,
    priority: "normal" as const,
    idempotencyKey: `flow:${input.bot}:${input.channelUpdateId}${step}`,
    ...(input.traceId ? { traceId: input.traceId } : {}),
  };

  if (input.reply.withMiniApp !== true || input.launch === undefined) {
    return { ...base, kind: "text" };
  }

  return {
    ...base,
    kind: "text_with_buttons",
    buttons: [
      {
        type: "mini_app",
        label: input.launch.label,
        miniApp: input.launch.miniApp,
      },
    ],
  };
}
