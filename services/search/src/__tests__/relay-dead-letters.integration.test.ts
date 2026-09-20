/**
 * اختبارُ تكامُلٍ لمقياسِ المسمومِ على PostgreSQL حقيقيّةٍ
 * (فجوةُ `G5` · موجةُ العينِ · `CLM-0247`).
 *
 * ما يُقاسُ هنا ولا يُقاسُ في الوحدةِ:
 *   1) الاستعلامُ يُطابِقُ **المخطَّطَ الحقيقيَّ** (أسماءُ الأعمدةِ والحالاتِ) —
 *      وحدةٌ بمنفذٍ وهميٍّ تبقى خضراءَ بعدَ تسميةِ عمودٍ.
 *   2) `count(*)` يصلُ **عدداً لا نصّاً**، والطابعُ يصلُ ISO مقروءاً من داخلِ
 *      `json_agg` — وهما الموضعانِ اللذانِ تُخفيهما المنافذُ الوهميّةُ.
 *   3) **القراءةُ لا تكتبُ**: بصمةُ الجدولِ قبلَ النداءِ وبعدَهُ واحدةٌ — مُقاسٌ
 *      لا مُدَّعىً في تعليقٍ.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PG_ENABLED, setupPostgres, resetData, type PgFixture } from "./pg-harness.js";
import { PostgresSearchDeadLetterStore } from "../infrastructure/relay-dead-letter-store.js";
import { classifySearchDeadLetterSeverity } from "../domain/relay-dead-letters.js";

const LEDGER_TABLE = "search_relay_consumed_events";

async function seedConsumed(
  pool: PgFixture["pool"],
  row: {
    outboxId: string;
    status: string;
    eventType: string;
    consumedAt?: string;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO ${LEDGER_TABLE}
       (outbox_id, event_type, aggregate_type, aggregate_id, status, attempt_count, last_error, consumed_at)
     VALUES ($1::uuid, $2, 'product', $1::text, $3, 5, 'simulated poison', coalesce($4::timestamptz, now()))`,
    [row.outboxId, row.eventType, row.status, row.consumedAt ?? null],
  );
}

/** بصمةُ الجدولِ: كلُّ صفٍّ بكلِّ عمودٍ يُمكنُ أن تمسَّهُ كتابةٌ. */
async function ledgerFingerprint(pool: PgFixture["pool"]): Promise<string> {
  const result = await pool.query<{ fingerprint: string }>(
    `SELECT coalesce(
              string_agg(
                outbox_id::text || '|' || status || '|' || attempt_count::text ||
                '|' || coalesce(last_error, '') || '|' || consumed_at::text,
                E'\\n' ORDER BY outbox_id
              ), '') AS fingerprint
       FROM ${LEDGER_TABLE}`,
  );
  return result.rows[0]?.fingerprint ?? "";
}

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe.skipIf(!PG_ENABLED)("PostgresSearchDeadLetterStore integration (G5)", () => {
  let fixture: PgFixture;

  // المخطَّطُ يُطبَّقُ مرّةً والبياناتُ تُنظَّفُ لكلِّ حالةٍ — سابقةُ
  // `outbox-drain.integration.test.ts` نفسُها. وإعادةُ تطبيقِ المخطَّطِ لكلِّ
  // حالةٍ كانَتْ تُتجاوِزُ مهلةَ الخطّافِ على قاعدةٍ بعيدةٍ، فالعلاجُ في موضعِ
  // التهيئةِ لا في تمديدِ مهلةٍ يُخفي البطءَ.
  beforeAll(async () => {
    fixture = await setupPostgres();
  });

  beforeEach(async () => {
    await resetData(fixture.pool);
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("measures an empty ledger as a measured zero — the ledger is still named", async () => {
    const store = new PostgresSearchDeadLetterStore(fixture.pool);
    const metric = await store.readSearchDeadLetters({ eventTypeLimit: 10 });

    expect(metric.totalPoisoned).toBe(0);
    expect(metric.ledgers).toHaveLength(1);
    expect(metric.ledgers[0]).toMatchObject({
      ledger: "marketplace",
      poisoned: 0,
      oldestPoisonedAt: null,
      newestPoisonedAt: null,
      byEventType: [],
    });
    // الطابعُ مقروءٌ زمناً لا نصٌّ مُصطنَعٌ.
    expect(Number.isNaN(Date.parse(metric.measuredAt))).toBe(false);
  });

  it("counts ONLY poisoned rows — applied, skipped and pending are not loss", async () => {
    await seedConsumed(fixture.pool, { outboxId: uuid(1), status: "poisoned", eventType: "marketplace.product_published" });
    await seedConsumed(fixture.pool, { outboxId: uuid(2), status: "applied", eventType: "marketplace.product_published" });
    await seedConsumed(fixture.pool, { outboxId: uuid(3), status: "skipped", eventType: "marketplace.product_created" });
    await seedConsumed(fixture.pool, { outboxId: uuid(4), status: "skipped_stale", eventType: "marketplace.product_created" });
    await seedConsumed(fixture.pool, { outboxId: uuid(5), status: "ignored", eventType: "marketplace.store_registered" });
    await seedConsumed(fixture.pool, { outboxId: uuid(6), status: "pending", eventType: "marketplace.store_registered" });

    const store = new PostgresSearchDeadLetterStore(fixture.pool);
    const metric = await store.readSearchDeadLetters({ eventTypeLimit: 10 });

    expect(metric.totalPoisoned).toBe(1);
    // عددٌ لا نصٌّ: `"1" >= 10` كانَ سيُجيبُ خطأً في مراقبٍ بلا إسقاطِ اختبارٍ.
    expect(typeof metric.ledgers[0]?.poisoned).toBe("number");
    expect(metric.ledgers[0]?.byEventType).toEqual([
      { eventType: "marketplace.product_published", poisoned: 1 },
    ]);
  });

  it("reports oldest/newest stamps and caps the event-type breakdown by the limit", async () => {
    const old = "2026-09-01T00:00:00.000Z";
    const recent = "2026-09-19T00:00:00.000Z";
    await seedConsumed(fixture.pool, { outboxId: uuid(11), status: "poisoned", eventType: "a.one", consumedAt: old });
    await seedConsumed(fixture.pool, { outboxId: uuid(12), status: "poisoned", eventType: "a.one", consumedAt: recent });
    await seedConsumed(fixture.pool, { outboxId: uuid(13), status: "poisoned", eventType: "b.two", consumedAt: recent });
    await seedConsumed(fixture.pool, { outboxId: uuid(14), status: "poisoned", eventType: "c.three", consumedAt: recent });

    const store = new PostgresSearchDeadLetterStore(fixture.pool);
    const full = await store.readSearchDeadLetters({ eventTypeLimit: 10 });
    expect(full.totalPoisoned).toBe(4);
    expect(full.ledgers[0]?.oldestPoisonedAt).toBe(old);
    expect(full.ledgers[0]?.newestPoisonedAt).toBe(recent);
    // أعلى أوّلاً ثمَّ بالاسمِ — ترتيبٌ مُثبَتٌ لا مصادفةٌ.
    expect(full.ledgers[0]?.byEventType.map((e) => e.eventType)).toEqual(["a.one", "b.two", "c.three"]);

    const capped = await store.readSearchDeadLetters({ eventTypeLimit: 1 });
    expect(capped.ledgers[0]?.byEventType).toEqual([{ eventType: "a.one", poisoned: 2 }]);
    // والحدُّ يقصُّ **التفصيلَ** ولا يقصُّ المجموعَ: مجموعٌ مقصوصٌ كانَ كذباً.
    expect(capped.totalPoisoned).toBe(4);
  });

  it("the verdict computed from a real measurement escalates on real age", async () => {
    const longAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await seedConsumed(fixture.pool, { outboxId: uuid(21), status: "poisoned", eventType: "a.one", consumedAt: longAgo });

    const store = new PostgresSearchDeadLetterStore(fixture.pool);
    const metric = await store.readSearchDeadLetters({ eventTypeLimit: 10 });
    const verdict = classifySearchDeadLetterSeverity(metric, new Date());

    expect(verdict.severity).toBe("critical");
    expect(verdict.because).toBe("oldest_poisoned_at_or_above_critical_age");
    expect(verdict.oldestPoisonedAgeSeconds).toBeGreaterThan(86_400);
  });

  it("reading NEVER writes — the ledger fingerprint is identical before and after", async () => {
    await seedConsumed(fixture.pool, { outboxId: uuid(31), status: "poisoned", eventType: "a.one" });
    await seedConsumed(fixture.pool, { outboxId: uuid(32), status: "applied", eventType: "a.one" });

    const before = await ledgerFingerprint(fixture.pool);
    const store = new PostgresSearchDeadLetterStore(fixture.pool);
    await store.readSearchDeadLetters({ eventTypeLimit: 10 });
    await store.readSearchDeadLetters({ eventTypeLimit: 1 });
    const after = await ledgerFingerprint(fixture.pool);

    expect(after).toBe(before);
    expect(before).not.toBe("");
  });

  it("guards its own contract: a non-positive limit is a defect, not a clamped read", async () => {
    const store = new PostgresSearchDeadLetterStore(fixture.pool);
    await expect(store.readSearchDeadLetters({ eventTypeLimit: 0 })).rejects.toThrow(RangeError);
    await expect(store.readSearchDeadLetters({ eventTypeLimit: 1.5 })).rejects.toThrow(RangeError);
  });
});
