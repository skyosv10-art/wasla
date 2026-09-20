/**
 * اختبارُ تكامُلٍ لمحضرِ الإقرارِ على PostgreSQL حقيقيّةٍ
 * (فجوةُ `G5` · موجةُ **المحضرِ** · `CLM-0249`).
 *
 * ما يُقاسُ هنا ولا تقيسُهُ الوحدةُ:
 *   1) **القيودُ نفسُها**: ثلاثيٌّ ناقصٌ يُرفَضُ بـ`23514` من القاعدةِ لا من
 *      تطبيقٍ، وإقرارٌ على صفٍّ غيرِ مسمومٍ كذلكَ. فالحاجزُ الأخيرُ ليسَ رمزاً
 *      يُمكنُ تجاوزُهُ بـ`psql`، وهذا ما يجعلُ الشاهدَ شاهداً.
 *   2) **الإعادةُ تمحو الإقرارَ**: صفٌّ أُقِرَّ ثمَّ أُعيدَ يعودُ بلا شاهدٍ —
 *      وإلّا لبقيَ صفٌّ `pending` يحمِلُ إقرارَ فقدٍ لم يَعُدْ فقداً، فيُسَمُّ
 *      ثانيةً ويُقرأُ مُقَرّاً بهِ سلفاً فلا يُرى في الحكمِ أبداً.
 *   3) **النداءُ الثاني لا يكتُبُ فوقَ الأوّلِ**: الصفُّ في القاعدةِ يحمِلُ
 *      إقرارَ الأوّلِ حرفاً بعدَ نداءٍ ثانٍ بسببٍ آخرَ.
 *   4) **المقياسُ يقسِمُ ولا يُنقِصُ**: المُقَرُّ بهِ يسقطُ من الحكمِ ويبقى في
 *      `totalPoisoned` — مُقاسٌ على متجرِ العينِ نفسِهِ لا مُدَّعىً في تعليقٍ.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PG_ENABLED, setupPostgres, resetData, type PgFixture } from "./pg-harness.js";
import { PostgresSearchAcknowledgementStore } from "../infrastructure/relay-acknowledgement-store.js";
import { PostgresSearchRequeueStore } from "../infrastructure/relay-requeue-store.js";
import { PostgresSearchDeadLetterStore } from "../infrastructure/relay-dead-letter-store.js";
import { classifySearchDeadLetterSeverity } from "../domain/relay-dead-letters.js";

const LEDGER_TABLE = "search_relay_consumed_events";
const POISONED_AT = "2026-09-01T00:00:00.000Z";
const LAST_ERROR = "unsupported event_version: v9";
const REASON = "مقبولٌ بقرارِ مالكٍ: المنتجُ حُذِفَ من المصدرِ ولا وجهةَ لتطبيقِهِ";
const ACKNOWLEDGER = "service:ops-console/on-behalf-of:usr_7";
const ACK_AT = new Date("2026-09-20T12:00:00.000Z");

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function seedConsumed(
  pool: PgFixture["pool"],
  row: { outboxId: string; status: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO ${LEDGER_TABLE}
       (outbox_id, event_type, aggregate_type, aggregate_id, status, attempt_count, last_error, consumed_at)
     VALUES ($1::uuid, 'marketplace.product_published', 'product', $1::text, $2, 5, $3, $4::timestamptz)`,
    [row.outboxId, row.status, LAST_ERROR, POISONED_AT],
  );
}

interface AckRow {
  status: string;
  attempt_count: number;
  last_error: string | null;
  consumed_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  acknowledgement_reason: string | null;
}

async function readRow(pool: PgFixture["pool"], outboxId: string): Promise<AckRow | null> {
  const result = await pool.query<AckRow>(
    `SELECT status, attempt_count, last_error, consumed_at,
            acknowledged_at, acknowledged_by, acknowledgement_reason
       FROM ${LEDGER_TABLE} WHERE outbox_id = $1::uuid`,
    [outboxId],
  );
  return result.rows[0] ?? null;
}

/** بصمةُ الجدولِ بكلِّ عمودٍ يُمكنُ أن تمسَّهُ كتابةُ إقرارٍ أو إعادةٍ. */
async function ledgerFingerprint(pool: PgFixture["pool"]): Promise<string> {
  const result = await pool.query<{ fingerprint: string }>(
    `SELECT coalesce(
              string_agg(
                outbox_id::text || '|' || status || '|' || attempt_count::text ||
                '|' || coalesce(last_error, '') || '|' || consumed_at::text ||
                '|' || coalesce(acknowledged_at::text, '') ||
                '|' || coalesce(acknowledged_by, '') ||
                '|' || coalesce(acknowledgement_reason, ''),
                E'\\n' ORDER BY outbox_id
              ), '') AS fingerprint
       FROM ${LEDGER_TABLE}`,
  );
  return result.rows[0]?.fingerprint ?? "";
}

describe.skipIf(!PG_ENABLED)("PostgresSearchAcknowledgementStore integration (G5 · the record)", () => {
  let fixture: PgFixture;

  beforeAll(async () => {
    fixture = await setupPostgres();
  });

  beforeEach(async () => {
    await resetData(fixture.pool);
  });

  afterAll(async () => {
    await fixture.close();
  });

  it("writes the triple and touches NO evidence column", async () => {
    const id = uuid(1);
    await seedConsumed(fixture.pool, { outboxId: id, status: "poisoned" });

    const store = new PostgresSearchAcknowledgementStore(fixture.pool);
    const decision = await store.acknowledgePoisonedEvent({
      ledger: "marketplace",
      outboxId: id,
      acknowledgedBy: ACKNOWLEDGER,
      reason: REASON,
      acknowledgedAt: ACK_AT,
    });
    expect(decision).toEqual({ outcome: "acknowledged" });

    const row = await readRow(fixture.pool, id);
    expect(row?.acknowledged_at?.toISOString()).toBe(ACK_AT.toISOString());
    expect(row?.acknowledged_by).toBe(ACKNOWLEDGER);
    expect(row?.acknowledgement_reason).toBe(REASON);
    /*
     * والحالةُ تبقى `poisoned` ولا تصيرُ حالةً سادسةً: الإقرارُ شهادةٌ على
     * الفقدِ لا إبطالٌ لهُ، وحالةٌ جديدةٌ كانت ستُخرِجَ الصفَّ من كلِّ استعلامٍ
     * يعدُّ المسمومَ — وهوَ الإخفاءُ بعينِهِ.
     */
    expect(row?.status).toBe("poisoned");
    expect(row?.attempt_count).toBe(5);
    expect(row?.last_error).toBe(LAST_ERROR);
    expect(row?.consumed_at.toISOString()).toBe(POISONED_AT);
  });

  it("the DATABASE itself refuses a partial triple (23514) — the guard is not application-only", async () => {
    const id = uuid(2);
    await seedConsumed(fixture.pool, { outboxId: id, status: "poisoned" });

    /*
     * كلُّ تشكيلةٍ ناقصةٍ تُجرَّبُ بـSQL مباشرةً — أي **بتجاوُزِ المُحوِّلِ**:
     * مُشغِّلٌ بـ`psql` أو ترحيلٌ لاحقٌ لا يمرُّ بالرمزِ، والقيدُ هوَ ما يبقى.
     */
    const partials: readonly (readonly [string, readonly unknown[]])[] = [
      ["SET acknowledged_at = $2", [id, ACK_AT]],
      ["SET acknowledged_by = $2", [id, ACKNOWLEDGER]],
      ["SET acknowledgement_reason = $2", [id, REASON]],
      ["SET acknowledged_at = $2, acknowledged_by = $3", [id, ACK_AT, ACKNOWLEDGER]],
    ];
    /*
     * وتُطلَقُ **معاً** لا واحدةً بعدَ واحدةٍ: كلُّ تشكيلةٍ نداءٌ مستقلٌّ يفشلُ
     * وحدَهُ، وتسلسلُها كانَ يضربُ مهلةَ الحالةِ على قاعدةٍ بعيدةٍ — فتُقرأُ
     * المهلةُ عطباً في القيدِ. ولا حرفَ من الحُكمِ يُخفَّفُ: كلُّ واحدةٍ تُرفَضُ
     * بـ`23514` نفسِهِ.
     */
    const outcomes = await Promise.allSettled(
      partials.map(([clause, params]) =>
        fixture.pool.query(
          `UPDATE ${LEDGER_TABLE} ${clause} WHERE outbox_id = $1::uuid`,
          params as unknown[],
        ),
      ),
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual(partials.map(() => "rejected"));
    for (const outcome of outcomes) {
      expect((outcome as PromiseRejectedResult).reason).toMatchObject({ code: "23514" });
    }

    // ولا حرفَ كُتِبَ من كلِّ ما رُفِضَ.
    const row = await readRow(fixture.pool, id);
    expect(row?.acknowledged_at).toBeNull();
    expect(row?.acknowledged_by).toBeNull();
    expect(row?.acknowledgement_reason).toBeNull();
  });

  it("the DATABASE refuses an acknowledgement on a non-poisoned row too", async () => {
    const id = uuid(3);
    await seedConsumed(fixture.pool, { outboxId: id, status: "applied" });
    await expect(
      fixture.pool.query(
        `UPDATE ${LEDGER_TABLE}
            SET acknowledged_at = $2, acknowledged_by = $3, acknowledgement_reason = $4
          WHERE outbox_id = $1::uuid`,
        [id, ACK_AT, ACKNOWLEDGER, REASON],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects not_found and not_poisoned WITHOUT any write — fingerprint identical", async () => {
    const applied = uuid(4);
    await seedConsumed(fixture.pool, { outboxId: applied, status: "applied" });
    const before = await ledgerFingerprint(fixture.pool);

    const store = new PostgresSearchAcknowledgementStore(fixture.pool);
    expect(
      await store.acknowledgePoisonedEvent({
        ledger: "marketplace",
        outboxId: uuid(99),
        acknowledgedBy: ACKNOWLEDGER,
        reason: REASON,
        acknowledgedAt: ACK_AT,
      }),
    ).toEqual({ outcome: "rejected", reason: "not_found", observedStatus: null });

    expect(
      await store.acknowledgePoisonedEvent({
        ledger: "marketplace",
        outboxId: applied,
        acknowledgedBy: ACKNOWLEDGER,
        reason: REASON,
        acknowledgedAt: ACK_AT,
      }),
    ).toEqual({ outcome: "rejected", reason: "not_poisoned", observedStatus: "applied" });

    expect(await ledgerFingerprint(fixture.pool)).toBe(before);
  });

  it("a second acknowledgement returns the FIRST record and overwrites nothing in the row", async () => {
    const id = uuid(5);
    await seedConsumed(fixture.pool, { outboxId: id, status: "poisoned" });
    const store = new PostgresSearchAcknowledgementStore(fixture.pool);

    await store.acknowledgePoisonedEvent({
      ledger: "marketplace",
      outboxId: id,
      acknowledgedBy: ACKNOWLEDGER,
      reason: REASON,
      acknowledgedAt: ACK_AT,
    });
    const afterFirst = await ledgerFingerprint(fixture.pool);

    const second = await store.acknowledgePoisonedEvent({
      ledger: "marketplace",
      outboxId: id,
      acknowledgedBy: "service:someone-else",
      reason: "سببٌ ثانٍ مختلفٌ تماماً عن الأوّلِ ولا يجوزُ أن يُكتَبَ فوقَهُ",
      acknowledgedAt: new Date("2026-09-21T00:00:00.000Z"),
    });
    expect(second).toEqual({
      outcome: "already_acknowledged",
      acknowledgedAt: ACK_AT.toISOString(),
      acknowledgedBy: ACKNOWLEDGER,
      acknowledgementReason: REASON,
    });
    expect(await ledgerFingerprint(fixture.pool)).toBe(afterFirst);
  });

  it("requeue CLEARS the triple — an acknowledgement does not survive the row it judged", async () => {
    const id = uuid(6);
    await seedConsumed(fixture.pool, { outboxId: id, status: "poisoned" });
    await new PostgresSearchAcknowledgementStore(fixture.pool).acknowledgePoisonedEvent({
      ledger: "marketplace",
      outboxId: id,
      acknowledgedBy: ACKNOWLEDGER,
      reason: REASON,
      acknowledgedAt: ACK_AT,
    });

    const requeued = await new PostgresSearchRequeueStore(fixture.pool).requeuePoisonedEvent({
      ledger: "marketplace",
      outboxId: id,
    });
    expect(requeued).toEqual({ outcome: "requeued", previousStatus: "poisoned" });

    const row = await readRow(fixture.pool, id);
    expect(row?.status).toBe("pending");
    expect(row?.acknowledged_at).toBeNull();
    expect(row?.acknowledged_by).toBeNull();
    expect(row?.acknowledgement_reason).toBeNull();
    // والدليلُ ما زالَ قائماً: الإعادةُ لا تمحو سببَ العطبِ.
    expect(row?.last_error).toBe(LAST_ERROR);
    expect(row?.consumed_at.toISOString()).toBe(POISONED_AT);
  });

  it("splits the metric: the acknowledged row leaves the VERDICT and stays in total_poisoned", async () => {
    const acked = uuid(7);
    const open = uuid(8);
    await seedConsumed(fixture.pool, { outboxId: acked, status: "poisoned" });
    await seedConsumed(fixture.pool, { outboxId: open, status: "poisoned" });

    const reader = new PostgresSearchDeadLetterStore(fixture.pool);
    const at = new Date("2026-09-20T12:00:00.000Z");

    const before = await reader.readSearchDeadLetters({ eventTypeLimit: 5 });
    expect(before.totalPoisoned).toBe(2);
    expect(before.totalUnacknowledgedPoisoned).toBe(2);
    expect(before.totalAcknowledgedPoisoned).toBe(0);

    await new PostgresSearchAcknowledgementStore(fixture.pool).acknowledgePoisonedEvent({
      ledger: "marketplace",
      outboxId: acked,
      acknowledgedBy: ACKNOWLEDGER,
      reason: REASON,
      acknowledgedAt: ACK_AT,
    });

    const after = await reader.readSearchDeadLetters({ eventTypeLimit: 5 });
    // الواقعُ لم ينقُصْ: اثنانِ مسمومانِ، والإقرارُ لم يُخفِ صفّاً.
    expect(after.totalPoisoned).toBe(2);
    expect(after.totalAcknowledgedPoisoned).toBe(1);
    expect(after.totalUnacknowledgedPoisoned).toBe(1);
    expect(after.ledgers[0]?.acknowledgedPoisoned).toBe(1);
    expect(after.ledgers[0]?.unacknowledgedPoisoned).toBe(1);
    expect(after.ledgers[0]?.oldestPoisonedAt).toBe(POISONED_AT);
    expect(after.ledgers[0]?.oldestUnacknowledgedPoisonedAt).toBe(POISONED_AT);
    // والحكمُ قائمٌ ما بقيَ صفٌّ غيرُ مُقَرٍّ بهِ.
    expect(classifySearchDeadLetterSeverity(after, at).severity).not.toBe("ok");

    await new PostgresSearchAcknowledgementStore(fixture.pool).acknowledgePoisonedEvent({
      ledger: "marketplace",
      outboxId: open,
      acknowledgedBy: ACKNOWLEDGER,
      reason: REASON,
      acknowledgedAt: ACK_AT,
    });

    const all = await reader.readSearchDeadLetters({ eventTypeLimit: 5 });
    expect(all.totalPoisoned).toBe(2);
    expect(all.totalUnacknowledgedPoisoned).toBe(0);
    expect(all.ledgers[0]?.oldestUnacknowledgedPoisonedAt).toBeNull();
    /*
     * وهنا الحدُّ المُعلَنُ لهذهِ الموجةِ: الحكمُ يعودُ `ok` بسببٍ **يُسمّي
     * نفسَهُ** (`all_poisoned_acknowledged`) لا بسببِ «لا مسمومَ» — فمَن يقرأُ
     * لوحةً يرى فرقَ «نظيفٌ» عن «مُقَرٌّ بهِ»، ولا يُقرأُ التصميتُ نظافةً.
     */
    const verdict = classifySearchDeadLetterSeverity(all, at);
    expect(verdict.severity).toBe("ok");
    expect(verdict.because).toBe("all_poisoned_acknowledged");
    expect(verdict.oldestUnacknowledgedPoisonedAgeSeconds).toBeNull();
  });
});
