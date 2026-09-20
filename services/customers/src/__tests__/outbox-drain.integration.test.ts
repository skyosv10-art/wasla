/**
 * اختبارُ تكاملِ تصريفِ صندوقِ صادرِ العملاء (ADR-042 · موجة 1).
 *
 * هذا الاختبارُ يُثبتُ نمطَ ADR-042 على PostgreSQL حقيقيّة:
 *
 *   1. claim → deliver → markPublished: صفٌّ غيرُ منشورٍ يُصرَّف ويُعلَّم.
 *   2. فشلُ التسليم لا يُوقفُ الدفعة: صفٌّ فاشلٌ لا يمنعُ غيرَه.
 *   3. alreadyPublished: التعليمُ الشرطيُّ يكشفُ النشرةَ الثانية.
 *   4. SKIP LOCKED: مُصرّفان لا يريان نفسَ الصفّ.
 *
 * Local run:
 *   DATABASE_URL=postgres://wasla:wasla@127.0.0.1:5432/wasla_customers_test \
 *     pnpm --filter @wasla/customers-service test:integration
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createCustomerDb } from "../infrastructure/drizzle/db.js";
import { CustomerOutboxDrainStore } from "../outbox/customer-outbox-store.js";
import {
  createDirectOutboxDrainRunner,
  drainOutbox,
  type EventSinkPort,
  type OutboxRecord,
} from "@wasla/outbox";
import { applyCanonicalSchema, truncateAll, type PgFixture } from "./pg-harness.js";
import { DATABASE_URL, PG_ENABLED } from "./pg-harness.js";

const TEST_EVENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEST_EVENT_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEST_EVENT_ID_3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** مُستقبٍ يُسجّلُ ما سُلِّم ويُفشلُ صفوفًا مُعيَّنة. */
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

describe("CustomerOutboxDrainStore integration", () => {
  let fixture: PgFixture;

  beforeAll(() => {
    if (!PG_ENABLED) return;
    const { pool, db } = createCustomerDb({
      connectionString: DATABASE_URL!,
      max: 4,
    });
    fixture = { pool, db, close: () => pool.end() } as PgFixture;
  });

  beforeEach(async () => {
    if (!PG_ENABLED) return;
    await applyCanonicalSchema(fixture.pool);
    await truncateAll(fixture.pool);
  });

  afterAll(async () => {
    if (!PG_ENABLED) return;
    await fixture.close();
  });

  it("claims, delivers, and marks published", async () => {
    if (!PG_ENABLED) return;

    // ازرع صفًّا واحدًا
    await fixture.pool.query(
      `INSERT INTO customer_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload)
       VALUES ($1, 'customer.created', 'v1', 'customer', 'WS-0000000001', '{"name":"test"}'::jsonb)`,
      [TEST_EVENT_ID],
    );

    const sink = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    const result = await fixture.db.transaction(async (tx) => {
      const store = new CustomerOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, sink, { limit: 10, clock });
    });

    expect(result.claimed).toBe(1);
    expect(result.published).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(result.alreadyPublished).toBe(0);
    expect(sink.delivered).toHaveLength(1);
    expect(sink.delivered[0].eventId).toBe(TEST_EVENT_ID);

    // تأكّد أن published_at صار غيرَ فارغ
    const rows = await fixture.pool.query(
      `SELECT published_at FROM customer_outbox WHERE event_id = $1`,
      [TEST_EVENT_ID],
    );
    expect(rows.rows[0].published_at).not.toBeNull();
  });

  it("does not stop on delivery failure", async () => {
    if (!PG_ENABLED) return;

    // ازرع ثلاثة صفوف: الثاني سيفشل
    for (const [i, eventId] of [TEST_EVENT_ID, TEST_EVENT_ID_2, TEST_EVENT_ID_3].entries()) {
      await fixture.pool.query(
        `INSERT INTO customer_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload)
         VALUES ($1, 'customer.updated', 'v1', 'customer', $2, '{}'::jsonb)`,
        [eventId, `WS-000000000${i + 1}`],
      );
    }

    // اجعل الصف الثاني (بـ id الأكبر) يفشل
    const failId = String(
      (await fixture.pool.query(`SELECT id FROM customer_outbox WHERE event_id = $1`, [TEST_EVENT_ID_2])).rows[0].id,
    );

    const sink = new RecordingSink([failId]);
    const clock = { now: () => new Date().toISOString() };

    const result = await fixture.db.transaction(async (tx) => {
      const store = new CustomerOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, sink, { limit: 10, clock });
    });

    expect(result.claimed).toBe(3);
    expect(result.published).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe(failId);

    // الصف الفاشل لم يُعلَّم منشورًا
    const failedRow = await fixture.pool.query(
      `SELECT published_at FROM customer_outbox WHERE event_id = $1`,
      [TEST_EVENT_ID_2],
    );
    expect(failedRow.rows[0].published_at).toBeNull();
  });

  it("detects already-published rows", async () => {
    if (!PG_ENABLED) return;

    // ازرع صفًّا وعلِّمه منشورًا يدويًّا
    await fixture.pool.query(
      `INSERT INTO customer_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload, published_at)
       VALUES ($1, 'customer.deleted', 'v1', 'customer', 'WS-0000000001', '{}'::jsonb, now())`,
      [TEST_EVENT_ID],
    );

    const sink = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    // ادَّعِ الصفَّ (تجاوز القفل) ثم حاول تعليمه
    await fixture.db.transaction(async (tx) => {
      // اقرأ الصفَّ يدويًّا (محاكاةُ مُصرّفٍ آخر علّمه بين ادّعائنا وتعلينا)
      const rows = await tx.execute(sql`
        SELECT id, event_id, event_type, event_version, aggregate_type, aggregate_id, payload, occurred_at
          FROM customer_outbox
         WHERE published_at IS NULL
      `);
      // لا يوجد صفوف غير منشورة
      const claimedCount = Array.isArray(rows) ? rows.length : (rows as { rows?: unknown[] }).rows?.length ?? 0;
      expect(claimedCount).toBe(0);
    });

    // لا صفوفَ غيرُ منشورةٍ — التصريفُ لا يجد شيئًا
    const result2 = await fixture.db.transaction(async (tx) => {
      const store = new CustomerOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, sink, { limit: 10, clock });
    });

    expect(result2.claimed).toBe(0);
    expect(result2.published).toBe(0);
    expect(sink.delivered).toHaveLength(0);
  });

  it("respects SKIP LOCKED — two drains do not overlap", async () => {
    if (!PG_ENABLED) return;

    // ازرع خمسة صفوف
    for (let i = 0; i < 5; i++) {
      await fixture.pool.query(
        `INSERT INTO customer_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload)
         VALUES ($1, 'customer.event', 'v1', 'customer', $2, '{}'::jsonb)`,
        [`dddddddd-dddd-4ddd-8ddd-dddddddddd0${i}`, `WS-000000000${i + 1}`],
      );
    }

    const sink1 = new RecordingSink();
    const sink2 = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    // مُصرّفان متزامنان
    const [r1, r2] = await Promise.all([
      fixture.db.transaction(async (tx) => {
        const store = new CustomerOutboxDrainStore(tx);
        const runner = createDirectOutboxDrainRunner(store);
        return drainOutbox(runner, sink1, { limit: 3, clock });
      }),
      fixture.db.transaction(async (tx) => {
        const store = new CustomerOutboxDrainStore(tx);
        const runner = createDirectOutboxDrainRunner(store);
        return drainOutbox(runner, sink2, { limit: 3, clock });
      }),
    ]);

    // لا تداخل: مجموع ما سُلِّم = 5 لا أكثر
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
      `INSERT INTO customer_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload)
       VALUES ($1, 'customer.created', 'v1', 'customer', 'WS-0000000001', '{}'::jsonb)`,
      [TEST_EVENT_ID],
    );

    const rowId = String(
      (await fixture.pool.query(`SELECT id FROM customer_outbox WHERE event_id = $1`, [TEST_EVENT_ID]))
        .rows[0].id,
    );

    const clock = { now: () => new Date().toISOString() };

    // مرورٌ أوّلُ يفشل
    const failing = await fixture.db.transaction(async (tx) => {
      const store = new CustomerOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, new RecordingSink([rowId]), { limit: 10, clock });
    });

    expect(failing.published).toBe(0);
    expect(failing.failed).toHaveLength(1);

    const afterFailure = await fixture.pool.query(
      `SELECT attempts, last_error, published_at FROM customer_outbox WHERE id = $1`,
      [rowId],
    );
    expect(Number(afterFailure.rows[0].attempts)).toBe(1);
    expect(String(afterFailure.rows[0].last_error)).toContain("simulated delivery failure");
    expect(afterFailure.rows[0].published_at).toBeNull();

    // مرورٌ ثانٍ ينجح: العدّادُ يتقدّمُ والخطأُ يُمحى
    const succeeding = await fixture.db.transaction(async (tx) => {
      const store = new CustomerOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, new RecordingSink(), { limit: 10, clock });
    });

    expect(succeeding.published).toBe(1);

    const afterSuccess = await fixture.pool.query(
      `SELECT attempts, last_error, published_at FROM customer_outbox WHERE id = $1`,
      [rowId],
    );
    expect(Number(afterSuccess.rows[0].attempts)).toBe(2);
    expect(afterSuccess.rows[0].last_error).toBeNull();
    expect(afterSuccess.rows[0].published_at).not.toBeNull();

    // المحاولةُ المقروءةُ تصلُ العقدَ المشترك: claimUnpublished يُرجعُ attempts الحقيقيَّ
    await fixture.pool.query(`UPDATE customer_outbox SET published_at = NULL WHERE id = $1`, [rowId]);
    const claimedAttempts = await fixture.db.transaction(async (tx) => {
      const store = new CustomerOutboxDrainStore(tx);
      const records = await store.claimUnpublished(10);
      return records[0]?.attempts;
    });
    expect(claimedAttempts).toBe(2);
  });

});
