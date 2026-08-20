/**
 * Domain event builders for the channel layer.
 *
 * Shapes come from the published event contract
 * (packages/channel-core/contracts/events.json) via the typed re-exports in
 * `@wasla/contracts-channel`. Events are always appended to an Outbox — the core
 * never publishes directly (ADR-007 / schema.sql).
 *
 * Aggregate = the conversation (`channel_chat`), identified by the opaque
 * `chatRef`. No identity reference ever appears in a channel event (ADR-001).
 */

import type {
  BotKind,
  ChannelName,
  InboundUpdateKind,
  MessageDeliveredV1,
  MessageFailedV1,
  MiniAppKind,
  MiniAppLaunchedV1,
  UpdateReceivedV1,
} from "@wasla/contracts-channel";

import type { ChatRef } from "./model.js";

/** The producer name published in every channel event envelope. */
export const CHANNEL_EVENT_PRODUCER = "channel-adapter" as const;

/** The aggregate type published in every channel event envelope. */
export const CHANNEL_EVENT_AGGREGATE = "channel_chat" as const;

/** Any event this layer can emit. */
export type ChannelDomainEvent =
  | UpdateReceivedV1
  | MessageDeliveredV1
  | MessageFailedV1
  | MiniAppLaunchedV1;

interface EnvelopeInput {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly chatRef: ChatRef;
  readonly traceId?: string;
}

function envelope(input: EnvelopeInput): {
  event_id: string;
  event_version: "v1";
  occurred_at: string;
  producer: typeof CHANNEL_EVENT_PRODUCER;
  aggregate: { type: typeof CHANNEL_EVENT_AGGREGATE; id: string };
  trace_id?: string;
} {
  return {
    event_id: input.eventId,
    event_version: "v1",
    occurred_at: input.occurredAt,
    producer: CHANNEL_EVENT_PRODUCER,
    aggregate: { type: CHANNEL_EVENT_AGGREGATE, id: input.chatRef },
    ...(input.traceId === undefined ? {} : { trace_id: input.traceId }),
  };
}

/** `channel.update.received.v1` — emitted only the first time an update is seen. */
export function updateReceivedEvent(
  input: EnvelopeInput & {
    readonly channel: ChannelName;
    readonly bot: BotKind;
    readonly channelUpdateId: string;
    readonly kind: InboundUpdateKind;
    readonly command?: string;
  },
): UpdateReceivedV1 {
  return {
    ...envelope(input),
    event_type: "channel.update.received",
    payload: {
      channel: input.channel,
      bot: input.bot,
      channel_update_id: input.channelUpdateId,
      kind: input.kind,
      ...(input.command === undefined ? {} : { command: input.command }),
    },
  };
}

/** `channel.message.delivered.v1`. */
export function messageDeliveredEvent(
  input: EnvelopeInput & {
    readonly channel: ChannelName;
    readonly deliveryId: string;
    readonly idempotencyKey: string;
    readonly attempts: number;
  },
): MessageDeliveredV1 {
  return {
    ...envelope(input),
    event_type: "channel.message.delivered",
    payload: {
      channel: input.channel,
      delivery_id: input.deliveryId,
      idempotency_key: input.idempotencyKey,
      attempts: input.attempts,
    },
  };
}

/** `channel.message.failed.v1` — terminal failure only (never a retryable attempt). */
export function messageFailedEvent(
  input: EnvelopeInput & {
    readonly channel: ChannelName;
    readonly deliveryId: string;
    readonly idempotencyKey: string;
    readonly attempts: number;
    readonly errorCode: string;
    readonly retryable: boolean;
  },
): MessageFailedV1 {
  return {
    ...envelope(input),
    event_type: "channel.message.failed",
    payload: {
      channel: input.channel,
      delivery_id: input.deliveryId,
      idempotency_key: input.idempotencyKey,
      attempts: input.attempts,
      error_code: input.errorCode,
      retryable: input.retryable,
    },
  };
}

/** `channel.mini_app.launched.v1` — the Exit Gate evidence trail. */
export function miniAppLaunchedEvent(
  input: EnvelopeInput & {
    readonly channel: ChannelName;
    readonly bot: BotKind;
    readonly miniApp: MiniAppKind;
    readonly path?: string;
  },
): MiniAppLaunchedV1 {
  return {
    ...envelope(input),
    event_type: "channel.mini_app.launched",
    payload: {
      channel: input.channel,
      bot: input.bot,
      mini_app: input.miniApp,
      ...(input.path === undefined ? {} : { path: input.path }),
    },
  };
}
