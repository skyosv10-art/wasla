/**
 * قياسُ المسمومِ — على قاعدةٍ حقيقيّةٍ (المراجعةُ 21/N · ADR-026 §4.23).
 *
 * ما تُثبِتُهُ هذه الاختباراتُ ولا يستطيعُ بديلُ ذاكرةٍ إثباتَهُ:
 *
 *   • **الجدولُ الصحيحُ لكلِّ دفترٍ.** خطأٌ في الربطِ يُعطي صفراً سليمَ الشكلِ،
 *     وبديلٌ في الذاكرةِ يُمرَّرُ إليهِ العددُ جاهزاً فلا يمسُّ الربطَ أصلاً.
 *   • **العدُّ يُحصي `poisoned` وحدَهُ.** الحالاتُ الأخرى تُسكَنُ الجدولَ نفسَهُ،
 *     فضمُّ واحدةٍ منها بالخطأِ يجعلُ التنبيهَ ضجيجاً يُصمَّتُ.
 *   • **`updated_at` هوَ المقيسُ لا `consumed_at`.** الصفُّ يُنشأُ عندَ أوّلِ
 *     محاولةٍ ويصيرُ مسموماً بعدَ استنفادِها، فلا يُثبَتُ الفرقُ إلّا بصفٍّ
 *     عمودَاهُ مختلفانِ فعلاً في القاعدةِ.
 *   • **اللقطةُ واحدةٌ**: مجموعٌ منشورٌ يوافقُ جمعَ الدفترَينِ المنشورَينِ.
 *   • **قراءةٌ محضةٌ**: بصمةُ الجدولَينِ لا تتغيّرُ بالنداءِ — دعوى التعليقِ
 *     تُثبَتُ بالقياسِ لا تُصدَّقُ بالنيّةِ.
 *
 * يُتخطّى حينَ لا `DATABASE_URL` (docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { PG_ENABLED, resetData, setupPostgres, type PgFixture } from "./pg-harness.js";
import { PostgresRelayDeadLetterStore } from "../infrastructure/relay-dead-letter-store.js";

const T0 = "2026-09-13T00:00:00.000Z";
const at = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

let fixture: PgFixture;

interface LedgerRow {
  eventId: string;
  eventType: string;
  aggregateType?: string;
  aggregateId?: string;
  status: string;
  attemptCount?: number;
  consumedAt?: string;
  updatedAt?: string;
}

async function insertDispatchRow(pool: Pool, row: LedgerRow): Promise<void> {
  await pool.query(
    `INSERT INTO delivery_relay_consumed_events
       (event_id, event_type, aggregate_type, aggregate_id, consumed_status,
        attempt_count, consumed_at, updated_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)`,
    [
      row.eventId,
      row.eventType,
      row.aggregateType ?? "dispatch_job",
      row.aggregateId ?? "job-agg-1",
      row.status,
      row.attemptCount ?? 5,
      row.consumedAt ?? row.updatedAt ?? T0,
      row.updatedAt ?? T0,
    ],
  );
}

async function insertInventoryRow(pool: Pool, row: LedgerRow): Promise<void> {
  await pool.query(
    `INSERT INTO delivery_inventory_relay_consumed_events
       (event_id, event_type, aggregate_type, aggregate_id, consumed_status,
        attempt_count, consumed_at, updated_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)`,
    [
      row.eventId,
      row.eventType,
      row.aggregateType ?? "inventory",
      row.aggregateId ?? "cccccccc-0000-0000-0000-000000000003",
      row.status,
      row.attemptCount ?? 5,
      row.consumedAt ?? row.updatedAt ?? T0,
      row.updatedAt ?? T0,
    ],
  );
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/**
 * بصمةُ الدفترَينِ: كلُّ صفٍّ بكلِّ عمودٍ يمسُّهُ القياسُ. تغيُّرُها بعدَ نداءٍ
 * قراءةٍ إخفاقٌ — وعدُّ الصفوفِ وحدَهُ كانَ سيَبتلِعُ تعديلَ حالةٍ في موضعِها.
 */
async function ledgerFingerprint(pool: Pool): Promise<string> {
  const result = await pool.query<{ fingerprint: string }>(
    `SELECT coalesce(string_agg(line, '|' ORDER BY line), '∅') AS fingerprint
       FROM (
         SELECT 'd:' || event_id::text || ':' || consumed_status || ':' ||
                attempt_count::text || ':' || consumed_at::text || ':' || updated_at::text AS line
           FROM delivery_relay_consumed_events
         UNION ALL
         SELECT 'i:' || event_id::text || ':' || consumed_status || ':' ||
                attempt_count::text || ':' || consumed_at::text || ':' || updated_at::text AS line
           FROM delivery_inventory_relay_consumed_events
       ) rows`,
  );
  return result.rows[0]!.fingerprint;
}

describe.skipIf(!PG_ENABLED)("PostgresRelayDeadLetterStore — على قاعدةٍ حقيقيّةٍ", () => {
  beforeEach(async () => {
    fixture = await setupPostgres();
    await resetData(fixture.pool);
  });

  afterEach(async () => {
    await fixture.close();
  });

  it("دفترانِ خاليانِ ⇒ صفرٌ **وكلا الدفترَينِ مذكورانِ** بلا طابعٍ", async () => {
    const store = new PostgresRelayDeadLetterStore(fixture.pool);

    const metric = await store.readRelayDeadLetters({ eventTypeLimit: 10 });

    expect(metric.totalPoisoned).toBe(0);
    expect(metric.ledgers).toEqual([
      {
        ledger: "dispatch",
        poisoned: 0,
        oldestPoisonedAt: null,
        newestPoisonedAt: null,
        byEventType: [],
      },
      {
        ledger: "marketplace_inventory",
        poisoned: 0,
        oldestPoisonedAt: null,
        newestPoisonedAt: null,
        byEventType: [],
      },
    ]);
    // القياسُ مؤرَّخٌ بساعةِ القاعدةِ لا بساعةِ العمليّةِ.
    expect(Number.isNaN(Date.parse(metric.measuredAt))).toBe(false);
  });

  it("**`poisoned` وحدَهُ يُحصى** — وبقيّةُ الحالاتِ في الجدولِ لا تُعَدُّ", async () => {
    // الحالاتُ المسموحُ بها في عقدِ دفترِ التوزيعِ كاملةً، مسمومٌ واحدٌ بينَها.
    const statuses = ["pending", "applied", "skipped_stale", "ignored", "ignored_foreign", "poisoned"];
    let n = 1;
    for (const status of statuses) {
      await insertDispatchRow(fixture.pool, {
        eventId: uuid(n),
        eventType: "dispatch.job_assigned",
        status,
        updatedAt: at(n),
      });
      n += 1;
    }
    // وفي دفترِ المخزونِ: حالاتُهُ المسموحُ بها كاملةً ومسمومانِ.
    for (const status of ["pending", "applied", "skipped_stale", "ignored"]) {
      await insertInventoryRow(fixture.pool, {
        eventId: uuid(n),
        eventType: "marketplace.inventory_adjusted",
        status,
        updatedAt: at(n),
      });
      n += 1;
    }
    await insertInventoryRow(fixture.pool, {
      eventId: uuid(90),
      eventType: "marketplace.inventory_adjusted",
      status: "poisoned",
      updatedAt: at(90),
    });
    await insertInventoryRow(fixture.pool, {
      eventId: uuid(91),
      eventType: "marketplace.store_activated",
      aggregateType: "store",
      status: "poisoned",
      updatedAt: at(91),
    });

    const store = new PostgresRelayDeadLetterStore(fixture.pool);
    const metric = await store.readRelayDeadLetters({ eventTypeLimit: 10 });

    // ثلاثةٌ من اثنَي عشرَ صفّاً — لا تسعةٌ ولا صفرٌ.
    expect(metric.totalPoisoned).toBe(3);
    expect(metric.ledgers.map((l) => [l.ledger, l.poisoned])).toEqual([
      ["dispatch", 1],
      ["marketplace_inventory", 2],
    ]);
    // والمجموعُ المنشورُ = جمعُ الدفترَينِ المنشورَينِ: لقطةٌ واحدةٌ لا رقمانِ.
    expect(metric.totalPoisoned).toBe(
      metric.ledgers.reduce((sum, ledger) => sum + ledger.poisoned, 0),
    );
  });

  it("تفصيلُ النوعِ مُرتَّبٌ بالعددِ نازلاً ثمَّ بالاسمِ، **وكلُّ دفترٍ منفصلٌ**", async () => {
    await insertDispatchRow(fixture.pool, {
      eventId: uuid(1),
      eventType: "dispatch.job_completed",
      status: "poisoned",
      updatedAt: at(1),
    });
    for (const id of [2, 3, 4]) {
      await insertDispatchRow(fixture.pool, {
        eventId: uuid(id),
        eventType: "dispatch.job_assigned",
        status: "poisoned",
        updatedAt: at(id),
      });
    }
    await insertInventoryRow(fixture.pool, {
      eventId: uuid(5),
      eventType: "marketplace.inventory_adjusted",
      status: "poisoned",
      updatedAt: at(5),
    });

    const store = new PostgresRelayDeadLetterStore(fixture.pool);
    const metric = await store.readRelayDeadLetters({ eventTypeLimit: 10 });

    expect(metric.ledgers[0]!.byEventType).toEqual([
      { eventType: "dispatch.job_assigned", poisoned: 3 },
      { eventType: "dispatch.job_completed", poisoned: 1 },
    ]);
    // نوعُ دفترٍ لا يتسرَّبُ إلى تفصيلِ الآخرِ.
    expect(metric.ledgers[1]!.byEventType).toEqual([
      { eventType: "marketplace.inventory_adjusted", poisoned: 1 },
    ]);
  });

  it("السقفُ يقصُّ **التفصيلَ** ولا يقصُّ **المجموعَ**", async () => {
    for (const id of [1, 2, 3]) {
      await insertDispatchRow(fixture.pool, {
        eventId: uuid(id),
        eventType: `dispatch.job_type_${id}`,
        status: "poisoned",
        updatedAt: at(id),
      });
    }

    const store = new PostgresRelayDeadLetterStore(fixture.pool);
    const metric = await store.readRelayDeadLetters({ eventTypeLimit: 1 });

    expect(metric.ledgers[0]!.byEventType).toHaveLength(1);
    // مجموعٌ مقصوصٌ بسقفِ عرضٍ كانَ سيُخفي فقداً بقرارِ واجهةٍ.
    expect(metric.ledgers[0]!.poisoned).toBe(3);
    expect(metric.totalPoisoned).toBe(3);
  });

  it("**`updated_at` هوَ المقيسُ لا `consumed_at`** — عمرُ الفقدِ لا عمرُ أوّلِ محاولةٍ", async () => {
    // صفٌّ استُهلَّ قبلَ يومَينِ وسُمَّ قبلَ دقائقَ: العمودانِ مختلفانِ فعلاً.
    await insertDispatchRow(fixture.pool, {
      eventId: uuid(1),
      eventType: "dispatch.job_assigned",
      status: "poisoned",
      consumedAt: at(-2880),
      updatedAt: at(30),
    });

    const store = new PostgresRelayDeadLetterStore(fixture.pool);
    const metric = await store.readRelayDeadLetters({ eventTypeLimit: 10 });

    expect(metric.ledgers[0]!.oldestPoisonedAt).toBe(at(30));
    expect(metric.ledgers[0]!.newestPoisonedAt).toBe(at(30));
  });

  it("أقدمُ/أحدثُ يُقاسانِ لكلِّ دفترٍ على حدَتِهِ لا للمجموعِ", async () => {
    await insertDispatchRow(fixture.pool, {
      eventId: uuid(1),
      eventType: "dispatch.job_assigned",
      status: "poisoned",
      updatedAt: at(10),
    });
    await insertDispatchRow(fixture.pool, {
      eventId: uuid(2),
      eventType: "dispatch.job_assigned",
      status: "poisoned",
      updatedAt: at(50),
    });
    await insertInventoryRow(fixture.pool, {
      eventId: uuid(3),
      eventType: "marketplace.inventory_adjusted",
      status: "poisoned",
      updatedAt: at(200),
    });

    const store = new PostgresRelayDeadLetterStore(fixture.pool);
    const metric = await store.readRelayDeadLetters({ eventTypeLimit: 10 });

    expect(metric.ledgers[0]!.oldestPoisonedAt).toBe(at(10));
    expect(metric.ledgers[0]!.newestPoisonedAt).toBe(at(50));
    expect(metric.ledgers[1]!.oldestPoisonedAt).toBe(at(200));
    expect(metric.ledgers[1]!.newestPoisonedAt).toBe(at(200));
  });

  it("**القراءةُ لا تكتبُ**: بصمةُ الدفترَينِ كما هيَ قبلَ النداءِ وبعدَهُ", async () => {
    await insertDispatchRow(fixture.pool, {
      eventId: uuid(1),
      eventType: "dispatch.job_assigned",
      status: "poisoned",
      updatedAt: at(10),
    });
    await insertInventoryRow(fixture.pool, {
      eventId: uuid(2),
      eventType: "marketplace.inventory_adjusted",
      status: "pending",
      updatedAt: at(11),
    });

    const before = await ledgerFingerprint(fixture.pool);
    const store = new PostgresRelayDeadLetterStore(fixture.pool);
    await store.readRelayDeadLetters({ eventTypeLimit: 10 });
    await store.readRelayDeadLetters({ eventTypeLimit: 3 });
    const after = await ledgerFingerprint(fixture.pool);

    expect(after).toBe(before);
    // ولا يُقِرُّ ولا يُحرِّرُ: صفٌّ مسمومٌ يبقى مسموماً حتّى يقضيَ فيهِ إنسانٌ.
    expect(after).toContain(":poisoned:");
  });

  it("سقفٌ غيرُ صحيحٍ يُرفَضُ في المُهيَّئِ نفسِهِ ولا يُصحَّحُ صامتاً", async () => {
    const store = new PostgresRelayDeadLetterStore(fixture.pool);

    await expect(store.readRelayDeadLetters({ eventTypeLimit: 0 })).rejects.toThrow(RangeError);
    await expect(store.readRelayDeadLetters({ eventTypeLimit: 2.5 })).rejects.toThrow(RangeError);
  });
});
