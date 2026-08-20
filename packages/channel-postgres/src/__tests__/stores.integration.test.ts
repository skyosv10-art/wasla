/**
 * Postgres integration test for the three channel stores (Phase 03 MR 5).
 *
 * Verifies against a real Postgres what only a real Postgres can prove:
 * the contract's unique indexes really de-duplicate, `version` really bumps
 * inside the UPDATE, the retry queue really comes back in priority order, and a
 * stored message body really round-trips through JSONB unchanged.
 *
 * Excluded from the default `pnpm -r test` (see vitest.config.ts). Run with:
 *   DATABASE_URL=postgres://... pnpm --filter @wasla/channel-postgres test:integration
 *
 * Skipped entirely when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Pool } from "pg";

import { IMPLEMENTED_CHANNEL } from "@wasla/contracts-channel";

import {
  type ChannelDispatch,
  type NewDelivery,
  type ProcessedUpdateRecord,
  updateReceivedEvent,
} from "@wasla/channel-core";

import {
  createChannelDb,
  PostgresChannelOutbox,
  PostgresDeliveryStore,
  PostgresProcessedUpdateStore,
  type ChannelDb,
} from "../index.js";

import { resetChannelSchema, truncateChannelTables } from "./harness.js";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = Boolean(DATABASE_URL);

const CHANNEL = IMPLEMENTED_CHANNEL;
const AT = "2026-08-20T12:00:00.000Z";

function uuid(seed: number): string {
  return `00000000-0000-4000-8000-${seed.toString().padStart(12, "0")}`;
}

function dispatchFor(overrides: Partial<ChannelDispatch> = {}): ChannelDispatch {
  return {
    channel: CHANNEL,
    chatRef: "chat-1",
    kind: "text",
    text: "مرحباً بك في وصلة",
    priority: "normal",
    idempotencyKey: "key-1",
    ...overrides,
  };
}

function newDelivery(overrides: Partial<NewDelivery> = {}): NewDelivery {
  const dispatch = dispatchFor(
    overrides.dispatch === undefined ? {} : { ...overrides.dispatch },
  );
  return {
    deliveryId: uuid(1),
    channel: CHANNEL,
    chatRef: dispatch.chatRef,
    idempotencyKey: dispatch.idempotencyKey,
    kind: dispatch.kind,
    priority: dispatch.priority,
    maxAttempts: 5,
    createdAt: AT,
    dispatch,
    ...overrides,
  };
}

function processedUpdate(overrides: Partial<ProcessedUpdateRecord> = {}): ProcessedUpdateRecord {
  return {
    channel: CHANNEL,
    bot: "customer",
    channelUpdateId: "1001",
    chatRef: "chat-1",
    kind: "command",
    command: "start",
    receivedAt: AT,
    ...overrides,
  };
}

describe.skipIf(!ENABLED)("channel stores on Postgres", () => {
  let pool: Pool;
  let db: ChannelDb;

  beforeAll(async () => {
    const created = createChannelDb({ connectionString: DATABASE_URL! });
    pool = created.pool;
    db = created.db;
    await resetChannelSchema(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateChannelTables(pool);
  });

  // ───────────────────────── ProcessedUpdateStore ─────────────────────────

  describe("PostgresProcessedUpdateStore", () => {
    it("claims an update once and reports the replay as a duplicate", async () => {
      const store = new PostgresProcessedUpdateStore(db);

      await expect(store.remember(processedUpdate())).resolves.toBe(true);
      await expect(store.remember(processedUpdate())).resolves.toBe(false);
      await expect(store.has(CHANNEL, "customer", "1001")).resolves.toBe(true);
    });

    it("scopes de-duplication per bot (same update id, another bot)", async () => {
      const store = new PostgresProcessedUpdateStore(db);

      await expect(store.remember(processedUpdate())).resolves.toBe(true);
      await expect(store.remember(processedUpdate({ bot: "driver" }))).resolves.toBe(true);
      await expect(store.has(CHANNEL, "partner", "1001")).resolves.toBe(false);
    });

    it("keeps the claim across a restart (a new store over the same database)", async () => {
      await expect(new PostgresProcessedUpdateStore(db).remember(processedUpdate())).resolves.toBe(
        true,
      );
      // A fresh instance stands in for a restarted process: the in-memory
      // adapter forgets here, the Postgres one must not.
      await expect(new PostgresProcessedUpdateStore(db).remember(processedUpdate())).resolves.toBe(
        false,
      );
    });

    it("lets two concurrent claims of one update produce exactly one winner", async () => {
      const store = new PostgresProcessedUpdateStore(db);

      const results = await Promise.all([
        store.remember(processedUpdate()),
        store.remember(processedUpdate()),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
    });
  });

  // ───────────────────────────── DeliveryStore ─────────────────────────────

  describe("PostgresDeliveryStore", () => {
    it("creates a queued delivery at version 1", async () => {
      const store = new PostgresDeliveryStore(db);

      const { record, created } = await store.create(newDelivery());

      expect(created).toBe(true);
      expect(record).toMatchObject({
        deliveryId: uuid(1),
        channel: CHANNEL,
        status: "queued",
        attempts: 0,
        maxAttempts: 5,
        nextAttemptAt: null,
        version: 1,
      });
      expect(record.createdAt).toBe(AT);
    });

    it("returns the existing row for a repeated idempotency key", async () => {
      const store = new PostgresDeliveryStore(db);
      await store.create(newDelivery());

      const second = await store.create(newDelivery({ deliveryId: uuid(2) }));

      expect(second.created).toBe(false);
      expect(second.record.deliveryId).toBe(uuid(1));
      await expect(store.findByIdempotencyKey(CHANNEL, "key-1")).resolves.toMatchObject({
        deliveryId: uuid(1),
      });
    });

    it("bumps version on every applied attempt", async () => {
      const store = new PostgresDeliveryStore(db);
      await store.create(newDelivery());

      const requeued = await store.applyProgress(uuid(1), {
        status: "queued",
        attempts: 1,
        nextAttemptAt: "2026-08-20T12:00:01.000Z",
        lastErrorCode: "CHANNEL_RATE_LIMITED",
        lastErrorAt: AT,
        sentAt: null,
        updatedAt: AT,
      });
      expect(requeued).toMatchObject({ status: "queued", attempts: 1, version: 2 });

      const sent = await store.applyProgress(uuid(1), {
        status: "sent",
        attempts: 2,
        nextAttemptAt: null,
        lastErrorCode: null,
        lastErrorAt: null,
        sentAt: "2026-08-20T12:00:02.000Z",
        updatedAt: "2026-08-20T12:00:02.000Z",
      });
      expect(sent).toMatchObject({ status: "sent", attempts: 2, version: 3, nextAttemptAt: null });
      expect(sent.sentAt).toBe("2026-08-20T12:00:02.000Z");
    });

    it("rejects progress for an unknown delivery", async () => {
      const store = new PostgresDeliveryStore(db);

      await expect(
        store.applyProgress(uuid(99), {
          status: "sent",
          attempts: 1,
          nextAttemptAt: null,
          lastErrorCode: null,
          lastErrorAt: null,
          sentAt: AT,
          updatedAt: AT,
        }),
      ).rejects.toMatchObject({ code: "CHANNEL_INTERNAL_ERROR" });
    });

    it("returns due deliveries by priority, then by next attempt time", async () => {
      const store = new PostgresDeliveryStore(db);
      const queue: readonly { readonly seed: number; readonly priority: NewDelivery["priority"]; readonly due: string }[] = [
        { seed: 1, priority: "low", due: "2026-08-20T12:00:01.000Z" },
        { seed: 2, priority: "critical", due: "2026-08-20T12:00:03.000Z" },
        { seed: 3, priority: "normal", due: "2026-08-20T12:00:01.000Z" },
        { seed: 4, priority: "critical", due: "2026-08-20T12:00:02.000Z" },
        { seed: 5, priority: "high", due: "2026-08-20T12:00:01.000Z" },
      ];

      for (const item of queue) {
        await store.create(
          newDelivery({
            deliveryId: uuid(item.seed),
            idempotencyKey: `key-${item.seed}`,
            priority: item.priority,
            dispatch: dispatchFor({
              idempotencyKey: `key-${item.seed}`,
              priority: item.priority,
            }),
          }),
        );
        await store.applyProgress(uuid(item.seed), {
          status: "queued",
          attempts: 1,
          nextAttemptAt: item.due,
          lastErrorCode: "CHANNEL_TRANSPORT_ERROR",
          lastErrorAt: AT,
          sentAt: null,
          updatedAt: AT,
        });
      }

      const due = await store.dueForRetry("2026-08-20T12:01:00.000Z", 10);

      expect(due.map((record) => record.deliveryId)).toEqual([
        uuid(4), // critical, earliest
        uuid(2), // critical, later
        uuid(5), // high
        uuid(3), // normal
        uuid(1), // low
      ]);
    });

    it("excludes deliveries that are not due, not queued, or never scheduled", async () => {
      const store = new PostgresDeliveryStore(db);

      // never scheduled (fresh row, nextAttemptAt IS NULL)
      await store.create(newDelivery());
      // scheduled in the future
      await store.create(
        newDelivery({
          deliveryId: uuid(2),
          idempotencyKey: "key-2",
          dispatch: dispatchFor({ idempotencyKey: "key-2" }),
        }),
      );
      await store.applyProgress(uuid(2), {
        status: "queued",
        attempts: 1,
        nextAttemptAt: "2026-08-20T13:00:00.000Z",
        lastErrorCode: "CHANNEL_RATE_LIMITED",
        lastErrorAt: AT,
        sentAt: null,
        updatedAt: AT,
      });
      // terminally failed, with a stale schedule
      await store.create(
        newDelivery({
          deliveryId: uuid(3),
          idempotencyKey: "key-3",
          dispatch: dispatchFor({ idempotencyKey: "key-3" }),
        }),
      );
      await store.applyProgress(uuid(3), {
        status: "failed",
        attempts: 5,
        nextAttemptAt: "2026-08-20T12:00:01.000Z",
        lastErrorCode: "CHANNEL_TRANSPORT_ERROR",
        lastErrorAt: AT,
        sentAt: null,
        updatedAt: AT,
      });

      await expect(store.dueForRetry("2026-08-20T12:30:00.000Z", 10)).resolves.toEqual([]);
    });

    it("honours the sweep limit", async () => {
      const store = new PostgresDeliveryStore(db);
      for (const seed of [1, 2, 3]) {
        await store.create(
          newDelivery({
            deliveryId: uuid(seed),
            idempotencyKey: `key-${seed}`,
            dispatch: dispatchFor({ idempotencyKey: `key-${seed}` }),
          }),
        );
        await store.applyProgress(uuid(seed), {
          status: "queued",
          attempts: 1,
          nextAttemptAt: AT,
          lastErrorCode: "CHANNEL_RATE_LIMITED",
          lastErrorAt: AT,
          sentAt: null,
          updatedAt: AT,
        });
      }

      await expect(store.dueForRetry("2026-08-20T12:30:00.000Z", 2)).resolves.toHaveLength(2);
    });

    it("round-trips the stored body, including button intents and the owning bot", async () => {
      const store = new PostgresDeliveryStore(db);
      const dispatch = dispatchFor({
        kind: "text_with_buttons",
        idempotencyKey: "key-buttons",
        traceId: "trace-7",
        buttons: [
          { type: "mini_app", label: "افتح التطبيق", miniApp: "customer", path: "/orders" },
          { type: "deep_link", label: "شارك", action: "track_order", params: { order: "ORD-1" } },
        ],
      });

      await store.create(
        newDelivery({
          deliveryId: uuid(8),
          idempotencyKey: "key-buttons",
          kind: "text_with_buttons",
          traceId: "trace-7",
          bot: "customer",
          dispatch,
        }),
      );

      const stored = await store.loadDispatch(uuid(8));

      expect(stored?.bot).toBe("customer");
      expect(stored?.dispatch).toEqual(dispatch);
      await expect(store.loadDispatch(uuid(99))).resolves.toBeNull();
    });

    it("keeps traceId absent (not null) when the delivery carried none", async () => {
      const store = new PostgresDeliveryStore(db);
      const { record } = await store.create(newDelivery());

      expect("traceId" in record).toBe(false);
    });
  });

  // ─────────────────────────────── Outbox ───────────────────────────────

  describe("PostgresChannelOutbox", () => {
    it("appends an event as an unpublished row and reads it back whole", async () => {
      const outbox = new PostgresChannelOutbox(db);
      const event = updateReceivedEvent({
        eventId: uuid(11),
        occurredAt: AT,
        chatRef: "chat-1",
        traceId: "trace-1",
        channel: CHANNEL,
        bot: "customer",
        channelUpdateId: "1001",
        kind: "command",
        command: "start",
      });

      await outbox.append(event);

      await expect(outbox.unpublished()).resolves.toEqual([event]);
    });

    it("treats a replayed event id as a no-op instead of a duplicate row", async () => {
      const outbox = new PostgresChannelOutbox(db);
      const event = updateReceivedEvent({
        eventId: uuid(12),
        occurredAt: AT,
        chatRef: "chat-1",
        channel: CHANNEL,
        bot: "driver",
        channelUpdateId: "1002",
        kind: "text_message",
      });

      await outbox.append(event);
      await outbox.append(event);

      await expect(outbox.unpublished()).resolves.toHaveLength(1);
    });
  });
});
