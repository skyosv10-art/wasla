/**
 * حرسُ الانتقالات: الجدولُ واحدٌ، والقرارُ ليس الحالة، والسببُ شرطٌ على قرارٍ جائز.
 *
 * الاختبارُ الأوّلُ هنا (`جدولُ الخدمةِ هو جدولُ العقدِ نفسُه`) هو أهمُّها: يُقارِن ما يقبله
 * المجالُ بجدولِ العقدِ **زوجاً بزوج** على كلّ الأزواجِ الممكنةِ الستّةِ والثلاثين، فلو نُسخ
 * جدولٌ ثانٍ في الخدمةِ يوماً لسقط هذا الاختبارُ في نفسِ الدفعة.
 */
import { describe, expect, it } from "vitest";

import {
  PRODUCT_ALLOWED_TRANSITIONS,
  PRODUCT_STATES,
  STORE_ALLOWED_TRANSITIONS,
  STORE_DECISIONS,
  STORE_STATES,
  type StoreState,
} from "../domain/contract-sets.js";
import { MarketplaceError } from "../domain/errors.js";
import {
  PRODUCT_MODERATION_ALLOWED_TRANSITIONS,
  STORE_DECISIONS_REQUIRING_REASON,
  STORE_DECISION_RESULT_STATE,
  assertProductDecision,
  assertProductTransition,
  assertStoreDecision,
  isAllowedProductTransition,
  isAllowedStoreTransition,
} from "../domain/transitions.js";

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error("expected a MarketplaceError to be thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(MarketplaceError);
    expect((error as MarketplaceError).code).toBe(code);
  }
}

describe("جدولُ الانتقالِ يُقرأ من العقدِ ولا يُنسَخ", () => {
  it("يقبل كلَّ زوجٍ في جدولِ المتجرِ ويرفض كلَّ ما ليس فيه", () => {
    const declared = new Set(STORE_ALLOWED_TRANSITIONS.map(([from, to]) => `${from}->${to}`));
    const candidates: Array<StoreState | null> = [null, ...STORE_STATES];
    let allowed = 0;
    for (const from of candidates) {
      for (const to of STORE_STATES) {
        const isDeclared = declared.has(`${from}->${to}`);
        expect(isAllowedStoreTransition(from, to)).toBe(isDeclared);
        if (isDeclared) allowed += 1;
      }
    }
    expect(allowed).toBe(STORE_ALLOWED_TRANSITIONS.length);
    expect(STORE_ALLOWED_TRANSITIONS).toHaveLength(9);
  });

  it("لا `suspended → archived`: المُوقَفُ يُعاد أوّلاً ثمّ يُؤرشَف", () => {
    expect(isAllowedStoreTransition("suspended", "archived")).toBe(false);
    expect(isAllowedStoreTransition("suspended", "approved")).toBe(true);
    expect(isAllowedStoreTransition("approved", "archived")).toBe(true);
  });

  it("الرفضُ ليس نهايةً: `rejected → pending_review` مسموح", () => {
    expect(isAllowedStoreTransition("rejected", "pending_review")).toBe(true);
  });

  it("`archived` نهائيّةٌ للمنتجِ بلا مَخرج", () => {
    const declared = new Set(PRODUCT_ALLOWED_TRANSITIONS.map(([from, to]) => `${from}->${to}`));
    for (const to of PRODUCT_STATES) {
      expect(isAllowedProductTransition("archived", to)).toBe(false);
      expect(declared.has(`archived->${to}`)).toBe(false);
    }
    expect(PRODUCT_ALLOWED_TRANSITIONS).toHaveLength(4);
  });
});

describe("القرارُ ليس الحالة", () => {
  it("لكلِّ قرارٍ في العقدِ حالةٌ ناتجةٌ واحدةٌ مُعلَنة", () => {
    for (const decision of STORE_DECISIONS) {
      expect(STORE_STATES).toContain(STORE_DECISION_RESULT_STATE[decision]);
    }
    expect(Object.keys(STORE_DECISION_RESULT_STATE)).toHaveLength(STORE_DECISIONS.length);
  });

  it("`review_requested` يُنتج `pending_review` و`reinstated` يُنتج `approved`", () => {
    expect(STORE_DECISION_RESULT_STATE.review_requested).toBe("pending_review");
    expect(STORE_DECISION_RESULT_STATE.reinstated).toBe("approved");
    expect(assertStoreDecision({ fromState: "draft", decision: "review_requested" })).toBe(
      "pending_review",
    );
    expect(assertStoreDecision({ fromState: "suspended", decision: "reinstated" })).toBe("approved");
  });

  it("لا قرارَ اسمُه `reinstated` يصير حالةً في العمود", () => {
    expect(STORE_STATES).not.toContain("reinstated" as StoreState);
  });
});

describe("حرسُ قرارِ المتجر", () => {
  it("يرفض قراراً لا يقبله الحالُ الحاضرُ برمزِ `STORE_DECISION_NOT_ALLOWED`", () => {
    expectCode(
      () => assertStoreDecision({ fromState: "archived", decision: "approved" }),
      "STORE_DECISION_NOT_ALLOWED",
    );
    expectCode(
      () => assertStoreDecision({ fromState: "draft", decision: "approved" }),
      "STORE_DECISION_NOT_ALLOWED",
    );
  });

  it("يُعيد الحالتَين في `details` ليعرف المستهلكُ أين هو", () => {
    try {
      assertStoreDecision({ fromState: "suspended", decision: "archived" });
      throw new Error("expected throw");
    } catch (error) {
      const details = (error as MarketplaceError).details;
      expect(details?.from_state).toBe("suspended");
      expect(details?.to_state).toBe("archived");
    }
  });

  it("الرفضُ والإيقافُ يلزمهما سببٌ مُقفَل", () => {
    expect(STORE_DECISIONS_REQUIRING_REASON).toEqual(["rejected", "suspended"]);
    expectCode(
      () => assertStoreDecision({ fromState: "pending_review", decision: "rejected" }),
      "STORE_REJECTION_REASON_REQUIRED",
    );
    expectCode(
      () => assertStoreDecision({ fromState: "approved", decision: "suspended" }),
      "STORE_REJECTION_REASON_REQUIRED",
    );
    expect(
      assertStoreDecision({
        fromState: "pending_review",
        decision: "rejected",
        reasonCode: "incomplete_profile",
      }),
    ).toBe("rejected");
  });

  it("الانتقالُ يُفحَص قبل السبب: قرارٌ ممنوعٌ لا يُطالَب بسببٍ أوّلاً", () => {
    expectCode(
      () => assertStoreDecision({ fromState: "archived", decision: "suspended" }),
      "STORE_DECISION_NOT_ALLOWED",
    );
  });

  it("الاعتمادُ وطلبُ المراجعةِ والإعادةُ بلا سببٍ بحال", () => {
    expectCode(
      () =>
        assertStoreDecision({
          fromState: "pending_review",
          decision: "approved",
          reasonCode: "policy_violation",
        }),
      "STORE_DECISION_NOT_ALLOWED",
    );
  });

  it("الأرشفةُ سببُها اختياريّ", () => {
    expect(assertStoreDecision({ fromState: "approved", decision: "archived" })).toBe("archived");
    expect(
      assertStoreDecision({
        fromState: "approved",
        decision: "archived",
        reasonCode: "owner_request",
      }),
    ).toBe("archived");
  });
});

describe("انتقالُ المنتجِ واعتدالُه", () => {
  it("يرفض انتقالاً غيرَ مُعلَنٍ برمزِ `PRODUCT_TRANSITION_NOT_ALLOWED`", () => {
    expectCode(() => assertProductTransition("archived", "published"), "PRODUCT_TRANSITION_NOT_ALLOWED");
    expectCode(() => assertProductTransition("published", "draft"), "PRODUCT_TRANSITION_NOT_ALLOWED");
    expect(assertProductTransition("draft", "published")).toBe("published");
    expect(assertProductTransition("draft", "archived")).toBe("archived");
  });

  it("الاعتدالُ من `pending` وحدَها، ولا سحبَ لاعتمادٍ بقرارِ رفض", () => {
    expect(PRODUCT_MODERATION_ALLOWED_TRANSITIONS).toHaveLength(3);
    expect(assertProductDecision({ fromState: "pending", decision: "approved" })).toBe("approved");
    expect(
      assertProductDecision({
        fromState: "pending",
        decision: "rejected",
        reasonCode: "prohibited_item",
      }),
    ).toBe("rejected");
    expectCode(
      () =>
        assertProductDecision({
          fromState: "approved",
          decision: "rejected",
          reasonCode: "policy_violation",
        }),
      "PRODUCT_TRANSITION_NOT_ALLOWED",
    );
  });

  it("سببُ رفضِ المنتجِ إلزاميٌّ وسببُ اعتمادِه ممنوع", () => {
    expectCode(
      () => assertProductDecision({ fromState: "pending", decision: "rejected" }),
      "MARKETPLACE_VALIDATION_FAILED",
    );
    expectCode(
      () =>
        assertProductDecision({
          fromState: "pending",
          decision: "approved",
          reasonCode: "wrong_category",
        }),
      "MARKETPLACE_VALIDATION_FAILED",
    );
  });
});
