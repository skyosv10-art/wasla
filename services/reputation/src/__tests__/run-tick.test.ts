/**
 * النبضة: قابلةٌ للتكرار، ونافذتُها محسوبة، وفشلُها يُعَدّ ولا يُرمى.
 *
 * كلُّ ما هنا يدفع ساعةً بيده ولا ينتظر زمناً حقيقياً — وهذا شرطٌ لا تحسين: اختبارٌ ينتظر
 * أربعاً وعشرين ساعةً لا يُكتب، وإن كُتب حُذف.
 */

import { describe, expect, it } from "vitest";
import { runTick } from "../use-cases/run-tick.js";
import { recordFact } from "../use-cases/record-fact.js";
import { fraudWindowFor } from "../domain/time.js";
import { CUSTOMER, DRIVER, T0, completeOrder, deps, factDraft, order, recordSeries } from "./helpers.js";

describe("runTick — الاستحقاق", () => {
  it("لا مستحقّين ⇒ أصفارٌ ولحظةُ تشغيلٍ مُعلَنة", async () => {
    const dependencies = deps();
    const result = await runTick(dependencies);
    expect(result).toEqual({
      ranAt: T0,
      scoresRecomputed: 0,
      tiersChanged: 0,
      fraudSignalsRaised: 0,
      failures: 0,
    });
  });

  it("نتيجةٌ حُسبت الآن ليست مستحقّةً قبل انقضاء الفاصل", async () => {
    const dependencies = deps();
    await recordFact(dependencies, { draft: factDraft() });
    const stored = await dependencies.scores.find("customer", CUSTOMER);
    expect(stored?.nextRecomputeAt).toBe("2026-03-02T12:00:00.000Z");

    const sameDay = await runTick(dependencies);
    expect(sameDay.scoresRecomputed).toBe(0);
  });

  it("بعد انقضاء الفاصل تُعاد الحسبة، ويتحرّك موعدُ الاستحقاق", async () => {
    const dependencies = deps();
    await recordFact(dependencies, { draft: factDraft() });
    dependencies.clock.advanceHours(24);

    const result = await runTick(dependencies);
    expect(result.scoresRecomputed).toBe(1);
    expect(result.failures).toBe(0);

    const stored = await dependencies.scores.find("customer", CUSTOMER);
    expect(stored?.computedAt).toBe("2026-03-02T12:00:00.000Z");
    expect(stored?.nextRecomputeAt).toBe("2026-03-03T12:00:00.000Z");
  });

  it("النبضةُ تُصدر حدثَ حسابٍ لكل من أُعيد حسابُه، ولا تُصدر حدثَ رتبةٍ بلا تغيير", async () => {
    const dependencies = deps();
    await recordFact(dependencies, { draft: factDraft() });
    dependencies.outbox.clear();
    dependencies.clock.advanceHours(24);

    const result = await runTick(dependencies);
    expect(dependencies.outbox.eventsOfType("reputation.score_recomputed")).toHaveLength(1);
    expect(dependencies.outbox.eventsOfType("reputation.tier_changed")).toHaveLength(0);
    expect(result.tiersChanged).toBe(0);
  });

  it("المُحرّض في حدث النبضة هو tick — لا يُخمَّن في المستهلك", async () => {
    const dependencies = deps();
    await recordFact(dependencies, { draft: factDraft() });
    dependencies.outbox.clear();
    dependencies.clock.advanceHours(24);
    await runTick(dependencies);

    const [event] = dependencies.outbox.eventsOfType("reputation.score_recomputed");
    expect(event).toBeDefined();
    if (event === undefined || event.event_type !== "reputation.score_recomputed") return;
    expect(event.data.trigger).toBe("tick");
    expect(event.data.previous_score_points).toBe(63);
  });

  it("الحدُّ يُحترَم فلا تسحب النبضةُ كلَّ المستحقّين", async () => {
    const dependencies = deps();
    await completeOrder(dependencies, { orderPublicId: order(1), occurredAt: T0 });
    dependencies.clock.advanceHours(24);

    const first = await runTick(dependencies, { limit: 1 });
    expect(first.scoresRecomputed).toBe(1);
    const second = await runTick(dependencies, { limit: 1 });
    expect(second.scoresRecomputed).toBe(1);
    const third = await runTick(dependencies, { limit: 1 });
    expect(third.scoresRecomputed).toBe(0);
  });
});

describe("runTick — إشارات الاحتيال", () => {
  it("ترفع إشارةً مُسمّاةً بعددٍ وعتبةٍ ونافذةٍ محسوبة", async () => {
    const dependencies = deps();
    await recordSeries(dependencies, {
      subjectType: "customer",
      subjectPublicId: CUSTOMER,
      factKind: "order_cancelled_by_customer",
      count: 5,
      occurredAt: T0,
      actorType: "customer",
    });
    dependencies.clock.advanceHours(24);

    const result = await runTick(dependencies);
    expect(result.fraudSignalsRaised).toBe(1);

    const signals = await dependencies.fraudSignals.list({ subjectPublicId: CUSTOMER });
    expect(signals).toHaveLength(1);
    const [signal] = signals;
    expect(signal).toBeDefined();
    if (signal === undefined) return;

    const expectedWindow = fraudWindowFor("2026-03-02T12:00:00.000Z", 30);
    expect(signal.ruleCode).toBe("repeated_customer_cancellation");
    expect(signal.severity).toBe("medium");
    expect(signal.observedCount).toBe(5);
    expect(signal.thresholdCount).toBe(5);
    expect(signal.windowStartedAt).toBe(expectedWindow.startedAt);
    expect(signal.windowEndedAt).toBe(expectedWindow.endedAt);
    expect(signal.raisedAt).toBe("2026-03-02T12:00:00.000Z");
    expect(signal.rulesetVersion).toBe(1);
  });

  it("حدثُ الإشارة يحمل حدَّ النافذة في occurred_for لا لحظةَ رفعها", async () => {
    const dependencies = deps();
    await recordSeries(dependencies, {
      subjectType: "customer",
      subjectPublicId: CUSTOMER,
      factKind: "order_cancelled_by_customer",
      count: 5,
      occurredAt: T0,
      actorType: "customer",
    });
    dependencies.clock.advanceHours(24);
    await runTick(dependencies);

    const [event] = dependencies.outbox.eventsOfType("reputation.fraud_signal_raised");
    expect(event).toBeDefined();
    if (event === undefined || event.event_type !== "reputation.fraud_signal_raised") return;
    expect(event.data.occurred_for).toBe(event.data.window_ended_at);
    expect(event.occurred_at).toBe("2026-03-02T12:00:00.000Z");
    // ولا حقلَ يأمر بشيء: لا إيقافَ ولا عقوبةَ ولا مدّة.
    expect(Object.keys(event.data)).not.toContain("action");
    expect(Object.keys(event.data)).not.toContain("suspend");
  });

  it("نبضةٌ ثانيةٌ في نفس اليوم لا تُكرّر الإشارة", async () => {
    /**
     * جوهرُ «النبضة قابلةٌ للتكرار». الاستحقاقُ يُدفَع بيدٍ هنا كي تركض نبضتان في نفس
     * السلّة اليوميّة، وهو بالضبط ما يحدث عند إعادة تشغيلٍ أو تشغيلٍ يدويٍّ للتحقيق.
     */
    const dependencies = deps();
    await recordSeries(dependencies, {
      subjectType: "customer",
      subjectPublicId: CUSTOMER,
      factKind: "order_cancelled_by_customer",
      count: 5,
      occurredAt: T0,
      actorType: "customer",
    });
    dependencies.clock.advanceHours(24);
    const first = await runTick(dependencies);
    expect(first.fraudSignalsRaised).toBe(1);

    dependencies.clock.advanceHours(6);
    const stored = await dependencies.scores.find("customer", CUSTOMER);
    expect(stored).not.toBeNull();
    if (stored === null) return;
    await dependencies.scores.upsert({ ...stored, nextRecomputeAt: dependencies.clock.now() });

    const second = await runTick(dependencies);
    expect(second.scoresRecomputed).toBe(1);
    expect(second.fraudSignalsRaised).toBe(0);
    expect(await dependencies.fraudSignals.list({ subjectPublicId: CUSTOMER })).toHaveLength(1);
    expect(dependencies.outbox.eventsOfType("reputation.fraud_signal_raised")).toHaveLength(1);
  });

  it("دفترٌ نظيفٌ ⇒ لا إشارةَ واحدة", async () => {
    const dependencies = deps();
    await completeOrder(dependencies, { orderPublicId: order(1), occurredAt: T0 });
    dependencies.clock.advanceHours(24);
    const result = await runTick(dependencies);
    expect(result.fraudSignalsRaised).toBe(0);
  });
});

describe("runTick — الفشل", () => {
  it("عطلٌ في صفٍّ واحدٍ يُحصى ولا يُوقف الباقي", async () => {
    const dependencies = deps();
    await completeOrder(dependencies, { orderPublicId: order(1), occurredAt: T0 });
    dependencies.clock.advanceHours(24);

    const original = dependencies.facts.listBySubject.bind(dependencies.facts);
    dependencies.facts.listBySubject = async (subjectType, subjectPublicId) => {
      if (subjectPublicId === DRIVER) throw new Error("عطلٌ مُصطنع في المخزن");
      return await original(subjectType, subjectPublicId);
    };

    const result = await runTick(dependencies);
    expect(result.failures).toBe(1);
    expect(result.scoresRecomputed).toBe(1);

    // ونتيجةُ العميل كُتبت فعلاً: العطلُ لم يُبطل عملَ الآخر.
    const stored = await dependencies.scores.find("customer", CUSTOMER);
    expect(stored?.computedAt).toBe("2026-03-02T12:00:00.000Z");
  });

  it("لا يُرمى استثناءٌ من النبضة بحال", async () => {
    const dependencies = deps();
    await completeOrder(dependencies, { orderPublicId: order(1), occurredAt: T0 });
    dependencies.clock.advanceHours(24);
    dependencies.facts.listBySubject = async () => {
      throw new Error("كلُّ شيءٍ يفشل");
    };

    const result = await runTick(dependencies);
    expect(result.failures).toBe(2);
    expect(result.scoresRecomputed).toBe(0);
  });
});
