/**
 * Outbound use case: deliver one message through the single exit point.
 *
 * Guarantees implemented here (contract + ADR-007 rule 3):
 *   - validation before any adapter call, in the stable error vocabulary
 *   - one delivery per `(channel, idempotencyKey)`: a repeat is reported as
 *     `duplicate` and never sent twice
 *   - a retryable failure re-queues the *same* delivery with a backoff, so a
 *     retry never creates a new message
 *   - a terminal failure emits `channel.message.failed.v1` exactly once
 *   - a Mini App button emits `channel.mini_app.launched.v1` on success — the
 *     evidence trail for the Phase 03 Exit Gate
 */

import { MAX_DELIVERY_ATTEMPTS, type ChannelErrorCode } from "@wasla/contracts-channel";

import { channelError } from "../domain/errors.js";
import {
  messageDeliveredEvent,
  messageFailedEvent,
  miniAppLaunchedEvent,
} from "../domain/events.js";
import {
  DEFAULT_PRIORITY,
  LIMITS,
  type ButtonIntent,
  type DeliveryOutcome,
  type DeliveryRecord,
  type OutboundMessageCommand,
} from "../domain/model.js";
import type { ChannelDispatch } from "../ports.js";
import type { OutboundDeps } from "./deps.js";

function assertValid(command: OutboundMessageCommand): void {
  const invalid = (message: string, details?: Record<string, string | number>): never => {
    throw channelError("CHANNEL_INVALID_MESSAGE", message, details ? { details } : {});
  };

  if (command.chatRef.length === 0 || command.chatRef.length > LIMITS.chatRefMax) {
    invalid("مرجع المحادثة مفقود أو يتجاوز الحد", { limit: LIMITS.chatRefMax });
  }
  if (command.text.length === 0 || command.text.length > LIMITS.textMax) {
    invalid("نص الرسالة فارغ أو يتجاوز الحد", { limit: LIMITS.textMax });
  }
  if (
    command.idempotencyKey.length < LIMITS.idempotencyKeyMin ||
    command.idempotencyKey.length > LIMITS.idempotencyKeyMax
  ) {
    invalid("مفتاح منع التكرار خارج الطول المسموح", {
      min: LIMITS.idempotencyKeyMin,
      max: LIMITS.idempotencyKeyMax,
    });
  }

  const buttons = command.buttons ?? [];
  if (command.kind === "text_with_buttons" && buttons.length === 0) {
    invalid("رسالة بأزرار بلا أزرار");
  }
  if (command.kind === "text" && buttons.length > 0) {
    invalid("أزرار في رسالة نصّية — استخدم النوع text_with_buttons");
  }
  if (buttons.length > LIMITS.buttonsMax) {
    invalid("عدد الأزرار يتجاوز الحد", { limit: LIMITS.buttonsMax });
  }
  for (const button of buttons) {
    if (button.label.length === 0 || button.label.length > LIMITS.buttonLabelMax) {
      invalid("عنوان زر فارغ أو يتجاوز الحد", { limit: LIMITS.buttonLabelMax });
    }
    if (
      button.type === "mini_app" &&
      button.path !== undefined &&
      button.path.length > LIMITS.miniAppPathMax
    ) {
      invalid("مسار Mini App يتجاوز الحد", { limit: LIMITS.miniAppPathMax });
    }
  }
}

function firstMiniAppButton(
  buttons: readonly ButtonIntent[] | undefined,
): Extract<ButtonIntent, { type: "mini_app" }> | undefined {
  return buttons?.find(
    (button): button is Extract<ButtonIntent, { type: "mini_app" }> =>
      button.type === "mini_app",
  );
}

function outcomeOf(record: DeliveryRecord, status: DeliveryOutcome["status"]): DeliveryOutcome {
  return {
    deliveryId: record.deliveryId,
    status,
    channel: record.channel,
    chatRef: record.chatRef,
    attempts: record.attempts,
    ...(record.lastErrorCode === null ? {} : { errorCode: record.lastErrorCode }),
  };
}

/**
 * Run one delivery attempt and persist its outcome.
 *
 * Shared by the first attempt (`sendMessage`) and by the retry sweep, so both
 * paths follow exactly the same state machine and emit the same events.
 */
export async function attemptDelivery(
  deps: OutboundDeps,
  record: DeliveryRecord,
  dispatch: ChannelDispatch,
  /** Bot context, only needed to attribute a Mini App launch event. */
  context?: { readonly bot: DeliveryContextBot },
): Promise<DeliveryOutcome> {
  const attempts = record.attempts + 1;
  const result = await deps.channel.send(dispatch);
  const now = deps.clock.now();

  if (result.ok) {
    const sent = await deps.deliveries.applyProgress(record.deliveryId, {
      status: "sent",
      attempts,
      nextAttemptAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
      sentAt: now,
      updatedAt: now,
    });

    await deps.outbox.append(
      messageDeliveredEvent({
        eventId: deps.ids.uuid(),
        occurredAt: now,
        chatRef: record.chatRef,
        ...(record.traceId === undefined ? {} : { traceId: record.traceId }),
        channel: record.channel,
        deliveryId: record.deliveryId,
        idempotencyKey: record.idempotencyKey,
        attempts,
      }),
    );

    const miniApp = firstMiniAppButton(dispatch.buttons);
    if (miniApp && context?.bot) {
      await deps.outbox.append(
        miniAppLaunchedEvent({
          eventId: deps.ids.uuid(),
          occurredAt: now,
          chatRef: record.chatRef,
          ...(record.traceId === undefined ? {} : { traceId: record.traceId }),
          channel: record.channel,
          bot: context.bot,
          miniApp: miniApp.miniApp,
          ...(miniApp.path === undefined ? {} : { path: miniApp.path }),
        }),
      );
    }

    return outcomeOf(sent, "sent");
  }

  const decision = deps.retry.decide({
    attempts,
    retryable: isRetryable(result.errorCode),
    maxAttempts: record.maxAttempts,
    ...(result.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: result.retryAfterSeconds }),
  });

  if (decision.shouldRetry) {
    const requeued = await deps.deliveries.applyProgress(record.deliveryId, {
      status: "queued",
      attempts,
      nextAttemptAt: new Date(Date.parse(now) + decision.delayMs).toISOString(),
      lastErrorCode: result.errorCode,
      lastErrorAt: now,
      sentAt: null,
      updatedAt: now,
    });
    return outcomeOf(requeued, "queued");
  }

  const failed = await deps.deliveries.applyProgress(record.deliveryId, {
    status: "failed",
    attempts,
    nextAttemptAt: null,
    lastErrorCode: result.errorCode,
    lastErrorAt: now,
    sentAt: null,
    updatedAt: now,
  });

  await deps.outbox.append(
    messageFailedEvent({
      eventId: deps.ids.uuid(),
      occurredAt: now,
      chatRef: record.chatRef,
      ...(record.traceId === undefined ? {} : { traceId: record.traceId }),
      channel: record.channel,
      deliveryId: record.deliveryId,
      idempotencyKey: record.idempotencyKey,
      attempts,
      errorCode: result.errorCode,
      retryable: isRetryable(result.errorCode),
    }),
  );

  return outcomeOf(failed, "failed");
}

/** Bot attribution for Mini App launch events. */
export type DeliveryContextBot = Parameters<typeof miniAppLaunchedEvent>[0]["bot"];

function isRetryable(code: ChannelErrorCode): boolean {
  return RETRYABLE.has(code);
}

const RETRYABLE = new Set<ChannelErrorCode>([
  "CHANNEL_RATE_LIMITED",
  "CHANNEL_TRANSPORT_ERROR",
  "CHANNEL_IDENTITY_BOOTSTRAP_FAILED",
]);

export interface SendMessageInput {
  readonly message: OutboundMessageCommand;
  /** Bot that owns this message (only used to attribute a Mini App launch). */
  readonly bot?: DeliveryContextBot;
}

/** Validate, de-duplicate, then attempt one delivery. */
export async function sendMessage(
  deps: OutboundDeps,
  input: SendMessageInput,
): Promise<DeliveryOutcome> {
  const { message } = input;
  assertValid(message);

  if (message.channel !== deps.channel.channel) {
    throw channelError("CHANNEL_INVALID_MESSAGE", "قناة الرسالة لا تطابق المُهيّئ المُركّب", {
      details: { requested: message.channel, adapter: deps.channel.channel },
    });
  }

  const now = deps.clock.now();
  const priority = message.priority ?? DEFAULT_PRIORITY;

  const dispatch: ChannelDispatch = {
    channel: message.channel,
    chatRef: message.chatRef,
    kind: message.kind,
    text: message.text,
    ...(message.buttons === undefined ? {} : { buttons: message.buttons }),
    priority,
    idempotencyKey: message.idempotencyKey,
    ...(message.traceId === undefined ? {} : { traceId: message.traceId }),
  };

  const { record, created } = await deps.deliveries.create({
    deliveryId: deps.ids.uuid(),
    channel: message.channel,
    chatRef: message.chatRef,
    idempotencyKey: message.idempotencyKey,
    kind: message.kind,
    priority,
    maxAttempts: deps.maxAttempts ?? MAX_DELIVERY_ATTEMPTS,
    createdAt: now,
    ...(message.traceId === undefined ? {} : { traceId: message.traceId }),
    dispatch,
    ...(input.bot === undefined ? {} : { bot: input.bot }),
  });

  if (!created) {
    return outcomeOf(record, "duplicate");
  }

  return attemptDelivery(
    deps,
    record,
    dispatch,
    input.bot === undefined ? undefined : { bot: input.bot },
  );
}
