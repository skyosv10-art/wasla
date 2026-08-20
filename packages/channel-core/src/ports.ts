/**
 * Ports of the channel layer (hexagonal boundaries) — the internal contract
 * fixed by ADR-007 §2 and extended once, by ADR-008, with the group registry.
 *
 * Use cases depend on these interfaces only. Every port has a production
 * adapter (added in later MRs of the phase plan) and a test adapter shipped in
 * ./infrastructure, which is what makes the Phase 03 Exit Gate
 * («the adapter can be swapped for a mock») provable instead of asserted.
 *
 * Hard rule: nothing in this package imports a concrete channel adapter, and no
 * channel-native identifier appears in any signature below. The channel is a
 * value carried in the data.
 */

import type { BotKind, ChannelErrorCode, ChannelName } from "@wasla/contracts-channel";

import type {
  ButtonIntent,
  ChatRef,
  GroupPresence,
  GroupRole,
  DeliveryRecord,
  DeliveryStatus,
  InboundActor,
  InboundUpdate,
  MessagePriority,
  OutboundMessageKind,
  ProcessedUpdateRecord,
  BotPresence,
} from "./domain/model.js";
import type { ChannelDomainEvent } from "./domain/events.js";

// ─────────────────────────────────────────────────────────────────────
// 1) ChannelPort — the single way out
// ─────────────────────────────────────────────────────────────────────

/** What an adapter is asked to deliver (already validated by the core). */
export interface ChannelDispatch {
  readonly channel: ChannelName;
  readonly chatRef: ChatRef;
  readonly kind: OutboundMessageKind;
  readonly text: string;
  readonly buttons?: readonly ButtonIntent[];
  readonly priority: MessagePriority;
  /** Carried through so an adapter can de-duplicate at its own boundary too. */
  readonly idempotencyKey: string;
  readonly traceId?: string;
}

/** Success: the message reached the channel. */
export interface ChannelSendSuccess {
  readonly ok: true;
  /** Channel-side message reference, when the channel returns one (opaque). */
  readonly messageRef?: string;
}

/**
 * Failure: already translated into the WASLA error vocabulary.
 *
 * The adapter maps its native failure to a `CHANNEL_*` code (ADR-007 rule 7),
 * so the core decides retry vs. fail without ever reading a channel error text.
 */
export interface ChannelSendFailure {
  readonly ok: false;
  readonly errorCode: ChannelErrorCode;
  /** Cooldown the channel asked for, in seconds, when it provided one. */
  readonly retryAfterSeconds?: number;
}

export type ChannelSendResult = ChannelSendSuccess | ChannelSendFailure;

/** Sends outbound messages to one channel. */
export interface ChannelPort {
  readonly channel: ChannelName;
  send(dispatch: ChannelDispatch): Promise<ChannelSendResult>;
}

// ─────────────────────────────────────────────────────────────────────
// 2) UpdateParserPort — the single way in
// ─────────────────────────────────────────────────────────────────────

/**
 * Translates a raw channel update into the neutral `InboundUpdate`.
 *
 * Implementations must reject anything unparsable with
 * `CHANNEL_INVALID_UPDATE`, and must normalise/validate untrusted fields before
 * returning (ADR-007 rule 8).
 */
export interface UpdateParserPort {
  readonly channel: ChannelName;
  parse(raw: unknown, bot: BotKind): InboundUpdate;
}

// ─────────────────────────────────────────────────────────────────────
// 3) ProcessedUpdateStorePort — inbound de-duplication
// ─────────────────────────────────────────────────────────────────────

/**
 * Records processed updates, keyed by `(channel, bot, channelUpdateId)`.
 *
 * `remember` must be atomic: it returns `false` when the key already exists, so
 * a duplicate is detected by the store, not by a read-then-write race in the
 * core (the Postgres adapter relies on the unique index for exactly this).
 */
export interface ProcessedUpdateStorePort {
  remember(record: ProcessedUpdateRecord): Promise<boolean>;
  has(channel: ChannelName, bot: BotKind, channelUpdateId: string): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────
// 4) DeliveryStorePort — outbound state + retry queue
// ─────────────────────────────────────────────────────────────────────

/** A new delivery row, before the first send attempt. */
export interface NewDelivery {
  readonly deliveryId: string;
  readonly channel: ChannelName;
  readonly chatRef: ChatRef;
  readonly idempotencyKey: string;
  readonly kind: OutboundMessageKind;
  readonly priority: MessagePriority;
  readonly maxAttempts: number;
  readonly createdAt: string;
  readonly traceId?: string;
  /**
   * The accepted message body, stored verbatim.
   *
   * A retry must re-send *the same* message, so the body cannot be rebuilt by
   * the caller later (it may no longer exist). This is why
   * `channel_deliveries.payload` exists in the data contract.
   */
  readonly dispatch: ChannelDispatch;
  /** Owning bot, kept only to attribute a Mini App launch event on success. */
  readonly bot?: BotKind;
}

/** What the store hands back so a queued delivery can be re-dispatched. */
export interface StoredDispatch {
  readonly dispatch: ChannelDispatch;
  readonly bot?: BotKind;
}

/** The mutable part of a delivery after an attempt. */
export interface DeliveryProgress {
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly nextAttemptAt: string | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorAt: string | null;
  readonly sentAt: string | null;
  readonly updatedAt: string;
}

/**
 * Stores outbound deliveries and exposes the retry queue.
 *
 * `create` must honour the unique `(channel, idempotencyKey)` constraint by
 * returning the existing row instead of inserting a second one — that is what
 * turns a retry of the *caller* into a `duplicate` rather than a double send.
 */
export interface DeliveryStorePort {
  /** Insert, or return the existing row for this idempotency key. */
  create(delivery: NewDelivery): Promise<{ record: DeliveryRecord; created: boolean }>;
  findByIdempotencyKey(
    channel: ChannelName,
    idempotencyKey: string,
  ): Promise<DeliveryRecord | null>;
  /** Persist the outcome of an attempt (bumps `version`). */
  applyProgress(deliveryId: string, progress: DeliveryProgress): Promise<DeliveryRecord>;
  /** Queued deliveries whose `nextAttemptAt` is due at `now`, highest priority first. */
  dueForRetry(now: string, limit: number): Promise<DeliveryRecord[]>;
  /** The stored body needed to re-dispatch a delivery without rebuilding it. */
  loadDispatch(deliveryId: string): Promise<StoredDispatch | null>;
}

// ─────────────────────────────────────────────────────────────────────
// 5) OutboxPort — domain events
// ─────────────────────────────────────────────────────────────────────

/** Appends domain events transactionally; publishing is a separate concern. */
export interface OutboxPort {
  append(event: ChannelDomainEvent): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// 6) IdentityBootstrapPort — the only identity touchpoint
// ─────────────────────────────────────────────────────────────────────

export interface IdentityBootstrapInput {
  readonly channel: ChannelName;
  readonly bot: BotKind;
  readonly actor: InboundActor;
  readonly traceId?: string;
}

export interface IdentityBootstrapResult {
  readonly waslaPublicId: string;
  readonly created: boolean;
}

/**
 * Creates or fetches the WASLA identity behind a channel actor.
 *
 * The channel layer forwards and forgets: it never stores the
 * `chatRef ↔ waslaPublicId` mapping (ADR-001, ADR-007 rule 4). Failures surface
 * as `CHANNEL_IDENTITY_BOOTSTRAP_FAILED`, which is retryable.
 */
export interface IdentityBootstrapPort {
  ensureIdentity(input: IdentityBootstrapInput): Promise<IdentityBootstrapResult>;
}

// ─────────────────────────────────────────────────────────────────────
// 7) MiniAppRegistryPort — which app a bot opens
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolves a bot's public surface (its Mini App and its shareable link shape).
 *
 * This is configuration, injected by the composition root from the environment
 * — URLs are never hard-coded in the core (SECURITY_RULES).
 */
export interface MiniAppRegistryPort {
  presenceFor(bot: BotKind): BotPresence | null;
}

// ─────────────────────────────────────────────────────────────────────
// 8) GroupRegistryPort — which groups this deployment operates
// ─────────────────────────────────────────────────────────────────────

/**
 * Answers «is this conversation a group we operate, and in what capacity».
 *
 * Configuration, not state (ADR-008): the group ↔ order binding that would need
 * a table belongs to the support service and is deferred, so this port resolves
 * a conversation reference against what the composition root was told at boot.
 *
 * A deployment with no groups configured returns `null` for everything, and the
 * use cases then treat every group as unknown — which is the safe default: a bot
 * that was added to a group nobody configured stays silent instead of speaking
 * to strangers.
 */
export interface GroupRegistryPort {
  /** The role of a group conversation, or `null` when it is not ours. */
  roleFor(chatRef: ChatRef): GroupRole | null;
  /** Every group configured for a role — the seam a router will consume. */
  groupsFor(role: GroupRole): readonly GroupPresence[];
}

// ─────────────────────────────────────────────────────────────────────
// 9) ClockPort · IdGeneratorPort — deterministic injectables
// ─────────────────────────────────────────────────────────────────────

/** Wall-clock time as an ISO-8601 string. */
export interface ClockPort {
  now(): string;
}

/** UUID source for `event_id` / `delivery_id`. */
export interface IdGeneratorPort {
  uuid(): string;
}

export type { RetryPolicy, RetryDecision, RetryDecisionInput } from "./domain/retry.js";
