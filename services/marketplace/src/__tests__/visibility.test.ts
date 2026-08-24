/**
 * حرسُ الظهور: أربعةُ شروطٍ، أربعةُ رموزٍ، ولا عمودَ يُخزَّن.
 *
 * الاختبارُ الحاكمُ هنا يمشي على **الستّةَ عشرَ** اقتراناً الممكنَ لحالاتِ الشروطِ الأربعة
 * (معتمَدٌ/لا · منشورٌ/لا · مُعتدَلٌ/لا · مخزونٌ/لا) ويُقارن نتيجةَ `isVisible` بحاصلِ ضربِ
 * الشروطِ يدوياً: فلو أُضيف شرطٌ خامسٌ يوماً أو حُذِف شرطٌ لسقط الاختبارُ فوراً.
 */
import { describe, expect, it } from "vitest";

import { isProductVisible, type ProductModerationState, type ProductState, type StoreState } from "../domain/contract-sets.js";
import { MarketplaceError } from "../domain/errors.js";
import {
  assertProductVisible,
  isVisible,
  productVisibilityBlockers,
  type ProductVisibilityFacts,
} from "../domain/visibility.js";

const VISIBLE: ProductVisibilityFacts = {
  storeState: "approved",
  productState: "published",
  moderationState: "approved",
  quantityOnHand: 3,
};

describe("الظهورُ اقترانُ أربعةِ شروط", () => {
  it("الشروطُ الأربعةُ مجتمعةً ⇒ ظاهر", () => {
    expect(isVisible(VISIBLE)).toBe(true);
    expect(productVisibilityBlockers(VISIBLE)).toEqual([]);
    expect(() => assertProductVisible(VISIBLE)).not.toThrow();
  });

  it("يوافق دالّةَ العقدِ في كلّ الاقتراناتِ الستّةَ عشر", () => {
    const storeStates: StoreState[] = ["approved", "suspended"];
    const productStates: ProductState[] = ["published", "draft"];
    const moderationStates: ProductModerationState[] = ["approved", "pending"];
    const quantities = [3, 0];
    let checked = 0;

    for (const storeState of storeStates) {
      for (const productState of productStates) {
        for (const moderationState of moderationStates) {
          for (const quantityOnHand of quantities) {
            const facts = { storeState, productState, moderationState, quantityOnHand };
            const expected =
              storeState === "approved" &&
              productState === "published" &&
              moderationState === "approved" &&
              quantityOnHand > 0;
            expect(isVisible(facts)).toBe(expected);
            expect(isProductVisible(facts)).toBe(expected);
            expect(productVisibilityBlockers(facts).length === 0).toBe(expected);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(16);
  });

  it("لكلِّ شرطٍ ساقطٍ رمزُه لا رمزٌ جامع", () => {
    expect(productVisibilityBlockers({ ...VISIBLE, storeState: "suspended" })).toEqual([
      "STORE_NOT_APPROVED",
    ]);
    expect(productVisibilityBlockers({ ...VISIBLE, moderationState: "rejected" })).toEqual([
      "PRODUCT_NOT_MODERATED",
    ]);
    expect(productVisibilityBlockers({ ...VISIBLE, productState: "draft" })).toEqual([
      "PRODUCT_TRANSITION_NOT_ALLOWED",
    ]);
    expect(productVisibilityBlockers({ ...VISIBLE, quantityOnHand: 0 })).toEqual([
      "INVENTORY_INSUFFICIENT_QUANTITY",
    ]);
  });

  it("يُعيد كلَّ العوائقِ لا أوّلَها فقط", () => {
    expect(
      productVisibilityBlockers({
        storeState: "draft",
        productState: "draft",
        moderationState: "pending",
        quantityOnHand: 0,
      }),
    ).toEqual([
      "STORE_NOT_APPROVED",
      "PRODUCT_NOT_MODERATED",
      "PRODUCT_TRANSITION_NOT_ALLOWED",
      "INVENTORY_INSUFFICIENT_QUANTITY",
    ]);
  });

  it("الرميُ يتبع ترتيبَ العوائقِ نفسَه: الأعمُّ أوّلاً", () => {
    const cases: Array<[Partial<ProductVisibilityFacts>, string]> = [
      [{ storeState: "suspended", moderationState: "pending", quantityOnHand: 0 }, "STORE_NOT_APPROVED"],
      [{ moderationState: "pending", quantityOnHand: 0 }, "PRODUCT_NOT_MODERATED"],
      [{ productState: "draft", quantityOnHand: 0 }, "PRODUCT_TRANSITION_NOT_ALLOWED"],
      [{ quantityOnHand: 0 }, "INVENTORY_INSUFFICIENT_QUANTITY"],
    ];
    for (const [patch, code] of cases) {
      try {
        assertProductVisible({ ...VISIBLE, ...patch });
        throw new Error("expected throw");
      } catch (error) {
        expect(error).toBeInstanceOf(MarketplaceError);
        expect((error as MarketplaceError).code).toBe(code);
        expect((error as MarketplaceError).code).toBe(
          productVisibilityBlockers({ ...VISIBLE, ...patch })[0],
        );
      }
    }
  });

  it("رمزُ ظهورٍ جامعٌ غيرُ موجودٍ في الكتالوجِ عن قصد", () => {
    const blockers = productVisibilityBlockers({ ...VISIBLE, storeState: "draft" });
    expect(blockers).not.toContain("PRODUCT_NOT_VISIBLE");
    expect(blockers.every((code) => code.length > 0)).toBe(true);
  });

  it("كميّةٌ سالبةٌ تُعامَل عائقاً كالصفرِ ولا تُحسَب ظهوراً", () => {
    expect(isVisible({ ...VISIBLE, quantityOnHand: -1 })).toBe(false);
    expect(productVisibilityBlockers({ ...VISIBLE, quantityOnHand: -1 })).toEqual([
      "INVENTORY_INSUFFICIENT_QUANTITY",
    ]);
  });
});
