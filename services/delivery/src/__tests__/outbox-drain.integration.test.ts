/**
 * اختبارُ تكاملِ تصريفِ صندوقِ صادرِ التوصيل (ADR-042 · موجة 3).
 *
 * الاختلافُ عن موجة 1: `delivery_outbox` يملكُ `outbox_id` لا `id`،
 * ويملكُ `trace_id` (G4 مُغلقٌ هنا). 4 اختبارات على PostgreSQL.
 *
 * Local run:
 *   DATABASE_URL=postgres://wasla:wasla@127.0.0.1:5432/wasla_delivery_test \
 *     pnpm --filter @wasla/delivery-service test:integration
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DeliveryOutboxDrainStore } from "../outbox/delivery-outbox-store.js";
import {
  createDirectOutboxDrainRunner,
  drainOutbox,
  type EventSinkPort,
  type OutboxRecord,
} from "@wasla/outbox";
import {
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

describe.skipIf(!PG_ENABLED)("DeliveryOutboxDrainStore integration", () => {
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
      `INSERT INTO delivery_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload)
       VALUES ($1, 'delivery.task_created', 'v1', 'delivery_task', 'DT-001', '{"status":"created"}'::jsonb)`,
      [TEST_EVENT_ID],
    );

    const sink = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    const result = await db.transaction(async (tx) => {
      const store = new DeliveryOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, sink, { limit: 10, clock });
    });

    expect(result.claimed).toBe(1);
    expect(result.published).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(sink.delivered).toHaveLength(1);
    expect(sink.delivered[0].eventId).toBe(TEST_EVENT_ID);

    const rows = await fixture.pool.query(
      `SELECT published_at FROM delivery_outbox WHERE event_id = $1`,
      [TEST_EVENT_ID],
    );
    expect(rows.rows[0].published_at).not.toBeNull();
  });

  it("does not stop on delivery failure", async () => {
    for (const [i, eventId] of [TEST_EVENT_ID, TEST_EVENT_ID_2, TEST_EVENT_ID_3].entries()) {
      await fixture.pool.query(
        `INSERT INTO delivery_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload)
         VALUES ($1, 'delivery.event', 'v1', 'delivery_task', $2, '{}'::jsonb)`,
        [eventId, `DT-${i + 1}`],
      );
    }

    const failId = String(
      (await fixture.pool.query(`SELECT outbox_id FROM delivery_outbox WHERE event_id = $1`, [TEST_EVENT_ID_2])).rows[0].outbox_id,
    );

    const sink = new RecordingSink([failId]);
    const clock = { now: () => new Date().toISOString() };

    const result = await db.transaction(async (tx) => {
      const store = new DeliveryOutboxDrainStore(tx);
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
      `INSERT INTO delivery_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload, published_at)
       VALUES ($1, 'delivery.event', 'v1', 'delivery_task', 'DT-001', '{}'::jsonb, now())`,
      [TEST_EVENT_ID],
    );

    const sink = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    const result = await db.transaction(async (tx) => {
      const store = new DeliveryOutboxDrainStore(tx);
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
        `INSERT INTO delivery_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload)
         VALUES ($1, 'delivery.event', 'v1', 'delivery_task', $2, '{}'::jsonb)`,
        [`dddddddd-dddd-4ddd-8ddd-dddddddddd0${i}`, `DT-${i + 1}`],
      );
    }

    const sink1 = new RecordingSink();
    const sink2 = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    const [r1, r2] = await Promise.all([
      db.transaction(async (tx) => {
        const store = new DeliveryOutboxDrainStore(tx);
        const runner = createDirectOutboxDrainRunner(store);
        return drainOutbox(runner, sink1, { limit: 3, clock });
      }),
      db.transaction(async (tx) => {
        const store = new DeliveryOutboxDrainStore(tx);
        const runner = createDirectOutboxDrainRunner(store);
        return drainOutbox(runner, sink2, { limit: 3, clock });
      }),
    ]);

    expect(r1.published + r2.published).toBe(5);
    expect(r1.claimed + r2.claimed).toBe(5);
    expect(sink1.delivered.length + sink2.delivered.length).toBe(5);
  });

  // ── G3 (CLM-0245): تسجيلُ الفشلِ في الصفِّ نفسِه ───────────────────────────
  //
  // قبلَ هذه الدفعةِ كان الفشلُ يبقى في الذاكرةِ (`DrainReport.failed`) ويُفقَدُ
  // بانتهاءِ العمليّة، فيبدو الحدثُ المسمومُ طازجًا في كلِّ مرورٍ. الآن
  // `attempts`/`last_error` عمودانِ في الجدولِ و`recordDeliveryFailure` مُنفَّذٌ.

  it("persists attempts and last_error on delivery failure (G3)", async () => {
    if (!PG_ENABLED) return;

    await fixture.pool.query(
      `INSERT INTO delivery_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload)
       VALUES ($1, 'delivery.task_created', 'v1', 'delivery_task', 'DT-001', '{}'::jsonb)`,
      [TEST_EVENT_ID],
    );

    const rowId = String(
      (await fixture.pool.query(`SELECT outbox_id FROM delivery_outbox WHERE event_id = $1`, [TEST_EVENT_ID]))
        .rows[0].outbox_id,
    );

    const clock = { now: () => new Date().toISOString() };

    // مرورٌ أوّلُ يفشل
    const failing = await db.transaction(async (tx) => {
      const store = new DeliveryOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, new RecordingSink([rowId]), { limit: 10, clock });
    });

    expect(failing.published).toBe(0);
    expect(failing.failed).toHaveLength(1);

    const afterFailure = await fixture.pool.query(
      `SELECT attempts, last_error, published_at FROM delivery_outbox WHERE outbox_id = $1`,
      [rowId],
    );
    expect(Number(afterFailure.rows[0].attempts)).toBe(1);
    expect(String(afterFailure.rows[0].last_error)).toContain("simulated delivery failure");
    expect(afterFailure.rows[0].published_at).toBeNull();

    // مرورٌ ثانٍ ينجح: العدّادُ يتقدّمُ والخطأُ يُمحى
    const succeeding = await db.transaction(async (tx) => {
      const store = new DeliveryOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, new RecordingSink(), { limit: 10, clock });
    });

    expect(succeeding.published).toBe(1);

    const afterSuccess = await fixture.pool.query(
      `SELECT attempts, last_error, published_at FROM delivery_outbox WHERE outbox_id = $1`,
      [rowId],
    );
    expect(Number(afterSuccess.rows[0].attempts)).toBe(2);
    expect(afterSuccess.rows[0].last_error).toBeNull();
    expect(afterSuccess.rows[0].published_at).not.toBeNull();

    // المحاولةُ المقروءةُ تصلُ العقدَ المشترك: claimUnpublished يُرجعُ attempts الحقيقيَّ
    await fixture.pool.query(`UPDATE delivery_outbox SET published_at = NULL WHERE outbox_id = $1`, [rowId]);
    const claimedAttempts = await db.transaction(async (tx) => {
      const store = new DeliveryOutboxDrainStore(tx);
      const records = await store.claimUnpublished(10);
      return records[0]?.attempts;
    });
    expect(claimedAttempts).toBe(2);
  });

});
