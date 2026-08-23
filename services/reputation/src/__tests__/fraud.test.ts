/**
 * القواعدُ الخمس: مُسمّاةٌ، نقيّة، بعتبةٍ من نسخة القواعد، ولا حُكمَ فيها.
 *
 * ما تُثبته هذه الحزمة صراحةً:
 *
 *   - كلُّ قاعدةٍ تُعيد **إشارةً أو لا شيء**. لا درجةَ خطرٍ ولا احتمالَ ولا حالةً محفوظة.
 *   - لا إشارةَ دون العتبة، مهما قَرُبت. «قريبٌ من العتبة» ليس نمطاً.
 *   - كلُّ قاعدةٍ تعمل على **جانبها المُعلَن** وحده.
 *   - النافذةُ حدٌّ فعليّ: ما خارجَها لا يُعدّ.
 *   - وفي الحمولة عددٌ وعتبةٌ ونافذةٌ ونسخةُ قواعد — فيُمكن أن يُقال لصاحب الإشارة **لماذا**
 *     رُفعت، وذاك عبارةُ الطور: «إشاراتٌ مُسمّاة لا حُكم».
 */

import { describe, expect, it } from "vitest";
import {
  FRAUD_RULES,
  accept_then_abandon,
  evaluateFraudRules,
  offer_timeout_streak,
  rating_extremity_burst,
  repeated_customer_cancellation,
  repeated_driver_cancellation,
  type FraudRuleInput,
} from "../domain/fraud.js";
import { FRAUD_RULE_CODES } from "../domain/contract-sets.js";
import { SEEDED_RULESETS } from "../domain/ruleset.js";
import { fraudWindowFor } from "../domain/time.js";
import type { ReputationFactRow, ReputationRatingRow } from "../domain/model.js";

const RULESET = SEEDED_RULESETS[0];
const NOW = "2026-03-01T12:00:00.000Z";
const WINDOW = fraudWindowFor(NOW, RULESET.fraudWindowDays);

function fact(
  index: number,
  factKind: ReputationFactRow["factKind"],
  overrides: Partial<ReputationFactRow> = {},
): ReputationFactRow {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    subjectType: "driver",
    subjectPublicId: "WS-2000000002",
    factKind,
    orderPublicId: `ORD-${String(index).padStart(10, "0")}`,
    sourceEventType: "order.updated",
    sourceEventId: `e-${index}`,
    sourceSequence: 1,
    actorType: "system",
    reasonCode: null,
    occurredAt: NOW,
    recordedAt: NOW,
    traceId: null,
    ...overrides,
  };
}

function rating(index: number, stars: number, submittedAt = NOW): ReputationRatingRow {
  return {
    id: `00000000-0000-4000-8000-${String(900 + index).padStart(12, "0")}`,
    orderPublicId: `ORD-${String(index).padStart(10, "0")}`,
    raterType: "customer",
    raterPublicId: "WS-1000000001",
    subjectType: "driver",
    subjectPublicId: "WS-2000000002",
    stars,
    reasonCode: null,
    rulesetVersion: RULESET.rulesetVersion,
    submittedAt,
    traceId: null,
  };
}

function input(overrides: Partial<FraudRuleInput> = {}): FraudRuleInput {
  return {
    subjectType: "driver",
    subjectPublicId: "WS-2000000002",
    window: WINDOW,
    facts: [],
    ratingsAuthored: [],
    ruleset: RULESET,
    ...overrides,
  };
}

describe("النافذة", () => {
  it("تنتهي عند منتصف ليل الغد بتوقيت UTC وتبدأ قبله بثلاثين يوماً", () => {
    expect(WINDOW.endedAt).toBe("2026-03-02T00:00:00.000Z");
    expect(WINDOW.startedAt).toBe("2026-01-31T00:00:00.000Z");
  });

  it("كلُّ لحظات اليوم الواحد تُنتج نفسَ النافذة — وهو ما يجعل النبضةَ قابلةً للتكرار", () => {
    const morning = fraudWindowFor("2026-03-01T00:00:00.000Z", 30);
    const midnightEdge = fraudWindowFor("2026-03-01T23:59:59.999Z", 30);
    expect(morning).toEqual(WINDOW);
    expect(midnightEdge).toEqual(WINDOW);
  });
});

describe("repeated_customer_cancellation", () => {
  const base = {
    subjectType: "customer" as const,
    subjectPublicId: "WS-1000000001",
  };

  function cancellations(count: number, occurredAt = NOW): readonly ReputationFactRow[] {
    return Array.from({ length: count }, (_, index) =>
      fact(index + 1, "order_cancelled_by_customer", {
        ...base,
        actorType: "customer",
        occurredAt,
      }),
    );
  }

  it("دون العتبة (4 من 5) ⇒ لا إشارة", () => {
    expect(
      repeated_customer_cancellation(input({ ...base, facts: cancellations(4) })),
    ).toBeNull();
  });

  it("عند العتبة بالضبط ⇒ إشارةٌ بشدّتها المُعلَنة وعددِها وعتبتِها ونافذتِها", () => {
    const signal = repeated_customer_cancellation(input({ ...base, facts: cancellations(5) }));
    expect(signal).not.toBeNull();
    expect(signal).toEqual({
      subjectType: "customer",
      subjectPublicId: "WS-1000000001",
      ruleCode: "repeated_customer_cancellation",
      severity: "medium",
      windowStartedAt: WINDOW.startedAt,
      windowEndedAt: WINDOW.endedAt,
      observedCount: 5,
      thresholdCount: 5,
      rulesetVersion: 1,
    });
  });

  it("لا تُعدّ ما وقع خارج النافذة", () => {
    const outside = cancellations(5, "2026-01-01T12:00:00.000Z");
    expect(repeated_customer_cancellation(input({ ...base, facts: outside }))).toBeNull();
  });

  it("لا تعمل على السائق — عتبتُها مُعلَنةٌ للعميل وحده", () => {
    const driverCancels = Array.from({ length: 9 }, (_, index) =>
      fact(index + 1, "order_cancelled_by_customer"),
    );
    expect(repeated_customer_cancellation(input({ facts: driverCancels }))).toBeNull();
  });
});

describe("repeated_driver_cancellation", () => {
  it("عتبتُها 4 وشدّتُها medium", () => {
    const facts = Array.from({ length: 4 }, (_, index) =>
      fact(index + 1, "order_cancelled_by_driver", { actorType: "driver" }),
    );
    const signal = repeated_driver_cancellation(input({ facts }));
    expect(signal?.thresholdCount).toBe(4);
    expect(signal?.observedCount).toBe(4);
    expect(signal?.severity).toBe("medium");
  });

  it("ثلاثةٌ لا تكفي", () => {
    const facts = Array.from({ length: 3 }, (_, index) =>
      fact(index + 1, "order_cancelled_by_driver"),
    );
    expect(repeated_driver_cancellation(input({ facts }))).toBeNull();
  });
});

describe("accept_then_abandon", () => {
  /** زوجٌ كاملٌ على طلبٍ واحد: قَبِل ثم ألغى. */
  function pair(index: number): readonly ReputationFactRow[] {
    return [
      fact(index, "assignment_accepted", { id: `00000000-0000-4000-8000-a${String(index).padStart(11, "0")}` }),
      fact(index, "order_cancelled_by_driver", {
        id: `00000000-0000-4000-8000-b${String(index).padStart(11, "0")}`,
        actorType: "driver",
      }),
    ];
  }

  it("ثلاثةُ أزواجٍ ⇒ إشارةٌ high", () => {
    const facts = [...pair(1), ...pair(2), ...pair(3)];
    const signal = accept_then_abandon(input({ facts }));
    expect(signal?.severity).toBe("high");
    expect(signal?.observedCount).toBe(3);
    expect(signal?.thresholdCount).toBe(3);
  });

  it("زوجان ⇒ لا إشارة", () => {
    expect(accept_then_abandon(input({ facts: [...pair(1), ...pair(2)] }))).toBeNull();
  });

  it("تُعدّ الطلبات لا الوقائع — ستُّ وقائعَ على طلبين لا تبلغ عتبةَ ثلاثة", () => {
    /**
     * لو عُدَّت الوقائع لكان العددُ أربعاً على طلبين، فيتجاوز عتبةَ ثلاثةٍ بنصف النمط.
     */
    const signal = accept_then_abandon(input({ facts: [...pair(1), ...pair(2)] }));
    expect(signal).toBeNull();
  });

  it("قبولٌ بلا إلغاء وإلغاءٌ بلا قبول على طلباتٍ مختلفة ⇒ لا نمط", () => {
    const facts = [
      fact(1, "assignment_accepted"),
      fact(2, "assignment_accepted"),
      fact(3, "assignment_accepted"),
      fact(4, "order_cancelled_by_driver"),
      fact(5, "order_cancelled_by_driver"),
      fact(6, "order_cancelled_by_driver"),
    ];
    expect(accept_then_abandon(input({ facts }))).toBeNull();
  });
});

describe("offer_timeout_streak", () => {
  it("عشرةُ انتهاءاتٍ للمهلة ⇒ إشارةٌ low", () => {
    const facts = Array.from({ length: 10 }, (_, index) => fact(index + 1, "assignment_timed_out"));
    const signal = offer_timeout_streak(input({ facts }));
    expect(signal?.severity).toBe("low");
    expect(signal?.observedCount).toBe(10);
  });

  it("تسعةٌ لا تكفي", () => {
    const facts = Array.from({ length: 9 }, (_, index) => fact(index + 1, "assignment_timed_out"));
    expect(offer_timeout_streak(input({ facts }))).toBeNull();
  });

  it("عدٌّ في نافذةٍ لا تتابعٌ متّصل — قبولٌ في الوسط لا يُصفّر العدّاد", () => {
    /**
     * «تتابعٌ» بمعناه الحرفيّ يعني أنّ قبولاً واحداً يُخفي النمطَ تماماً، فيصير من يقبل
     * عرضاً كل عشرةٍ غيرَ مرئيّ. والعدُّ في نافذةٍ يقيس ما يقع فعلاً.
     */
    const facts = [
      ...Array.from({ length: 5 }, (_, index) => fact(index + 1, "assignment_timed_out")),
      fact(50, "assignment_accepted"),
      ...Array.from({ length: 5 }, (_, index) => fact(index + 20, "assignment_timed_out")),
    ];
    expect(offer_timeout_streak(input({ facts }))?.observedCount).toBe(10);
  });
});

describe("rating_extremity_burst", () => {
  const base = { subjectType: "customer" as const, subjectPublicId: "WS-1000000001" };

  it("ثمانيةُ تقييماتٍ متطرّفةٍ أرسلها ⇒ إشارةٌ low", () => {
    const ratingsAuthored = Array.from({ length: 8 }, (_, index) =>
      rating(index + 1, index % 2 === 0 ? 1 : 5),
    );
    const signal = rating_extremity_burst(input({ ...base, ratingsAuthored }));
    expect(signal?.severity).toBe("low");
    expect(signal?.observedCount).toBe(8);
  });

  it("لا تُعدّ الدرجات الوسطى", () => {
    const ratingsAuthored = Array.from({ length: 8 }, (_, index) => rating(index + 1, 3));
    expect(rating_extremity_burst(input({ ...base, ratingsAuthored }))).toBeNull();
  });

  it("تقرأ ما أرسله لا ما تلقّاه", () => {
    /**
     * الحقلُ المقروء `ratingsAuthored`، وقائمةُ الوقائع لا تحمل درجةً أصلاً. ولو قُرئت
     * تقييماتُ من تلقّاها لصارت القاعدةُ تُعاقب من أُسيء إليه.
     */
    const received = Array.from({ length: 8 }, (_, index) => fact(index + 1, "rating_received"));
    expect(rating_extremity_burst(input({ ...base, facts: received }))).toBeNull();
  });

  it("لا تُعدّ ما أُرسل خارج النافذة", () => {
    const ratingsAuthored = Array.from({ length: 8 }, (_, index) =>
      rating(index + 1, 5, "2025-12-01T12:00:00.000Z"),
    );
    expect(rating_extremity_burst(input({ ...base, ratingsAuthored }))).toBeNull();
  });
});

describe("السجل الكامل", () => {
  it("لكلّ رمزٍ في العقد قاعدةٌ تُقابله — ولا رمزَ بلا قاعدة", () => {
    expect(Object.keys(FRAUD_RULES).sort()).toEqual([...FRAUD_RULE_CODES].sort());
  });

  it("evaluateFraudRules تُشغّل الكلَّ وتُعيد المُتجاوِزَ فقط، بترتيب العقد", () => {
    const facts = [
      ...Array.from({ length: 4 }, (_, index) =>
        fact(index + 1, "order_cancelled_by_driver", { actorType: "driver" }),
      ),
      fact(1, "assignment_accepted"),
      fact(2, "assignment_accepted"),
      fact(3, "assignment_accepted"),
    ];
    const drafts = evaluateFraudRules(input({ facts }));
    expect(drafts.map((draft) => draft.ruleCode)).toEqual([
      "repeated_driver_cancellation",
      "accept_then_abandon",
    ]);
  });

  it("دفترٌ نظيفٌ ⇒ لا إشارةَ واحدة", () => {
    expect(evaluateFraudRules(input())).toEqual([]);
  });

  it("لا قاعدةَ تُعيد شيئاً غير مسوّدةٍ أو غياب — لا درجةَ ولا احتمال", () => {
    for (const ruleCode of FRAUD_RULE_CODES) {
      const result = FRAUD_RULES[ruleCode](input());
      expect(result === null || typeof result === "object").toBe(true);
      if (result !== null) {
        expect(Object.keys(result)).not.toContain("probability");
        expect(Object.keys(result)).not.toContain("score");
      }
    }
  });
});
