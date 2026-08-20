/**
 * In-memory / mock adapters for every port.
 *
 * These are first-class deliverables, not test scaffolding: the Phase 03 Exit
 * Gate is «the channel adapter can be swapped for a mock», so `MockChannelAdapter`
 * is the artefact that makes the gate provable. Production adapters
 * (channel transport in MR 3, Postgres stores in MR 5, HTTP identity in MR 4)
 * implement the same interfaces and are swapped in by the composition root.
 *
 * Everything here is deterministic: the clock is stepped explicitly, ids are
 * sequential, and jitter is zero unless injected — so a failing test points at a
 * behaviour, never at timing.
 */

import type { BotKind, ChannelErrorCode, ChannelName } from "@wasla/contracts-channel";
import { BOT_KINDS, BOT_MINI_APP, IMPLEMENTED_CHANNEL } from "@wasla/contracts-channel";

import { channelError } from "../domain/errors.js";
import type { ChannelDomainEvent } from "../domain/events.js";
import type {
  BotPresence,
  DeliveryRecord,
  InboundUpdate,
  ProcessedUpdateRecord,
} from "../domain/model.js";
import type {
  ChannelDispatch,
  ChannelPort,
  ChannelSendResult,
  ClockPort,
  DeliveryProgress,
  DeliveryStorePort,
  IdGeneratorPort,
  IdentityBootstrapInput,
  IdentityBootstrapPort,
  IdentityBootstrapResult,
  MiniAppRegistryPort,
  NewDelivery,
  OutboxPort,
  ProcessedUpdateStorePort,
  StoredDispatch,
  UpdateParserPort,
} from "../ports.js";

// ─────────────────────────────────────────────────────────────────────
// Clock + ids
// ─────────────────────────────────────────────────────────────────────

/** A clock you move by hand. */
export class FixedClock implements ClockPort {
  private current: number;

  constructor(startIso = "2026-08-20T12:00:00.000Z") {
    this.current = Date.parse(startIso);
  }

  now(): string {
    return new Date(this.current).toISOString();
  }

  /** Advance the clock by `ms` (used to make a backoff window elapse). */
  advance(ms: number): void {
    this.current += ms;
  }

  /** Jump to an absolute instant. */
  set(iso: string): void {
    this.current = Date.parse(iso);
  }
}

/** Sequential, readable, deterministic ids. */
export class SequentialIdGenerator implements IdGeneratorPort {
  private counter = 0;

  constructor(private readonly prefix = "00000000-0000-4000-8000-") {}

  uuid(): string {
    this.counter += 1;
    return `${this.prefix}${this.counter.toString().padStart(12, "0")}`;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Inbound stores
// ─────────────────────────────────────────────────────────────────────

/** De-duplication store backed by a Set — mirrors the DDL unique index. */
export class InMemoryProcessedUpdateStore implements ProcessedUpdateStorePort {
  private readonly seen = new Map<string, ProcessedUpdateRecord>();

  private static key(channel: ChannelName, bot: BotKind, updateId: string): string {
    return `${channel}::${bot}::${updateId}`;
  }

  async remember(record: ProcessedUpdateRecord): Promise<boolean> {
    const key = InMemoryProcessedUpdateStore.key(
      record.channel,
      record.bot,
      record.channelUpdateId,
    );
    if (this.seen.has(key)) return false;
    this.seen.set(key, record);
    return true;
  }

  async has(channel: ChannelName, bot: BotKind, channelUpdateId: string): Promise<boolean> {
    return this.seen.has(InMemoryProcessedUpdateStore.key(channel, bot, channelUpdateId));
  }

  /** Everything remembered so far, in insertion order (assertions only). */
  records(): ProcessedUpdateRecord[] {
    return [...this.seen.values()];
  }
}

// ─────────────────────────────────────────────────────────────────────
// Outbound store
// ─────────────────────────────────────────────────────────────────────

const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 } as const;

/** Delivery store honouring the same uniqueness and ordering rules as the DDL. */
export class InMemoryDeliveryStore implements DeliveryStorePort {
  private readonly byId = new Map<string, DeliveryRecord>();
  private readonly idByKey = new Map<string, string>();
  private readonly dispatches = new Map<string, StoredDispatch>();

  private static key(channel: ChannelName, idempotencyKey: string): string {
    return `${channel}::${idempotencyKey}`;
  }

  async create(delivery: NewDelivery): Promise<{ record: DeliveryRecord; created: boolean }> {
    const key = InMemoryDeliveryStore.key(delivery.channel, delivery.idempotencyKey);
    const existingId = this.idByKey.get(key);
    if (existingId !== undefined) {
      const existing = this.byId.get(existingId);
      if (existing) return { record: existing, created: false };
    }

    const record: DeliveryRecord = {
      deliveryId: delivery.deliveryId,
      channel: delivery.channel,
      chatRef: delivery.chatRef,
      idempotencyKey: delivery.idempotencyKey,
      kind: delivery.kind,
      priority: delivery.priority,
      status: "queued",
      attempts: 0,
      maxAttempts: delivery.maxAttempts,
      nextAttemptAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
      createdAt: delivery.createdAt,
      updatedAt: delivery.createdAt,
      sentAt: null,
      ...(delivery.traceId === undefined ? {} : { traceId: delivery.traceId }),
      version: 1,
    };

    this.byId.set(record.deliveryId, record);
    this.idByKey.set(key, record.deliveryId);
    this.dispatches.set(record.deliveryId, {
      dispatch: delivery.dispatch,
      ...(delivery.bot === undefined ? {} : { bot: delivery.bot }),
    });
    return { record, created: true };
  }

  async findByIdempotencyKey(
    channel: ChannelName,
    idempotencyKey: string,
  ): Promise<DeliveryRecord | null> {
    const id = this.idByKey.get(InMemoryDeliveryStore.key(channel, idempotencyKey));
    return id === undefined ? null : (this.byId.get(id) ?? null);
  }

  async applyProgress(deliveryId: string, progress: DeliveryProgress): Promise<DeliveryRecord> {
    const current = this.byId.get(deliveryId);
    if (!current) {
      throw channelError("CHANNEL_INTERNAL_ERROR", "محاولة تحديث تسليم غير موجود", {
        details: { deliveryId },
      });
    }
    const updated: DeliveryRecord = { ...current, ...progress, version: current.version + 1 };
    this.byId.set(deliveryId, updated);
    return updated;
  }

  async dueForRetry(now: string, limit: number): Promise<DeliveryRecord[]> {
    const at = Date.parse(now);
    return [...this.byId.values()]
      .filter(
        (record) =>
          record.status === "queued" &&
          record.nextAttemptAt !== null &&
          Date.parse(record.nextAttemptAt) <= at,
      )
      .sort((left, right) => {
        const byPriority = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
        if (byPriority !== 0) return byPriority;
        return Date.parse(left.nextAttemptAt ?? "") - Date.parse(right.nextAttemptAt ?? "");
      })
      .slice(0, limit);
  }

  async loadDispatch(deliveryId: string): Promise<StoredDispatch | null> {
    return this.dispatches.get(deliveryId) ?? null;
  }

  /** Read a row directly (assertions only). */
  get(deliveryId: string): DeliveryRecord | undefined {
    return this.byId.get(deliveryId);
  }

  /** Drop a stored body to simulate an unrecoverable queued row. */
  forgetDispatch(deliveryId: string): void {
    this.dispatches.delete(deliveryId);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Outbox
// ─────────────────────────────────────────────────────────────────────

/** Collects appended events so tests can assert the event trail. */
export class InMemoryOutbox implements OutboxPort {
  readonly events: ChannelDomainEvent[] = [];

  async append(event: ChannelDomainEvent): Promise<void> {
    this.events.push(event);
  }

  /** Events of one type, in append order. */
  ofType<T extends ChannelDomainEvent["event_type"]>(
    type: T,
  ): Extract<ChannelDomainEvent, { event_type: T }>[] {
    return this.events.filter(
      (event): event is Extract<ChannelDomainEvent, { event_type: T }> =>
        event.event_type === type,
    );
  }

  /** All event types appended so far, in order. */
  types(): string[] {
    return this.events.map((event) => event.event_type);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Channel adapter (the Exit Gate substitute)
// ─────────────────────────────────────────────────────────────────────

/** One scripted outcome for the mock adapter. */
export type MockSendOutcome =
  | { readonly ok: true; readonly messageRef?: string }
  | {
      readonly ok: false;
      readonly errorCode: ChannelErrorCode;
      readonly retryAfterSeconds?: number;
    };

/**
 * A channel adapter that records what it was asked to send and replays a script.
 *
 * Swapping this in for the production adapter is the Exit Gate: nothing above it
 * changes, because it satisfies `ChannelPort` and nothing more.
 */
export class MockChannelAdapter implements ChannelPort {
  readonly sent: ChannelDispatch[] = [];
  private readonly script: MockSendOutcome[];

  constructor(
    /** Outcomes consumed in order; the last one repeats once exhausted. */
    script: MockSendOutcome[] = [{ ok: true }],
    readonly channel: ChannelName = IMPLEMENTED_CHANNEL,
  ) {
    this.script = [...script];
  }

  async send(dispatch: ChannelDispatch): Promise<ChannelSendResult> {
    this.sent.push(dispatch);
    const next = this.script.length > 1 ? this.script.shift() : this.script[0];
    const outcome = next ?? { ok: true as const };
    return outcome.ok
      ? { ok: true, ...(outcome.messageRef === undefined ? {} : { messageRef: outcome.messageRef }) }
      : {
          ok: false,
          errorCode: outcome.errorCode,
          ...(outcome.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: outcome.retryAfterSeconds }),
        };
  }

  /** The most recent dispatch (assertions only). */
  last(): ChannelDispatch | undefined {
    return this.sent.at(-1);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Update parser
// ─────────────────────────────────────────────────────────────────────

/**
 * A parser that accepts an already-neutral update.
 *
 * It exists so inbound use cases can be tested without any channel payload
 * shape: production parsing (a channel-specific concern) lives in MR 3.
 */
export class FakeUpdateParser implements UpdateParserPort {
  constructor(readonly channel: ChannelName = IMPLEMENTED_CHANNEL) {}

  parse(raw: unknown, bot: BotKind): InboundUpdate {
    if (typeof raw !== "object" || raw === null) {
      throw channelError("CHANNEL_INVALID_UPDATE", "جسم التحديث ليس كائناً");
    }
    const candidate = raw as Partial<InboundUpdate>;
    if (typeof candidate.channelUpdateId !== "string" || typeof candidate.chatRef !== "string") {
      throw channelError("CHANNEL_INVALID_UPDATE", "تحديث بلا معرّف أو بلا مرجع محادثة");
    }
    return { ...(candidate as InboundUpdate), channel: this.channel, bot };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Identity bootstrap
// ─────────────────────────────────────────────────────────────────────

/** Identity bootstrap stub: stable public id per actor, or a scripted failure. */
export class FakeIdentityBootstrap implements IdentityBootstrapPort {
  readonly calls: IdentityBootstrapInput[] = [];
  private readonly known = new Map<string, string>();
  private failing = false;

  constructor(private readonly prefix = "WSL-") {}

  /** Make the next calls fail as an unavailable Identity service. */
  failNext(failing = true): void {
    this.failing = failing;
  }

  async ensureIdentity(input: IdentityBootstrapInput): Promise<IdentityBootstrapResult> {
    this.calls.push(input);
    if (this.failing) {
      throw channelError("CHANNEL_IDENTITY_BOOTSTRAP_FAILED", "خدمة الهوية غير متاحة (اختبار)");
    }
    const existing = this.known.get(input.actor.channelUserRef);
    if (existing !== undefined) {
      return { waslaPublicId: existing, created: false };
    }
    const publicId = `${this.prefix}${(this.known.size + 1).toString().padStart(6, "0")}`;
    this.known.set(input.actor.channelUserRef, publicId);
    return { waslaPublicId: publicId, created: true };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Mini App registry
// ─────────────────────────────────────────────────────────────────────

/** Registry backed by a plain map — the shape a composition root builds from env. */
export class StaticMiniAppRegistry implements MiniAppRegistryPort {
  constructor(private readonly presences: Partial<Record<BotKind, BotPresence>>) {}

  presenceFor(bot: BotKind): BotPresence | null {
    return this.presences[bot] ?? null;
  }
}

/** A registry covering the three bots, each pointing at its own Mini App. */
export function testRegistry(baseUrl = "https://example.test"): StaticMiniAppRegistry {
  const presences: Partial<Record<BotKind, BotPresence>> = {};
  for (const bot of BOT_KINDS) {
    presences[bot] = {
      bot,
      miniApp: BOT_MINI_APP[bot],
      miniAppUrl: `${baseUrl}/${bot}`,
      miniAppLabel: `${bot} app`,
      deepLinkTemplate: `${baseUrl}/bots/${bot}?payload={payload}`,
    };
  }
  return new StaticMiniAppRegistry(presences);
}
