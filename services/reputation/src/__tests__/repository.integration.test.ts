/**
 * مستودعاتُ PostgreSQL مقابل القاعدة الحقيقية (الطور 09 · المراجعة 3/6).
 *
 * هذه الحزمةُ تفحص **المُهيئ** لا المجال: هل يكتب كلَّ عمودٍ ويقرؤه كما كُتب؟ وهل
 * يُترجم خطأَ القاعدة إلى خطأِ المجال **باسم القيد** لا برسالةٍ عامّة؟ وهل تُرتّب
 * القراءاتُ كما يعتمد عليه المجال؟
 *
 * ولا `expect(true)` عند غياب القاعدة: الحزمةُ تُتخطّى بالكامل بـ`skipIf`، فلا تُعطي
 * خضرةً كاذبةً على جهازٍ بلا PostgreSQL. وتشغيلُها في CI إلزاميٌّ عبر الوظيفة
 * `reputation-db-integration`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ReputationError } from "../domain/errors.js";
import { factRecorded, type ReputationDomainEvent } from "../domain/events.js";
import type {
  FraudSignalRow,
  ReputationFactRow,
  ReputationIdempotencyRow,
  ReputationRatingRow,
  ReputationScoreRow,
} from "../domain/model.js";
import {
  countOutbox,
  postgresError,
  readOutbox,
} from "../infrastructure/drizzle/repository.js";
import { CUSTOMER, DRIVER, OTHER_DRIVER, T0, order } from "./helpers.js";
import {
  PG_ENABLED,
  countRows,
  pgFactDraft,
  resetData,
  setupPostgres,
  sourceEventUuid,
  type PgFixture,
} from "./pg-harness.js";

/** مُعرّفُ صفٍّ حتميٌّ صالحُ شكلِ UUID — أعمدةُ `id` كلُّها `UUID` في العقد. */
function rowId(index: number): string {
  return `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
}

const T1 = "2026-03-01T13:00:00.000Z";
const T2 = "2026-03-01T14:00:00.000Z";

function factRow(index: number, overrides: Partial<ReputationFactRow> = {}): ReputationFactRow {
  return {
    id: rowId(index),
    ...pgFactDraft(),
    sourceEventId: sourceEventUuid(9, index),
    recordedAt: T0,
    traceId: null,
    ...overrides,
  };
}

function scoreRow(overrides: Partial<ReputationScoreRow> = {}): ReputationScoreRow {
  return {
    subjectType: "customer",
    subjectPublicId: CUSTOMER,
    rulesetVersion: 1,
    scorePoints: 63,
    tier: "standard",
    factCount: 5,
    computedThroughFactId: rowId(1),
    computedAt: T0,
    nextRecomputeAt: T1,
    traceId: null,
    ...overrides,
  };
}

function ratingRow(index: number, overrides: Partial<ReputationRatingRow> = {}): ReputationRatingRow {
  return {
    id: rowId(index),
    orderPublicId: order(1),
    raterType: "customer",
    raterPublicId: CUSTOMER,
    subjectType: "driver",
    subjectPublicId: DRIVER,
    stars: 5,
    reasonCode: "on_time",
    rulesetVersion: 1,
    submittedAt: T0,
    traceId: null,
    ...overrides,
  };
}

function signalRow(index: number, overrides: Partial<FraudSignalRow> = {}): FraudSignalRow {
  return {
    id: rowId(index),
    subjectType: "driver",
    subjectPublicId: DRIVER,
    ruleCode: "repeated_driver_cancellation",
    severity: "medium",
    windowStartedAt: T0,
    windowEndedAt: T1,
    observedCount: 6,
    thresholdCount: 4,
    rulesetVersion: 1,
    raisedAt: T1,
    traceId: null,
    ...overrides,
  };
}

function idempotencyRow(
  overrides: Partial<ReputationIdempotencyRow> = {},
): ReputationIdempotencyRow {
  return {
    idempotencyKey: "idem-key-000001",
    operation: "submit_rating",
    requestFingerprint: "a".repeat(64),
    subjectPublicId: DRIVER,
    createdAt: T0,
    ...overrides,
  };
}

/**
 * حدثُ دفترٍ حقيقيٌّ من مصنع المجال، لا كائنٌ يدويٌّ بشكلٍ مشابه.
 *
 * لأنّ ما يُفحَص هنا أنّ **المُهيئَ** يكتب الغلافَ كما يُنتجه المجال؛ وكائنٌ يدويٌّ كان
 * سيبقى أخضرَ لو تغيّر الغلافُ في المجال، وذاك بعينه الانحرافُ الذي يُكتشف في الإنتاج.
 */
function factEvent(index: number, occurredAt: string): ReputationDomainEvent {
  return factRecorded({
    meta: { eventId: rowId(index), occurredAt, traceId: null },
    factId: rowId(index),
    subjectType: "customer",
    subjectPublicId: CUSTOMER,
    factKind: "order_completed",
    orderPublicId: order(1),
    sourceEventType: "order.completed",
    sourceEventId: sourceEventUuid(9, index),
    sourceSequence: 1,
    actorType: "system",
    reasonCode: null,
    factOccurredAt: occurredAt,
  });
}

/** يُنفّذ عملاً يُتوقّع أن يكسر قيداً، ويُعيد الخطأ لفحص رمزه واسم قيده. */
async function captureError(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error("كان متوقَّعاً أن يُرفض هذا العمل، فمرّ");
}

describe.skipIf(!PG_ENABLED)("مستودعاتُ السمعة على PostgreSQL", () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(async () => {
    await resetData(pg.pool);
  });

  // -------------------------------------------------------------------------
  // نسخة القواعد — من الترحيل لا من الكود
  // -------------------------------------------------------------------------

  describe("نسخةُ القواعد", () => {
    it("تُقرأ من بذرة الترحيل كاملةً بأوزانها وعتباتها", async () => {
      const active = await pg.rulesets.findActive();

      expect(active).not.toBeNull();
      expect(active?.rulesetVersion).toBe(1);
      expect(active?.label).toBe("saudi-launch-v1");
      expect(active?.isFrozen).toBe(true);
      expect(active?.weights).toHaveLength(9);
      expect(active?.fraudThresholds).toHaveLength(5);
    });

    it("ولا نسخةَ ثانية: `list` صفٌّ واحد و`find(2)` لا شيء", async () => {
      expect(await pg.rulesets.list()).toHaveLength(1);
      expect(await pg.rulesets.find(2)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // الدفتر
  // -------------------------------------------------------------------------

  describe("دفترُ الوقائع", () => {
    it("يُعيد الصفَّ كما كُتب حرفياً — كلُّ عمودٍ ذهاباً وعوداً", async () => {
      const written = factRow(1, { reasonCode: null, traceId: "trace-abc" });

      const inserted = await pg.facts.insert(written);
      const found = await pg.facts.findBySource({
        subjectType: written.subjectType,
        subjectPublicId: written.subjectPublicId,
        factKind: written.factKind,
        orderPublicId: written.orderPublicId,
        sourceSequence: written.sourceSequence,
      });

      expect(inserted).toEqual(written);
      expect(found).toEqual(written);
    });

    it("وتكرارُ (شخص × نوع × طلب × تسلسل) يُرفَض باسم `ux_reputation_facts_source`", async () => {
      await pg.facts.insert(factRow(1));

      const error = await captureError(() => pg.facts.insert(factRow(2)));

      expect(error).toBeInstanceOf(ReputationError);
      expect((error as ReputationError).code).toBe("REPUTATION_VALIDATION_FAILED");
      expect((error as ReputationError).details.constraint).toBe("ux_reputation_facts_source");
    });

    it("والترتيبُ بلحظةِ الحدوث ثمّ التسلسل — لا بترتيب الكتابة", async () => {
      await pg.facts.insert(factRow(3, { sourceSequence: 3, occurredAt: T2 }));
      await pg.facts.insert(factRow(1, { sourceSequence: 1, occurredAt: T0 }));
      await pg.facts.insert(factRow(2, { sourceSequence: 2, occurredAt: T1 }));

      const listed = await pg.facts.listBySubject("customer", CUSTOMER);

      expect(listed.map((fact) => fact.sourceSequence)).toEqual([1, 2, 3]);
      expect(await pg.facts.latestSourceSequence("customer", CUSTOMER, order(1))).toBe(3);
    });

    it("و`findOrderCompletion` يُعيد أوّلَ اكتمالٍ للطلب لا أيَّ واقعةٍ فيه", async () => {
      await pg.facts.insert(
        factRow(1, { factKind: "assignment_accepted", subjectType: "driver", subjectPublicId: DRIVER }),
      );
      await pg.facts.insert(factRow(2, { sourceSequence: 2 }));

      const completion = await pg.facts.findOrderCompletion(order(1));

      expect(completion?.factKind).toBe("order_completed");
      expect(completion?.id).toBe(rowId(2));
    });

    it("والتصفيةُ بالطلب تُعيد طرفي الطلب معاً", async () => {
      await pg.facts.insert(factRow(1));
      await pg.facts.insert(
        factRow(2, { subjectType: "driver", subjectPublicId: DRIVER, sourceSequence: 1 }),
      );

      const listed = await pg.facts.list({ orderPublicId: order(1) });

      expect(listed.map((fact) => fact.subjectPublicId).sort()).toEqual([CUSTOMER, DRIVER].sort());
    });
  });

  // -------------------------------------------------------------------------
  // النتائج
  // -------------------------------------------------------------------------

  describe("النتائج", () => {
    it("`upsert` مرّتين يُبقي صفاً واحداً بأحدث قيمة", async () => {
      await pg.scores.upsert(scoreRow());
      const second = await pg.scores.upsert(scoreRow({ scorePoints: 81, tier: "trusted" }));

      expect(second.scorePoints).toBe(81);
      expect(await countRows(pg.pool, "reputation_scores")).toBe(1);
      expect((await pg.scores.find("customer", CUSTOMER))?.tier).toBe("trusted");
    });

    it("ونتيجةٌ سالبةٌ تُرفَض باسم `ck_reputation_scores_non_negative`", async () => {
      const error = await captureError(() => pg.scores.upsert(scoreRow({ scorePoints: -1 })));

      expect((error as ReputationError).details.constraint).toBe(
        "ck_reputation_scores_non_negative",
      );
    });

    it("ورتبةُ `new` مع وقائعَ بلا تاريخِ حسابٍ تُرفَض باسم قيدها", async () => {
      const error = await captureError(() =>
        pg.scores.upsert(scoreRow({ tier: "new", factCount: 3, computedThroughFactId: null })),
      );

      expect((error as ReputationError).details.constraint).toBe(
        "ck_reputation_scores_new_has_no_history",
      );
    });

    it("و`listDueForRecompute` يحترم الاستحقاق والحدَّ الأعلى", async () => {
      await pg.scores.upsert(scoreRow({ nextRecomputeAt: T0 }));
      await pg.scores.upsert(
        scoreRow({ subjectType: "driver", subjectPublicId: DRIVER, nextRecomputeAt: T2 }),
      );

      const dueAtT1 = await pg.scores.listDueForRecompute(T1, 10);
      const dueAtT2 = await pg.scores.listDueForRecompute(T2, 10);
      const capped = await pg.scores.listDueForRecompute(T2, 1);

      expect(dueAtT1.map((row) => row.subjectPublicId)).toEqual([CUSTOMER]);
      expect(dueAtT2).toHaveLength(2);
      expect(capped).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // التقييمات
  // -------------------------------------------------------------------------

  describe("التقييمات", () => {
    it("تُكتب وتُقرأ بمفتاح (طلب × مُقيِّم × مُقيَّم)", async () => {
      const written = ratingRow(1);
      await pg.ratings.insert(written);

      expect(await pg.ratings.findByOrderPair(order(1), CUSTOMER, DRIVER)).toEqual(written);
      expect(await pg.ratings.listByRater(CUSTOMER)).toEqual([written]);
    });

    it("وتقييمٌ ثانٍ لنفس الثلاثيّ يُرفَض باسم `ux_reputation_ratings_order_pair`", async () => {
      await pg.ratings.insert(ratingRow(1));

      const error = await captureError(() => pg.ratings.insert(ratingRow(2)));

      expect((error as ReputationError).details.constraint).toBe(
        "ux_reputation_ratings_order_pair",
      );
    });

    it("وتقييمُ النفسِ يُرفَض باسم `ck_reputation_ratings_no_self`", async () => {
      const error = await captureError(() =>
        pg.ratings.insert(
          ratingRow(1, { subjectType: "driver", subjectPublicId: CUSTOMER, raterType: "customer" }),
        ),
      );

      expect((error as ReputationError).details.constraint).toBe("ck_reputation_ratings_no_self");
    });

    it("وتقييمُ طرفٍ من نفس الجهة يُرفَض باسم `ck_reputation_ratings_cross_side`", async () => {
      const error = await captureError(() =>
        pg.ratings.insert(ratingRow(1, { subjectType: "customer", subjectPublicId: DRIVER })),
      );

      expect((error as ReputationError).details.constraint).toBe(
        "ck_reputation_ratings_cross_side",
      );
    });

    /**
     * الترتيبُ تصاعديٌّ في المستودعين معاً، لا تنازليٌّ كاتّجاه الفهرس.
     *
     * `ix_reputation_ratings_subject` مُعلَنٌ `submitted_at DESC` لأنّ ذاك ما يخدم خطّةَ
     * القراءة، وليس ذاك عقدَ الترتيب. وعقدُ الترتيب تصاعديٌّ لأنّ مخزنَ الذاكرة يفرزه
     * كذلك، ولو اختلف الاتجاهُ بين المُهيئين لصار «أوّلُ تقييم» شيئين مختلفين في
     * بيئتين — وهو فرقٌ لا يُكتشف حتى تُقرأ قائمةٌ مقطوعة.
     */
    it("والترتيبُ بلحظةِ الإرسال تصاعديّاً ثمّ بالمُعرّف — كما في الذاكرة", async () => {
      await pg.ratings.insert(ratingRow(1, { submittedAt: T0 }));
      await pg.ratings.insert(
        ratingRow(2, { orderPublicId: order(2), submittedAt: T2, stars: 4 }),
      );

      const listed = await pg.ratings.list({ subjectType: "driver", subjectPublicId: DRIVER });

      expect(listed.map((rating) => rating.submittedAt)).toEqual([T0, T2]);
    });
  });

  // -------------------------------------------------------------------------
  // إشارات الاحتيال
  // -------------------------------------------------------------------------

  describe("إشاراتُ الاحتيال", () => {
    it("تُكتب وتُقرأ بمفتاح (قاعدة × شخص × نافذة)", async () => {
      const written = signalRow(1);
      await pg.fraudSignals.insert(written);

      expect(
        await pg.fraudSignals.findByRuleWindow(
          "driver",
          DRIVER,
          "repeated_driver_cancellation",
          T1,
        ),
      ).toEqual(written);
    });

    it("وإشارةٌ ثانيةٌ لنفس النافذة تُرفَض باسم `ux_fraud_signals_rule_window`", async () => {
      await pg.fraudSignals.insert(signalRow(1));

      const error = await captureError(() => pg.fraudSignals.insert(signalRow(2)));

      expect((error as ReputationError).details.constraint).toBe("ux_fraud_signals_rule_window");
    });

    it("ونافذةٌ مقلوبةٌ تُرفَض باسم `ck_fraud_signals_window_order`", async () => {
      const error = await captureError(() =>
        pg.fraudSignals.insert(signalRow(1, { windowStartedAt: T1, windowEndedAt: T0 })),
      );

      expect((error as ReputationError).details.constraint).toBe("ck_fraud_signals_window_order");
    });

    it("وعددٌ دون العتبة يُرفَض باسم `ck_fraud_signals_over_threshold`", async () => {
      const error = await captureError(() =>
        pg.fraudSignals.insert(signalRow(1, { observedCount: 2, thresholdCount: 4 })),
      );

      expect((error as ReputationError).details.constraint).toBe(
        "ck_fraud_signals_over_threshold",
      );
    });

    it("والتصفيةُ برمز القاعدة تعمل", async () => {
      await pg.fraudSignals.insert(signalRow(1));
      await pg.fraudSignals.insert(
        signalRow(2, {
          subjectType: "customer",
          subjectPublicId: OTHER_DRIVER,
          ruleCode: "repeated_customer_cancellation",
          thresholdCount: 5,
          observedCount: 7,
        }),
      );

      const listed = await pg.fraudSignals.list({ ruleCode: "repeated_driver_cancellation" });

      expect(listed).toHaveLength(1);
      expect(listed[0]?.subjectPublicId).toBe(DRIVER);
    });
  });

  // -------------------------------------------------------------------------
  // المعالجة الواحدة
  // -------------------------------------------------------------------------

  describe("سجلُّ المعالجة الواحدة", () => {
    it("أوّلُ كتابةٍ تفوز: إعادةُ الإدراج تُعيد الصفَّ الأوّل ولا تُحدّثه", async () => {
      const first = await pg.idempotency.insert(idempotencyRow());
      const second = await pg.idempotency.insert(
        idempotencyRow({ requestFingerprint: "b".repeat(64), createdAt: T2 }),
      );

      expect(second).toEqual(first);
      expect(await countRows(pg.pool, "reputation_idempotency")).toBe(1);
      expect((await pg.idempotency.find(first.idempotencyKey))?.requestFingerprint).toBe(
        "a".repeat(64),
      );
    });

    it("ومفتاحٌ غيرُ مسجَّلٍ يُعيد `null` لا خطأً", async () => {
      expect(await pg.idempotency.find("idem-key-absent")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // صندوق الصادر
  // -------------------------------------------------------------------------

  describe("صندوقُ الصادر", () => {
    it("يكتب الأحداثَ ويُعيدها بترتيب الحدوث لا بترتيب التمرير", async () => {
      await pg.outbox.append([factEvent(21, T2), factEvent(20, T0)], T2);

      const stored = await readOutbox(pg.db);

      expect(stored).toHaveLength(2);
      expect(
        stored.map((row) => (row.payload as { readonly event_id: string }).event_id),
      ).toEqual([rowId(20), rowId(21)]);
      expect(stored.every((row) => row.eventType === "reputation.fact_recorded")).toBe(true);
      expect(await countOutbox(pg.db)).toBe(2);
    });

    it("وإعادةُ حدثٍ بنفس المُعرّف لا تُضاعف الصفَّ (`ON CONFLICT DO NOTHING`)", async () => {
      await pg.outbox.append([factEvent(20, T0)], T0);
      await pg.outbox.append([factEvent(20, T0)], T2);

      expect(await countOutbox(pg.db)).toBe(1);
    });

    it("وقائمةٌ فارغةٌ لا تكتب صفاً ولا ترمي", async () => {
      await pg.outbox.append([], T0);

      expect(await countOutbox(pg.db)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // الانحرافُ المُعلَن: `source_event_id` عمودُ UUID
  // -------------------------------------------------------------------------

  describe("الانحرافُ المُعلَن بين المُهيئين", () => {
    /**
     * فرقٌ واحدٌ باقٍ بين الذاكرة وPostgres، مُعلَنٌ هنا لا مُخفى.
     *
     * `source_event_id` عمودُ `UUID` في العقد، والمجالُ لا يُعيد تحليلَ شكله عن قصد
     * (`domain/validation.ts`: «شكلُ UUID يحرسه العقد»). فمُعرّفٌ مثل `c-ORD-…` يمرّ في
     * مخزن الذاكرة ويرفضه Postgres بـ`22P02` **بلا اسم قيد** — فلا يستطيع `translate`
     * أن يُترجمه إلى خطأِ مجالٍ مُسمّى، ويُرفع الخطأُ الأصليّ كما هو.
     *
     * وتوثيقُ الفرق باختبارٍ أصدقُ من تسويته: تسويتُه تعني إمّا تحليلَ UUID في المجال
     * (وهو ما رفضه العقد) أو تحويلَ العمود إلى `TEXT` (وهو تعديلُ عقدٍ مُجمَّد). والحرسُ
     * الحقيقيُّ يعيش على حدّ HTTP في المراجعة 4/6.
     */
    it("مُعرّفُ حدثٍ ليس UUID: يمرّ في الذاكرة ويرفضه Postgres بـ`22P02` بلا اسم قيد", async () => {
      const error = await captureError(() =>
        pg.facts.insert(factRow(1, { sourceEventId: `c-${order(1)}` })),
      );

      expect(error).not.toBeInstanceOf(ReputationError);
      expect(postgresError(error).code).toBe("22P02");
      expect(postgresError(error).constraint).toBeUndefined();
      expect(await countRows(pg.pool, "reputation_facts")).toBe(0);
    });
  });
});
