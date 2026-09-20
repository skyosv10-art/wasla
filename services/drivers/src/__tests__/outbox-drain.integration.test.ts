/**
 * اختبارُ تكاملِ تصريفِ صندوقِ صادرِ السائقين (ADR-042 · موجة 2).
 *
 * يُثبتُ نمطَ ADR-042 على PostgreSQL حقيقيّة لخدمة السائقين.
 * نفسُ سيناريوهات موجة 1: claim→deliver→markPublished، فشلٌ لا يُوقفُ الدفعة،
 * alreadyPublished، SKIP LOCKED.
 *
 * Local run:
 *   DATABASE_URL=postgres://wasla:wasla@127.0.0.1:5432/wasla_drivers_test \
 *     pnpm --filter @wasla/drivers-service test:integration
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";

import { createDriverDb } from "../infrastructure/drizzle/db.js";
import { DriverOutboxDrainStore } from "../outbox/driver-outbox-store.js";
import {
  createDirectOutboxDrainRunner,
  drainOutbox,
  type EventSinkPort,
  type OutboxRecord,
} from "@wasla/outbox";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = Boolean(DATABASE_URL);
const SCHEMA_SQL_PATH = resolve(process.cwd(), "contracts/schema.sql");

const DRIVER_OUTBOX_TABLES = "driver_outbox";

function applySchema(pool: Pool) {
  return pool.query(`DROP TABLE IF EXISTS ${DRIVER_OUTBOX_TABLES} CASCADE`);
}

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

describe.skipIf(!ENABLED)("DriverOutboxDrainStore integration", () => {
  let pool: Pool;
  let db: ReturnType<typeof createDriverDb>["db"];

  beforeAll(() => {
    const { pool: p, db: d } = createDriverDb({
      connectionString: DATABASE_URL!,
      max: 4,
    });
    pool = p;
    db = d;
  });

  beforeEach(async () => {
    await applySchema(pool);
    const schemaSql = await readFile(SCHEMA_SQL_PATH, "utf-8");
    await pool.query(schemaSql);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("claims, delivers, and marks published", async () => {
    await pool.query(
      `INSERT INTO driver_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload)
       VALUES ($1, 'driver.created', 'v1', 'driver', 'WS-DRV-001', '{"name":"test"}'::jsonb)`,
      [TEST_EVENT_ID],
    );

    const sink = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    const result = await db.transaction(async (tx) => {
      const store = new DriverOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, sink, { limit: 10, clock });
    });

    expect(result.claimed).toBe(1);
    expect(result.published).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(sink.delivered).toHaveLength(1);
    expect(sink.delivered[0].eventId).toBe(TEST_EVENT_ID);

    const rows = await pool.query(
      `SELECT published_at FROM driver_outbox WHERE event_id = $1`,
      [TEST_EVENT_ID],
    );
    expect(rows.rows[0].published_at).not.toBeNull();
  });

  it("does not stop on delivery failure", async () => {
    for (const [i, eventId] of [TEST_EVENT_ID, TEST_EVENT_ID_2, TEST_EVENT_ID_3].entries()) {
      await pool.query(
        `INSERT INTO driver_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload)
         VALUES ($1, 'driver.updated', 'v1', 'driver', $2, '{}'::jsonb)`,
        [eventId, `WS-DRV-${i + 1}`],
      );
    }

    const failId = String(
      (await pool.query(`SELECT id FROM driver_outbox WHERE event_id = $1`, [TEST_EVENT_ID_2])).rows[0].id,
    );

    const sink = new RecordingSink([failId]);
    const clock = { now: () => new Date().toISOString() };

    const result = await db.transaction(async (tx) => {
      const store = new DriverOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, sink, { limit: 10, clock });
    });

    expect(result.claimed).toBe(3);
    expect(result.published).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe(failId);

    const failedRow = await pool.query(
      `SELECT published_at FROM driver_outbox WHERE event_id = $1`,
      [TEST_EVENT_ID_2],
    );
    expect(failedRow.rows[0].published_at).toBeNull();
  });

  it("detects already-published rows", async () => {
    await pool.query(
      `INSERT INTO driver_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload, published_at)
       VALUES ($1, 'driver.deleted', 'v1', 'driver', 'WS-DRV-001', '{}'::jsonb, now())`,
      [TEST_EVENT_ID],
    );

    const sink = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    const result = await db.transaction(async (tx) => {
      const store = new DriverOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, sink, { limit: 10, clock });
    });

    expect(result.claimed).toBe(0);
    expect(result.published).toBe(0);
    expect(sink.delivered).toHaveLength(0);
  });

  it("respects SKIP LOCKED — two drains do not overlap", async () => {
    for (let i = 0; i < 5; i++) {
      await pool.query(
        `INSERT INTO driver_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload)
         VALUES ($1, 'driver.event', 'v1', 'driver', $2, '{}'::jsonb)`,
        [`dddddddd-dddd-4ddd-8ddd-dddddddddd0${i}`, `WS-DRV-${i + 1}`],
      );
    }

    const sink1 = new RecordingSink();
    const sink2 = new RecordingSink();
    const clock = { now: () => new Date().toISOString() };

    const [r1, r2] = await Promise.all([
      db.transaction(async (tx) => {
        const store = new DriverOutboxDrainStore(tx);
        const runner = createDirectOutboxDrainRunner(store);
        return drainOutbox(runner, sink1, { limit: 3, clock });
      }),
      db.transaction(async (tx) => {
        const store = new DriverOutboxDrainStore(tx);
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
    if (!ENABLED) return;

    await pool.query(
      `INSERT INTO driver_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload)
       VALUES ($1, 'driver.created', 'v1', 'driver', 'WS-DRV-001', '{}'::jsonb)`,
      [TEST_EVENT_ID],
    );

    const rowId = String(
      (await pool.query(`SELECT id FROM driver_outbox WHERE event_id = $1`, [TEST_EVENT_ID]))
        .rows[0].id,
    );

    const clock = { now: () => new Date().toISOString() };

    // مرورٌ أوّلُ يفشل
    const failing = await db.transaction(async (tx) => {
      const store = new DriverOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, new RecordingSink([rowId]), { limit: 10, clock });
    });

    expect(failing.published).toBe(0);
    expect(failing.failed).toHaveLength(1);

    const afterFailure = await pool.query(
      `SELECT attempts, last_error, published_at FROM driver_outbox WHERE id = $1`,
      [rowId],
    );
    expect(Number(afterFailure.rows[0].attempts)).toBe(1);
    expect(String(afterFailure.rows[0].last_error)).toContain("simulated delivery failure");
    expect(afterFailure.rows[0].published_at).toBeNull();

    // مرورٌ ثانٍ ينجح: العدّادُ يتقدّمُ والخطأُ يُمحى
    const succeeding = await db.transaction(async (tx) => {
      const store = new DriverOutboxDrainStore(tx);
      const runner = createDirectOutboxDrainRunner(store);
      return drainOutbox(runner, new RecordingSink(), { limit: 10, clock });
    });

    expect(succeeding.published).toBe(1);

    const afterSuccess = await pool.query(
      `SELECT attempts, last_error, published_at FROM driver_outbox WHERE id = $1`,
      [rowId],
    );
    expect(Number(afterSuccess.rows[0].attempts)).toBe(2);
    expect(afterSuccess.rows[0].last_error).toBeNull();
    expect(afterSuccess.rows[0].published_at).not.toBeNull();

    // المحاولةُ المقروءةُ تصلُ العقدَ المشترك: claimUnpublished يُرجعُ attempts الحقيقيَّ
    await pool.query(`UPDATE driver_outbox SET published_at = NULL WHERE id = $1`, [rowId]);
    const claimedAttempts = await db.transaction(async (tx) => {
      const store = new DriverOutboxDrainStore(tx);
      const records = await store.claimUnpublished(10);
      return records[0]?.attempts;
    });
    expect(claimedAttempts).toBe(2);
  });

  // ── G4 (CLM-0250): trace_id يُقرأ من الصف ويصل العقد المشترك ────────────────
  it("reads trace_id from the row into OutboxRecord (G4)", async () => {
    if (!ENABLED) return;

    const TRACE = "trace-driver-g4-0001";
    await pool.query(
      `INSERT INTO driver_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload, trace_id)
       VALUES ($1, 'driver.registered', 'v1', 'driver', 'WS-DRI-0001', '{}'::jsonb, $2)`,
      [TEST_EVENT_ID, TRACE],
    );

    const claimed = await db.transaction(async (tx) => {
      const store = new DriverOutboxDrainStore(tx);
      return store.claimUnpublished(10);
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0].traceId).toBe(TRACE);
  });

  it("returns null trace_id when the column is null (G4)", async () => {
    if (!ENABLED) return;

    await pool.query(
      `INSERT INTO driver_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload)
       VALUES ($1, 'driver.registered', 'v1', 'driver', 'WS-DRI-0002', '{}'::jsonb)`,
      [TEST_EVENT_ID_2],
    );

    const claimed = await db.transaction(async (tx) => {
      const store = new DriverOutboxDrainStore(tx);
      return store.claimUnpublished(10);
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0].traceId).toBeNull();
  });

});
