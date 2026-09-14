/**
 * إعادةُ صفٍّ مسمومٍ — على قاعدةٍ حقيقيّةٍ (المراجعةُ 22/N · `M5-13R` · §4.24).
 *
 * ما تُثبِتُهُ هذه الاختباراتُ ولا يستطيعُ بديلُ ذاكرةٍ إثباتَهُ:
 *
 *   • **الحركتانِ تقعانِ معاً أو لا تقعُ واحدةٌ.** رفعُ الصفِّ وإرجاعُ نقطةِ
 *     التقدُّمِ في معاملةٍ واحدةٍ — وهذا لا يُقاسُ إلّا على محرِّكٍ لهُ معاملاتٌ.
 *   • **الجدولُ الصحيحُ لكلِّ دفترٍ.** خطأٌ في الربطِ يُرجِعُ نقطةَ المُرحِّلِ
 *     الآخرِ، وبديلٌ في الذاكرةِ لا يمسُّ الربطَ أصلاً.
 *   • **الدليلُ لا يُمحى.** `attempt_count` و`last_error` يبقيانِ كما كانا بعدَ
 *     الإعادةِ — الدعوى على **عمودَينِ في القاعدةِ** لا على نيّةٍ في تعليقٍ.
 *   • **الرفضُ لا يكتبُ شيئاً.** بصمةُ الجدولَينِ ونقطتا التقدُّمِ لا تتغيّرُ
 *     بنداءٍ مرفوضٍ.
 *   • **الإعادةُ تُغيِّرُ مقياسَ §4.23 فعلاً**: الصفُّ يخرجُ من عدِّ المسمومِ
 *     لأنَّهُ لم يعُدْ مسموماً — وهذا هوَ الرابطُ بينَ العينِ واليدِ.
 *
 * يُتخطّى حينَ لا `DATABASE_URL` (docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import {
  PG_ENABLED,
  resetData,
  seedDispatchEvent,
  seedTask,
  setupPostgres,
  type PgFixture,
} from "./pg-harness.js";
import { DEFAULT_RELAY_CONFIG, runRelayBatch, type RelayDeps } from "../relay.js";
import { PostgresDispatchEventSource } from "../infrastructure/dispatch-event-source.js";
import { PostgresTaskMirrorStore } from "../infrastructure/task-mirror-store.js";
import { PostgresRelayRequeueStore } from "../infrastructure/relay-requeue-store.js";
import { PostgresRelayConsumerLock } from "../infrastructure/relay-advisory-lock.js";
import { PostgresRelayDeadLetterStore } from "../infrastructure/relay-dead-letter-store.js";

const T0 = "2026-09-14T00:00:00.000Z";
const ZERO_ISO = new Date(0).toISOString();
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const DISPATCH_CONSUMER = "delivery-dispatch-relay-v1";
const INVENTORY_CONSUMER = "delivery-marketplace-inventory-relay-v1";

let fixture: PgFixture;

interface SeedRow {
  eventId: string;
  status: string;
  attemptCount?: number;
  lastError?: string | null;
}

async function seedDispatch(pool: Pool, row: SeedRow): Promise<void> {
  await pool.query(
    `INSERT INTO delivery_relay_consumed_events
       (event_id, event_type, aggregate_type, aggregate_id, consumed_status,
        attempt_count, last_error, consumed_at, updated_at)
     VALUES ($1::uuid, 'dispatch.job_completed', 'dispatch_job', 'job-agg-1', $2, $3, $4,
             $5::timestamptz, $5::timestamptz)`,
    [row.eventId, row.status, row.attemptCount ?? 6, row.lastError ?? null, T0],
  );
}

async function seedInventory(pool: Pool, row: SeedRow): Promise<void> {
  await pool.query(
    `INSERT INTO delivery_inventory_relay_consumed_events
       (event_id, event_type, aggregate_type, aggregate_id, consumed_status,
        attempt_count, last_error, consumed_at, updated_at)
     VALUES ($1::uuid, 'marketplace.inventory_adjusted', 'inventory',
             'cccccccc-0000-0000-0000-000000000003', $2, $3, $4,
             $5::timestamptz, $5::timestamptz)`,
    [row.eventId, row.status, row.attemptCount ?? 6, row.lastError ?? null, T0],
  );
}

async function seedCheckpoint(pool: Pool, table: string, consumerId: string): Promise<void> {
  await pool.query(
    `INSERT INTO ${table} (consumer_id, last_occurred_at, last_event_id, updated_at)
          VALUES ($1, $2::timestamptz, $3::uuid, now())
     ON CONFLICT (consumer_id) DO UPDATE
          SET last_occurred_at = EXCLUDED.last_occurred_at,
              last_event_id = EXCLUDED.last_event_id`,
    [consumerId, "2026-09-14T12:00:00.000Z", uuid(999)],
  );
}

async function readCheckpoint(
  pool: Pool,
  table: string,
  consumerId: string,
): Promise<{ occurredAt: string; eventId: string } | null> {
  const res = await pool.query<{ last_occurred_at: Date; last_event_id: string }>(
    `SELECT last_occurred_at, last_event_id FROM ${table} WHERE consumer_id = $1`,
    [consumerId],
  );
  if (res.rowCount === 0) return null;
  const row = res.rows[0]!;
  return { occurredAt: row.last_occurred_at.toISOString(), eventId: row.last_event_id };
}

/**
 * بصمةُ كلِّ ما يمسُّهُ المسارُ: الدفترانِ بحالاتِهما ومحاولاتِهما وأخطائِهما،
 * ونقطتا التقدُّمِ. وعدُّ الصفوفِ وحدَهُ كانَ سيَبتلِعُ تعديلَ حالةٍ في موضعِها —
 * وهوَ بالضبطِ العطبُ الذي يُخشى هنا.
 */
async function fingerprint(pool: Pool): Promise<string> {
  const res = await pool.query<{ fingerprint: string }>(
    `SELECT coalesce(string_agg(line, '|' ORDER BY line), '∅') AS fingerprint
       FROM (
         SELECT 'd:' || event_id::text || ':' || consumed_status || ':' ||
                attempt_count::text || ':' || coalesce(last_error, '∅') AS line
           FROM delivery_relay_consumed_events
         UNION ALL
         SELECT 'i:' || event_id::text || ':' || consumed_status || ':' ||
                attempt_count::text || ':' || coalesce(last_error, '∅') AS line
           FROM delivery_inventory_relay_consumed_events
         UNION ALL
         SELECT 'cd:' || consumer_id || ':' || last_occurred_at::text || ':' || last_event_id::text AS line
           FROM delivery_relay_checkpoint
         UNION ALL
         SELECT 'ci:' || consumer_id || ':' || last_occurred_at::text || ':' || last_event_id::text AS line
           FROM delivery_inventory_relay_checkpoint
       ) rows`,
  );
  return res.rows[0]!.fingerprint;
}

describe.skipIf(!PG_ENABLED)("PostgresRelayRequeueStore — على قاعدةٍ حقيقيّةٍ", () => {
  beforeEach(async () => {
    fixture = await setupPostgres();
    await resetData(fixture.pool);
  });

  afterEach(async () => {
    await fixture.close();
  });

  /* ══════════════════════════════════════════════════════════════════════
   * 1) الطريقُ السعيدُ — الحركتانِ معاً
   * ══════════════════════════════════════════════════════════════════════ */

  it("مسمومٌ في دفترِ التوزيعِ: يُرفَعُ إلى pending، وتُرجَعُ نقطتُهُ إلى الصفرِ", async () => {
    const pool = fixture.pool;
    const store = new PostgresRelayRequeueStore(pool);
    await seedDispatch(pool, { eventId: uuid(1), status: "poisoned", lastError: "unmappable" });
    await seedCheckpoint(pool, "delivery_relay_checkpoint", DISPATCH_CONSUMER);

    const effect = await store.requeuePoisonedEventWithEffect({
      ledger: "dispatch",
      eventId: uuid(1),
    });

    expect(effect.decision).toEqual({ outcome: "requeued", previousStatus: "poisoned" });
    expect(effect.consumerId).toBe(DISPATCH_CONSUMER);
    expect(effect.rewoundTo).toEqual({ lastOccurredAt: ZERO_ISO, lastEventId: ZERO_UUID });

    const row = await pool.query<{ consumed_status: string }>(
      `SELECT consumed_status FROM delivery_relay_consumed_events WHERE event_id = $1::uuid`,
      [uuid(1)],
    );
    expect(row.rows[0]!.consumed_status).toBe("pending");

    const checkpoint = await readCheckpoint(pool, "delivery_relay_checkpoint", DISPATCH_CONSUMER);
    expect(checkpoint).toEqual({ occurredAt: ZERO_ISO, eventId: ZERO_UUID });
  });

  /*
   * **الدفترُ الثاني ليسَ نسخةً**: خطأٌ في الربطِ كانَ سيُرجِعُ نقطةَ مُرحِّلِ
   * التوزيعِ بدلَ مُرحِّلِ المخزونِ — ويمرُّ سليمَ الشكلِ في كلِّ بديلِ ذاكرةٍ.
   * فالدعوى هنا: **نقطةُ الجارِ لم تُمَسَّ.**
   */
  it("مسمومٌ في دفترِ مخزونِ السوقِ: نقطتُهُ وحدَها تُرجَعُ، ونقطةُ الجارِ لا تُمَسُّ", async () => {
    const pool = fixture.pool;
    const store = new PostgresRelayRequeueStore(pool);
    await seedInventory(pool, { eventId: uuid(2), status: "poisoned" });
    await seedCheckpoint(pool, "delivery_relay_checkpoint", DISPATCH_CONSUMER);
    await seedCheckpoint(pool, "delivery_inventory_relay_checkpoint", INVENTORY_CONSUMER);

    const effect = await store.requeuePoisonedEventWithEffect({
      ledger: "marketplace_inventory",
      eventId: uuid(2),
    });

    expect(effect.decision.outcome).toBe("requeued");
    expect(effect.consumerId).toBe(INVENTORY_CONSUMER);

    expect(
      await readCheckpoint(pool, "delivery_inventory_relay_checkpoint", INVENTORY_CONSUMER),
    ).toEqual({ occurredAt: ZERO_ISO, eventId: ZERO_UUID });
    expect(await readCheckpoint(pool, "delivery_relay_checkpoint", DISPATCH_CONSUMER)).toEqual({
      occurredAt: "2026-09-14T12:00:00.000Z",
      eventId: uuid(999),
    });
  });

  it("لا نقطةَ تقدُّمٍ أصلاً ⇒ تُنشَأُ على الصفرِ، ولا يُجابُ «أُعيدَ» بلا إرجاعٍ", async () => {
    // مُرحِّلٌ لم يُشغَّلْ قطُّ لا صفَّ لهُ. و`UPDATE` وحدَهُ كانَ سيُصيبُ صفراً
    // من الصفوفِ صامتاً، فيُقرأُ الجوابُ `requeued` وما أُرجِعَ شيءٌ.
    const pool = fixture.pool;
    const store = new PostgresRelayRequeueStore(pool);
    await seedDispatch(pool, { eventId: uuid(3), status: "poisoned" });

    const effect = await store.requeuePoisonedEventWithEffect({
      ledger: "dispatch",
      eventId: uuid(3),
    });

    expect(effect.rewoundTo).toEqual({ lastOccurredAt: ZERO_ISO, lastEventId: ZERO_UUID });
    expect(await readCheckpoint(pool, "delivery_relay_checkpoint", DISPATCH_CONSUMER)).toEqual({
      occurredAt: ZERO_ISO,
      eventId: ZERO_UUID,
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
   * 2) الدليلُ لا يُمحى
   * ══════════════════════════════════════════════════════════════════════ */

  /**
   * **أهمُّ دعوى في الملفِّ.** الدفترُ لا يحفظُ تاريخاً، فـ`last_error` و
   * `attempt_count` هُما الأثرُ الوحيدُ على **لِمَ** سُمَّ الصفُّ. ومسحُهما عندَ
   * الإعادةِ كانَ يجعلُ كلَّ محاولةِ إنقاذٍ تمحو سببَ العطبِ، فيُعادُ الصفُّ
   * مرّتَينِ ولا أحدَ يعرِفُ ما الذي فشلَ أوّلاً.
   */
  it("الإعادةُ لا تمحو `last_error` ولا تُصفِّرُ `attempt_count`", async () => {
    const pool = fixture.pool;
    const store = new PostgresRelayRequeueStore(pool);
    await seedDispatch(pool, {
      eventId: uuid(4),
      status: "poisoned",
      attemptCount: 6,
      lastError: "unsupported event_version: v2",
    });

    await store.requeuePoisonedEvent({ ledger: "dispatch", eventId: uuid(4) });

    const row = await pool.query<{
      consumed_status: string;
      attempt_count: number;
      last_error: string | null;
    }>(
      `SELECT consumed_status, attempt_count, last_error
         FROM delivery_relay_consumed_events WHERE event_id = $1::uuid`,
      [uuid(4)],
    );
    expect(row.rows[0]).toEqual({
      consumed_status: "pending",
      attempt_count: 6,
      last_error: "unsupported event_version: v2",
    });
  });

  it("`updated_at` يتقدَّمُ — فمقياسُ §4.23 يقرأُ عمرَ الفقدِ لا عمرَ أوّلِ محاولةٍ", async () => {
    const pool = fixture.pool;
    const store = new PostgresRelayRequeueStore(pool);
    await seedDispatch(pool, { eventId: uuid(5), status: "poisoned" });

    await store.requeuePoisonedEvent({ ledger: "dispatch", eventId: uuid(5) });

    const row = await pool.query<{ consumed_at: Date; updated_at: Date }>(
      `SELECT consumed_at, updated_at FROM delivery_relay_consumed_events WHERE event_id = $1::uuid`,
      [uuid(5)],
    );
    expect(row.rows[0]!.updated_at.getTime()).toBeGreaterThan(
      row.rows[0]!.consumed_at.getTime(),
    );
  });

  /* ══════════════════════════════════════════════════════════════════════
   * 3) الرفضُ لا يكتبُ شيئاً
   * ══════════════════════════════════════════════════════════════════════ */

  it("مُعرِّفٌ لا صفَّ لهُ ⇒ `not_found`، ولا بايتَ يتغيّرُ", async () => {
    const pool = fixture.pool;
    const store = new PostgresRelayRequeueStore(pool);
    await seedDispatch(pool, { eventId: uuid(6), status: "poisoned" });
    await seedCheckpoint(pool, "delivery_relay_checkpoint", DISPATCH_CONSUMER);
    const before = await fingerprint(pool);

    const decision = await store.requeuePoisonedEvent({ ledger: "dispatch", eventId: uuid(777) });

    expect(decision).toEqual({ outcome: "rejected", reason: "not_found", observedStatus: null });
    expect(await fingerprint(pool)).toBe(before);
  });

  it.each([["applied"], ["pending"], ["ignored_foreign"], ["skipped_stale"]])(
    "صفٌّ حالتُهُ «%s» ⇒ `not_poisoned` بالحالةِ المقروءةِ، ولا بايتَ يتغيّرُ",
    async (status) => {
      const pool = fixture.pool;
      const store = new PostgresRelayRequeueStore(pool);
      await seedDispatch(pool, { eventId: uuid(7), status });
      await seedCheckpoint(pool, "delivery_relay_checkpoint", DISPATCH_CONSUMER);
      const before = await fingerprint(pool);

      const decision = await store.requeuePoisonedEvent({ ledger: "dispatch", eventId: uuid(7) });

      expect(decision).toEqual({
        outcome: "rejected",
        reason: "not_poisoned",
        observedStatus: status,
      });
      expect(await fingerprint(pool)).toBe(before);
    },
  );

  /*
   * **الصفُّ في الدفترِ الآخرِ ليسَ موجوداً في هذا الدفترِ.** والدعوى تُثبِتُ أنَّ
   * الربطَ يُسألُ الجدولَ الصحيحَ: لو خلطَ المُحوِّلُ الجدولَينِ لأجابَ
   * `requeued` هنا — وهوَ أسوأُ من خطأٍ، لأنَّهُ يُعيدُ صفّاً لم يُطلَبْ.
   */
  it("مُعرِّفٌ مسمومٌ في دفترِ المخزونِ لا يُعادُ من بابِ دفترِ التوزيعِ", async () => {
    const pool = fixture.pool;
    const store = new PostgresRelayRequeueStore(pool);
    await seedInventory(pool, { eventId: uuid(8), status: "poisoned" });
    const before = await fingerprint(pool);

    const decision = await store.requeuePoisonedEvent({ ledger: "dispatch", eventId: uuid(8) });

    expect(decision.outcome).toBe("rejected");
    expect(await fingerprint(pool)).toBe(before);
  });

  /* ══════════════════════════════════════════════════════════════════════
   * 4) التماثُليّةُ والرابطُ بالمقياسِ
   * ══════════════════════════════════════════════════════════════════════ */

  it("نداءٌ ثانٍ على الصفِّ نفسِهِ يُرَدُّ `not_poisoned` — لا أثرَ مُضاعَفٌ", async () => {
    const pool = fixture.pool;
    const store = new PostgresRelayRequeueStore(pool);
    await seedDispatch(pool, { eventId: uuid(9), status: "poisoned" });

    const first = await store.requeuePoisonedEvent({ ledger: "dispatch", eventId: uuid(9) });
    const afterFirst = await fingerprint(pool);
    const second = await store.requeuePoisonedEvent({ ledger: "dispatch", eventId: uuid(9) });

    expect(first.outcome).toBe("requeued");
    expect(second).toEqual({
      outcome: "rejected",
      reason: "not_poisoned",
      observedStatus: "pending",
    });
    expect(await fingerprint(pool)).toBe(afterFirst);
  });

  /* ══════════════════════════════════════════════════════════════════════
   * 5) الدعوى الأخيرةُ — **هل يُعادُ الحدثُ فعلاً؟**
   * ══════════════════════════════════════════════════════════════════════ */

  /**
   * **هذا هوَ الاختبارُ الذي يُسقِطُ المسارَ كلَّهُ لو كانَ وهماً.**
   *
   * كلُّ ما سبقَ يقيسُ أعمدةً؛ وهذا يقيسُ **الأثرَ**: هل يقرأُ المُرحِّلُ الصفَّ
   * ويُطبِّقُهُ بعدَ الإعادةِ؟ والترتيبُ مقصودٌ:
   *
   *   • نُشغِّلُ دفعةً **قبلَ** الإعادةِ ونُثبِتُ أنَّها **صفرٌ** — فلولا ذلكَ
   *     لكانَ «طُبِّقَ بعدَها» قد يكونُ تطبيقاً كانَ سيقعُ بلا إعادةٍ أصلاً،
   *     والاختبارُ يُصادِقُ على لا شيءٍ.
   *   • والحاجزانِ اللذانِ يمنعانِ القراءةَ منصوبانِ كلاهُما: الصفُّ نهائيٌّ
   *     (`poisoned` ⇒ `relay.ts` الخطوةُ 1 تُلاشيهِ)، ونقطةُ التقدُّمِ **تجاوزَتْهُ**
   *     (⇒ المصدرُ لا يُعيدُهُ أصلاً). ورفعُ واحدٍ دونَ الآخرِ لا يكفي — وهذا
   *     بالضبطِ سببُ كونِ الحركتَينِ معاً في معاملةٍ واحدةٍ.
   */
  it("الحدثُ المُعادُ يُقرأُ ويُطبَّقُ فعلاً — بعدَ أن كانت الدفعةُ صفراً", async () => {
    const pool = fixture.pool;
    const { taskId } = await seedTask(pool, { dispatchJobRef: "job-agg-1" });
    const eventId = await seedDispatchEvent(pool, {
      event_type: "dispatch.offer_accepted",
      aggregate_id: "job-agg-1",
      occurred_at: "2026-09-14T10:00:00.000Z",
      payload: {
        job_id: "job-agg-1",
        driver_public_id: "WS-0000000123",
        accepted_at: "2026-09-14T10:00:00.000Z",
      },
    });

    // الحاجزُ الأوّلُ: حكمٌ نهائيٌّ بالسمِّ على هذا الحدثِ بعينِهِ.
    await pool.query(
      `INSERT INTO delivery_relay_consumed_events
         (event_id, event_type, aggregate_type, aggregate_id, consumed_status,
          attempt_count, last_error, consumed_at, updated_at)
       VALUES ($1::uuid, 'dispatch.offer_accepted', 'dispatch_job', 'job-agg-1',
               'poisoned', 6, 'transient downstream outage', now(), now())`,
      [eventId],
    );
    // الحاجزُ الثاني: نقطةُ التقدُّمِ تجاوزَت زمنَهُ.
    await pool.query(
      `INSERT INTO delivery_relay_checkpoint (consumer_id, last_occurred_at, last_event_id, updated_at)
            VALUES ($1, $2::timestamptz, $3::uuid, now())
       ON CONFLICT (consumer_id) DO UPDATE SET last_occurred_at = EXCLUDED.last_occurred_at,
                                               last_event_id = EXCLUDED.last_event_id`,
      [DEFAULT_RELAY_CONFIG.consumerId, "2026-09-14T23:00:00.000Z", uuid(998)],
    );

    const deps = (): RelayDeps => ({
      events: new PostgresDispatchEventSource(pool),
      store: new PostgresTaskMirrorStore(pool),
      lock: new PostgresRelayConsumerLock(pool),
      config: { ...DEFAULT_RELAY_CONFIG, batchSize: 10 },
    });

    const beforeBatch = await runRelayBatch(deps());
    expect(beforeBatch.applied).toBe(0);
    const stateBefore = await pool.query<{ state: string }>(
      `SELECT state FROM delivery_tasks WHERE task_id = $1::uuid`,
      [taskId],
    );
    expect(stateBefore.rows[0]!.state).toBe("dispatch_requested");

    await new PostgresRelayRequeueStore(pool).requeuePoisonedEvent({
      ledger: "dispatch",
      eventId,
    });

    const afterBatch = await runRelayBatch(deps());

    expect(afterBatch.applied).toBe(1);
    const stateAfter = await pool.query<{ state: string; courier_ref: string }>(
      `SELECT state, courier_ref FROM delivery_tasks WHERE task_id = $1::uuid`,
      [taskId],
    );
    expect(stateAfter.rows[0]).toMatchObject({
      state: "driver_assigned",
      courier_ref: "WS-0000000123",
    });
    // والحكمُ النهائيُّ صارَ `applied`: الصفُّ خرجَ من الفقدِ إلى الأثرِ.
    const verdict = await pool.query<{ consumed_status: string }>(
      `SELECT consumed_status FROM delivery_relay_consumed_events WHERE event_id = $1::uuid`,
      [eventId],
    );
    expect(verdict.rows[0]!.consumed_status).toBe("applied");
  });

  /**
   * **الرابطُ بينَ العينِ واليدِ، مقيساً لا مُدَّعىً.** مقياسُ §4.23 يُسألُ قبلَ
   * الإعادةِ وبعدَها بالمُحوِّلِ **نفسِهِ** الذي يقرأُهُ المُشغِّلُ — فالدعوى
   * ليست «الحالةُ تغيّرَت في عمودٍ» بل «الفقدُ اختفى من اللوحةِ التي يُنبَّهُ
   * عليها».
   */
  it("بعدَ الإعادةِ يخرجُ الصفُّ من عدِّ المسمومِ في مقياسِ §4.23", async () => {
    const pool = fixture.pool;
    const requeue = new PostgresRelayRequeueStore(pool);
    const metrics = new PostgresRelayDeadLetterStore(pool);
    await seedDispatch(pool, { eventId: uuid(10), status: "poisoned" });
    await seedDispatch(pool, { eventId: uuid(11), status: "poisoned" });

    const before = await metrics.readRelayDeadLetters({ eventTypeLimit: 10 });
    expect(before.totalPoisoned).toBe(2);

    await requeue.requeuePoisonedEvent({ ledger: "dispatch", eventId: uuid(10) });

    const after = await metrics.readRelayDeadLetters({ eventTypeLimit: 10 });
    expect(after.totalPoisoned).toBe(1);
  });
});
