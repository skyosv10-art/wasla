/**
 * إقرارُ صفٍّ مسمومٍ — على قاعدةٍ حقيقيّةٍ (المراجعةُ 24/N · `M5-13` · §4.27).
 *
 * ما تُثبِتُهُ هذهِ الاختباراتُ ولا يستطيعُ بديلُ ذاكرةٍ إثباتَهُ:
 *
 *   • **الإقرارُ يُضيفُ ولا يمحو**: `consumed_status` و`attempt_count`
 *     و`last_error` و`updated_at` **كما هيَ بعدَ الإقرارِ حرفاً** — دعوى على
 *     أعمدةٍ في القاعدةِ لا على نيّةٍ في تعليقٍ.
 *   • **قيودُ القاعدةِ هيَ المُنفِّذُ**: سببٌ من أحدَ عشرَ حرفاً يُرفَضُ
 *     بـ`23514` **من القاعدةِ نفسِها** لا من الشيفرةِ؛ وثلاثيٌّ ناقصٌ مرفوضٌ؛
 *     وإقرارٌ على صفٍّ غيرِ مسمومٍ مرفوضٌ.
 *   • **الإقرارُ الثاني لا يكتبُ فوقَ الأوّلِ**، والمعاملةُ تتراجَعُ فلا أثرَ.
 *   • **الرفضُ لا يكتبُ شيئاً**: بصمةُ الجدولَينِ لا تتغيَّرُ.
 *   • **والمقياسُ يتحرَّكُ فعلاً**: `total_poisoned` يبقى، و`unacknowledged`
 *     ينقُصُ، والحكمُ يعودُ إلى `ok` بسببِ الإقرارِ لا بسببِ الخلوِّ — وهذا هوَ
 *     الرابطُ بينَ المحضرِ والعينِ.
 *   • **وإعادةٌ بعدَ إقرارٍ تمحو الإقرارَ في القاعدةِ** (§4.25 + القيدُ) فلا
 *     يَعبُرُ حكمُ «عُولِجَ» إلى حياةٍ ثانيةٍ للصفِّ.
 *
 * يُتخطّى حينَ لا `DATABASE_URL` (docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { PG_ENABLED, resetData, setupPostgres, type PgFixture } from "./pg-harness.js";
import { PostgresRelayAcknowledgementStore } from "../infrastructure/relay-dead-letter-acknowledgement-store.js";
import { PostgresRelayRequeueStore } from "../infrastructure/relay-requeue-store.js";
import { PostgresRelayDeadLetterStore } from "../infrastructure/relay-dead-letter-store.js";
import { classifyRelayDeadLetterSeverity } from "../domain/relay-dead-letters.js";

const T0 = "2026-09-15T00:00:00.000Z";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BY = "service:ops-console/on-behalf-of:usr_01HQZX";
const REASON = "منتِجٌ أُصلِحَ والحدثُ لا يُعادُ — RISK-0021";

let fixture: PgFixture;

async function seedDispatch(
  pool: Pool,
  row: { eventId: string; status: string; attemptCount?: number; lastError?: string | null },
): Promise<void> {
  await pool.query(
    `INSERT INTO delivery_relay_consumed_events
       (event_id, event_type, aggregate_type, aggregate_id, consumed_status,
        attempt_count, last_error, consumed_at, updated_at)
     VALUES ($1::uuid, 'dispatch.job_completed', 'dispatch_job', 'job-agg-1', $2, $3, $4,
             $5::timestamptz, $5::timestamptz)`,
    [row.eventId, row.status, row.attemptCount ?? 6, row.lastError ?? "boom", T0],
  );
}

interface RowSnapshot {
  readonly consumed_status: string;
  readonly attempt_count: number;
  readonly last_error: string | null;
  readonly updated_at: Date;
  readonly acknowledged_at: Date | null;
  readonly acknowledged_by: string | null;
  readonly acknowledgement_reason: string | null;
}

async function readRow(pool: Pool, eventId: string): Promise<RowSnapshot> {
  const res = await pool.query<RowSnapshot>(
    `SELECT consumed_status, attempt_count, last_error, updated_at,
            acknowledged_at, acknowledged_by, acknowledgement_reason
       FROM delivery_relay_consumed_events
      WHERE event_id = $1::uuid`,
    [eventId],
  );
  return res.rows[0]!;
}

/** بصمةُ الدفترِ بكلِّ ما يمسُّهُ الإقرارُ — لإثباتِ «لا أثرَ» في الرفضِ. */
async function fingerprint(pool: Pool): Promise<string> {
  const res = await pool.query<{ fingerprint: string }>(
    `SELECT coalesce(string_agg(line, '|' ORDER BY line), '∅') AS fingerprint
       FROM (
         SELECT event_id::text || ':' || consumed_status || ':' || attempt_count::text || ':' ||
                coalesce(last_error, '∅') || ':' || updated_at::text || ':' ||
                coalesce(acknowledged_at::text, '∅') || ':' || coalesce(acknowledged_by, '∅') ||
                ':' || coalesce(acknowledgement_reason, '∅') AS line
           FROM delivery_relay_consumed_events
       ) rows`,
  );
  return res.rows[0]!.fingerprint;
}

describe.skipIf(!PG_ENABLED)("PostgresRelayAcknowledgementStore — على قاعدةٍ حقيقيّةٍ", () => {
  beforeEach(async () => {
    fixture = await setupPostgres();
    await resetData(fixture.pool);
  });

  afterEach(async () => {
    await fixture.close();
  });

  it("**الإقرارُ يُضيفُ ولا يمحو**: الحالةُ والمحاولاتُ والخطأُ و`updated_at` كما هيَ", async () => {
    const pool = fixture.pool;
    const eventId = uuid(1);
    await seedDispatch(pool, { eventId, status: "poisoned", attemptCount: 6, lastError: "boom" });
    const before = await readRow(pool, eventId);

    const store = new PostgresRelayAcknowledgementStore(pool);
    const decision = await store.acknowledgePoisonedEvent({
      ledger: "dispatch",
      eventId,
      acknowledgedBy: BY,
      reason: REASON,
      acknowledgedAt: "2026-09-15T09:00:00.000Z",
    });

    expect(decision).toEqual({ outcome: "acknowledged" });

    const after = await readRow(pool, eventId);
    // الدليلُ لا يُمَسُّ: أربعةُ أعمدةٍ **مقيسةٌ** لا مذكورةٌ في تعليقٍ.
    expect(after.consumed_status).toBe("poisoned");
    expect(after.attempt_count).toBe(before.attempt_count);
    expect(after.last_error).toBe(before.last_error);
    // و`updated_at` هوَ مقياسُ عمرِ الفقدِ في §4.23: تقديمُهُ بالإقرارِ كانَ
    // سيُصغِّرُ عمرَ صفٍّ لم يُعالَجْ — أي تحسينَ رقمٍ بلا تحسينِ واقعٍ.
    expect(after.updated_at.toISOString()).toBe(before.updated_at.toISOString());
    // والثلاثيُّ كُتِبَ كاملاً.
    expect(after.acknowledged_at?.toISOString()).toBe("2026-09-15T09:00:00.000Z");
    expect(after.acknowledged_by).toBe(BY);
    expect(after.acknowledgement_reason).toBe(REASON);
  });

  it("نداءٌ ثانٍ ⇒ `already_acknowledged` **وإقرارُ الأوّلِ باقٍ حرفاً**", async () => {
    const pool = fixture.pool;
    const eventId = uuid(2);
    await seedDispatch(pool, { eventId, status: "poisoned" });
    const store = new PostgresRelayAcknowledgementStore(pool);

    await store.acknowledgePoisonedEvent({
      ledger: "dispatch",
      eventId,
      acknowledgedBy: BY,
      reason: REASON,
      acknowledgedAt: "2026-09-15T09:00:00.000Z",
    });
    const afterFirst = await fingerprint(pool);

    const second = await store.acknowledgePoisonedEvent({
      ledger: "dispatch",
      eventId,
      acknowledgedBy: "service:other/on-behalf-of:usr_SECOND",
      reason: "سببُ الثاني الذي لا يُكتَبُ في الدفترِ",
      acknowledgedAt: "2026-09-15T10:00:00.000Z",
    });

    expect(second).toEqual({
      outcome: "already_acknowledged",
      acknowledgedAt: "2026-09-15T09:00:00.000Z",
      acknowledgedBy: BY,
      acknowledgementReason: REASON,
    });
    // **ولا أثرَ في القاعدةِ**: المعاملةُ تراجعَت، ودفترُ مسؤوليّةٍ يُكتَبُ فوقَ
    // أوّلِ شاهدٍ فيهِ ليسَ دفترَ مسؤوليّةٍ.
    expect(await fingerprint(pool)).toBe(afterFirst);
  });

  it("لا صفَّ ⇒ `not_found` **ولا أثرَ**؛ وصفٌّ `pending` ⇒ `not_poisoned` بالحالةِ المقروءةِ", async () => {
    const pool = fixture.pool;
    const pendingId = uuid(3);
    await seedDispatch(pool, { eventId: pendingId, status: "pending" });
    const before = await fingerprint(pool);
    const store = new PostgresRelayAcknowledgementStore(pool);

    expect(
      await store.acknowledgePoisonedEvent({
        ledger: "dispatch",
        eventId: uuid(999),
        acknowledgedBy: BY,
        reason: REASON,
        acknowledgedAt: "2026-09-15T09:00:00.000Z",
      }),
    ).toEqual({ outcome: "rejected", reason: "not_found", observedStatus: null });

    expect(
      await store.acknowledgePoisonedEvent({
        ledger: "dispatch",
        eventId: pendingId,
        acknowledgedBy: BY,
        reason: REASON,
        acknowledgedAt: "2026-09-15T09:00:00.000Z",
      }),
    ).toEqual({ outcome: "rejected", reason: "not_poisoned", observedStatus: "pending" });

    expect(await fingerprint(pool)).toBe(before);
  });

  /* ══════════════════════════════════════════════════════════════════════
   * القيودُ — **القاعدةُ هيَ المُنفِّذُ** لا الشيفرةُ
   * ════════════════════════════════════════════════════════════════════ */

  it("سببٌ أقصرُ من اثنَي عشرَ حرفاً يُرفَضُ **من القاعدةِ** (`23514`)", async () => {
    const pool = fixture.pool;
    const eventId = uuid(4);
    await seedDispatch(pool, { eventId, status: "poisoned" });

    // كتابةٌ مباشرةٌ تتجاوزُ الحدَّ HTTP والمُحوِّلَ: الدعوى أنَّ الحدَّ الأدنى
    // **مفروضٌ في القاعدةِ**، فلا يُلتَفُّ عليهِ بمسارٍ إداريٍّ أو هجرةِ بياناتٍ.
    await expect(
      pool.query(
        `UPDATE delivery_relay_consumed_events
            SET acknowledged_at = now(), acknowledged_by = $2, acknowledgement_reason = $3
          WHERE event_id = $1::uuid`,
        [eventId, BY, "x".repeat(11)],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("ثلاثيٌّ ناقصٌ يُرفَضُ **من القاعدةِ**: كلٌّ أو لا شيءَ", async () => {
    const pool = fixture.pool;
    const eventId = uuid(5);
    await seedDispatch(pool, { eventId, status: "poisoned" });

    await expect(
      pool.query(
        `UPDATE delivery_relay_consumed_events SET acknowledged_at = now() WHERE event_id = $1::uuid`,
        [eventId],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      pool.query(
        `UPDATE delivery_relay_consumed_events
            SET acknowledged_by = $2, acknowledgement_reason = $3
          WHERE event_id = $1::uuid`,
        [eventId, BY, REASON],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("إقرارٌ على صفٍّ **غيرِ مسمومٍ** يُرفَضُ من القاعدةِ ولو التُفَّ على الشيفرةِ", async () => {
    const pool = fixture.pool;
    const eventId = uuid(6);
    await seedDispatch(pool, { eventId, status: "applied" });

    await expect(
      pool.query(
        `UPDATE delivery_relay_consumed_events
            SET acknowledged_at = now(), acknowledged_by = $2, acknowledgement_reason = $3
          WHERE event_id = $1::uuid`,
        [eventId, BY, REASON],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  /* ══════════════════════════════════════════════════════════════════════
   * الرابطُ بالعينِ (§4.23) وباليدِ (§4.24 · §4.25)
   * ════════════════════════════════════════════════════════════════════ */

  it("المقياسُ: `total_poisoned` **يبقى** والحكمُ يعودُ `ok` بسببِ الإقرارِ", async () => {
    const pool = fixture.pool;
    const eventId = uuid(7);
    await seedDispatch(pool, { eventId, status: "poisoned" });

    const metrics = new PostgresRelayDeadLetterStore(pool);
    const before = await metrics.readRelayDeadLetters({ eventTypeLimit: 10 });
    expect(before.totalPoisoned).toBe(1);
    expect(before.totalUnacknowledgedPoisoned).toBe(1);
    expect(classifyRelayDeadLetterSeverity(before, new Date()).severity).toBe("warning");

    await new PostgresRelayAcknowledgementStore(pool).acknowledgePoisonedEvent({
      ledger: "dispatch",
      eventId,
      acknowledgedBy: BY,
      reason: REASON,
      acknowledgedAt: new Date().toISOString(),
    });

    const after = await metrics.readRelayDeadLetters({ eventTypeLimit: 10 });
    // **العددُ الكلِّيُّ لم ينقُصْ**: هذا هوَ الحدُّ بينَ الإقرارِ ومحوِ الدليلِ.
    expect(after.totalPoisoned).toBe(1);
    expect(after.totalAcknowledgedPoisoned).toBe(1);
    expect(after.totalUnacknowledgedPoisoned).toBe(0);

    const verdict = classifyRelayDeadLetterSeverity(after, new Date());
    expect(verdict.severity).toBe("ok");
    expect(verdict.because).toBe("all_poisoned_acknowledged");
  });

  it("**إعادةٌ بعدَ إقرارٍ تمحو الإقرارَ**: حكمُ «عُولِجَ» لا يَعبُرُ إلى حياةٍ ثانيةٍ", async () => {
    const pool = fixture.pool;
    const eventId = uuid(8);
    await seedDispatch(pool, { eventId, status: "poisoned" });

    await new PostgresRelayAcknowledgementStore(pool).acknowledgePoisonedEvent({
      ledger: "dispatch",
      eventId,
      acknowledgedBy: BY,
      reason: REASON,
      acknowledgedAt: "2026-09-15T09:00:00.000Z",
    });
    expect((await readRow(pool, eventId)).acknowledged_by).toBe(BY);

    const requeue = await new PostgresRelayRequeueStore(pool).requeuePoisonedEvent({
      ledger: "dispatch",
      eventId,
    });
    expect(requeue.outcome).toBe("requeued");

    const after = await readRow(pool, eventId);
    expect(after.consumed_status).toBe("pending");
    // القيدُ `ck_…_ack_poisoned_only` يُوجِبُ ذلكَ؛ ولو بقيَ الثلاثيُّ لسقطَت
    // المعاملةُ بـ`23514` — فلا سهوَ في شيفرةٍ يُمرِّرُ إقراراً منسوخاً.
    expect(after.acknowledged_at).toBeNull();
    expect(after.acknowledged_by).toBeNull();
    expect(after.acknowledgement_reason).toBeNull();
    // والدليلُ باقٍ بعدَ الإعادةِ كما أعلنَ §4.24.
    expect(after.attempt_count).toBe(6);
    expect(after.last_error).toBe("boom");
  });
});
