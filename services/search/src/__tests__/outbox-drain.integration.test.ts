/**
 * اختبارُ تكاملِ تصريفِ صندوقِ صادرِ البحث (ADR-042 · موجة 3).
 *
 * مثلُ `geo_outbox`: بلا `aggregate_type`. 4 اختبارات على PostgreSQL.
 *
 * Local run:
 *   DATABASE_URL=postgres://wasla:wasla@127.0.0.1:5432/wasla_search_test \
 *     pnpm --filter @wasla/search-service test:integration
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { SearchOutboxDrainStore } from "../outbox/search-outbox-store.js";
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

describe.skipIf(!PG_ENABLED)("SearchOutboxDrainStore integration", () => {
  let fixture: PgFixture;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    fixture = await setupPostgres();
    db = drizzle(fixture.pool);
  });

  beforeEach(async () => {
    await resetData(fixture.pool);
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("claims, delivers, and marks published", async () => {
    await fixture.pool.query(
      `INSERT INTO search_outbox (event_id, event_type, event_version, aggregate_id, payload)
       VALUES ($1, 'search.index_built', 'v1', 'IDX-001', '{"status":"built"}'::jsonb)`,
      [TEST_EVENT_ID],
    );

    const sink = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    const result = await db.transaction(async (tx) => {
      const store = new SearchOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, sink, { limit: 10, clock });
    });

    expect(result.claimed).toBe(1);
    expect(result.published).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(sink.delivered).toHaveLength(1);
    expect(sink.delivered[0].aggregateType).toBe("search");
    expect(sink.delivered[0].eventId).toBe(TEST_EVENT_ID);

    const rows = await fixture.pool.query(
      `SELECT published_at FROM search_outbox WHERE event_id = $1`,
      [TEST_EVENT_ID],
    );
    expect(rows.rows[0].published_at).not.toBeNull();
  });

  it("does not stop on delivery failure", async () => {
    for (const [i, eventId] of [TEST_EVENT_ID, TEST_EVENT_ID_2, TEST_EVENT_ID_3].entries()) {
      await fixture.pool.query(
        `INSERT INTO search_outbox (event_id, event_type, event_version, aggregate_id, payload)
         VALUES ($1, 'search.event', 'v1', $2, '{}'::jsonb)`,
        [eventId, `IDX-${i + 1}`],
      );
    }

    const failId = String(
      (await fixture.pool.query(`SELECT id FROM search_outbox WHERE event_id = $1`, [TEST_EVENT_ID_2])).rows[0].id,
    );

    const sink = new RecordingSink([failId]);
    const clock = { now: () => new Date().toISOString() };

    const result = await db.transaction(async (tx) => {
      const store = new SearchOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, sink, { limit: 10, clock });
    });

    expect(result.claimed).toBe(3);
    expect(result.published).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe(failId);
  });

  it("detects already-published rows", async () => {
    await fixture.pool.query(
      `INSERT INTO search_outbox (event_id, event_type, event_version, aggregate_id, payload, published_at)
       VALUES ($1, 'search.event', 'v1', 'IDX-001', '{}'::jsonb, now())`,
      [TEST_EVENT_ID],
    );

    const sink = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    const result = await db.transaction(async (tx) => {
      const store = new SearchOutboxDrainStore(tx);
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
        `INSERT INTO search_outbox (event_id, event_type, event_version, aggregate_id, payload)
         VALUES ($1, 'search.event', 'v1', $2, '{}'::jsonb)`,
        [`dddddddd-dddd-4ddd-8ddd-dddddddddd0${i}`, `IDX-${i + 1}`],
      );
    }

    const sink1 = new RecordingSink();
    const sink2 = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    const [r1, r2] = await Promise.all([
      db.transaction(async (tx) => {
        const store = new SearchOutboxDrainStore(tx);
        const runner = createDirectOutboxDrainRunner(store);
        return drainOutbox(runner, sink1, { limit: 3, clock });
      }),
      db.transaction(async (tx) => {
        const store = new SearchOutboxDrainStore(tx);
        const runner = createDirectOutboxDrainRunner(store);
        return drainOutbox(runner, sink2, { limit: 3, clock });
      }),
    ]);

    expect(r1.published + r2.published).toBe(5);
    expect(r1.claimed + r2.claimed).toBe(5);
    expect(sink1.delivered.length + sink2.delivered.length).toBe(5);
  });
});
