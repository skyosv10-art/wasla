/**
 * اختبارُ تكامُلٍ ليدِ الإعادةِ على PostgreSQL حقيقيّةٍ
 * (فجوةُ `G5` · موجةُ **اليدِ** · `CLM-0248`).
 *
 * ما يُقاسُ هنا ولا تقيسُهُ الوحدةُ:
 *   1) **الحركتانِ معاً**: الصفُّ صارَ `pending` **و** صفُّ نقطةِ التقدُّمِ
 *      اختفى. ونصفُ الفعلِ هوَ العطبُ الذي وُضِعَت المعاملةُ لأجلِهِ، ولا يظهرُ
 *      إلّا على قاعدةٍ حقيقيّةٍ.
 *   2) **الدليلُ لم يُمحَ**: `attempt_count` و`last_error` و`consumed_at` كما
 *      هيَ حرفاً بعدَ الإعادةِ — فالإنقاذُ لا يمحو سببَ العطبِ ولا يُصفِّرُ عمرَ
 *      فقدٍ قائمٍ.
 *   3) **الرفضُ لا أثرَ لهُ**: بصمةُ الجدولِ ونقطةُ التقدُّمِ قبلَ النداءِ
 *      المرفوضِ وبعدَهُ واحدةٌ — مُقاسٌ لا مُدَّعىً في تعليقٍ.
 *   4) أنَّ الصفَّ المُعادَ يصيرُ فعلاً **غيرَ نهائيٍّ** في عينِ المُرحِّلِ نفسِهِ،
 *      ويسقطُ من مقياسِ موجةِ العينِ.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PG_ENABLED, setupPostgres, resetData, type PgFixture } from "./pg-harness.js";
import { PostgresSearchRequeueStore } from "../infrastructure/relay-requeue-store.js";
import { PostgresSearchDeadLetterStore } from "../infrastructure/relay-dead-letter-store.js";
import { PostgresProjectionStore } from "../infrastructure/projection-store.js";
import { DEFAULT_RELAY_CONFIG } from "../relay.js";

const LEDGER_TABLE = "search_relay_consumed_events";
const CHECKPOINT_TABLE = "search_relay_checkpoint";
const CONSUMER = DEFAULT_RELAY_CONFIG.consumerId;

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const POISONED_AT = "2026-09-01T00:00:00.000Z";
const LAST_ERROR = "unsupported event_version: v9";

async function seedConsumed(
  pool: PgFixture["pool"],
  row: { outboxId: string; status: string; attempts?: number },
): Promise<void> {
  await pool.query(
    `INSERT INTO ${LEDGER_TABLE}
       (outbox_id, event_type, aggregate_type, aggregate_id, status, attempt_count, last_error, consumed_at)
     VALUES ($1::uuid, 'marketplace.product_published', 'product', $1::text, $2, $3, $4, $5::timestamptz)`,
    [row.outboxId, row.status, row.attempts ?? 5, LAST_ERROR, POISONED_AT],
  );
}

async function seedCheckpoint(pool: PgFixture["pool"], outboxId: string): Promise<void> {
  await pool.query(
    `INSERT INTO ${CHECKPOINT_TABLE} (consumer_id, last_outbox_id, last_created_at)
          VALUES ($1, $2::uuid, now())
     ON CONFLICT (consumer_id) DO UPDATE
          SET last_outbox_id = EXCLUDED.last_outbox_id`,
    [CONSUMER, outboxId],
  );
}

interface LedgerRow {
  status: string;
  attempt_count: number;
  last_error: string | null;
  consumed_at: Date;
}

async function readRow(pool: PgFixture["pool"], outboxId: string): Promise<LedgerRow | null> {
  const result = await pool.query<LedgerRow>(
    `SELECT status, attempt_count, last_error, consumed_at FROM ${LEDGER_TABLE} WHERE outbox_id = $1::uuid`,
    [outboxId],
  );
  return result.rows[0] ?? null;
}

async function countCheckpoints(pool: PgFixture["pool"]): Promise<number> {
  const result = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${CHECKPOINT_TABLE} WHERE consumer_id = $1`,
    [CONSUMER],
  );
  return Number(result.rows[0]?.n ?? "0");
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

describe.skipIf(!PG_ENABLED)("PostgresSearchRequeueStore integration (G5 · the hand)", () => {
  let fixture: PgFixture;

  // المخطَّطُ مرّةً والبياناتُ لكلِّ حالةٍ — سابقةُ موجةِ العينِ نفسُها: إعادةُ
  // تطبيقِ المخطَّطِ لكلِّ حالةٍ تتجاوزُ مهلةَ الخطّافِ على قاعدةٍ بعيدةٍ،
  // والعلاجُ في موضعِ التهيئةِ لا في تمديدِ مهلةٍ يُخفي البطءَ.
  beforeAll(async () => {
    fixture = await setupPostgres();
  });

  beforeEach(async () => {
    await resetData(fixture.pool);
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("performs BOTH moves: the row leaves terminality and the checkpoint row is gone", async () => {
    const id = uuid(1);
    await seedConsumed(fixture.pool, { outboxId: id, status: "poisoned" });
    await seedCheckpoint(fixture.pool, id);
    expect(await countCheckpoints(fixture.pool)).toBe(1);

    const store = new PostgresSearchRequeueStore(fixture.pool);
    const effect = await store.requeuePoisonedEventWithEffect({
      ledger: "marketplace",
      outboxId: id,
    });

    expect(effect.decision).toEqual({ outcome: "requeued", previousStatus: "poisoned" });
    expect(effect.consumerId).toBe(CONSUMER);
    expect(effect.checkpointRowDeleted).toBe(true);

    const row = await readRow(fixture.pool, id);
    expect(row?.status).toBe("pending");
    /*
     * ونصفُ الفعلِ هوَ ما يُمنَعُ هنا: صفٌّ `pending` ونقطةٌ باقيةٌ فوقَهُ لا
     * يُقرأُ أبداً **ويسقطُ من مقياسِ العينِ** — فقدٌ أخفى ممّا كانَ.
     */
    expect(await countCheckpoints(fixture.pool)).toBe(0);

    // وقراءةُ المُرحِّلِ نفسِها تُصدِّقُ الحركةَ الثانيةَ: لا نقطةَ ⇒ من الصفرِ.
    const projections = new PostgresProjectionStore(fixture.pool);
    expect(await projections.getCheckpoint(CONSUMER)).toBeNull();
  });

  it("preserves the evidence exactly — attempt_count, last_error and consumed_at untouched", async () => {
    /*
     * وهذا هوَ الاختبارُ الذي يمنعُ «تنظيفاً» يبدو لطيفاً: تصفيرُ المحاولاتِ
     * يمحو سببَ العطبِ، وتحديثُ `consumed_at` **يُصفِّرُ عمرَ فقدٍ قائمٍ** فيُخرِجُ
     * صفّاً معطوباً منذُ أسبوعٍ من العتبةِ الحرجةِ بلا أن يُعالَجَ.
     */
    const id = uuid(2);
    await seedConsumed(fixture.pool, { outboxId: id, status: "poisoned", attempts: 5 });
    const before = await readRow(fixture.pool, id);

    await new PostgresSearchRequeueStore(fixture.pool).requeuePoisonedEvent({
      ledger: "marketplace",
      outboxId: id,
    });

    const after = await readRow(fixture.pool, id);
    expect(after?.attempt_count).toBe(5);
    expect(after?.last_error).toBe(LAST_ERROR);
    expect(after?.consumed_at.toISOString()).toBe(before?.consumed_at.toISOString());
  });

  it("drops the row out of the eye's measurement — the two waves agree on one table", async () => {
    const id = uuid(3);
    await seedConsumed(fixture.pool, { outboxId: id, status: "poisoned" });
    const eye = new PostgresSearchDeadLetterStore(fixture.pool);
    expect((await eye.readSearchDeadLetters({ eventTypeLimit: 10 })).totalPoisoned).toBe(1);

    await new PostgresSearchRequeueStore(fixture.pool).requeuePoisonedEvent({
      ledger: "marketplace",
      outboxId: id,
    });

    const after = await eye.readSearchDeadLetters({ eventTypeLimit: 10 });
    expect(after.totalPoisoned).toBe(0);
    expect(after.ledgers[0]?.oldestPoisonedAt).toBeNull();
  });

  it("a rejected call writes NOTHING — neither the ledger nor the checkpoint moves", async () => {
    const poisoned = uuid(4);
    const applied = uuid(5);
    await seedConsumed(fixture.pool, { outboxId: poisoned, status: "poisoned" });
    await seedConsumed(fixture.pool, { outboxId: applied, status: "applied" });
    await seedCheckpoint(fixture.pool, poisoned);

    const fingerprintBefore = await ledgerFingerprint(fixture.pool);
    const store = new PostgresSearchRequeueStore(fixture.pool);

    const notPoisoned = await store.requeuePoisonedEventWithEffect({
      ledger: "marketplace",
      outboxId: applied,
    });
    expect(notPoisoned.decision).toEqual({
      outcome: "rejected",
      reason: "not_poisoned",
      observedStatus: "applied",
    });
    expect(notPoisoned.checkpointRowDeleted).toBe(false);

    const missing = await store.requeuePoisonedEventWithEffect({
      ledger: "marketplace",
      outboxId: uuid(99),
    });
    expect(missing.decision).toEqual({
      outcome: "rejected",
      reason: "not_found",
      observedStatus: null,
    });

    // لا صفَّ تغيَّرَ، ولا نقطةَ أُرجِعَت: الرفضُ رفضٌ لا نصفُ فعلٍ.
    expect(await ledgerFingerprint(fixture.pool)).toBe(fingerprintBefore);
    expect(await countCheckpoints(fixture.pool)).toBe(1);
  });

  it("is naturally idempotent: the second call conflicts instead of doubling the effect", async () => {
    const id = uuid(6);
    await seedConsumed(fixture.pool, { outboxId: id, status: "poisoned" });
    await seedCheckpoint(fixture.pool, id);
    const store = new PostgresSearchRequeueStore(fixture.pool);

    expect((await store.requeuePoisonedEvent({ ledger: "marketplace", outboxId: id })).outcome).toBe(
      "requeued",
    );
    const second = await store.requeuePoisonedEvent({ ledger: "marketplace", outboxId: id });
    expect(second).toEqual({
      outcome: "rejected",
      reason: "not_poisoned",
      observedStatus: "pending",
    });
    expect((await readRow(fixture.pool, id))?.status).toBe("pending");
  });

  it("requeues with no checkpoint row at all — reports it instead of inventing one", async () => {
    /*
     * مُرحِّلٌ لم يُشغَّلْ قطُّ لا صفَّ نقطةٍ لهُ، وهيَ حالةٌ **مقروءةٌ لا
     * مستحيلةٌ**: القراءةُ من الصفرِ قائمةٌ فيها أصلاً، فالفعلُ ينجحُ
     * و`checkpointRowDeleted: false` يقولُ الحقَّ بلا كتابةِ صفٍّ صوريٍّ.
     */
    const id = uuid(7);
    await seedConsumed(fixture.pool, { outboxId: id, status: "poisoned" });
    expect(await countCheckpoints(fixture.pool)).toBe(0);

    const effect = await new PostgresSearchRequeueStore(fixture.pool).requeuePoisonedEventWithEffect(
      { ledger: "marketplace", outboxId: id },
    );
    expect(effect.decision.outcome).toBe("requeued");
    expect(effect.checkpointRowDeleted).toBe(false);
    expect((await readRow(fixture.pool, id))?.status).toBe("pending");
  });
});
