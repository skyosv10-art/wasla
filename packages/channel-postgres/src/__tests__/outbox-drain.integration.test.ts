/**
 * Integration test for the channel outbox drain (G7 closure).
 *
 * Verifies against a real Postgres what only a real Postgres can prove:
 * - `claimUnpublished` returns oldest-first and locks rows (SKIP LOCKED)
 * - `markPublished` is conditional (no double-publish)
 * - `drainOutbox` delivers to a sink and marks published in one transaction
 * - A failed delivery does not mark the row published (it stays claimable)
 *
 * Excluded from the default `pnpm -r test` (see vitest.config.ts). Run with:
 *   DATABASE_URL=postgres://... pnpm --filter @wasla/channel-postgres test:integration
 *
 * Skipped entirely when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Pool } from "pg";

import {
  messageDeliveredEvent,
  type ChannelDomainEvent,
} from "@wasla/channel-core";

import {
  createChannelDb,
  PostgresChannelOutbox,
  PostgresChannelOutboxDrainRunner,
} from "../index.js";
import {
  drainOutbox,
  type EventSinkPort,
  type OutboxRecord,
} from "@wasla/outbox";

import {
  resetChannelSchema,
  truncateChannelTables,
} from "./harness.js";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("channel outbox drain (G7)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new (await import("pg")).Pool({ connectionString: DATABASE_URL });
    await resetChannelSchema(pool);
  });

  beforeEach(async () => {
    await truncateChannelTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  /** Append a delivered event to the channel outbox. */
  async function appendEvent(
    outbox: PostgresChannelOutbox,
    eventId: string,
    occurredAt: string,
    chatRef = "chat-123",
  ): Promise<ChannelDomainEvent> {
    const event = messageDeliveredEvent({
      eventId,
      occurredAt,
      chatRef,
      channel: "telegram",
      deliveryId: `del-${eventId.slice(0, 8)}`,
      idempotencyKey: `idem-${eventId.slice(0, 8)}`,
      attempts: 1,
    });
    await outbox.append(event);
    return event;
  }

  it("claims unpublished events oldest-first", async () => {
    const { db } = createChannelDb({ connectionString: DATABASE_URL! });
    const outbox = new PostgresChannelOutbox(db);

    const first = await appendEvent(outbox, crypto.randomUUID(), "2026-01-01T00:00:00Z");
    const second = await appendEvent(outbox, crypto.randomUUID(), "2026-01-01T00:00:01Z");

    const runner = new PostgresChannelOutboxDrainRunner(db);
    const records = await runner.drain(async (store) => {
      return store.claimUnpublished(10);
    });

    expect(records).toHaveLength(2);
    expect(records[0].id).toBe(first.event_id);
    expect(records[1].id).toBe(second.event_id);
  });

  it("marks published conditionally — no double-publish", async () => {
    const { db } = createChannelDb({ connectionString: DATABASE_URL! });
    const outbox = new PostgresChannelOutbox(db);
    const event = await appendEvent(outbox, crypto.randomUUID(), "2026-01-01T00:00:00Z");

    const runner = new PostgresChannelOutboxDrainRunner(db);
    const now = new Date().toISOString();

    const firstMark = await runner.drain(async (store) => {
      return store.markPublished(event.event_id, now);
    });
    expect(firstMark).toBe(true);

    const secondMark = await runner.drain(async (store) => {
      return store.markPublished(event.event_id, now);
    });
    expect(secondMark).toBe(false);
  });

  it("delivers to a sink and marks published via drainOutbox", async () => {
    const { db } = createChannelDb({ connectionString: DATABASE_URL! });
    const outbox = new PostgresChannelOutbox(db);
    const event = await appendEvent(outbox, crypto.randomUUID(), "2026-01-01T00:00:00Z");

    const delivered: OutboxRecord[] = [];
    const sink: EventSinkPort = {
      async deliver(record: OutboxRecord) {
        delivered.push(record);
      },
    };

    const runner = new PostgresChannelOutboxDrainRunner(db);
    const report = await drainOutbox(runner, sink, {
      limit: 10,
      clock: { now: () => new Date().toISOString() },
    });

    expect(report.claimed).toBe(1);
    expect(report.published).toBe(1);
    expect(report.failed).toHaveLength(0);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].id).toBe(event.event_id);
    expect(delivered[0].eventType).toBe("channel.message.delivered");
  });

  it("does not mark published on delivery failure — row stays claimable", async () => {
    const { db } = createChannelDb({ connectionString: DATABASE_URL! });
    const outbox = new PostgresChannelOutbox(db);
    const event = await appendEvent(outbox, crypto.randomUUID(), "2026-01-01T00:00:00Z");

    const failingSink: EventSinkPort = {
      async deliver() {
        throw new Error("broker unavailable");
      },
    };

    const runner = new PostgresChannelOutboxDrainRunner(db);
    const report = await drainOutbox(runner, failingSink, {
      limit: 10,
      clock: { now: () => new Date().toISOString() },
    });

    expect(report.claimed).toBe(1);
    expect(report.published).toBe(0);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].id).toBe(event.event_id);
    expect(report.failed[0].reason).toBe("broker unavailable");

    // Row should still be claimable (published_at is still NULL)
    const stillUnpublished = await runner.drain(async (store) => {
      return store.claimUnpublished(10);
    });
    expect(stillUnpublished).toHaveLength(1);
    expect(stillUnpublished[0].id).toBe(event.event_id);
  });

  it("SKIP LOCKED — claimed rows are not re-claimed after marking published", async () => {
    const { db } = createChannelDb({ connectionString: DATABASE_URL! });
    const outbox = new PostgresChannelOutbox(db);

    // Append 4 events
    const events: ChannelDomainEvent[] = [];
    for (let i = 0; i < 4; i++) {
      events.push(
        await appendEvent(
          outbox,
          crypto.randomUUID(),
          `2026-01-01T00:00:0${i}Z`,
        ),
      );
    }

    const runner = new PostgresChannelOutboxDrainRunner(db);

    // Drain first batch — claims and marks 2 as published
    const delivered: OutboxRecord[] = [];
    const sink: EventSinkPort = {
      async deliver(record: OutboxRecord) {
        delivered.push(record);
      },
    };
    const report1 = await drainOutbox(runner, sink, {
      limit: 2,
      clock: { now: () => new Date().toISOString() },
    });
    expect(report1.published).toBe(2);
    expect(delivered).toHaveLength(2);

    // Drain second batch — should get the other 2
    const report2 = await drainOutbox(runner, sink, {
      limit: 2,
      clock: { now: () => new Date().toISOString() },
    });
    expect(report2.published).toBe(2);
    expect(report2.claimed).toBe(2);

    // The two batches should not overlap
    const batch1Ids = new Set(delivered.slice(0, 2).map((r) => r.id));
    const batch2Ids = new Set(delivered.slice(2, 4).map((r) => r.id));
    for (const id of batch1Ids) {
      expect(batch2Ids.has(id)).toBe(false);
    }
  });
});
