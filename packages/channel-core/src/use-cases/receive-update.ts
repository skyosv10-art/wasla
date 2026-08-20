/**
 * Inbound use case: accept one channel update, exactly once.
 *
 * Order of operations is deliberate:
 *   1. parse (adapter) — an unparsable update is rejected before any state changes
 *   2. reject unsupported kinds/commands — never recorded as processed, so a
 *      corrected retry of the same update id is still possible
 *   3. de-duplicate atomically — a duplicate returns `duplicate` (202, not an
 *      error) and emits nothing (ADR-007 rule 3)
 *   4. bootstrap identity for the start command only (ADR-007 rule 4)
 *   5. append `channel.update.received.v1` to the outbox
 *
 * Identity bootstrap runs *after* de-duplication on purpose: a replayed update
 * must not hit the Identity service again.
 */

import type { BotKind } from "@wasla/contracts-channel";

import { channelError, isChannelError } from "../domain/errors.js";
import { updateReceivedEvent } from "../domain/events.js";
import { decodeDeepLinkPayload } from "../domain/deep-link.js";
import type { DecodedDeepLink, InboundUpdate } from "../domain/model.js";
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
  readonly channel: InboundUpdate["channel"];
  readonly bot: BotKind;
  readonly channelUpdateId: string;
  readonly kind: InboundUpdate["kind"];
  readonly command?: string;
  readonly chatRef: string;
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
      channel: update.channel,
      bot: update.bot,
      channelUpdateId: update.channelUpdateId,
      kind: update.kind,
      ...(update.command === undefined ? {} : { command: update.command }),
      chatRef: update.chatRef,
    };
  }

  let identity: IdentityBootstrapResult | undefined;
  if (update.kind === "command" && update.command === START_COMMAND && update.actor) {
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
    channel: update.channel,
    bot: update.bot,
    channelUpdateId: update.channelUpdateId,
    kind: update.kind,
    ...(update.command === undefined ? {} : { command: update.command }),
    chatRef: update.chatRef,
    ...(deepLink === undefined ? {} : { deepLink }),
    ...(identity === undefined ? {} : { identity }),
  };
}
