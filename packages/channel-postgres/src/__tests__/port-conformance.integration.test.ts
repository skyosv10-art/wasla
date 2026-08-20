/**
 * Port conformance: the core must behave identically on Postgres and in memory.
 *
 * The store tests next door assert SQL behaviour. This file asserts the thing we
 * actually care about — that swapping the in-memory adapters for the Postgres
 * ones changes *nothing* above the port (ADR-007 §2). Every case runs the real
 * use cases (`receiveUpdate`, `sendMessage`, `retryDueDeliveries`) twice: once
 * against `InMemory*`, once against `Postgres*`, and compares the results.
 *
 * That is the difference between "our SQL works" and "our SQL is a faithful
 * adapter", and it is also what protects the Phase 03 Exit Gate: the mock channel
 * adapter stays in place while the persistence layer changes underneath.
 *
 * Excluded from the default `pnpm -r test`. Run with:
 *   DATABASE_URL=postgres://... pnpm --filter @wasla/channel-postgres test:integration
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Pool } from "pg";

import { IMPLEMENTED_CHANNEL } from "@wasla/contracts-channel";

import {
  exponentialBackoffPolicy,
  FakeIdentityBootstrap,
  FakeUpdateParser,
  FixedClock,
  InMemoryDeliveryStore,
  InMemoryOutbox,
  InMemoryProcessedUpdateStore,
  MockChannelAdapter,
  receiveUpdate,
  retryDueDeliveries,
  sendMessage,
  SequentialIdGenerator,
  type DeliveryStorePort,
  type InboundDeps,
  type MockSendOutcome,
  type OutboundDeps,
  type OutboxPort,
  type ProcessedUpdateStorePort,
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

/** The three ports MR 5 replaces, plus the event trail for assertions. */
interface StoreSet {
  readonly processedUpdates: ProcessedUpdateStorePort;
  readonly deliveries: DeliveryStorePort;
  readonly outbox: OutboxPort;
  eventTypes(): Promise<string[]>;
}

function inMemorySet(): StoreSet {
  const outbox = new InMemoryOutbox();
  return {
    processedUpdates: new InMemoryProcessedUpdateStore(),
    deliveries: new InMemoryDeliveryStore(),
    outbox,
    eventTypes: async () => outbox.types(),
  };
}

function postgresSet(db: ChannelDb): StoreSet {
  const outbox = new PostgresChannelOutbox(db);
  return {
    processedUpdates: new PostgresProcessedUpdateStore(db),
    deliveries: new PostgresDeliveryStore(db),
    outbox,
    eventTypes: async () =>
      (await outbox.unpublished()).map((event) => event.event_type),
  };
}

/** One fully wired core, deterministic clock and ids included. */
function wire(stores: StoreSet, script: MockSendOutcome[] = [{ ok: true }]) {
  const clock = new FixedClock();
  const ids = new SequentialIdGenerator();
  const channel = new MockChannelAdapter(script);

  const inbound: InboundDeps = {
    parser: new FakeUpdateParser(),
    processedUpdates: stores.processedUpdates,
    outbox: stores.outbox,
    identity: new FakeIdentityBootstrap(),
    clock,
    ids,
  };

  const outbound: OutboundDeps = {
    channel,
    deliveries: stores.deliveries,
    outbox: stores.outbox,
    retry: exponentialBackoffPolicy(),
    clock,
    ids,
  };

  return { clock, channel, inbound, outbound, stores };
}

type Wired = ReturnType<typeof wire>;

const startUpdate = {
  channel: CHANNEL,
  bot: "customer" as const,
  channelUpdateId: "2001",
  chatRef: "chat-9",
  kind: "command" as const,
  command: "start",
  actor: { channelUserRef: "user-9", locale: "ar" },
  receivedAt: "2026-08-20T12:00:00.000Z",
};

const message = {
  channel: CHANNEL,
  chatRef: "chat-9",
  kind: "text_with_buttons" as const,
  text: "طلبك جاهز",
  idempotencyKey: "conformance-key",
  buttons: [
    { type: "mini_app" as const, label: "افتح", miniApp: "customer" as const, path: "/orders" },
  ],
};

describe.skipIf(!ENABLED)("Postgres adapters conform to the ports", () => {
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

  /** Run one scenario on both adapter sets and expect identical observations. */
  async function bothAdapters<T>(
    script: MockSendOutcome[],
    scenario: (wired: Wired) => Promise<T>,
  ): Promise<{ memory: T; postgres: T }> {
    const memory = await scenario(wire(inMemorySet(), script));
    await truncateChannelTables(pool);
    const postgres = await scenario(wire(postgresSet(db), script));
    return { memory, postgres };
  }

  it("accepts an update once, then reports the replay as duplicate", async () => {
    const { memory, postgres } = await bothAdapters([{ ok: true }], async ({ inbound, stores }) => {
      const first = await receiveUpdate(inbound, { bot: "customer", raw: startUpdate });
      const replay = await receiveUpdate(inbound, { bot: "customer", raw: startUpdate });
      return {
        statuses: [first.status, replay.status],
        events: await stores.eventTypes(),
      };
    });

    expect(postgres).toEqual(memory);
    expect(postgres.statuses).toEqual(["accepted", "duplicate"]);
    expect(postgres.events).toEqual(["channel.update.received"]);
  });

  it("sends a message once and emits delivered + mini_app.launched", async () => {
    const { memory, postgres } = await bothAdapters(
      [{ ok: true }],
      async ({ outbound, stores, channel }) => {
        const outcome = await sendMessage(outbound, { message, bot: "customer" });
        return {
          status: outcome.status,
          attempts: outcome.attempts,
          sentTexts: channel.sent.map((dispatch) => dispatch.text),
          events: await stores.eventTypes(),
        };
      },
    );

    expect(postgres).toEqual(memory);
    expect(postgres).toMatchObject({ status: "sent", attempts: 1, sentTexts: ["طلبك جاهز"] });
    expect(postgres.events).toEqual([
      "channel.message.delivered",
      "channel.mini_app.launched",
    ]);
  });

  it("reports a repeated idempotency key as duplicate without sending twice", async () => {
    const { memory, postgres } = await bothAdapters(
      [{ ok: true }],
      async ({ outbound, channel }) => {
        const first = await sendMessage(outbound, { message, bot: "customer" });
        const second = await sendMessage(outbound, { message, bot: "customer" });
        return {
          statuses: [first.status, second.status],
          sameDelivery: first.deliveryId === second.deliveryId,
          sends: channel.sent.length,
        };
      },
    );

    expect(postgres).toEqual(memory);
    expect(postgres).toMatchObject({
      statuses: ["sent", "duplicate"],
      sameDelivery: true,
      sends: 1,
    });
  });

  it("re-queues a retryable failure, then re-sends the same message on the sweep", async () => {
    const { memory, postgres } = await bothAdapters(
      [{ ok: false, errorCode: "CHANNEL_TRANSPORT_ERROR" }, { ok: true }],
      async ({ outbound, clock, channel, stores }) => {
        const first = await sendMessage(outbound, { message, bot: "customer" });

        // Nothing is due before the backoff elapses.
        const early = await retryDueDeliveries(outbound);
        clock.advance(1_000);
        const sweep = await retryDueDeliveries(outbound);

        return {
          firstStatus: first.status,
          earlyAttempted: early.attempted,
          sweep: { attempted: sweep.attempted, sent: sweep.sent, failed: sweep.failed },
          finalStatus: sweep.outcomes[0]?.status,
          attempts: sweep.outcomes[0]?.attempts,
          // The retry must re-send *the same* body and key, never a new message.
          idempotencyKeys: channel.sent.map((dispatch) => dispatch.idempotencyKey),
          texts: channel.sent.map((dispatch) => dispatch.text),
          events: await stores.eventTypes(),
        };
      },
    );

    expect(postgres).toEqual(memory);
    expect(postgres).toMatchObject({
      firstStatus: "queued",
      earlyAttempted: 0,
      sweep: { attempted: 1, sent: 1, failed: 0 },
      finalStatus: "sent",
      attempts: 2,
      idempotencyKeys: ["conformance-key", "conformance-key"],
    });
  });

  it("fails terminally on a non-retryable error and emits failed once", async () => {
    const { memory, postgres } = await bothAdapters(
      [{ ok: false, errorCode: "CHANNEL_CHAT_UNREACHABLE" }],
      async ({ outbound, stores }) => {
        const outcome = await sendMessage(outbound, { message, bot: "customer" });
        const sweep = await retryDueDeliveries(outbound);
        return {
          status: outcome.status,
          errorCode: outcome.errorCode,
          sweptAgain: sweep.attempted,
          events: await stores.eventTypes(),
        };
      },
    );

    expect(postgres).toEqual(memory);
    expect(postgres).toMatchObject({
      status: "failed",
      errorCode: "CHANNEL_CHAT_UNREACHABLE",
      sweptAgain: 0,
    });
    expect(postgres.events).toEqual(["channel.message.failed"]);
  });

  it("survives a restart: the queue and the de-duplication set outlive the process", async () => {
    // The whole reason MR 5 exists. In-memory loses both; Postgres must not, so
    // this case is asserted only against the durable adapters.
    const first = wire(postgresSet(db), [
      { ok: false, errorCode: "CHANNEL_RATE_LIMITED", retryAfterSeconds: 1 },
    ]);
    await receiveUpdate(first.inbound, { bot: "customer", raw: startUpdate });
    const queued = await sendMessage(first.outbound, { message, bot: "customer" });
    expect(queued.status).toBe("queued");

    // A brand-new set of adapters over the same database = a restarted bot.
    const restarted = wire(postgresSet(db), [{ ok: true }]);
    restarted.clock.advance(5_000);

    const replay = await receiveUpdate(restarted.inbound, { bot: "customer", raw: startUpdate });
    expect(replay.status).toBe("duplicate");

    const sweep = await retryDueDeliveries(restarted.outbound);
    expect(sweep).toMatchObject({ attempted: 1, sent: 1 });
    expect(restarted.channel.sent[0]).toMatchObject({
      idempotencyKey: "conformance-key",
      text: "طلبك جاهز",
    });
    expect(sweep.outcomes[0]).toMatchObject({ deliveryId: queued.deliveryId, attempts: 2 });
  });
});
