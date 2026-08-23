/**
 * حاسبةُ النتيجة: التلاشي، والاستنتاج، والحدود، وإعادةُ الإنتاج.
 *
 * كلُّ ما هنا يستدعي دوالَّ نقيّة ولا يلمس مخزناً: هذا هو الفحصُ العمليّ لكون الحاسبة
 * نقيّةً فعلاً. ولو احتاج أحدُ هذه الاختبارات مخزناً أو ساعةً لكان ذلك دليلَ العلّة نفسه.
 */

import { describe, expect, it } from "vitest";
import { SEEDED_RULESETS, weightFor } from "../domain/ruleset.js";
import {
  clampToRulesetBounds,
  computeScore,
  deriveTier,
  roundHalfUp,
} from "../domain/score.js";
import { decayFactor } from "../domain/time.js";
import type { ReputationFactRow } from "../domain/model.js";
import { isReputationError } from "../domain/errors.js";

const RULESET = SEEDED_RULESETS[0];
const AT = "2026-03-01T12:00:00.000Z";

function fact(overrides: Partial<ReputationFactRow> = {}): ReputationFactRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    subjectType: "customer",
    subjectPublicId: "WS-1000000001",
    factKind: "order_completed",
    orderPublicId: "ORD-0000000001",
    sourceEventType: "order.completed",
    sourceEventId: "e-1",
    sourceSequence: 1,
    actorType: "system",
    reasonCode: null,
    occurredAt: AT,
    recordedAt: AT,
    traceId: null,
    ...overrides,
  };
}

describe("نسخة القواعد الأولى", () => {
  it("تحمل القيم المجمَّدة في العقد", () => {
    expect(RULESET.rulesetVersion).toBe(1);
    expect(RULESET.startingScore).toBe(60);
    expect(RULESET.decayHalfLifeDays).toBe(180);
    expect(RULESET.minFactsForScore).toBe(5);
    expect(RULESET.tierUnderWatchBelow).toBe(35);
    expect(RULESET.tierStandardAt).toBe(50);
    expect(RULESET.tierTrustedAt).toBe(80);
    expect(RULESET.isFrozen).toBe(true);
  });
});

describe("التلاشي", () => {
  it("عند نصف العمر بالضبط يكون المعامل نصفاً", () => {
    expect(decayFactor(180, 180)).toBeCloseTo(0.5, 12);
  });

  it("عند ضِعف نصف العمر يكون ربعاً — لا خُطوةً ثابتة", () => {
    expect(decayFactor(360, 180)).toBeCloseTo(0.25, 12);
  });

  it("واقعةٌ اليوم بوزنها الكامل", () => {
    expect(decayFactor(0, 180)).toBe(1);
  });

  it("لا يُنتج معاملاً أكبر من واحد لواقعةٍ بعمرٍ سالب", () => {
    // ساعةٌ منحرفةٌ لثانيةٍ لا يجوز أن تُنتج وزناً أكبر من الوزن المُعلَن.
    expect(decayFactor(-5, 180)).toBe(1);
  });
});

describe("computeScore", () => {
  it("دفترٌ خالٍ ⇒ نتيجةُ البداية ورتبةُ new وبلا مؤشّرِ آخرِ واقعة", () => {
    const result = computeScore({ subjectType: "customer", facts: [], ruleset: RULESET, at: AT });
    expect(result.scorePoints).toBe(60);
    expect(result.tier).toBe("new");
    expect(result.factCount).toBe(0);
    expect(result.computedThroughFactId).toBeNull();
  });

  it("واقعةُ إكمالٍ اليوم لعميل تُضيف وزنَها الكامل (+3)", () => {
    const result = computeScore({
      subjectType: "customer",
      facts: [fact()],
      ruleset: RULESET,
      at: AT,
    });
    expect(result.scorePoints).toBe(63);
    expect(result.factCount).toBe(1);
  });

  it("واقعةُ إكمالٍ عمرُها نصفُ عمرٍ لسائق تُضيف نصفَ وزنها (+4 ⇒ +2)", () => {
    const result = computeScore({
      subjectType: "driver",
      facts: [fact({ subjectType: "driver", occurredAt: "2025-09-02T12:00:00.000Z" })],
      ruleset: RULESET,
      at: AT,
    });
    expect(result.scorePoints).toBe(62);
  });

  it("تقرأ occurredAt ولا تقرأ recordedAt", () => {
    /**
     * واقعتان بنفس لحظة الوقوع ولحظتَي تسجيلٍ مختلفتين تُنتجان **نفس** الرقم. وهذا هو
     * الفرقُ الذي يجعل حدثاً وصل متأخّراً يومين يُوزَن بعمره الحقيقيّ.
     */
    const early = computeScore({
      subjectType: "driver",
      facts: [fact({ subjectType: "driver", occurredAt: "2025-09-02T12:00:00.000Z", recordedAt: AT })],
      ruleset: RULESET,
      at: AT,
    });
    const late = computeScore({
      subjectType: "driver",
      facts: [
        fact({
          subjectType: "driver",
          occurredAt: "2025-09-02T12:00:00.000Z",
          recordedAt: "2026-02-28T12:00:00.000Z",
        }),
      ],
      ruleset: RULESET,
      at: AT,
    });
    expect(late.scorePoints).toBe(early.scorePoints);
  });

  it("الإلغاءُ يُنقص، والنتيجةُ تبقى دالّةً في الدفتر وحده", () => {
    const result = computeScore({
      subjectType: "customer",
      facts: [fact({ factKind: "order_cancelled_by_customer", actorType: "customer" })],
      ruleset: RULESET,
      at: AT,
    });
    expect(result.scorePoints).toBe(54);
  });

  it("نفسُ المدخل ⇒ نفسُ المخرج، بلا أي أثرٍ للاستدعاء السابق", () => {
    const input = {
      subjectType: "driver" as const,
      facts: [
        fact({ subjectType: "driver", id: "00000000-0000-4000-8000-00000000000a" }),
        fact({
          subjectType: "driver",
          id: "00000000-0000-4000-8000-00000000000b",
          factKind: "assignment_accepted",
          orderPublicId: "ORD-0000000002",
          sourceEventId: "e-2",
        }),
      ],
      ruleset: RULESET,
      at: AT,
    };
    expect(computeScore(input)).toEqual(computeScore(input));
  });

  it("لا تعتمد على ترتيب الوقائع الوارد", () => {
    const first = fact({ subjectType: "driver", id: "00000000-0000-4000-8000-00000000000a" });
    const second = fact({
      subjectType: "driver",
      id: "00000000-0000-4000-8000-00000000000b",
      factKind: "assignment_accepted",
      orderPublicId: "ORD-0000000002",
      sourceEventId: "e-2",
      occurredAt: "2026-02-01T12:00:00.000Z",
    });
    const ascending = computeScore({
      subjectType: "driver",
      facts: [second, first],
      ruleset: RULESET,
      at: AT,
    });
    const descending = computeScore({
      subjectType: "driver",
      facts: [first, second],
      ruleset: RULESET,
      at: AT,
    });
    expect(ascending).toEqual(descending);
  });

  it("ترفض وزناً غيرَ مُعلَن بدل أن تُهمل الواقعة بصمت", () => {
    /**
     * `assignment_accepted` وزنٌ مُعلَنٌ للسائق وحده. حسابُه لعميلٍ ليس صفراً بل خطأ:
     * لو صار صفراً لصار من المستحيل تمييزُ «لا أثر لها» من «نسيناها».
     */
    try {
      computeScore({
        subjectType: "customer",
        facts: [fact({ factKind: "assignment_accepted" })],
        ruleset: RULESET,
        at: AT,
      });
      expect.unreachable("كان يجب أن يُرمى REPUTATION_RULE_WEIGHT_MISSING");
    } catch (error) {
      expect(isReputationError(error)).toBe(true);
      if (isReputationError(error)) {
        expect(error.code).toBe("REPUTATION_RULE_WEIGHT_MISSING");
        expect(error.httpStatus).toBe(422);
      }
    }
  });

  it("الصفرُ المُعلَن يبقى صفراً ولا يُرمى", () => {
    // `assignment_rejected` للسائق وزنُه صفرٌ **مكتوبٌ صفّاً** في نسخة القواعد.
    expect(weightFor(RULESET, "driver", "assignment_rejected")).toBe(0);
    const result = computeScore({
      subjectType: "driver",
      facts: [fact({ subjectType: "driver", factKind: "assignment_rejected" })],
      ruleset: RULESET,
      at: AT,
    });
    expect(result.scorePoints).toBe(60);
    expect(result.factCount).toBe(1);
  });
});

describe("الحدود والتقريب", () => {
  it("يُقرَّب النصفُ إلى الأعلى دائماً", () => {
    expect(roundHalfUp(62.5)).toBe(63);
    expect(roundHalfUp(62.4999)).toBe(62);
    expect(roundHalfUp(-0.5)).toBe(0);
  });

  it("تُحبَس النتيجةُ في حدود النسخة", () => {
    expect(clampToRulesetBounds(-40, RULESET)).toBe(0);
    expect(clampToRulesetBounds(180, RULESET)).toBe(100);
    expect(clampToRulesetBounds(61, RULESET)).toBe(61);
  });
});

describe("deriveTier", () => {
  it("دون العدد الأدنى للوقائع ⇒ new مهما كان الرقم", () => {
    expect(deriveTier(100, 4, RULESET)).toBe("new");
    expect(deriveTier(0, 0, RULESET)).toBe("new");
  });

  it("دون 35 ⇒ under_watch", () => {
    expect(deriveTier(34, 5, RULESET)).toBe("under_watch");
  });

  it("80 وما فوق ⇒ trusted، والحدُّ نفسُه داخلٌ في الرتبة", () => {
    expect(deriveTier(80, 5, RULESET)).toBe("trusted");
    expect(deriveTier(79, 5, RULESET)).toBe("standard");
  });

  it("النطاق [35,50) ⇒ standard — قرارٌ مُعلَنٌ لا سهو", () => {
    /**
     * 38 نقطةً فوق حدِّ المراقبة (35) ودون حدِّ الاعتياد (50). ولا رتبةَ خامسةَ في العقد،
     * ورتبةٌ جديدةٌ تحتاج نسخةَ قواعدٍ وADR — لا فرعاً يُضاف في الكود. وهذا الاختبار
     * موجودٌ كي لا يُقرأ القرارُ لاحقاً كخطأ فيُصحَّح إلى سلوكٍ لم يُتّفق عليه.
     */
    expect(deriveTier(35, 5, RULESET)).toBe("standard");
    expect(deriveTier(38, 5, RULESET)).toBe("standard");
    expect(deriveTier(49, 5, RULESET)).toBe("standard");
  });
});
