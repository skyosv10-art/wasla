/**
 * التقييم: الشروطُ المُسبقة، والنافذة، والمعالجةُ الواحدة، والطريقُ إلى الدفتر.
 *
 * وأهمُّ ما تُثبته: التقييمُ **لا يُعدّل النتيجة بنفسه**. يُخزَّن، ثم تُشتقّ منه واقعةٌ في
 * الدفتر، ومن الدفتر تُحسب النتيجة. ولذلك يُفحَص وجودُ الواقعة المُشتقّة صراحةً: لو
 * اختفت لبقي الرقمُ صحيحاً بالمصادفة اليوم وكاذباً بعد أوّل إعادة حساب.
 */

import { describe, expect, it } from "vitest";
import { isReputationError } from "../domain/errors.js";
import { submitRating } from "../use-cases/submit-rating.js";
import { recordFact } from "../use-cases/record-fact.js";
import {
  CUSTOMER,
  DRIVER,
  OTHER_DRIVER,
  T0,
  completeOrder,
  deps,
  factDraft,
  order,
} from "./helpers.js";
import type { InMemoryReputationDependencies } from "../infrastructure/in-memory.js";

async function codeOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (isReputationError(error)) return error.code;
    throw error;
  }
  throw new Error("كان يجب أن يفشل الاستدعاء");
}

function ratingDraft(overrides: Record<string, unknown> = {}) {
  return {
    orderPublicId: order(1),
    raterType: "customer" as const,
    raterPublicId: CUSTOMER,
    subjectPublicId: DRIVER,
    stars: 5,
    reasonCode: null,
    submittedAt: T0,
    ...overrides,
  };
}

async function withCompletedOrder(): Promise<InMemoryReputationDependencies> {
  const dependencies = deps();
  await completeOrder(dependencies, { orderPublicId: order(1), occurredAt: T0 });
  return dependencies;
}

describe("submitRating — المسار السعيد", () => {
  it("يُخزّن التقييم ويُشتقّ منه واقعةً ويُعيد النتيجةَ المحسوبة", async () => {
    const dependencies = await withCompletedOrder();
    const result = await submitRating(dependencies, {
      draft: ratingDraft(),
      idempotencyKey: "key-1",
    });

    expect(result.rating.subjectType).toBe("driver");
    expect(result.rating.stars).toBe(5);
    expect(result.rating.rulesetVersion).toBe(1);

    // الواقعةُ المُشتقّة: نوعُها مُعلَن، ومصدرُها التقييمُ نفسه.
    expect(result.fact.factKind).toBe("rating_received");
    expect(result.fact.sourceEventType).toBe("reputation.rating_submitted");
    expect(result.fact.sourceEventId).toBe(result.rating.id);
    expect(result.fact.subjectPublicId).toBe(DRIVER);

    // 60 + 4 (إكمال) + 2 (تقييمٌ مُتلقّى) = 66
    expect(result.score.scorePoints).toBe(66);
    expect(result.score.factCount).toBe(2);
  });

  it("يُستنتج جانبُ المُقيَّم من دفتر الطلب ولا يُرسله العميل", async () => {
    const dependencies = await withCompletedOrder();
    const result = await submitRating(dependencies, {
      draft: ratingDraft(),
      idempotencyKey: "key-1",
    });
    expect(result.rating.subjectType).toBe("driver");
    expect(result.rating.raterType).toBe("customer");
  });

  it("يُنتج حدثَ تقييمٍ واحداً وحدثَ واقعةٍ واحداً", async () => {
    const dependencies = await withCompletedOrder();
    dependencies.outbox.clear();
    await submitRating(dependencies, { draft: ratingDraft(), idempotencyKey: "key-1" });

    expect(dependencies.outbox.eventsOfType("reputation.rating_submitted")).toHaveLength(1);
    expect(dependencies.outbox.eventsOfType("reputation.fact_recorded")).toHaveLength(1);
  });

  it("درجةٌ منخفضةٌ لا تُنقص النتيجة — التقييمُ واقعةٌ بوزنٍ واحدٍ مُعلَن", async () => {
    /**
     * وزنُ `rating_received` واحدٌ في نسخة القواعد (+2) ولا يتغيّر بعدد النجوم. وربطُ
     * النقاط بالدرجة كان قراراً آخر يحتاج عقداً وADR، ولا يُدسّ في الكود. والدرجاتُ
     * محفوظةٌ في `reputation_ratings` كاملةً فمن أراد بناءَ متوسّطٍ عليها فعل — بنسخة
     * قواعدٍ جديدة.
     */
    const dependencies = await withCompletedOrder();
    const result = await submitRating(dependencies, {
      draft: ratingDraft({ stars: 1 }),
      idempotencyKey: "key-1",
    });
    expect(result.score.scorePoints).toBe(66);
  });
});

describe("submitRating — المعالجة الواحدة", () => {
  it("بلا مفتاحٍ ⇒ 400 IDEMPOTENCY_KEY_REQUIRED", async () => {
    const dependencies = await withCompletedOrder();
    expect(await codeOf(() => submitRating(dependencies, { draft: ratingDraft() }))).toBe(
      "REPUTATION_IDEMPOTENCY_KEY_REQUIRED",
    );
  });

  it("نفسُ المفتاح بنفس الحمولة ⇒ نفسُ النتيجة بلا نقطةٍ ثانية ولا حدثٍ ثانٍ", async () => {
    const dependencies = await withCompletedOrder();
    const first = await submitRating(dependencies, {
      draft: ratingDraft(),
      idempotencyKey: "key-1",
    });
    const eventsAfterFirst = dependencies.outbox.appended.length;

    const replay = await submitRating(dependencies, {
      draft: ratingDraft(),
      idempotencyKey: "key-1",
    });

    expect(replay.rating.id).toBe(first.rating.id);
    expect(replay.fact.id).toBe(first.fact.id);
    expect(replay.score.scorePoints).toBe(first.score.scorePoints);
    expect(dependencies.outbox.appended.length).toBe(eventsAfterFirst);
  });

  it("نفسُ المفتاح بحمولةٍ مختلفة ⇒ 409 IDEMPOTENCY_KEY_REUSED", async () => {
    const dependencies = await withCompletedOrder();
    await submitRating(dependencies, { draft: ratingDraft(), idempotencyKey: "key-1" });
    expect(
      await codeOf(() =>
        submitRating(dependencies, { draft: ratingDraft({ stars: 2 }), idempotencyKey: "key-1" }),
      ),
    ).toBe("REPUTATION_IDEMPOTENCY_KEY_REUSED");
  });

  it("ترتيبُ حقول الحمولة لا يُغيّر البصمة", async () => {
    const dependencies = await withCompletedOrder();
    await submitRating(dependencies, { draft: ratingDraft(), idempotencyKey: "key-1" });
    const reordered = {
      stars: 5,
      submittedAt: T0,
      subjectPublicId: DRIVER,
      reasonCode: null,
      raterPublicId: CUSTOMER,
      raterType: "customer" as const,
      orderPublicId: order(1),
    };
    await expect(
      submitRating(dependencies, { draft: reordered, idempotencyKey: "key-1" }),
    ).resolves.toBeDefined();
  });

  it("مفتاحٌ جديدٌ لنفس الزوج ⇒ 409 RATING_ALREADY_SUBMITTED", async () => {
    const dependencies = await withCompletedOrder();
    await submitRating(dependencies, { draft: ratingDraft(), idempotencyKey: "key-1" });
    expect(
      await codeOf(() =>
        submitRating(dependencies, { draft: ratingDraft(), idempotencyKey: "key-2" }),
      ),
    ).toBe("REPUTATION_RATING_ALREADY_SUBMITTED");
  });
});

describe("submitRating — الرفض", () => {
  it("تقييمُ النفس ⇒ 422 RATING_SELF_FORBIDDEN", async () => {
    const dependencies = await withCompletedOrder();
    expect(
      await codeOf(() =>
        submitRating(dependencies, {
          draft: ratingDraft({ subjectPublicId: CUSTOMER }),
          idempotencyKey: "key-1",
        }),
      ),
    ).toBe("REPUTATION_RATING_SELF_FORBIDDEN");
  });

  it("طلبٌ لا يعرف الدفترُ أنّه اكتمل ⇒ 422 ORDER_NOT_COMPLETED", async () => {
    const dependencies = deps();
    // إسنادٌ مقبولٌ فقط، بلا إكمال.
    await recordFact(dependencies, {
      draft: factDraft({
        subjectType: "driver",
        subjectPublicId: DRIVER,
        factKind: "assignment_accepted",
        orderPublicId: order(1),
      }),
    });
    expect(
      await codeOf(() => submitRating(dependencies, { draft: ratingDraft(), idempotencyKey: "k" })),
    ).toBe("REPUTATION_ORDER_NOT_COMPLETED");
  });

  it("مُقيَّمٌ ليس طرفاً في الطلب ⇒ 422 RATING_PARTY_MISMATCH", async () => {
    const dependencies = await withCompletedOrder();
    expect(
      await codeOf(() =>
        submitRating(dependencies, {
          draft: ratingDraft({ subjectPublicId: OTHER_DRIVER }),
          idempotencyKey: "k",
        }),
      ),
    ).toBe("REPUTATION_RATING_PARTY_MISMATCH");
  });

  it("جانبُ المُقيِّم لا يُطابق ما في الدفتر ⇒ 422 RATING_PARTY_MISMATCH", async () => {
    const dependencies = await withCompletedOrder();
    expect(
      await codeOf(() =>
        submitRating(dependencies, {
          draft: ratingDraft({ raterType: "driver" }),
          idempotencyKey: "k",
        }),
      ),
    ).toBe("REPUTATION_RATING_PARTY_MISMATCH");
  });

  it("بعد 72 ساعةً من الإكمال ⇒ 422 RATING_WINDOW_CLOSED", async () => {
    const dependencies = await withCompletedOrder();
    expect(
      await codeOf(() =>
        submitRating(dependencies, {
          draft: ratingDraft({ submittedAt: "2026-03-04T13:00:00.000Z" }),
          idempotencyKey: "k",
        }),
      ),
    ).toBe("REPUTATION_RATING_WINDOW_CLOSED");
  });

  it("عند حدّ النافذة بالضبط ⇒ مقبول", async () => {
    const dependencies = await withCompletedOrder();
    const result = await submitRating(dependencies, {
      draft: ratingDraft({ submittedAt: "2026-03-04T12:00:00.000Z" }),
      idempotencyKey: "k",
    });
    expect(result.rating.submittedAt).toBe("2026-03-04T12:00:00.000Z");
  });

  it("درجةٌ خارج 1..5 ⇒ 400 VALIDATION_FAILED", async () => {
    const dependencies = await withCompletedOrder();
    expect(
      await codeOf(() =>
        submitRating(dependencies, { draft: ratingDraft({ stars: 6 }), idempotencyKey: "k" }),
      ),
    ).toBe("REPUTATION_VALIDATION_FAILED");
    expect(
      await codeOf(() =>
        submitRating(dependencies, { draft: ratingDraft({ stars: 0 }), idempotencyKey: "k2" }),
      ),
    ).toBe("REPUTATION_VALIDATION_FAILED");
  });

  it("سببٌ خارج القائمة المُقفلة ⇒ 400، ولا نصَّ حرّاً بحال", async () => {
    const dependencies = await withCompletedOrder();
    expect(
      await codeOf(() =>
        submitRating(dependencies, {
          draft: ratingDraft({ reasonCode: "كان لطيفاً جداً" }),
          idempotencyKey: "k",
        }),
      ),
    ).toBe("REPUTATION_VALIDATION_FAILED");
  });
});
