/**
 * القراءاتُ وإعادةُ الحساب اليدويّة.
 *
 * القاعدةُ المفروضةُ هنا: **قراءةُ قائمةٍ تحتاج مُرشِّحاً واحداً على الأقل**. مسحٌ كاملٌ
 * على `reputation_facts` جدولٌ ينمو بحركة المنصّة كلِّها، فطلبٌ بلا مُرشِّح يقرأ ملايينَ
 * الصفوف ويُوقف القاعدةَ على الجميع. والحدُّ في حالة الاستخدام لا في المخزن كي يُردّ
 * `400` واضحٌ بدل مهلةٍ منتهية.
 */

import { describe, expect, it } from "vitest";
import { isReputationError } from "../domain/errors.js";
import {
  listFacts,
  listFraudSignals,
  listRatings,
  listRulesets,
  readRuleset,
  readScore,
  readUsableRuleset,
} from "../use-cases/reads.js";
import { recomputeScore } from "../use-cases/recompute-score.js";
import { recordFact } from "../use-cases/record-fact.js";
import { CUSTOMER, DRIVER, T0, deps, factDraft, order } from "./helpers.js";
import { createInMemoryReputationDependencies } from "../infrastructure/in-memory.js";
import { SEEDED_RULESETS } from "../domain/ruleset.js";

/** نسخةُ قواعدٍ ثانيةٌ **غيرُ مجمَّدة** — مسوّدةٌ كما تكون في الواقع قبل إعلانها. */
const DRAFT_V2 = { ...SEEDED_RULESETS[0], rulesetVersion: 2, isFrozen: false };

async function codeOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (isReputationError(error)) return error.code;
    throw error;
  }
  throw new Error("كان يجب أن يفشل الاستدعاء");
}

describe("readScore", () => {
  it("نتيجةٌ موجودةٌ تُعاد كما خُزّنت", async () => {
    const dependencies = deps();
    await recordFact(dependencies, { draft: factDraft() });
    const score = await readScore(dependencies, {
      subjectType: "customer",
      subjectPublicId: CUSTOMER,
    });
    expect(score.scorePoints).toBe(63);
    expect(score.computedAt).toBe(T0);
  });

  it("من لا دفترَ له ⇒ 404 SCORE_NOT_FOUND ولا نتيجةَ بدايةٍ مُختلَقة", async () => {
    /**
     * إعادةُ 60 لمن لم يفعل شيئاً كانت ستجعل «من لهم سمعة» يساوي «من فُتح لهم حساب»،
     * فيُقاس شيءٌ غيرُ المقصود، ولا يُفرَّق بين صامتٍ وجديد.
     */
    const dependencies = deps();
    expect(
      await codeOf(() =>
        readScore(dependencies, { subjectType: "driver", subjectPublicId: DRIVER }),
      ),
    ).toBe("REPUTATION_SCORE_NOT_FOUND");
  });

  it("مُعرّفٌ بشكلٍ خطأ ⇒ 400 قبل أي قراءة", async () => {
    const dependencies = deps();
    expect(
      await codeOf(() => readScore(dependencies, { subjectType: "driver", subjectPublicId: "x" })),
    ).toBe("REPUTATION_VALIDATION_FAILED");
  });
});

describe("القوائم — المُرشِّح إلزاميّ", () => {
  it("وقائعُ بلا مُرشِّح ⇒ 400 FILTER_REQUIRED", async () => {
    const dependencies = deps();
    expect(await codeOf(() => listFacts(dependencies, {}))).toBe("REPUTATION_FILTER_REQUIRED");
  });

  it("تقييماتٌ وإشاراتٌ بلا مُرشِّح ⇒ 400 كذلك", async () => {
    const dependencies = deps();
    expect(await codeOf(() => listRatings(dependencies, {}))).toBe("REPUTATION_FILTER_REQUIRED");
    expect(await codeOf(() => listFraudSignals(dependencies, {}))).toBe(
      "REPUTATION_FILTER_REQUIRED",
    );
  });

  it("مُرشِّحٌ بقيمةٍ فارغةٍ لا يُعَدّ مُرشِّحاً", async () => {
    const dependencies = deps();
    expect(await codeOf(() => listFacts(dependencies, { subjectPublicId: "" }))).toBe(
      "REPUTATION_FILTER_REQUIRED",
    );
  });

  it("بمُرشِّحٍ واحدٍ تُعاد الوقائعُ مرتّبةً ترتيباً ثابتاً", async () => {
    const dependencies = deps();
    for (let index = 0; index < 3; index += 1) {
      await recordFact(dependencies, {
        draft: factDraft({ orderPublicId: order(index + 1), sourceEventId: `e-${index}` }),
      });
    }
    const facts = await listFacts(dependencies, { subjectPublicId: CUSTOMER });
    expect(facts).toHaveLength(3);
    expect(facts.map((fact) => fact.orderPublicId)).toEqual([order(1), order(2), order(3)]);
  });

  it("نسخُ القواعد تُقرأ بلا مُرشِّح — الاستثناءُ الوحيد المُعلَن", async () => {
    const dependencies = deps();
    const rulesets = await listRulesets(dependencies);
    expect(rulesets).toHaveLength(1);
    expect(rulesets[0]?.rulesetVersion).toBe(1);
  });
});

describe("قراءةُ نسخة القواعد", () => {
  it("نسخةٌ موجودةٌ تُعاد", async () => {
    const dependencies = deps();
    const ruleset = await readRuleset(dependencies, 1);
    expect(ruleset.label).toBe("saudi-launch-v1");
    expect(ruleset.isFrozen).toBe(true);
  });

  it("نسخةٌ غائبة ⇒ 404 RULESET_NOT_FOUND", async () => {
    const dependencies = deps();
    expect(await codeOf(() => readRuleset(dependencies, 99))).toBe("REPUTATION_RULESET_NOT_FOUND");
  });

  it("غيرُ المجمَّدة تُقرأ للمراجعة لكنها لا تصلح للحساب ⇒ 422 RULESET_NOT_FROZEN", async () => {
    const dependencies = createInMemoryReputationDependencies({
      startAt: T0,
      rulesets: [SEEDED_RULESETS[0], DRAFT_V2],
    });

    const readable = await readRuleset(dependencies, 2);
    expect(readable.isFrozen).toBe(false);
    expect(await codeOf(() => readUsableRuleset(dependencies, 2))).toBe(
      "REPUTATION_RULESET_NOT_FROZEN",
    );
  });

  it("النشطةُ هي أعلى نسخةٍ **مجمَّدة** — لا أعلى رقمٍ بحال", async () => {
    /**
     * لو كانت النشطةُ أعلى رقمٍ لكان مسوّدةُ نسخةٍ نصفَ مكتوبةٍ تُحسب بها نقاطُ الناس
     * لحظةَ إدراجها. والتجميدُ هو الإعلان.
     */
    const dependencies = createInMemoryReputationDependencies({
      startAt: T0,
      rulesets: [SEEDED_RULESETS[0], DRAFT_V2],
    });
    const active = await dependencies.rulesets.findActive();
    expect(active?.rulesetVersion).toBe(1);
  });
});

describe("recomputeScore", () => {
  it("يُعيد الحساب من الدفتر ويُحدّث موعدَ الاستحقاق", async () => {
    const dependencies = deps();
    await recordFact(dependencies, { draft: factDraft() });
    dependencies.clock.advanceDays(180);

    const result = await recomputeScore(dependencies, {
      subjectType: "customer",
      subjectPublicId: CUSTOMER,
    });

    // 60 + 3 × 0.5 (نصفُ العمر 180 يوماً) = 61.5 ⇒ 62
    expect(result.score.scorePoints).toBe(62);
    expect(result.previous?.scorePoints).toBe(63);
    expect(result.score.nextRecomputeAt).toBe("2026-08-29T12:00:00.000Z");
  });

  it("المُحرّض manual_recompute في الحدث", async () => {
    const dependencies = deps();
    await recordFact(dependencies, { draft: factDraft() });
    dependencies.outbox.clear();
    await recomputeScore(dependencies, { subjectType: "customer", subjectPublicId: CUSTOMER });

    const [event] = dependencies.outbox.eventsOfType("reputation.score_recomputed");
    expect(event).toBeDefined();
    if (event === undefined || event.event_type !== "reputation.score_recomputed") return;
    expect(event.data.trigger).toBe("manual_recompute");
  });

  it("حرسُ التزامن المتفائل: قيمةٌ قديمة ⇒ 409 SCORE_STALE", async () => {
    const dependencies = deps();
    const first = await recordFact(dependencies, { draft: factDraft() });
    await recordFact(dependencies, {
      draft: factDraft({ orderPublicId: order(2), sourceEventId: "e-2" }),
    });

    expect(
      await codeOf(() =>
        recomputeScore(dependencies, {
          subjectType: "customer",
          subjectPublicId: CUSTOMER,
          ifComputedThroughFactId: first.fact.id,
        }),
      ),
    ).toBe("REPUTATION_SCORE_STALE");
  });

  it("حرسٌ بقيمةٍ مُطابقة ⇒ يمرّ", async () => {
    const dependencies = deps();
    const first = await recordFact(dependencies, { draft: factDraft() });
    const result = await recomputeScore(dependencies, {
      subjectType: "customer",
      subjectPublicId: CUSTOMER,
      ifComputedThroughFactId: first.fact.id,
    });
    expect(result.score.computedThroughFactId).toBe(first.fact.id);
  });

  it("لا دفترَ ولا نتيجة ⇒ 404", async () => {
    const dependencies = deps();
    expect(
      await codeOf(() =>
        recomputeScore(dependencies, { subjectType: "driver", subjectPublicId: DRIVER }),
      ),
    ).toBe("REPUTATION_SCORE_NOT_FOUND");
  });

  it("إعادةُ الحساب لا تُغيّر الرقمَ إن لم يتغيّر الدفترُ ولا الزمن", async () => {
    /**
     * الحسبةُ دالّةٌ في (الدفتر، نسخة القواعد، اللحظة). وثباتُها عند ثبات المدخلات هو
     * ما يجعل «لماذا نقاطي 62؟» سؤالاً له جوابٌ واحد.
     */
    const dependencies = deps();
    await recordFact(dependencies, { draft: factDraft() });
    const again = await recomputeScore(dependencies, {
      subjectType: "customer",
      subjectPublicId: CUSTOMER,
    });
    expect(again.score.scorePoints).toBe(63);
    expect(again.tierDidChange).toBe(false);
  });
});
