/**
 * Inbound use case: accept one channel update, exactly once.
 *
 * Order of operations is deliberate:
 *   1. parse (adapter) — an unparsable update is rejected before any state changes
 *   2. reject unsupported kinds/commands — never recorded as processed, so a
 *      corrected retry of the same update id is still possible
 *   3. de-duplicate atomically — a duplicate returns `duplicate` (202, not an
 *      error) and emits nothing (ADR-007 rule 3)
 *   4. bootstrap identity for the start command only, and only in a private
 *      conversation (ADR-007 rule 4, ADR-008)
 *   5. append `channel.update.received.v1` to the outbox
 *
 * Identity bootstrap runs *after* de-duplication on purpose: a replayed update
 * must not hit the Identity service again.
 *
 * Group conversations travel this same path — no branch duplicates it. What the
 * scope decides is answered here once, in two lines: identity is personal (a
 * group reference is shared by everyone in the room, so bootstrapping from it
 * would attach one person's identity to a room), and only a group this
 * deployment declared may be answered at all.
 */

import type { BotKind } from "@wasla/contracts-channel";

import { channelError, isChannelError } from "../domain/errors.js";
import { updateReceivedEvent } from "../domain/events.js";
import { decodeDeepLinkPayload } from "../domain/deep-link.js";
import type {
  ConversationScope,
  DecodedDeepLink,
  GroupRole,
  InboundActor,
  InboundUpdate,
} from "../domain/model.js";
import type { IdentityBootstrapResult } from "../ports.js";
import type { InboundDeps } from "./deps.js";

/** The command that triggers identity bootstrap. Neutral: no channel syntax. */
export const START_COMMAND = "start";

/** Commands a bot answers unless its composition root says otherwise. */
export const DEFAULT_SUPPORTED_COMMANDS: readonly string[] = [START_COMMAND] as const;

/** Update kinds the core accepts in Phase 03. */
const SUPPORTED_KINDS = new Set([
  "command",
  "text_message",
  "callback",
  "contact",
  "location",
  "group_event",
]);

export interface ReceiveUpdateInput {
  readonly bot: BotKind;
  /** The raw channel payload; only the parser is allowed to interpret it. */
  readonly raw: unknown;
  readonly traceId?: string;
}

export interface ReceiveUpdateResult {
  readonly status: "accepted" | "duplicate";
  /** Private chat or group — the value the reply policy is derived from. */
  readonly scope: ConversationScope;
  /** Role of the group, when the conversation is a group we operate. */
  readonly groupRole?: GroupRole;
  /**
   * Whether the composition root may answer *in this conversation*.
   *
   * `true` for private chats and for configured groups; `false` for a group this
   * deployment does not know. Computed here so all three bots share one answer
   * instead of re-deriving it (and disagreeing).
   */
  readonly replyAllowed: boolean;
  readonly channel: InboundUpdate["channel"];
  readonly bot: BotKind;
  readonly channelUpdateId: string;
  readonly kind: InboundUpdate["kind"];
  readonly command?: string;
  readonly chatRef: string;
  /**
   * The neutral actor of the update, when the channel reported one.
   *
   * Exposed for the composition root, which is the only layer allowed to attach
   * a *domain* flow to a conversation (ADR-007 §1): resolving «who is this» for
   * a command other than `start` needs the actor, and re-parsing the raw payload
   * to recover it would put channel syntax back in the root. It is the same
   * neutral shape the parser produced — no channel-native identifier leaks with
   * it, and this use case still does not bootstrap identity for anything but
   * `start`.
   */
  readonly actor?: InboundActor;
  /** Present when a start command carried a deep-link payload. */
  readonly deepLink?: DecodedDeepLink;
  /** Present when this update triggered identity bootstrap. */
  readonly identity?: IdentityBootstrapResult;
}

export async function receiveUpdate(
  deps: InboundDeps,
  input: ReceiveUpdateInput,
): Promise<ReceiveUpdateResult> {
  const update = deps.parser.parse(input.raw, input.bot);

  if (update.bot !== input.bot) {
    throw channelError("CHANNEL_INVALID_UPDATE", "التحديث لا يعود إلى البوت المطلوب", {
      details: { expected: input.bot, received: update.bot },
    });
  }
  if (update.channelUpdateId.length === 0 || update.chatRef.length === 0) {
    throw channelError("CHANNEL_INVALID_UPDATE", "تحديث بلا معرّف أو بلا مرجع محادثة");
  }

  if (!SUPPORTED_KINDS.has(update.kind)) {
    throw channelError("CHANNEL_UNSUPPORTED_UPDATE", "نوع تحديث غير مدعوم في هذه المرحلة", {
      details: { kind: update.kind },
    });
  }

  const supportedCommands = deps.supportedCommands ?? DEFAULT_SUPPORTED_COMMANDS;
  if (update.kind === "command") {
    const command = update.command ?? "";
    if (!supportedCommands.includes(command)) {
      throw channelError("CHANNEL_UNSUPPORTED_COMMAND", "أمر غير مُسجّل لهذا البوت", {
        details: { command, bot: input.bot },
      });
    }
  }

  const traceId = input.traceId ?? update.traceId;
  const receivedAt = deps.clock.now();

  const scope: ConversationScope = update.isGroup === true ? "group" : "private";
  const groupRole = scope === "group" ? (deps.groups?.roleFor(update.chatRef) ?? null) : null;
  // An unknown group is recorded but never answered: the bot may have been added
  // by anyone, and a bot that greets an unconfigured room leaks its existence and
  // its Mini App link to it.
  const replyAllowed = scope === "private" || groupRole !== null;

  const isNew = await deps.processedUpdates.remember({
    channel: update.channel,
    bot: update.bot,
    channelUpdateId: update.channelUpdateId,
    chatRef: update.chatRef,
    kind: update.kind,
    ...(update.command === undefined ? {} : { command: update.command }),
    receivedAt,
    ...(traceId === undefined ? {} : { traceId }),
  });

  if (!isNew) {
    return {
      status: "duplicate",
      scope,
      ...(groupRole === null ? {} : { groupRole }),
      replyAllowed,
      channel: update.channel,
      bot: update.bot,
      channelUpdateId: update.channelUpdateId,
      kind: update.kind,
      ...(update.command === undefined ? {} : { command: update.command }),
      chatRef: update.chatRef,
      ...(update.actor === undefined ? {} : { actor: update.actor }),
    };
  }

  let identity: IdentityBootstrapResult | undefined;
  if (
    update.kind === "command" &&
    update.command === START_COMMAND &&
    update.actor &&
    scope === "private"
  ) {
    try {
      identity = await deps.identity.ensureIdentity({
        channel: update.channel,
        bot: update.bot,
        actor: update.actor,
        ...(traceId === undefined ? {} : { traceId }),
      });
    } catch (cause) {
      if (isChannelError(cause)) throw cause;
      throw channelError(
        "CHANNEL_IDENTITY_BOOTSTRAP_FAILED",
        "تعذّر إنشاء أو جلب الهوية أثناء بدء المحادثة",
        { cause, ...(traceId === undefined ? {} : { traceId }) },
      );
    }
  }

  let deepLink: DecodedDeepLink | undefined;
  if (
    update.kind === "command" &&
    update.command === START_COMMAND &&
    update.commandArgument !== undefined &&
    update.commandArgument.length > 0
  ) {
    deepLink = decodeDeepLinkPayload(update.commandArgument);
  }

  await deps.outbox.append(
    updateReceivedEvent({
      eventId: deps.ids.uuid(),
      occurredAt: receivedAt,
      chatRef: update.chatRef,
      ...(traceId === undefined ? {} : { traceId }),
      channel: update.channel,
      bot: update.bot,
      channelUpdateId: update.channelUpdateId,
      kind: update.kind,
      ...(update.command === undefined ? {} : { command: update.command }),
    }),
  );

  return {
    status: "accepted",
    scope,
    ...(groupRole === null ? {} : { groupRole }),
    replyAllowed,
    channel: update.channel,
    bot: update.bot,
    channelUpdateId: update.channelUpdateId,
    kind: update.kind,
    ...(update.command === undefined ? {} : { command: update.command }),
    chatRef: update.chatRef,
    ...(update.actor === undefined ? {} : { actor: update.actor }),
    ...(deepLink === undefined ? {} : { deepLink }),
    ...(identity === undefined ? {} : { identity }),
  };
}
