/**
 * قفلُ المُستهلِكِ الاستشاريُّ — البرهانُ التكامليُّ (M5-13R · §4.24-ب).
 *
 * مُقاسٌ لا مُتخيَّلٌ: كان الحدُّ المُعلَنُ في ROADMAP أنَّهُ لا قفلَ موزَّعاً —
 * «دفعةُ ترحيلٍ جاريةٌ قد تُقدِّمُ نقطةَ التقدُّمِ فوقَ الإرجاعِ بعدَ COMMIT
 * فتُبطِلَ الإعادةَ بصمتٍ». هذا الملفُ يُبرهِنُ على PostgreSQL ثلاث مراتٍ:
 *
 *   1. **الحجبُ المُباشرُ**: إعادةٌ تنتظرُ قفلًا يمتلكُهُ مستهلكٌ آخر — لا
 *      تلتزمُ حتى يُفرِجَ، ثمَّ تلتزمُ وتُرجِعُ النقطةَ فعلاً. والعكسُ صحيحٌ:
 *      دفعةٌ تنتظرُ قفلًا مُستأجَراً يدويّاً.
 *   2. **مفتاحانِ لدفترَينِ**: قفلُ مُستهلِكِ التوزيعِ لا يحجبُ إعادةً في دفترِ
 *      المخزونِ — `hashtext(consumerId)` يفصلُ بينَهما.
 *   3. **السباقُ المُصمَّمُ (البُرهانُ الحاسمُ)**: دفعةٌ **متوقِّفةٌ في منتصفِها**
 *      (قرأتِ النقطةَ القديمةَ ولم تكتبْ نقطتَها بعدُ) + إعادةٌ تبدأُ في هذه
 *      اللحظةِ. بلا قفلٍ: تلتزمُ الإعادةُ ثمَّ تكتبُ الدفعةُ نقطتَها فوقَها فيبقى
 *      الصفُّ السامُّ تحتَ نقطةٍ تجاوزتْهُ — **الإعادةُ وقعت وبَطَلَ أثرُها**.
 *      بالقفلِ: تنتظرُ الإعادةُ حتى تنتهيَ الدفعةُ، ثمَّ تلتزمُ، ثمَّ تقرأُ
 *      الدفعةُ التاليةُ الصفَّ المُعادَ وتُعالِجُهُ ثانيةً (محاولةٌ جديدةٌ
 *      مُسجَّلةٌ) بدلَ أن تُبتلِعَهُ النقطةُ إلى الأبدِ.
 *
 * ## الطفرتانِ المُعلَنتانِ — قِيسَتا أثناءَ التطويرِ وسُجِّلَتا (2026-09-15 · PostgreSQL 18.6 محليّاً)
 *
 *   - **إلغاءُ قفلِ المُستهلِكِ وحدهُ** (الدفعةُ خارجَ `withConsumerLock`
 *     والإعادةُ بقفلِها): اختبارُ (3) يفشلُ — الدفعةُ المتوقِّفةُ تكتبُ فوقَ
 *     الإرجاعِ، والدفعةُ الثالثةُ لا ترى الصفَّ السامَّ أبداً.
 *   - **إلغاءُ قفلِ الإعادةِ وحدهُ** (المُستهلِكُ بقفلِهِ والإعادةُ معاملةٌ
 *     عاريةٌ): اختبارُ (1) يفشلُ — الإعادةُ تلتزمُ تحتَ القفلِ المُستأجَرِ
 *     فيبطُلُ الحجبُ الذي يُثبِتُهُ الاختبارُ.
 *
 * أي أنَّ كِلا نصفَي الحارسِ **مطلوبانِ معاً** — ونصفٌ واحدٌ يتركُ النافذةَ
 * مفتوحةً من الجهةِ الأخرى، وهذا عينُ ما جعلَ الحقلَ إلزاميّاً في التبعيّاتِ
 * (نسيانُهُ خطأُ ترجمةٍ لا خضرةً صامتةً).
 */

import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { PG_ENABLED, resetData, seedDispatchEvent, seedTask, setupPostgres, T0 } from "./pg-harness.js";
import { PostgresRelayConsumerLock, relayAdvisoryLockKey } from "../infrastructure/relay-advisory-lock.js";
import { PostgresRelayRequeueStore } from "../infrastructure/relay-requeue-store.js";
import { PostgresDispatchEventSource } from "../infrastructure/dispatch-event-source.js";
import { PostgresTaskMirrorStore } from "../infrastructure/task-mirror-store.js";
import {
  DEFAULT_RELAY_CONFIG,
  runRelayBatch,
  type BatchOutcome,
  type RelayDeps,
  type RelayLogEntry,
} from "../relay.js";
import type { RelayRequeueDecision } from "../domain/relay-reprocess.js";
import { ZERO_CHECKPOINT, type DispatchOutboxRow, type RelayCheckpoint } from "../domain/consumed-events.js";
import type { DispatchEventSource } from "../ports.js";

const ts = (n: number) => new Date(Date.parse(T0) + n * 60_000).toISOString();

/** مفتاحُ القفلِ كما تحسبُهُ القاعدةُ — لحيازةٍ يدويّةٍ من جلسةٍ خامسةٍ. */
function lockArgs(consumerId: string): [number, string] {
  const [ns, key] = relayAdvisoryLockKey(consumerId);
  return [ns, key];
}

/** حيازةُ قفلِ جلسةٍ **يدويّاً** — نفسُ مفتاحِ المصدرِ الواحدِ لا نسخةً منهُ. */
async function withHeldSessionLock(pool: Pool, consumerId: string, fn: () => Promise<void>): Promise<void> {
  const client = await pool.connect();
  const [ns, key] = lockArgs(consumerId);
  try {
    await client.query("SELECT pg_advisory_lock($1, hashtext($2))", [ns, key]);
    await fn();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", [ns, key]);
    client.release();
  }
}

/**
 * حيازةٌ **تُمسَكُ أوّلاً ثمَّ يُطلَقُها نداءٌ لاحقٌ** — الترتيبُ مهمٌّ: قائمةُ
 * انتظارِ الأقفالِ الاستشاريّةِ FIFO، فلو بدأَ الطرفُ الآخرُ قبلَ الحيازةِ
 * اليدويّةِ لَحازَ هوَ أوّلاً وانتظرتِ الحيازةُ اليدويّةُ هوَ — وانهارَ برهانُ الحجبِ.
 */
async function holdSessionLock(pool: Pool, consumerId: string): Promise<() => Promise<void>> {
  const client = await pool.connect();
  const [ns, key] = lockArgs(consumerId);
  await client.query("SELECT pg_advisory_lock($1, hashtext($2))", [ns, key]);
  return async () => {
    await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", [ns, key]);
    client.release();
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** نقطةُ التقدُّمِ الحاليةُ كما هيَ في الدفترِ — قراءةٌ صريحةٌ لا استنتاجاً. */
async function checkpoint(pool: Pool): Promise<RelayCheckpoint> {
  const row = await pool.query<{ last_occurred_at: string; last_event_id: string }>(
    `SELECT last_occurred_at::text, last_event_id::text FROM delivery_relay_checkpoint WHERE consumer_id = $1`,
    [DEFAULT_RELAY_CONFIG.consumerId],
  );
  if (row.rows.length === 0) return ZERO_CHECKPOINT;
  // `::text` يعطي «2026-09-09 10:00:00+00» والمُخزِنُ يقرأُ ISO — نُوحّدُ إلى
  // ISO حتّى تُقارَنَ النقطةُ بالصيغةِ التي تمرُّها الدفعةُ إلى المصدرِ.
  return {
    last_occurred_at: new Date(row.rows[0]!.last_occurred_at).toISOString(),
    last_event_id: row.rows[0]!.last_event_id,
  };
}

/** هل عادَتِ النقطةُ إلى الصفرِ؟ — شرطُ نجاةِ الإعادةِ. */
async function rewoundToZero(pool: Pool): Promise<boolean> {
  const cp = await checkpoint(pool);
  return cp.last_event_id === ZERO_CHECKPOINT.last_event_id;
}

function relayDeps(pool: Pool, events?: DispatchEventSource, logs?: RelayLogEntry[]): RelayDeps {
  return {
    events: events ?? new PostgresDispatchEventSource(pool),
    store: new PostgresTaskMirrorStore(pool),
    lock: new PostgresRelayConsumerLock(pool),
    log: logs ? (e) => logs.push(e) : undefined,
    config: { ...DEFAULT_RELAY_CONFIG, batchSize: 10 },
  };
}

/**
 * مصدرُ أحداثٍ **متوقِّفٌ**: يُثبِتُ أنَّ الدفعةَ قرأتِ النقطةَ المُتوقَّعةَ ثمَّ
 * يُعلِّقُ الاستدعاءَ على بوّابةٍ نملكُها نحنُ — فتبقى الدفعةُ **حائزةً للقفلِ
 * في منتصفِها** بينَ القراءةِ والكتابةِ، وهيَ بالضبطِ اللحظةُ التي كانَ السباقُ
 * يقعُ فيها.
 */
class PausableEventSource extends PostgresDispatchEventSource {
  private gate: Promise<void> = new Promise(() => {});
  private arrivedResolve!: () => void;
  /** يُحَلُّ حينَ تصلُ الدفعةُ إلى القراءةِ — أي **بعدَ** حيازتِها القفلَ. */
  readonly arrived = new Promise<void>((resolve) => { this.arrivedResolve = resolve; });
  resume!: () => void;

  constructor(
    pool: Pool,
    private readonly expectedCheckpoint: RelayCheckpoint,
  ) {
    super(pool);
  }

  override async readAfter(cp: RelayCheckpoint | null, limit: number): Promise<readonly DispatchOutboxRow[]> {
    // الدفعةُ قرأتْ هذهِ النقطةَ **قبلَ** التوقُّفِ — وإلّا فالتوقُّفُ في موضعٍ
    // لا يُبرهِنُ شيئاً.
    expect(cp).toEqual(this.expectedCheckpoint);
    const rows = await super.readAfter(cp, limit);
    if (rows.length > 0) {
      // وصلَتِ الدفعةُ وهيَ **حائزةٌ للقفلِ** (الحيازةُ سَبَقَتِ القراءةَ) — من
      // هذهِ اللحظةِ يُسمَحُ للإعادةِ أن تبدأَ: أيُّ بدءٍ قبلَها سباقُ بدءٍ لا
      // يُبرهِنُ شيئاً (قائمةُ الانتظارِ FIFO فلو سبقتِ الإعادةُ لحازتْ هيَ).
      this.arrivedResolve();
      await this.gate; // مُعلَّقةٌ حتى resume()
    }
    return rows;
  }

  arm(): void {
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => { release = resolve; });
    this.resume = release;
  }
}

/**
 * صفٌّ سامٌّ **مصنوعٌ بأصالةٍ لا بحُكمٍ مُزروعٍ**: `event_version` خارجُ `v1`
 * يُسمَّمُ فوراً في أوّلِ دفعةٍ (خطوةُ توافقِ النسخةِ — قبلَ التصنيفِ)، ولا
 * يعتمدُ على عدِّ المحاولاتِ ولا على حالةِ مهمّةٍ.
 */
function poisonSeed(jobId: string, occurredAt: string): Parameters<typeof seedDispatchEvent>[1] {
  return {
    event_type: "dispatch.offer_accepted",
    event_version: "v2",
    aggregate_type: "dispatch_job",
    aggregate_id: jobId,
    payload: { job_id: jobId, driver_public_id: "WS-0000000123", accepted_at: occurredAt },
    occurred_at: occurredAt,
  };
}

(PG_ENABLED ? describe : describe.skip)("relay consumer advisory lock — PostgreSQL (M5-13R · §4.24-ب)", () => {
  it("requeue waits behind a manually-held session lock, then commits and rewinds", async () => {
    const { pool, close } = await setupPostgres();
    try {
      await resetData(pool);
      const seeded = await seedTask(pool);
      const poisonId = await seedDispatchEvent(pool, poisonSeed(seeded.jobId!, ts(0)));

      // دفعةٌ أولى تُسمِّمُ الصفَّ وتُقدِّمُ النقطةَ فوقَهُ.
      const first = await runRelayBatch(relayDeps(pool));
      expect(first.poisoned).toBe(1);
      expect(await rewoundToZero(pool)).toBe(false);

      // الحيازةُ اليدويّةُ **أوّلاً** (FIFO) — ثمَّ تبدأُ الإعادةُ خلفَها.
      const releaseLock = await holdSessionLock(pool, DEFAULT_RELAY_CONFIG.consumerId);
      let requeueSettled = false;
      const requeue = new PostgresRelayRequeueStore(pool)
        .requeuePoisonedEvent({ ledger: "dispatch", eventId: poisonId })
        .then((effect) => {
          requeueSettled = true;
          return effect;
        });

      let effect!: RelayRequeueDecision;
      try {
        // 400ms بعدَ بدءِ الإعادةِ: لم تلتزمْ بعدُ — **الانتظارُ مُقاسٌ لا مُفترَضٌ**.
        await sleep(400);
        expect(requeueSettled).toBe(false);
        expect(await rewoundToZero(pool)).toBe(false);
      } finally {
        // **الإفراجُ هنا في مسارَي النجاحِ والفشلِ معاً**: قبلَ انتظارِ الطرفِ
        // الآخرِ (نجاحاً)، وقبلَ إغلاقِ المجمّعِ (فشلاً) — ففشلُ تأكيدٍ والقفلُ
        // بيدِنا كانَ سيُعلِّقُ `close()` فيبتلعُ الخطأَ الحقيقيَّ في مهلةٍ صامتةٍ.
        await releaseLock();
      }
      effect = await requeue;
      expect(effect.outcome).toBe("requeued");
      expect(await rewoundToZero(pool)).toBe(true); // الإرجاعُ فعِلَ بعدَ الإفراجِ

      // والصفُّ عادَ `pending` قابلاً للقراءةِ من الصفرِ:
      const status = await pool.query<{ consumed_status: string }>(
        `SELECT consumed_status FROM delivery_relay_consumed_events WHERE event_id = $1::uuid`,
        [poisonId],
      );
      expect(status.rows[0]!.consumed_status).toBe("pending");
    } finally {
      await close();
    }
  });

  it("a relay batch waits behind a manually-held session lock, then proceeds", async () => {
    const { pool, close } = await setupPostgres();
    try {
      await resetData(pool);
      const seeded = await seedTask(pool);
      await seedDispatchEvent(pool, {
        event_type: "dispatch.offer_accepted",
        aggregate_type: "dispatch_job",
        aggregate_id: seeded.jobId!,
        payload: { job_id: seeded.jobId, driver_public_id: "WS-0000000123", accepted_at: ts(1) },
        occurred_at: ts(1),
      });

      // الحيازةُ اليدويّةُ **أوّلاً** (FIFO) — ثمَّ تبدأُ الدفعةُ خلفَها.
      const releaseLock = await holdSessionLock(pool, DEFAULT_RELAY_CONFIG.consumerId);
      let batchSettled = false;
      const batch = runRelayBatch(relayDeps(pool)).then((outcome) => {
        batchSettled = true;
        return outcome;
      });

      let outcome!: BatchOutcome;
      try {
        await sleep(400);
        expect(batchSettled).toBe(false); // الدفعةُ تنتظرُ القفلَ المُستأجَرَ
      } finally {
        await releaseLock(); // نفسُ عقدِ الإفراجِ في الاختبارِ السابقِ
      }
      outcome = await batch;
      expect(outcome.applied).toBe(1);
    } finally {
      await close();
    }
  });

  it("two ledgers, two keys: a dispatch-consumer lock does not block an inventory-ledger requeue", async () => {
    const { pool, close } = await setupPostgres();
    try {
      await resetData(pool);

      // إعادةٌ على دفترِ **المخزونِ** بينما قفلُ مُستهلِكِ **التوزيعِِ**
      // مُستأجَرٌ يدويّاً: تمرُّ فوراً (رفضُ not_found يكفي — الانتظارُ كانَ
      // سيحصلُ **قبلَ** القراءةِ فلو حجبَ القفلُ لَما رفضَ أصلاً).
      const requeue = new PostgresRelayRequeueStore(pool).requeuePoisonedEvent({
        ledger: "marketplace_inventory",
        eventId: "00000000-0000-0000-0000-000000000001",
      });

      await withHeldSessionLock(pool, DEFAULT_RELAY_CONFIG.consumerId, async () => {
        const effect = await requeue; // لا انتظارَ: مفتاحٌ آخرُ
        expect(effect.outcome).toBe("rejected");
      });
    } finally {
      await close();
    }
  });

  it("the requeue lock key comes from the same source: an inventory-key holder does not block a dispatch requeue", async () => {
    const { pool, close } = await setupPostgres();
    try {
      await resetData(pool);
      await withHeldSessionLock(pool, "delivery-marketplace-inventory-relay-v1", async () => {
        const effect = await new PostgresRelayRequeueStore(pool).requeuePoisonedEvent({
          ledger: "dispatch",
          eventId: "00000000-0000-0000-0000-000000000002",
        });
        expect(effect.outcome).toBe("rejected"); // مرَّتْ فوراً: مفتاحُ التوزيعِ حرٌّ
      });
    } finally {
      await close();
    }
  });

  it("THE designed race: a mid-batch requeue waits, the rewind survives, the poisoned event is re-read (not swallowed)", async () => {
    const { pool, close } = await setupPostgres();
    try {
      await resetData(pool);
      const seeded = await seedTask(pool);

      // (أ) صفٌّ سامٌّ في `10:00` — النسخةُ `v2` تُسمِّمُهُ فوراً.
      const poisonId = await seedDispatchEvent(pool, poisonSeed(seeded.jobId!, ts(0)));
      const first = await runRelayBatch(relayDeps(pool));
      expect(first.poisoned).toBe(1);

      // (ب) حدثٌ قابلٌ للتطبيقِ **بعدَ** السمِّ — ما ستقرأُهُ الدفعةُ الثانيةُ.
      const applyableId = await seedDispatchEvent(pool, {
        event_type: "dispatch.offer_accepted",
        aggregate_type: "dispatch_job",
        aggregate_id: seeded.jobId!,
        payload: { job_id: seeded.jobId, driver_public_id: "WS-0000000123", accepted_at: ts(5) },
        occurred_at: ts(5),
      });

      // (ج) النقطةُ التي ستقرأُها الدفعةُ المتوقِّفةُ **قبلَ** الإعادةِ.
      const staleCheckpoint = await checkpoint(pool);

      // (د) الدفعةُ المتوقِّفةُ: تقرأُ فوقَ النقطةِ القديمةِ ثمَّ تُعلَّقُ **وهيَ
      // حائزةٌ للقفلِ** بينَ القراءةِ وأوّلِ كتابةٍ.
      const source = new PausableEventSource(pool, staleCheckpoint);
      source.arm();
      const secondBatch = runRelayBatch(relayDeps(pool, source));
      // لا تبدأُ الإعادةُ إلا بعدَ وصولِ الدفعةِ إلى القراءةِ — أي **وهيَ حائزةٌ
      // للقفلِ ومعطِّلةٌ داخلهُ**: هذهِ هيَ اللحظةُ التي كانَ السباقُ يقعُ فيها.
      await source.arrived;

      // (هـ) الإعادةُ تبدأُ **والدفعةُ معلَّقةٌ في منتصفِها**: بلا قفلٍ كانتْ
      // ستلتزمُ فوراً، وتكتبُ الدفعةُ عندَ استئنافِها نقطتَها فوقَ الإرجاعِ.
      const requeue = new PostgresRelayRequeueStore(pool).requeuePoisonedEvent({
        ledger: "dispatch",
        eventId: poisonId,
      });

      try {
        // إمهالٌ مُقيسٌ: الإعادةُ **لم تلتزمْ** والدفعةُ لم تكتبْ بعدُ.
        await sleep(400);
        expect(await rewoundToZero(pool)).toBe(false);

        // (و) استئنافُ الدفعةِ — تُكمِلُ ما بدأتهُ فوقَ النقطةِ القديمةِ.
        source.resume();
        const secondOutcome = await secondBatch;
        expect(secondOutcome.applied).toBe(1); // القابلُ للتطبيقِ طُبِّقَ
        const applyable = await pool.query<{ consumed_status: string }>(
          `SELECT consumed_status FROM delivery_relay_consumed_events WHERE event_id = $1::uuid`,
          [applyableId],
        );
        expect(applyable.rows[0]!.consumed_status).toBe("applied");

        // (ز) الآنَ تلتزمُ الإعادةُ — **بعدَ** الدفعةِ لا قبلَها — والإرجاعُ فوقَ
        // نقطةِ الدفعةِ لا تحتها.
        const effect = await requeue;
        expect(effect.outcome).toBe("requeued");
        expect(await rewoundToZero(pool)).toBe(true);

        // (ح) **البُرهانُ الحاسمُ**: الدفعةُ الثالثةُ تقرأُ من الصفرِ فترى الصفَّ
        // السامَّ المُعادَ — مُحاولةً ثانيةً مُسجَّلةً — ولو بقيتِ النقطةُ فوقَهُ
        // لَما رآهُ أحدٌ أبداً (وهذا عينُ «إبطالُ عملٍ وقعَ فعلاً»).
        const logs: RelayLogEntry[] = [];
        const third = await runRelayBatch(relayDeps(pool, undefined, logs));
        expect(third.processed).toBe(2); // السامُّ المُعادُ + القابلُ للتطبيقِ
        const poisonLog = logs.find((l) => l.event_id === poisonId);
        expect(poisonLog).toBeDefined();
        expect(poisonLog!.attempt).toBe(2); // محاولةٌ ثانيةٌ — قُرِئَ حقّاً
        expect(poisonLog!.status).toBe("poisoned"); // وأُعيدَ تسميمُهُ فالنسخةُ ما زالتْ v2

      } finally {
        // **الاستئنافُ قبلَ الإغلاقِ مهما فشلَ**: تأكيدٌ فاشلٌ وبوّابةُ الدفعةِ
        // مُغلقةٌ كانَ سيُعلِّقُ الدفعةَ داخلَ القفلِ فيُعلِّقُ `close()` ويبتلعُ
        // الخطأَ الحقيقيَّ في مهلةٍ صامتةٍ. `resume()` الثانيةُ لا أثرَ لها.
        source.resume();
      }
    } finally {
      await close();
    }
  });
});
