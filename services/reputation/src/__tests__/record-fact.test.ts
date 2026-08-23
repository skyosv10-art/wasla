/**
 * تسجيلُ الواقعة: الحرّاسُ بترتيبها، وإعادةُ التسليم، والأحداثُ المُنتَجة.
 *
 * أهمُّ ما تُثبته هذه الحزمة: **إعادةُ تسليمٍ لا تُضاعف نقطة، ولا تُنتج حدثاً ثانياً، ولا
 * تُردّ خطأً.** الثلاثةُ معاً، لأنّ إسقاطَ أيٍّ منها يجعل الخدمةَ إمّا تكذب في الرقم أو
 * تُغرق المستهلكين أو تُنتج ضجيجَ أخطاءٍ على أمرٍ طبيعيّ يقع كل يوم (`errors.md` القاعدة 4).
 */

import { describe, expect, it } from "vitest";
import { isReputationError } from "../domain/errors.js";
import { recordFact } from "../use-cases/record-fact.js";
import { CUSTOMER, T0, deps, factDraft, order } from "./helpers.js";

/** استخراجُ رمزِ الخطأ من استدعاءٍ يجب أن يفشل — بلا `try/catch` في كل اختبار. */
async function codeOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (isReputationError(error)) return error.code;
    throw error;
  }
  throw new Error("كان يجب أن يفشل الاستدعاء");
}

describe("recordFact — المسار السعيد", () => {
  it("يُسجّل الواقعة ويُعيد نتيجةً محسوبةً من الدفتر", async () => {
    const dependencies = deps();
    const result = await recordFact(dependencies, { draft: factDraft() });

    expect(result.duplicate).toBe(false);
    expect(result.fact.subjectPublicId).toBe(CUSTOMER);
    expect(result.fact.recordedAt).toBe(T0);
    expect(result.score.scorePoints).toBe(63);
    expect(result.score.factCount).toBe(1);
    expect(result.score.tier).toBe("new");
    expect(result.score.rulesetVersion).toBe(1);
  });

  it("يُنتج حدثَ واقعةٍ واحداً وحدثَ حسابٍ واحداً وحدثَ رتبةٍ واحداً", async () => {
    const dependencies = deps();
    await recordFact(dependencies, { draft: factDraft() });

    expect(dependencies.outbox.eventsOfType("reputation.fact_recorded")).toHaveLength(1);
    expect(dependencies.outbox.eventsOfType("reputation.score_recomputed")).toHaveLength(1);
    // أوّلُ رتبةٍ لشخصٍ تغيُّرٌ: من غياب إلى `new`.
    expect(dependencies.outbox.eventsOfType("reputation.tier_changed")).toHaveLength(1);
  });

  it("حدثُ الواقعة يحمل لحظةَ الوقوع في occurred_for لا لحظةَ التسجيل", async () => {
    const dependencies = deps();
    const occurredAt = "2026-02-25T08:30:00.000Z";
    await recordFact(dependencies, { draft: factDraft({ occurredAt }) });

    const [event] = dependencies.outbox.eventsOfType("reputation.fact_recorded");
    expect(event).toBeDefined();
    if (event === undefined) return;
    expect(event.data.occurred_for).toBe(occurredAt);
    // لحظةُ إصدار الحدث لحظةُ الاكتشاف، وهي غيرُها.
    expect(event.occurred_at).toBe(T0);
    expect(event.producer).toBe("reputation-service");
    expect(event.event_version).toBe("v1");
  });

  it("النتيجةُ تُخزَّن فتُقرأ لاحقاً بنفس القيمة", async () => {
    const dependencies = deps();
    await recordFact(dependencies, { draft: factDraft() });
    const stored = await dependencies.scores.find("customer", CUSTOMER);
    expect(stored?.scorePoints).toBe(63);
  });

  it("خمسُ وقائعِ إكمالٍ ⇒ الرتبةُ تتجاوز new إلى standard", async () => {
    const dependencies = deps();
    for (let index = 0; index < 5; index += 1) {
      await recordFact(dependencies, {
        draft: factDraft({ orderPublicId: order(index + 1), sourceEventId: `e-${index}` }),
      });
    }
    const stored = await dependencies.scores.find("customer", CUSTOMER);
    expect(stored?.factCount).toBe(5);
    expect(stored?.scorePoints).toBe(75);
    expect(stored?.tier).toBe("standard");
    // تغيُّرا رتبةٍ فقط: غياب ⇒ new، ثم new ⇒ standard. ولا حدثَ في الثلاث الوسطى.
    expect(dependencies.outbox.eventsOfType("reputation.tier_changed")).toHaveLength(2);
  });
});

describe("recordFact — إعادةُ التسليم", () => {
  it("نفسُ المفتاح بنفس الحمولة ⇒ duplicate ولا نقطةَ تُضاف", async () => {
    const dependencies = deps();
    const first = await recordFact(dependencies, { draft: factDraft() });
    const second = await recordFact(dependencies, { draft: factDraft() });

    expect(second.duplicate).toBe(true);
    expect(second.fact.id).toBe(first.fact.id);
    expect(second.score.scorePoints).toBe(first.score.scorePoints);
    expect(second.score.factCount).toBe(1);
  });

  it("إعادةُ التسليم لا تُنتج حدثاً ثانياً", async () => {
    const dependencies = deps();
    await recordFact(dependencies, { draft: factDraft() });
    const afterFirst = dependencies.outbox.appended.length;
    await recordFact(dependencies, { draft: factDraft() });
    await recordFact(dependencies, { draft: factDraft() });
    expect(dependencies.outbox.appended.length).toBe(afterFirst);
  });

  it("لا تُعَدّ خطأً — ولا رمزَ يُنتَج لها", async () => {
    const dependencies = deps();
    await recordFact(dependencies, { draft: factDraft() });
    await expect(recordFact(dependencies, { draft: factDraft() })).resolves.toBeDefined();
  });

  it("اختلافُ traceId وحده لا يجعلها حمولةً مختلفة", async () => {
    /**
     * `traceId` من عندنا لا من الواقعة. ومقارنتُه كانت ستجعل كلَّ إعادةِ تسليمٍ عبر مسارٍ
     * آخر تُردّ 409 على من لم يُخطئ.
     */
    const dependencies = deps();
    await recordFact(dependencies, { draft: factDraft(), traceId: "trace-a" });
    const again = await recordFact(dependencies, { draft: factDraft(), traceId: "trace-b" });
    expect(again.duplicate).toBe(true);
  });

  it("نفسُ المفتاح بحمولةٍ مختلفة ⇒ 409 FACT_ALREADY_RECORDED", async () => {
    const dependencies = deps();
    await recordFact(dependencies, { draft: factDraft() });
    const code = await codeOf(() =>
      recordFact(dependencies, { draft: factDraft({ sourceEventId: "different-event" }) }),
    );
    expect(code).toBe("REPUTATION_FACT_ALREADY_RECORDED");
  });
});

describe("recordFact — الرفض", () => {
  it("تسلسلٌ لا يزيد على المُسجَّل ⇒ 422 SOURCE_EVENT_STALE", async () => {
    const dependencies = deps();
    await recordFact(dependencies, { draft: factDraft({ sourceSequence: 5 }) });
    const code = await codeOf(() =>
      recordFact(dependencies, {
        draft: factDraft({
          factKind: "order_cancelled_by_customer",
          sourceSequence: 3,
          sourceEventId: "older",
        }),
      }),
    );
    expect(code).toBe("REPUTATION_SOURCE_EVENT_STALE");
  });

  it("تسلسلٌ مساوٍ بنوعٍ آخر ⇒ مرفوضٌ أيضاً", async () => {
    const dependencies = deps();
    await recordFact(dependencies, { draft: factDraft({ sourceSequence: 5 }) });
    const code = await codeOf(() =>
      recordFact(dependencies, {
        draft: factDraft({
          factKind: "order_cancelled_by_customer",
          sourceSequence: 5,
          sourceEventId: "same-sequence",
        }),
      }),
    );
    expect(code).toBe("REPUTATION_SOURCE_EVENT_STALE");
  });

  it("مُعرّفٌ عامٌّ بشكلٍ خطأ ⇒ 400 VALIDATION_FAILED", async () => {
    const dependencies = deps();
    const code = await codeOf(() =>
      recordFact(dependencies, { draft: factDraft({ subjectPublicId: "12345" }) }),
    );
    expect(code).toBe("REPUTATION_VALIDATION_FAILED");
  });

  it("مُعرّفُ طلبٍ بشكلٍ خطأ ⇒ 400", async () => {
    const dependencies = deps();
    const code = await codeOf(() =>
      recordFact(dependencies, { draft: factDraft({ orderPublicId: "ORD-1" }) }),
    );
    expect(code).toBe("REPUTATION_VALIDATION_FAILED");
  });

  it("نوعُ واقعةٍ بلا وزنٍ لهذا الجانب ⇒ 422 RULE_WEIGHT_MISSING ولا كتابة", async () => {
    const dependencies = deps();
    const code = await codeOf(() =>
      recordFact(dependencies, { draft: factDraft({ factKind: "assignment_timed_out" }) }),
    );
    expect(code).toBe("REPUTATION_RULE_WEIGHT_MISSING");
    // ولا شيءَ كُتب: لا واقعةَ ولا نتيجةَ ولا حدث.
    expect(await dependencies.facts.listBySubject("customer", CUSTOMER)).toHaveLength(0);
    expect(await dependencies.scores.find("customer", CUSTOMER)).toBeNull();
    expect(dependencies.outbox.appended).toHaveLength(0);
  });
});
