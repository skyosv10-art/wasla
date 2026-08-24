/**
 * صندوقُ الصادرِ ومستهلكُ الوقائعِ فوق Postgres — **معاملةٌ واحدةٌ للحقيقةِ وحدثِها**.
 *
 * ما يُثبته هذا الملفُّ ولا يستطيع أن يُثبته اختبارٌ نقيّ:
 *
 *  1. **الذرّية**: منحُ مُدّةٍ وكتابةُ انتقالٍ وكتابةُ حدثٍ في معاملةٍ واحدة. والمِسبارُ
 *     يُجهضها في منتصفِها فلا يبقى **شيء**: لا مُدّةٌ ولا انتقالٌ ولا صفٌّ في الصادر. وهذا
 *     هو الدَّينُ المُعلَنُ في HANDOFF §18.9 البند 6، ويُسدَّد هنا لا يُوصَف.
 *  2. **التسليمُ مرّةً على الأقلّ لا مرّتين فعليّاً**: `claimUnpublished` يقفل الصفوفَ
 *     (`FOR UPDATE SKIP LOCKED`)، و`markPublished` شرطيٌّ فيعيد `false` لصفٍّ نُشر سابقاً.
 *     فناشرٌ ثانٍ يجد **صفراً** لا نسخةً ثانية.
 *  3. **فشلُ منفذٍ لا يُسقط الدفعة**: صفٌّ يفشل يُسجَّل سببُه ويبقى غيرَ منشورٍ، ومن بعده
 *     يُنشَر. ومن جعل الفشلَ يرفع كان سيوقف بريدَ الخدمةِ كلَّه على مستهلكٍ واحدٍ معطوب.
 *  4. **خمسُ وقائعَ تُؤهّل، والسادسةُ لا تُكافئ ثانيةً**: الطريقُ الكاملُ من واقعةِ سمعةٍ
 *     إلى مُدّةٍ ممنوحةٍ للمُحيل — مدّةٌ لا رصيد.
 *  5. **الواقعةُ المُعادةُ لا تُحسَب**: نفسُ `fact_id` مرّتين ⇒ `duplicate`، والعدُّ لا يزيد.
 *     وهذا هو الفرقُ بين نظامٍ يُكافئ على عملٍ ونظامٍ يُكافئ على إعادةِ تسليمِ وسيط.
 *
 * واللحظاتُ ثوابتُ نصّيّة، والمُعرِّفاتُ من مُوَلِّدٍ تسلسليّ: اختبارٌ يقرأ الساعةَ يفشل
 * مرّةً كلَّ ألفِ تشغيلٍ فيُعلَّم بأنّه «متقلّب» ثمّ يُهمَل.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DRAIN_BATCH_LIMIT,
  drainSubscriptionOutbox,
  sequentialUuidGenerator,
  unconfiguredEventSink,
  type EventSinkPort,
} from "../app/events.js";
import { CONSUMED_EVENT_TYPE, ReputationFactConsumer } from "../app/facts.js";
import { ReferralService } from "../app/referrals.js";
import { SubscriptionService } from "../app/subscriptions.js";
import { SubscriptionUnitOfWork, type TransactionProbe } from "../db/unit-of-work.js";
import type { OutboxRow } from "../db/outbox.js";
import { LAUNCH_PLAN } from "../domain/plans.js";
import { addDays } from "../domain/time.js";
import type { Clock } from "../domain/time.js";
import {
  DRIVER,
  OTHER_DRIVER,
  PG_ENABLED,
  T0,
  countRows,
  outboxSnapshot,
  resetData,
  setupPostgres,
  type PgFixture,
} from "./pg-harness.js";

/**
 * ساعةُ الخدمة: **بعد** نهايةِ تجربةِ `T0` وقبل نهايةِ تغطيةِ الدفع.
 *
 * وهذا اختيارٌ لا تفصيل: المُحيلُ يجب أن يكون `active` لحظةَ التأهّل (شرطُ المجال)، ومن
 * دفع في اليومِ الأوّلِ يبقى `trial` حتى تنتهي تجربتُه — فساعةٌ مبكّرةٌ كانت تُنتج رفضاً
 * (`referrer_not_active`) يبدو خللاً في المستهلكِ وهو خللٌ في المُهيئ.
 */
const NOW = "2026-03-20T00:00:00.000Z";
const clock: Clock = { now: () => NOW };

/** منفذٌ في الذاكرة: يجمع ما سُلِّم، ويفشل على مُعرِّفاتٍ مُعلَنةٍ سلفاً. */
function recordingSink(failOn: ReadonlySet<string> = new Set()): {
  readonly sink: EventSinkPort;
  readonly delivered: OutboxRow[];
} {
  const delivered: OutboxRow[] = [];
  return {
    delivered,
    sink: {
      deliver: async (row) => {
        if (failOn.has(row.eventId)) throw new Error(`منفذٌ مرفوضٌ للحدث ${row.eventId}`);
        delivered.push(row);
      },
    },
  };
}

/** مُعرِّفٌ متوقَّعٌ بشكلِ UUID: أعمدةُ `source_event_id` و`event_id` أنواعُ `uuid` في القاعدة. */
function uuidAt(group: number, index: number): string {
  return `00000000-0000-4000-8${group.toString(16).padStart(3, "0")}-${String(index).padStart(12, "0")}`;
}

/**
 * واقعةُ سمعةٍ كما يُصدرها المُنتِج — بمُعرِّفاتٍ صالحةٍ لا نصوصٍ لطيفة.
 *
 * ومُعرِّفُ الحدثِ يدخل `subscription_periods.source_event_id` عند المكافأة، وهو عمودُ `uuid`.
 * فنصٌّ مثل `fact-evt-1` كان يُسقط الإدخالَ بـ`22P02` في منتصفِ معاملةٍ — وهذا بالضبط ما
 * كشفه هذا الملفُّ، ولا يستطيع اختبارٌ نقيٌّ أن يكشفه لأنّه لا يعرف أنواعَ الأعمدة.
 */
function factPayload(index: number, subject = OTHER_DRIVER, factKind = "order_completed"): Record<string, unknown> {
  return {
    event_id: uuidAt(0xf01, index),
    event_type: CONSUMED_EVENT_TYPE,
    trace_id: "trace-من-السمعة",
    data: {
      fact_id: uuidAt(0xf02, index),
      subject_type: "driver",
      subject_public_id: subject,
      fact_kind: factKind,
      order_public_id: `WO-${index}`,
      occurred_for: addDays(T0, 18),
    },
  };
}

describe.skipIf(!PG_ENABLED)("صندوقُ الصادرِ وأحداثُه فوق Postgres", () => {
  let pg: PgFixture;
  let uow: SubscriptionUnitOfWork;
  let subscriptions: SubscriptionService;
  let referrals: ReferralService;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  beforeEach(async () => {
    await resetData(pg.pool);
    uow = new SubscriptionUnitOfWork(pg.db);
    subscriptions = new SubscriptionService(uow, clock, sequentialUuidGenerator(1));
    referrals = new ReferralService(uow, clock);
  });

  afterAll(async () => {
    await pg?.close();
  });

  async function outboxRows() {
    return outboxSnapshot(pg.pool);
  }

  async function startTrial(driver = DRIVER, requestedAt = T0) {
    return subscriptions.startTrial({
      driverPublicId: driver,
      planCode: LAUNCH_PLAN.planCode,
      planVersion: LAUNCH_PLAN.planVersion,
      requestedAt,
      trace: { traceId: "trace-بدء" },
    });
  }

  // -------------------------------------------------------------------------
  // 1 · الحدثُ يُكتَب مع الحقيقةِ في المعاملةِ نفسِها
  // -------------------------------------------------------------------------

  it("بدءُ التجربةِ يكتب حدثاً واحداً في الصادر، وحمولتُه المغلَّفُ كاملاً", async () => {
    const outcome = await startTrial();
    const rows = await outboxRows();

    expect(outcome.eventIds).toHaveLength(1);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.eventId).toBe(outcome.eventIds[0]);
    expect(row.eventType).toBe("subscription.trial_started");
    expect(row.aggregateType).toBe("subscription");
    expect(row.publishedAt).toBeNull();
    expect(row.attempts).toBe(0);
    expect(row.lastError).toBeNull();
    // الحمولةُ تُقرأ من العمود لا من الذاكرة: `jsonb` يُعيد ترتيبَ المفاتيح، فالفحصُ على
    // القيمِ لا على النصّ — ومن قارن نصّاً كان سيكتب اختباراً يفشل لسببِ تخزين.
    const payload = row.payload as { readonly data: { readonly to_state: string } };
    expect(payload.data.to_state).toBe("trial");
    expect(row.traceId).toBe("trace-بدء");
  });

  it("وإعادةُ حسابٍ تعبر حالتَين فتكتب حدثَين — حدثٌ لكلّ انتقالٍ لا حدثٌ لكلّ نداء", async () => {
    await startTrial();
    const outcome = await subscriptions.recompute(DRIVER, { traceId: "trace-إعادة" });

    expect(outcome.rebuilt).toBe(true);
    const rows = await outboxRows();
    // حدثان لا ثلاثة: التجربةُ انقضت قبل ساعةِ الخدمة، ومهلةُ المجتمعِ **لم** تنقضِ بعد.
    // والاختبارُ يُثبت العددَ الصحيحَ لا العددَ الأكبر: توقُّعُ ثلاثةٍ كان سيُلزمنا بساعةٍ
    // أبعدَ تُفسد شرطَ التأهّلِ في بقيّةِ الملفّ.
    expect(rows.map((row) => row.eventType)).toEqual([
      "subscription.trial_started",
      "subscription.expired",
    ]);
    // والتسلسلُ في الحمولةِ يقابل تسلسلَ الصفوف: 1 ثمّ 2 ثمّ 3، فمن قرأ الأحداثَ وحدَها
    // يستطيع أن يبنيَ نفسَ الطريقِ دون أن يسألنا.
    const sequences = rows.map(
      (row) => (row.payload as { readonly data: { readonly state_sequence: number } }).data.state_sequence,
    );
    expect(sequences).toEqual([1, 2]);
  });

  it("والإجهاضُ في منتصفِ المعاملةِ لا يُبقي مُدّةً ولا انتقالاً ولا حدثاً", async () => {
    // الدَّينُ المُعلَنُ (HANDOFF §18.9 · 6): «الذرّيةُ موصوفةٌ ولم تُثبَت». والمِسبارُ يُجهض
    // بعد كتابةِ الانتقالِ — أي بعد أن كُتب في المعاملةِ كلُّ ما يُفترض أن يُلغى معاً.
    const abort: TransactionProbe = async (stage) => {
      if (stage === "after-transition") throw new Error("إجهاضٌ مقصودٌ في الاختبار");
    };
    const aborting = new SubscriptionUnitOfWork(pg.db, abort);
    const service = new SubscriptionService(aborting, clock, sequentialUuidGenerator(2));

    await expect(
      service.startTrial({
        driverPublicId: DRIVER,
        planCode: LAUNCH_PLAN.planCode,
        planVersion: LAUNCH_PLAN.planVersion,
        requestedAt: T0,
        trace: { traceId: "trace-إجهاض" },
      }),
    ).rejects.toThrow("إجهاضٌ مقصودٌ");

    expect(await countRows(pg.pool, "subscription_periods")).toBe(0);
    expect(await countRows(pg.pool, "subscription_transitions")).toBe(0);
    expect(await countRows(pg.pool, "subscriptions")).toBe(0);
    expect(await countRows(pg.pool, "subscription_outbox")).toBe(0);
    // ولا رمزَ إحالةٍ كذلك: الأربعةُ آثارٌ لمعاملةٍ واحدةٍ، فإمّا كلُّها أو لا شيء.
    expect(await countRows(pg.pool, "referral_codes")).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 2 · الناشرُ: مرّةً على الأقلّ، ولا مرّتين فعليّاً
  // -------------------------------------------------------------------------

  it("الناشرُ يُسلّم ما لم يُنشَر ثمّ يجد الصندوقَ فارغاً — لا نسخةَ ثانية", async () => {
    await startTrial();
    await startTrial(OTHER_DRIVER, addDays(T0, 1));

    const first = recordingSink();
    const report = await drainSubscriptionOutbox(uow, first.sink, { clock });
    expect(report).toEqual({ claimed: 2, published: 2, failed: [], alreadyPublished: 0 });
    expect(first.delivered.map((row) => row.eventType)).toEqual([
      "subscription.trial_started",
      "subscription.trial_started",
    ]);

    const second = recordingSink();
    const again = await drainSubscriptionOutbox(uow, second.sink, { clock });
    expect(again).toEqual({ claimed: 0, published: 0, failed: [], alreadyPublished: 0 });
    expect(second.delivered).toHaveLength(0);

    const rows = await outboxRows();
    // القيمةُ تُقرأ من عمودِ `timestamptz`، فالمقياسُ «مختومٌ» لا مساواةُ نصٍّ: تنسيقُ
    // القراءةِ يتبع منطقةَ الجلسة، ومقارنةُ نصٍّ كانت ستجعل الاختبارَ رهنَ إعدادِ خادم.
    expect(rows.every((row) => row.publishedAt !== null)).toBe(true);
    expect(rows.every((row) => row.attempts === 1)).toBe(true);
  });

  it("وفشلُ منفذٍ يُسجَّل سببُه ويبقى الصفُّ غيرَ منشورٍ — والدفعةُ تُكمل بقيّتَها", async () => {
    await startTrial();
    await startTrial(OTHER_DRIVER, addDays(T0, 1));
    const [doomed, healthy] = (await outboxRows()).map((row) => row.eventId);

    const { sink, delivered } = recordingSink(new Set([doomed!]));
    const report = await drainSubscriptionOutbox(uow, sink, { clock });

    expect(report.claimed).toBe(2);
    expect(report.published).toBe(1);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.eventId).toBe(doomed);
    expect(report.failed[0]?.reason).toContain(doomed!);
    expect(delivered.map((row) => row.eventId)).toEqual([healthy]);

    const rows = await outboxRows();
    const failedRow = rows.find((row) => row.eventId === doomed)!;
    expect(failedRow.publishedAt).toBeNull();
    expect(failedRow.attempts).toBe(1);
    expect(failedRow.lastError).toContain("منفذٌ مرفوض");

    // ثمّ يتعافى المنفذُ فيُسلَّم الصفُّ الباقي: التسليمُ مؤجّلٌ لا مفقود.
    const retry = recordingSink();
    const after = await drainSubscriptionOutbox(uow, retry.sink, { clock });
    expect(after.published).toBe(1);
    expect(retry.delivered.map((row) => row.eventId)).toEqual([doomed]);
    expect((await outboxRows()).find((row) => row.eventId === doomed)?.attempts).toBe(2);
  });

  it("والحدُّ يُحترَم: دفعةٌ بحدٍّ واحدٍ تُسلّم صفّاً واحداً وتترك الباقي", async () => {
    await startTrial();
    await startTrial(OTHER_DRIVER, addDays(T0, 1));

    const { sink, delivered } = recordingSink();
    const report = await drainSubscriptionOutbox(uow, sink, { limit: 1, clock });
    expect(report.claimed).toBe(1);
    expect(delivered).toHaveLength(1);
    expect((await outboxRows()).filter((row) => row.publishedAt === null)).toHaveLength(1);
    expect(DRAIN_BATCH_LIMIT).toBe(100);
  });

  it("وحدٌّ غيرُ صحيحٍ يُرفَض، ومنفذٌ غيرُ مُهيَّأٍ يُعلن نفسَه ولا يُبلع الحدث", async () => {
    await expect(
      drainSubscriptionOutbox(uow, recordingSink().sink, { limit: 0, clock }),
    ).rejects.toThrow(RangeError);

    await startTrial();
    const report = await drainSubscriptionOutbox(uow, unconfiguredEventSink("لا ناقلَ في هذه البيئة"), {
      clock,
    });
    // لا يُرفَع الخطأُ إلى الأعلى: الصفُّ يُسجّل سببَه ويبقى، فتشغيلٌ بلا ناقلٍ يُراكم
    // بريداً لا يفقده. ومن جعله يرفع كان سيُسقط النبضةَ في بيئةٍ لم يُوصَل ناقلُها بعد.
    expect(report.published).toBe(0);
    expect(report.failed[0]?.reason).toContain("لا ناقلَ في هذه البيئة");
    expect((await outboxRows())[0]?.publishedAt).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 3 · مستهلكُ وقائعِ السمعة: من واقعةٍ إلى مُدّةٍ ممنوحة
  // -------------------------------------------------------------------------

  describe("مستهلكُ الوقائع", () => {
    let consumer: ReputationFactConsumer;

    beforeEach(async () => {
      consumer = new ReputationFactConsumer(uow, clock, sequentialUuidGenerator(3));
      // مُحيلٌ سارٍ (دفع) ومُحالٌ في تجربةٍ ثمّ مطالبةٌ قائمة — شرطُ التأهّلِ كما يُعلنه المجال.
      await startTrial();
      await subscriptions.activate({
        driverPublicId: DRIVER,
        paymentReference: "PAY-0000000001",
        planCode: LAUNCH_PLAN.planCode,
        planVersion: LAUNCH_PLAN.planVersion,
        activatedAt: addDays(T0, 1),
        trace: { traceId: "trace-تفعيل" },
      });
      await startTrial(OTHER_DRIVER, addDays(T0, 1));
      await subscriptions.activate({
        driverPublicId: OTHER_DRIVER,
        paymentReference: "PAY-0000000002",
        planCode: LAUNCH_PLAN.planCode,
        planVersion: LAUNCH_PLAN.planVersion,
        activatedAt: addDays(T0, 2),
        trace: { traceId: "trace-تفعيل-2" },
      });
      await referrals.claim({
        referralCode: (await referrals.getCode(DRIVER)).referralCode,
        refereePublicId: OTHER_DRIVER,
        claimedAt: addDays(T0, 17),
        traceId: "trace-مطالبة",
      });
    });

    it("واقعةٌ مؤهِّلةٌ تُحسَب ولا تُكافئ قبل العتبة", async () => {
      const outcome = await consumer.record(factPayload(1));
      expect(outcome.verdict).toBe("counted");
      expect(outcome.qualifyingFactCount).toBe(1);
      expect(outcome.rewardId).toBeNull();
      expect(await countRows(pg.pool, "referral_rewards")).toBe(0);
      expect(LAUNCH_PLAN.referralQualifyingFacts).toBe(5);
    });

    it("ونفسُ الواقعةِ مرّتين لا تُحسَب مرّتين — المفتاحُ هو `fact_id` لا لحظةُ التسليم", async () => {
      await consumer.record(factPayload(1));
      const replay = await consumer.record(factPayload(1));
      expect(replay.verdict).toBe("duplicate");
      const state = await referrals.list({ refereePublicId: OTHER_DRIVER });
      expect(state[0]?.qualifyingFactCount).toBe(1);
      expect(await countRows(pg.pool, "subscription_idempotency")).toBe(1);
    });

    it("والخمسُ تُؤهّل وتُكافئ: مُدّةٌ للمُحيل بأيّامِ الخطّةِ لا برصيد", async () => {
      const outcomes = [];
      for (let index = 1; index <= LAUNCH_PLAN.referralQualifyingFacts; index += 1) {
        outcomes.push(await consumer.record(factPayload(index)));
      }

      expect(outcomes.slice(0, 4).map((outcome) => outcome.verdict)).toEqual([
        "counted",
        "counted",
        "counted",
        "counted",
      ]);
      const rewarded = outcomes[4]!;
      expect(rewarded.verdict).toBe("rewarded");
      expect(rewarded.qualifyingFactCount).toBe(LAUNCH_PLAN.referralQualifyingFacts);
      expect(rewarded.rewardDays).toBe(LAUNCH_PLAN.referralRewardDays);
      expect(rewarded.grantedPeriodId).not.toBeNull();
      // ثلاثةُ أحداثٍ لهذه الواقعةِ: تأهّلٌ ثمّ انتقالُ الاشتراكِ (إن وقع) ثمّ مكافأة.
      expect(rewarded.eventIds.length).toBeGreaterThanOrEqual(2);

      const referral = (await referrals.list({ refereePublicId: OTHER_DRIVER }))[0]!;
      expect(referral.state).toBe("rewarded");
      // المكافأةُ صفٌّ في `referral_rewards` لا حقلٌ في صفِّ الإحالة: القراءةُ من مخزنِها.
      const reward = await uow.read(({ stores }) => stores.referrals.readRewardByReferral(referral.referralId));
      expect(reward?.rewardDays).toBe(LAUNCH_PLAN.referralRewardDays);
      expect(reward?.grantedPeriodId).toBe(rewarded.grantedPeriodId);

      // المُدّةُ الممنوحةُ للمُحيلِ لا للمُحال: مصدرُها `referral_reward`، وتغطيتُه تمتدّ.
      const periods = await subscriptions.listPeriods(DRIVER);
      const bonus = periods.filter((period) => period.source === "referral_reward");
      expect(bonus).toHaveLength(1);
      expect(bonus[0]?.grantedDays).toBe(LAUNCH_PLAN.referralRewardDays);
      expect(bonus[0]?.paymentReference).toBeNull();
      expect(await countRows(pg.pool, "referral_rewards")).toBe(1);

      const types = (await outboxRows()).map((row) => row.eventType);
      expect(types).toContain("referral.qualified");
      expect(types).toContain("referral.rewarded");
    });

    it("وواقعةٌ سادسةٌ لا تُكافئ ثانيةً: الحالةُ خرجت من `pending` فلا عدَّ ولا منح", async () => {
      for (let index = 1; index <= LAUNCH_PLAN.referralQualifyingFacts; index += 1) {
        await consumer.record(factPayload(index));
      }
      const extra = await consumer.record(factPayload(6));

      expect(extra.verdict).toBe("ignored");
      expect(extra.ignoreReason).toBe("referral_not_pending");
      expect(await countRows(pg.pool, "referral_rewards")).toBe(1);
      const bonus = (await subscriptions.listPeriods(DRIVER)).filter(
        (period) => period.source === "referral_reward",
      );
      expect(bonus).toHaveLength(1);
    });

    it("وواقعةٌ من غيرِ نوعِ العمل تُهمَل بسببٍ مُعلَنٍ ولا تُحسَب", async () => {
      const outcome = await consumer.record(factPayload(9, OTHER_DRIVER, "rating_submitted"));
      expect(outcome.verdict).toBe("ignored");
      expect(outcome.ignoreReason).toBe("fact_kind_not_qualifying");
      // ولا صفَّ منعِ تكرارٍ لواقعةٍ لم تُعالَج؟ بل يُكتب: الإهمالُ **قرارٌ** اتُّخذ لهذه
      // الواقعة، وإعادةُ تسليمِها لا تُعاد قراءتُه. ومن لم يكتبه كان سيُعيد الحسابَ في كلّ
      // تسليمٍ لواقعةٍ لا تعنينا — وهو عملٌ بلا نهايةٍ على بريدٍ يُعاد كثيراً.
      expect(await countRows(pg.pool, "subscription_idempotency")).toBe(1);
    });

    it("وواقعةٌ لسائقٍ لا إحالةَ له تُهمَل ولا تُنشئ إحالةً من فراغ", async () => {
      const outcome = await consumer.record(factPayload(10, "WS-1000009999"));
      expect(outcome.verdict).toBe("ignored");
      expect(outcome.ignoreReason).toBe("no_referral_for_referee");
      expect(await countRows(pg.pool, "referrals")).toBe(1);
    });
  });
});
