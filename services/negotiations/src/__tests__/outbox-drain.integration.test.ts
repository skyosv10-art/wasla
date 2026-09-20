/**
 * اختبارُ تكاملِ تصريفِ صندوقِ صادرِ المفاوضات (ADR-042 · موجة 3).
 *
 * أغنى جدولِ صادرٍ: يملكُ `attempts`/`last_error` (G3 مُغلقٌ) و`trace_id` (G4).
 * يُنفِّذُ `recordDeliveryFailure` فعليًّا. الاختلافُ: `id` هو UUID.
 *
 * Local run:
 *   DATABASE_URL=postgres://wasla:wasla@127.0.0.1:5432/wasla_negotiations_test \
 *     pnpm --filter @wasla/negotiations-service test:integration
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createNegotiationDb } from "../infrastructure/drizzle/db.js";
import { NegotiationOutboxDrainStore } from "../outbox/negotiation-outbox-store.js";
import {
  createDirectOutboxDrainRunner,
  drainOutbox,
  type EventSinkPort,
  type OutboxRecord,
} from "@wasla/outbox";
import {
  DATABASE_URL,
  PG_ENABLED,
  setupPostgres,
  resetData,
  type PgFixture,
} from "./pg-harness.js";

const TEST_EVENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEST_EVENT_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEST_EVENT_ID_3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

class RecordingSink implements EventSinkPort {
  readonly delivered: OutboxRecord[] = [];
  private readonly failIds: Set<string>;

  constructor(failIds: string[] = []) {
    this.failIds = new Set(failIds);
  }

  async deliver(record: OutboxRecord): Promise<void> {
    if (this.failIds.has(record.id)) {
      throw new Error(`simulated delivery failure for ${record.id}`);
    }
    this.delivered.push(record);
  }
}

describe.skipIf(!PG_ENABLED)("NegotiationOutboxDrainStore integration", () => {
  let fixture: PgFixture;

  beforeAll(async () => {
    fixture = await setupPostgres();
  });

  beforeEach(async () => {
    await resetData(fixture.pool);
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("claims, delivers, and marks published", async () => {
    await fixture.pool.query(
      `INSERT INTO negotiation_outbox (id, aggregate_type, aggregate_id, event_type, event_version, payload)
       VALUES ($1::uuid, 'negotiation_thread', 'NT-001', 'negotiation.started', 'v1', '{"status":"started"}'::jsonb)`,
      [TEST_EVENT_ID],
    );

    const sink = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    const result = await fixture.db.transaction(async (tx) => {
      const store = new NegotiationOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, sink, { limit: 10, clock });
    });

    expect(result.claimed).toBe(1);
    expect(result.published).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(sink.delivered).toHaveLength(1);
    expect(sink.delivered[0].eventId).toBe(TEST_EVENT_ID);

    const rows = await fixture.pool.query(
      `SELECT published_at FROM negotiation_outbox WHERE id = $1::uuid`,
      [TEST_EVENT_ID],
    );
    expect(rows.rows[0].published_at).not.toBeNull();
  });

  it("does not stop on delivery failure and records attempts", async () => {
    for (const [i, eventId] of [TEST_EVENT_ID, TEST_EVENT_ID_2, TEST_EVENT_ID_3].entries()) {
      await fixture.pool.query(
        `INSERT INTO negotiation_outbox (id, aggregate_type, aggregate_id, event_type, event_version, payload)
         VALUES ($1::uuid, 'negotiation_thread', $2, 'negotiation.event', 'v1', '{}'::jsonb)`,
        [eventId, `NT-${i + 1}`],
      );
    }

    const failId = TEST_EVENT_ID_2;

    const sink = new RecordingSink([failId]);
    const clock = { now: () => new Date().toISOString() };

    const result = await fixture.db.transaction(async (tx) => {
      const store = new NegotiationOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, sink, { limit: 10, clock });
    });

    expect(result.claimed).toBe(3);
    expect(result.published).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe(failId);

    // The failed row should have attempts=1 and last_error set
    const failedRow = await fixture.pool.query(
      `SELECT attempts, last_error FROM negotiation_outbox WHERE id = $1::uuid`,
      [TEST_EVENT_ID_2],
    );
    expect(failedRow.rows[0].attempts).toBe(1);
    expect(failedRow.rows[0].last_error).not.toBeNull();
  });

  it("detects already-published rows", async () => {
    await fixture.pool.query(
      `INSERT INTO negotiation_outbox (id, aggregate_type, aggregate_id, event_type, event_version, payload, published_at)
       VALUES ($1::uuid, 'negotiation_thread', 'NT-001', 'negotiation.event', 'v1', '{}'::jsonb, now())`,
      [TEST_EVENT_ID],
    );

    const sink = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    const result = await fixture.db.transaction(async (tx) => {
      const store = new NegotiationOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, sink, { limit: 10, clock });
    });

    expect(result.claimed).toBe(0);
    expect(result.published).toBe(0);
    expect(sink.delivered).toHaveLength(0);
  });

  it("respects SKIP LOCKED — two drains do not overlap", async () => {
    for (let i = 0; i < 5; i++) {
      await fixture.pool.query(
        `INSERT INTO negotiation_outbox (id, aggregate_type, aggregate_id, event_type, event_version, payload)
         VALUES ($1::uuid, 'negotiation_thread', $2, 'negotiation.event', 'v1', '{}'::jsonb)`,
        [`dddddddd-dddd-4ddd-8ddd-dddddddddd0${i}`, `NT-${i + 1}`],
      );
    }

    const sink1 = new RecordingSink();
    const sink2 = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    const [r1, r2] = await Promise.all([
      fixture.db.transaction(async (tx) => {
        const store = new NegotiationOutboxDrainStore(tx);
        const runner = createDirectOutboxDrainRunner(store);
        return drainOutbox(runner, sink1, { limit: 3, clock });
      }),
      fixture.db.transaction(async (tx) => {
        const store = new NegotiationOutboxDrainStore(tx);
        const runner = createDirectOutboxDrainRunner(store);
        return drainOutbox(runner, sink2, { limit: 3, clock });
      }),
    ]);

    expect(r1.published + r2.published).toBe(5);
    expect(r1.claimed + r2.claimed).toBe(5);
    expect(sink1.delivered.length + sink2.delivered.length).toBe(5);
  });
});
