/**
 * ذرّيّةُ العملية الواحدة على PostgreSQL (الطور 09 · المراجعة 3/6).
 *
 * القرارُ الذي تحرسه هذه الحزمة: **الواقعةُ والنتيجةُ وحدثُ الصندوق تُكتب أو لا يُكتب
 * شيء**. وهو ما يمنع الحالةَ التي لا يُصلحها إعادةُ تشغيل: واقعةٌ في الدفتر بلا نتيجةٍ
 * أُعيد حسابها، أو نتيجةٌ مكتوبةٌ وحدثٌ لم يدخل الصندوق فلا يعلم أحدٌ بالتغيير.
 *
 * والفحصُ يقرأ **عددَ الصفوف بعد فشلٍ مُتعمَّد** لا استدعاءاتِ كائناتٍ مُزيَّفة: مُزيَّفٌ
 * يُثبت أنّ الكود نادى `rollback`، وعددُ الصفوف يُثبت أنّ القاعدةَ تراجعت فعلاً — والفرقُ
 * بينهما هو بالضبط ما تُخفيه معاملةٌ فُتحت على مقبضٍ غير الذي كتبت به المستودعات.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { countOutbox, readOutbox } from "../infrastructure/drizzle/repository.js";
import { recordFact } from "../use-cases/record-fact.js";
import { CUSTOMER, DRIVER, T0, order } from "./helpers.js";
import {
  PG_ENABLED,
  countRows,
  createPgHarness,
  pgFactDraft,
  resetData,
  setupPostgres,
  sourceEventUuid,
  type PgFixture,
} from "./pg-harness.js";

/** فشلٌ مُتعمَّدٌ **بعد** نجاح الكتابة، ليقع التراجعُ على عملٍ تمّ فعلاً. */
class DeliberateFailure extends Error {
  constructor() {
    super("فشلٌ مُتعمَّدٌ لفحص التراجع");
    this.name = "DeliberateFailure";
  }
}

describe.skipIf(!PG_ENABLED)("ذرّيّةُ الكتابة على PostgreSQL", () => {
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

  async function rowCounts(): Promise<{
    readonly facts: number;
    readonly scores: number;
    readonly outbox: number;
  }> {
    return {
      facts: await countRows(pg.pool, "reputation_facts"),
      scores: await countRows(pg.pool, "reputation_scores"),
      outbox: await countOutbox(pg.db),
    };
  }

  /**
   * أنواعُ ما دخل الصندوق — مفروزةً، فالترتيبُ ليس عقداً.
   *
   * ويُفحَص النوعُ لا العدد: «ثلاثةُ أحداث» رقمٌ يبقى أخضرَ لو استُبدل `tier_changed`
   * بحدثٍ آخر، والقائمةُ المُسمّاة تُفشل ذلك التغييرَ في سطره.
   */
  async function outboxTypes(): Promise<readonly string[]> {
    return (await readOutbox(pg.db)).map((row) => row.eventType).sort();
  }

  /** أوّلُ إكمالٍ لشخصٍ جديد: واقعةٌ، ونتيجةٌ أُعيد حسابها، ورتبةٌ تغيّرت عن `new`. */
  const FIRST_WRITE_EVENTS = [
    "reputation.fact_recorded",
    "reputation.score_recomputed",
    "reputation.tier_changed",
  ].sort();

  it("العمليةُ الناجحة تكتب الثلاثةَ معاً: واقعةٌ ونتيجةٌ وحدثٌ في الصندوق", async () => {
    const harness = createPgHarness(pg);

    const result = await harness.runner.write((deps) =>
      recordFact(deps, { draft: pgFactDraft() }),
    );

    expect(result.duplicate).toBe(false);
    expect(await rowCounts()).toEqual({ facts: 1, scores: 1, outbox: 3 });
    expect(await outboxTypes()).toEqual(FIRST_WRITE_EVENTS);
  });

  it("وفشلٌ بعد الكتابة يُلغي الثلاثةَ: لا صفَّ واحد يبقى", async () => {
    const harness = createPgHarness(pg);

    await expect(
      harness.runner.write(async (deps) => {
        await recordFact(deps, { draft: pgFactDraft() });
        throw new DeliberateFailure();
      }),
    ).rejects.toBeInstanceOf(DeliberateFailure);

    expect(await rowCounts()).toEqual({ facts: 0, scores: 0, outbox: 0 });
  });

  it("وخطأُ مجالٍ في منتصف العملية يُلغي ما قبله من كتابات", async () => {
    const harness = createPgHarness(pg);

    /**
     * واقعتان في عمليةٍ واحدة، والثانيةُ تكسر `ux_reputation_facts_source`.
     *
     * فتُرفَض العمليةُ كاملةً ولا تبقى الأولى: لو بقيت، لكان لدينا دفترٌ فيه نصفُ ما
     * طُلب — ولا استعلامَ يُميّز ذلك عن دفترٍ صحيح، فيُحسب للشخص نصفُ سمعته بلا أن
     * يفشل شيء.
     */
    await expect(
      harness.runner.write(async (deps) => {
        await recordFact(deps, { draft: pgFactDraft() });
        return recordFact(deps, {
          draft: pgFactDraft({ sourceEventId: sourceEventUuid(7, 7) }),
        });
      }),
    ).rejects.toThrow();

    expect(await rowCounts()).toEqual({ facts: 0, scores: 0, outbox: 0 });
  });

  it("وعمليةٌ ثانيةٌ ناجحة بعد فشلٍ تُكتب كاملةً — المعاملةُ لا تُسمّم المسبح", async () => {
    const harness = createPgHarness(pg);

    await expect(
      harness.runner.write(async (deps) => {
        await recordFact(deps, { draft: pgFactDraft() });
        throw new DeliberateFailure();
      }),
    ).rejects.toBeInstanceOf(DeliberateFailure);

    await harness.runner.write((deps) => recordFact(deps, { draft: pgFactDraft() }));

    expect(await rowCounts()).toEqual({ facts: 1, scores: 1, outbox: 3 });
    expect(await outboxTypes()).toEqual(FIRST_WRITE_EVENTS);
  });

  it("وكتابتان لطلبين مختلفين تُلزم كلٌّ منهما نفسها: فشلُ الثانية لا يمسّ الأولى", async () => {
    const harness = createPgHarness(pg);

    await harness.runner.write((deps) =>
      recordFact(deps, { draft: pgFactDraft({ orderPublicId: order(1) }) }),
    );

    await expect(
      harness.runner.write(async (deps) => {
        await recordFact(deps, {
          draft: pgFactDraft({
            orderPublicId: order(2),
            sourceEventId: sourceEventUuid(8, 2),
            subjectPublicId: DRIVER,
            subjectType: "driver",
          }),
        });
        throw new DeliberateFailure();
      }),
    ).rejects.toBeInstanceOf(DeliberateFailure);

    const facts = await pg.facts.list({});
    expect(facts.map((fact) => fact.orderPublicId)).toEqual([order(1)]);
    expect(await countRows(pg.pool, "reputation_scores")).toBe(1);
  });

  it("والقراءةُ ترى ما التزم به غيرُها ولا ترى ما تراجع", async () => {
    const harness = createPgHarness(pg);

    await harness.runner.write((deps) => recordFact(deps, { draft: pgFactDraft() }));
    await expect(
      harness.runner.write(async (deps) => {
        await recordFact(deps, {
          draft: pgFactDraft({ orderPublicId: order(3), sourceEventId: sourceEventUuid(8, 3) }),
        });
        throw new DeliberateFailure();
      }),
    ).rejects.toBeInstanceOf(DeliberateFailure);

    const seen = await harness.runner.read((deps) => deps.facts.listBySubject("customer", CUSTOMER));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.orderPublicId).toBe(order(1));
    expect(seen[0]?.occurredAt).toBe(T0);
  });
});
