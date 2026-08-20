/**
 * Channel Domain Event types — hand-derived from the canonical Event Contract
 * (packages/channel-core/contracts/events.json, JSON Schema 2020-12).
 *
 * Why hand-derived (not codegen): `json-schema-to-typescript` emits a generic
 * index signature for the $defs-only root schema, which is unusable. The event
 * set is small, stable, and versioned (v1; any breaking change requires v2 +
 * ADR), so hand-authoring is reliable and low-drift. Same rationale as
 * @wasla/contracts-geography.
 *
 * Drift guard: `__tests__/events.test.ts` reads events.json and asserts the
 * event_type literals + payload structure stay in sync with these types.
 *
 * Canonical source = events.json. If the contract changes, update this file
 * to match and re-run the drift-guard test.
 */

/** Channels reserved by the contract. Phase 03 implements `telegram` only. */
export type ChannelName = "telegram" | "web" | "mobile" | "whatsapp";

/** The three WASLA bots. */
export type BotKind = "customer" | "driver" | "partner";

/** The three WASLA Mini Apps (one per bot). */
export type MiniAppKind = "customer" | "driver" | "partner";

/** Neutral classification of an inbound update after adapter parsing. */
export type InboundUpdateKind =
  | "command"
  | "text_message"
  | "callback"
  | "contact"
  | "location"
  | "group_event"
  | "unsupported";

/** Base envelope shared by all Channel domain events. */
export interface EventEnvelope {
  /** UUID. */
  event_id: string;
  /** Discriminator (e.g. "channel.update.received"). */
  event_type: string;
  /** Schema version, pattern ^v[0-9]+$. */
  event_version: string;
  /** ISO-8601 date-time. */
  occurred_at: string;
  /** Always "channel-adapter". */
  producer: "channel-adapter";
  /** The aggregate (channel chat) the event concerns. */
  aggregate: {
    type: "channel_chat";
    /** chat_ref — opaque channel chat reference (never an identity reference). */
    id: string;
  };
  /** Optional trace/correlation id. */
  trace_id?: string;
}

/** An inbound update was received and processed for the first time. */
export interface UpdateReceivedV1 extends EventEnvelope {
  event_type: "channel.update.received";
  event_version: "v1";
  payload: {
    channel: ChannelName;
    bot: BotKind;
    /** Channel-provided update id, as a string (never assumed numeric). */
    channel_update_id: string;
    kind: InboundUpdateKind;
    /** Command name without the leading '/' when kind === "command". */
    command?: string;
  };
}

/** An outbound message was delivered to the channel successfully. */
export interface MessageDeliveredV1 extends EventEnvelope {
  event_type: "channel.message.delivered";
  event_version: "v1";
  payload: {
    channel: ChannelName;
    /** UUID. */
    delivery_id: string;
    idempotency_key: string;
    /** >= 1. */
    attempts: number;
  };
}

/** An outbound message failed terminally (retries exhausted or non-retryable). */
export interface MessageFailedV1 extends EventEnvelope {
  event_type: "channel.message.failed";
  event_version: "v1";
  payload: {
    channel: ChannelName;
    /** UUID. */
    delivery_id: string;
    idempotency_key: string;
    /** >= 1. */
    attempts: number;
    /** A stable CHANNEL_* code from errors.md (channel error already mapped). */
    error_code: string;
    retryable: boolean;
  };
}

/** A Mini App launch button was sent to the user (Phase 03 Exit Gate evidence). */
export interface MiniAppLaunchedV1 extends EventEnvelope {
  event_type: "channel.mini_app.launched";
  event_version: "v1";
  payload: {
    channel: ChannelName;
    bot: BotKind;
    mini_app: MiniAppKind;
    /** Optional in-app path appended to the Mini App base URL. */
    path?: string;
  };
}

/** Union of all v1 Channel domain events. */
export type ChannelEvent =
  | UpdateReceivedV1
  | MessageDeliveredV1
  | MessageFailedV1
  | MiniAppLaunchedV1;

/** Discriminator union of all event_type literals. */
export type ChannelEventType = ChannelEvent["event_type"];

/** All v1 event_type literals, in declaration order. (Drift-guarded by tests.) */
export const CHANNEL_EVENT_TYPES: readonly ChannelEventType[] = [
  "channel.update.received",
  "channel.message.delivered",
  "channel.message.failed",
  "channel.mini_app.launched",
] as const;

/** Map an event_type literal to its concrete event interface (type-level). */
export interface ChannelEventByType {
  "channel.update.received": UpdateReceivedV1;
  "channel.message.delivered": MessageDeliveredV1;
  "channel.message.failed": MessageFailedV1;
  "channel.mini_app.launched": MiniAppLaunchedV1;
}
