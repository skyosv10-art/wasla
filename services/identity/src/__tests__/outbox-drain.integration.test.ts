/**
 * اختبارُ تكاملِ تصريفِ صندوقِ صادرِ الهوية (ADR-042 · موجة 2).
 *
 * يُثبتُ نمطَ ADR-042 على PostgreSQL حقيقيّة لخدمة الهوية.
 * الاختلافُ عن موجة 1: `identity_outbox` بلا `aggregate_type` و`aggregate_id`
 * من نوع UUID. المحوّلُ يُرجعُ `"identity"` كقيمةٍ ثابتة و`aggregateId` كنصٍّ.
 *
 * Local run:
 *   DATABASE_URL=postgres://wasla:wasla@127.0.0.1:5432/wasla_identity_test \
 *     pnpm --filter @wasla/identity-service test:integration
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";

import { createDb } from "../infrastructure/drizzle/db.js";
import { IdentityOutboxDrainStore } from "../outbox/identity-outbox-store.js";
import {
  createDirectOutboxDrainRunner,
  drainOutbox,
  type EventSinkPort,
  type OutboxRecord,
} from "@wasla/outbox";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = Boolean(DATABASE_URL);
const SCHEMA_SQL_PATH = resolve(process.cwd(), "contracts/schema.sql");

const TEST_AGGREGATE_UUID = "11111111-1111-4111-8111-111111111111";
const TEST_AGGREGATE_UUID_2 = "22222222-2222-4222-8222-222222222222";
const TEST_AGGREGATE_UUID_3 = "33333333-3333-4333-8333-333333333333";
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

describe.skipIf(!ENABLED)("IdentityOutboxDrainStore integration", () => {
  let pool: Pool;
  let db: ReturnType<typeof createDb>["db"];

  beforeAll(() => {
    const { pool: p, db: d } = createDb({
      connectionString: DATABASE_URL!,
      max: 4,
    });
    pool = p;
    db = d;
  });

  beforeEach(async () => {
    await pool.query(`DROP TABLE IF EXISTS identity_outbox CASCADE`);
    const schemaSql = await readFile(SCHEMA_SQL_PATH, "utf-8");
    await pool.query(schemaSql);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("claims, delivers, and marks published", async () => {
    await pool.query(
      `INSERT INTO identity_outbox (event_id, event_type, event_version, aggregate_id, payload)
       VALUES ($1, 'identity.user_created', 'v1', $2, '{"name":"test"}'::jsonb)`,
      [TEST_EVENT_ID, TEST_AGGREGATE_UUID],
    );

    const sink = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    const result = await db.transaction(async (tx) => {
      const store = new IdentityOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, sink, { limit: 10, clock });
    });

    expect(result.claimed).toBe(1);
    expect(result.published).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(sink.delivered).toHaveLength(1);
    expect(sink.delivered[0].aggregateType).toBe("identity");
    expect(sink.delivered[0].aggregateId).toBe(TEST_AGGREGATE_UUID);
    expect(sink.delivered[0].eventId).toBe(TEST_EVENT_ID);

    const rows = await pool.query(
      `SELECT published_at FROM identity_outbox WHERE event_id = $1`,
      [TEST_EVENT_ID],
    );
    expect(rows.rows[0].published_at).not.toBeNull();
  });

  it("does not stop on delivery failure", async () => {
    const uuids = [TEST_AGGREGATE_UUID, TEST_AGGREGATE_UUID_2, TEST_AGGREGATE_UUID_3];
    const events = [TEST_EVENT_ID, TEST_EVENT_ID_2, TEST_EVENT_ID_3];
    for (const [i, eventId] of events.entries()) {
      await pool.query(
        `INSERT INTO identity_outbox (event_id, event_type, event_version, aggregate_id, payload)
         VALUES ($1, 'identity.event', 'v1', $2, '{}'::jsonb)`,
        [eventId, uuids[i]],
      );
    }

    const failId = String(
      (await pool.query(`SELECT id FROM identity_outbox WHERE event_id = $1`, [TEST_EVENT_ID_2])).rows[0].id,
    );

    const sink = new RecordingSink([failId]);
    const clock = { now: () => new Date().toISOString() };

    const result = await db.transaction(async (tx) => {
      const store = new IdentityOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, sink, { limit: 10, clock });
    });

    expect(result.claimed).toBe(3);
    expect(result.published).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe(failId);
  });

  it("detects already-published rows", async () => {
    await pool.query(
      `INSERT INTO identity_outbox (event_id, event_type, event_version, aggregate_id, payload, published_at)
       VALUES ($1, 'identity.event', 'v1', $2, '{}'::jsonb, now())`,
      [TEST_EVENT_ID, TEST_AGGREGATE_UUID],
    );

    const sink = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    const result = await db.transaction(async (tx) => {
      const store = new IdentityOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, sink, { limit: 10, clock });
    });

    expect(result.claimed).toBe(0);
    expect(result.published).toBe(0);
    expect(sink.delivered).toHaveLength(0);
  });

  it("respects SKIP LOCKED — two drains do not overlap", async () => {
    const uuids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ];
    for (let i = 0; i < 5; i++) {
      await pool.query(
        `INSERT INTO identity_outbox (event_id, event_type, event_version, aggregate_id, payload)
         VALUES ($1, 'identity.event', 'v1', $2, '{}'::jsonb)`,
        [`dddddddd-dddd-4ddd-8ddd-dddddddddd0${i}`, uuids[i]],
      );
    }

    const sink1 = new RecordingSink();
    const sink2 = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    const [r1, r2] = await Promise.all([
      db.transaction(async (tx) => {
        const store = new IdentityOutboxDrainStore(tx);
        const runner = createDirectOutboxDrainRunner(store);
        return drainOutbox(runner, sink1, { limit: 3, clock });
      }),
      db.transaction(async (tx) => {
        const store = new IdentityOutboxDrainStore(tx);
        const runner = createDirectOutboxDrainRunner(store);
        return drainOutbox(runner, sink2, { limit: 3, clock });
      }),
    ]);

    expect(r1.published + r2.published).toBe(5);
    expect(r1.claimed + r2.claimed).toBe(5);
    expect(sink1.delivered.length + sink2.delivered.length).toBe(5);
  });
});
