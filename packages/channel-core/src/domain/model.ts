/**
 * Neutral domain model of the channel layer (ADR-007).
 *
 * Nothing here is specific to one channel: the channel is a *value*
 * (`ChannelName`), never a type name, a field name or a hard-coded literal.
 * Concrete channel adapters translate their own payloads into these shapes at
 * the boundary, so the core can be exercised with in-memory / mock adapters.
 *
 * Field-level limits mirror the published API contract
 * (packages/channel-core/contracts/api.openapi.yml). They are re-stated here as
 * constants because the core validates *before* any adapter is involved; the
 * contract remains the canonical source and drift is covered by tests.
 */

import type {
  BotKind,
  ChannelName,
  DeepLinkAction,
  InboundUpdateKind,
  MiniAppKind,
} from "@wasla/contracts-channel";

/**
 * Opaque reference to a conversation inside a channel.
 *
 * The channel layer never stores the mapping `chatRef ↔ waslaPublicId`; that
 * mapping belongs to the Identity service (ADR-001, ADR-007 rule 4).
 */
export type ChatRef = string;

/** Opaque reference to the channel-side end user (used only for bootstrap). */
export type ChannelUserRef = string;

/** Delivery priority, as published in the API contract. */
export type MessagePriority = "critical" | "high" | "normal" | "low";

/** Applied when the caller omits `priority` (the contract imposes no default). */
export const DEFAULT_PRIORITY: MessagePriority = "normal";

/** Outbound message shapes supported in Phase 03. */
export type OutboundMessageKind = "text" | "text_with_buttons";

/** Lifecycle of an outbound delivery (mirrors channel_deliveries.status). */
export type DeliveryStatus = "queued" | "sent" | "failed";

/** Contract limits the core enforces before touching any adapter. */
export const LIMITS = {
  chatRefMax: 128,
  textMax: 4096,
  buttonsMax: 8,
  buttonLabelMax: 64,
  miniAppPathMax: 256,
  idempotencyKeyMin: 8,
  idempotencyKeyMax: 128,
  deepLinkParamsMax: 4,
} as const;

// ─────────────────────────────────────────────────────────────────────
// Inbound
// ─────────────────────────────────────────────────────────────────────

/**
 * The channel-side end user, already normalised by the adapter.
 *
 * Every field arriving from a channel is untrusted (ADR-007 rule 8): the
 * adapter validates and trims it before the core sees it. The core treats the
 * whole actor as *bootstrap input only* — it is forwarded to Identity and never
 * persisted by the channel layer.
 */
export interface InboundActor {
  readonly channelUserRef: ChannelUserRef;
  readonly displayName?: string;
  readonly languageCode?: string;
}

/** A channel update after translation into the neutral shape. */
export interface InboundUpdate {
  readonly channel: ChannelName;
  readonly bot: BotKind;
  /** Update id as reported by the channel — always treated as a string. */
  readonly channelUpdateId: string;
  readonly chatRef: ChatRef;
  readonly kind: InboundUpdateKind;
  /** Command name without its leading marker, when `kind === "command"`. */
  readonly command?: string;
  /** Raw argument that followed the command (e.g. a deep-link payload). */
  readonly commandArgument?: string;
  readonly text?: string;
  readonly callbackData?: string;
  readonly actor?: InboundActor;
  /** True when the conversation is a group/supergroup (ADR-007 rule 9). */
  readonly isGroup?: boolean;
  readonly traceId?: string;
}

/**
 * Where a conversation happens, from the layer's point of view.
 *
 * A group is *not* a second kind of conversation with its own code path
 * (ADR-007 rule 9, ADR-008): it is a value on the same update, so the same
 * de-duplication, the same delivery accounting and the same retry queue serve
 * both. What the scope changes is *policy*, and policy lives in the use cases.
 */
export type ConversationScope = "private" | "group";

/**
 * The capacity in which WASLA operates a group.
 *
 * Roles are deliberately coarse. Binding a group to an *order* (which ticket,
 * which city) needs the support service and its own table; that binding is
 * deferred (ADR-008), and pretending otherwise here would invent a mapping this
 * layer is not allowed to own.
 */
export type GroupRole = "support" | "escalation" | "community";

/** A group this deployment operates, as declared by configuration. */
export interface GroupPresence {
  readonly chatRef: ChatRef;
  readonly role: GroupRole;
  /** Operator-facing label; never sent to the channel. */
  readonly label?: string;
}

/** A processed inbound update, as persisted for de-duplication. */
export interface ProcessedUpdateRecord {
  readonly channel: ChannelName;
  readonly bot: BotKind;
  readonly channelUpdateId: string;
  readonly chatRef: ChatRef;
  readonly kind: InboundUpdateKind;
  readonly command?: string;
  readonly receivedAt: string;
  readonly traceId?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Outbound
// ─────────────────────────────────────────────────────────────────────

/**
 * Intent to open a Mini App.
 *
 * The core declares *which* app; building the actual channel button is the
 * adapter's job (ADR-007 rule 5).
 */
export interface MiniAppButtonIntent {
  readonly type: "mini_app";
  readonly label: string;
  readonly miniApp: MiniAppKind;
  readonly path?: string;
}

/** Intent to share a deep link. */
export interface DeepLinkButtonIntent {
  readonly type: "deep_link";
  readonly label: string;
  readonly action: DeepLinkAction;
  readonly params?: Readonly<Record<string, string>>;
}

/** A button intent — never a channel-native button. */
export type ButtonIntent = MiniAppButtonIntent | DeepLinkButtonIntent;

/** A request to deliver one message through the single outbound exit point. */
export interface OutboundMessageCommand {
  readonly channel: ChannelName;
  readonly chatRef: ChatRef;
  readonly kind: OutboundMessageKind;
  readonly text: string;
  readonly buttons?: readonly ButtonIntent[];
  readonly priority?: MessagePriority;
  /** Required: the same key is never delivered twice (contract + DDL unique). */
  readonly idempotencyKey: string;
  readonly traceId?: string;
}

/** Persisted state of an outbound delivery (mirrors channel_deliveries). */
export interface DeliveryRecord {
  readonly deliveryId: string;
  readonly channel: ChannelName;
  readonly chatRef: ChatRef;
  readonly idempotencyKey: string;
  readonly kind: OutboundMessageKind;
  readonly priority: MessagePriority;
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  /** Next retry time (ISO-8601) while `status === "queued"`, else null. */
  readonly nextAttemptAt: string | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sentAt: string | null;
  readonly traceId?: string;
  /** Optimistic concurrency counter (mirrors channel_deliveries.version). */
  readonly version: number;
}

/** What the message use case reports back to its caller. */
export interface DeliveryOutcome {
  readonly deliveryId: string;
  /** `duplicate` = the idempotency key was already accepted before. */
  readonly status: "queued" | "sent" | "duplicate" | "failed";
  readonly channel: ChannelName;
  readonly chatRef: ChatRef;
  readonly attempts: number;
  readonly errorCode?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Launch surfaces
// ─────────────────────────────────────────────────────────────────────

/**
 * Which Mini App a bot opens, plus how a shareable link to that bot is built.
 *
 * `deepLinkTemplate` is *configuration*, not knowledge: it is supplied by the
 * composition root (environment) and must contain the `{payload}` placeholder.
 * That keeps link building channel-neutral inside the core — the core only
 * substitutes an encoded payload into a template it never authored.
 */
export interface BotPresence {
  readonly bot: BotKind;
  readonly miniApp: MiniAppKind;
  readonly miniAppUrl: string;
  readonly miniAppLabel: string;
  readonly deepLinkTemplate?: string;
}

/** Placeholder every `deepLinkTemplate` must contain. */
export const DEEP_LINK_PAYLOAD_PLACEHOLDER = "{payload}";

/** Mini App launch descriptor (the Phase 03 Exit Gate assertion target). */
export interface MiniAppLaunchDescriptor {
  readonly bot: BotKind;
  readonly miniApp: MiniAppKind;
  readonly url: string;
  readonly label: string;
}

/** A generated deep link. */
export interface GeneratedDeepLink {
  readonly url: string;
  readonly payload: string;
  readonly bot: BotKind;
  readonly action: DeepLinkAction;
}

/** A decoded deep link payload (as received back on the inbound side). */
export interface DecodedDeepLink {
  readonly action: DeepLinkAction;
  readonly params: Readonly<Record<string, string>>;
}
