/**
 * حرسُ الكتالوج: المسوّدةُ دائماً مسوّدةٌ، والتصنيفُ ورقةٌ للمنتج، واللاحقةُ تُقفَل بعد الاعتماد.
 */
import { describe, expect, it } from "vitest";

import { STORE_ACTIVE_LIMIT_PER_OWNER } from "../domain/contract-sets.js";
import {
  CATEGORY_LEAF_DEPTH,
  STORE_ACTIVE_STATES,
  assertOwnerStoreLimit,
  assertProductCategory,
  assertProductPublishable,
  assertStoreCategory,
  assertStoreSlugMutable,
  draftProduct,
  draftStore,
  isLeafCategory,
} from "../domain/catalog.js";
import { MarketplaceError } from "../domain/errors.js";
import type { CategoryFacts } from "../domain/model.js";

const LEAF: CategoryFacts = { slug: "grills", depth: 2, isActive: true };
const ROOT: CategoryFacts = { slug: "restaurants", depth: 1, isActive: true };
const STORE_ID = "7d0f4b1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b";
const CATEGORY_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const OWNER = "WS-0000000011";

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error("expected a MarketplaceError to be thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(MarketplaceError);
    expect((error as MarketplaceError).code).toBe(code);
  }
}

describe("حدُّ متاجرِ المالك", () => {
  it("يُحسَب على كلِّ ما ليس مُؤرشَفاً — ومنه المرفوضُ والمُوقَف", () => {
    expect(STORE_ACTIVE_STATES).toEqual(["draft", "pending_review", "approved", "rejected", "suspended"]);
    expect(STORE_ACTIVE_STATES).not.toContain("archived");
  });

  it("يرفض تجاوزَ الحدِّ المُعلَنِ برمزِه", () => {
    expect(() => assertOwnerStoreLimit(0)).not.toThrow();
    expectCode(() => assertOwnerStoreLimit(STORE_ACTIVE_LIMIT_PER_OWNER), "STORE_OWNER_LIMIT_REACHED");
    expectCode(() => assertOwnerStoreLimit(-1), "MARKETPLACE_VALIDATION_FAILED");
  });
});

describe("التصنيف", () => {
  it("الورقةُ هي العمقُ الأقصى المُعلَنُ لا عمودٌ مُخزَّن", () => {
    expect(CATEGORY_LEAF_DEPTH).toBe(2);
    expect(isLeafCategory(2)).toBe(true);
    expect(isLeafCategory(1)).toBe(false);
  });

  it("المتجرُ يقبل أيَّ عمقٍ فعّالٍ والمنتجُ ورقةً فقط", () => {
    expect(assertStoreCategory(ROOT)).toBe(ROOT);
    expect(assertStoreCategory(LEAF)).toBe(LEAF);
    expect(assertProductCategory(LEAF)).toBe(LEAF);
    expectCode(() => assertProductCategory(ROOT), "PRODUCT_CATEGORY_NOT_LEAF");
  });

  it("المُعطَّلُ مرفوضٌ للاثنَين، والتفعيلُ يُفحَص قبل الورقيّة", () => {
    expectCode(() => assertStoreCategory({ ...LEAF, isActive: false }), "STORE_CATEGORY_INACTIVE");
    expectCode(() => assertProductCategory({ ...ROOT, isActive: false }), "STORE_CATEGORY_INACTIVE");
  });

  it("يرفض عمقاً خارجَ الحدّ", () => {
    expectCode(() => assertStoreCategory({ ...LEAF, depth: 3 }), "MARKETPLACE_VALIDATION_FAILED");
    expectCode(() => assertStoreCategory({ ...LEAF, depth: 0 }), "MARKETPLACE_VALIDATION_FAILED");
  });
});

describe("مسوّدةُ المتجر", () => {
  const input = {
    ownerPublicId: OWNER,
    slug: "madinah-sweets",
    titleAr: "حلويات المدينة",
    categoryId: CATEGORY_ID,
    category: LEAF,
    activeStoreCount: 0,
  };

  it("تُنتج `draft` بتسلسلٍ 1 دائماً", () => {
    const draft = draftStore(input);
    expect(draft.state).toBe("draft");
    expect(draft.stateSequence).toBe(1);
    expect(draft.slug).toBe("madinah-sweets");
    expect(draft.titleAr).toBe("حلويات المدينة");
    expect(draft.titleEn).toBeUndefined();
  });

  it("تحمل العناوينَ الاختياريّةَ المقصوصةَ ولا تُخزّن فارغاً", () => {
    const draft = draftStore({ ...input, titleEn: " Madinah Sweets ", titleUr: "  " });
    expect(draft.titleEn).toBe("Madinah Sweets");
    expect(draft.titleUr).toBeUndefined();
  });

  it("ترفض الحدَّ قبل أن تلمس اللاحقة", () => {
    expectCode(() => draftStore({ ...input, activeStoreCount: 1 }), "STORE_OWNER_LIMIT_REACHED");
  });

  it("ترفض لاحقةً محجوزةً وتصنيفاً مُعطَّلاً", () => {
    expectCode(() => draftStore({ ...input, slug: "support" }), "STORE_SLUG_RESERVED");
    expectCode(
      () => draftStore({ ...input, category: { ...LEAF, isActive: false } }),
      "STORE_CATEGORY_INACTIVE",
    );
  });

  it("اللاحقةُ تُقفَل بعد أوّلِ اعتمادٍ ولا تُفتَح بأرشفة", () => {
    expect(() => assertStoreSlugMutable(undefined)).not.toThrow();
    expectCode(
      () => assertStoreSlugMutable("2026-03-05T10:00:00.000Z"),
      "MARKETPLACE_VALIDATION_FAILED",
    );
  });
});

describe("مسوّدةُ المنتج", () => {
  const input = {
    storeId: STORE_ID,
    storeState: "approved" as const,
    sku: "SW-001",
    titleAr: "كنافة",
    categoryId: CATEGORY_ID,
    category: LEAF,
    priceMinorUnits: 2950,
    createdByPublicId: OWNER,
  };

  it("تُنتج `draft` واعتدالاً `pending` وعُملةً ثابتة", () => {
    const draft = draftProduct(input);
    expect(draft.state).toBe("draft");
    expect(draft.moderationState).toBe("pending");
    expect(draft.moderationSequence).toBe(1);
    expect(draft.currencyCode).toBe("SAR");
    expect(draft.priceMinorUnits).toBe(2950);
  });

  it("ترفض منتجاً في متجرٍ غيرِ معتمَدٍ برمزِ `STORE_NOT_APPROVED`", () => {
    for (const storeState of ["draft", "pending_review", "rejected", "suspended", "archived"] as const) {
      expectCode(() => draftProduct({ ...input, storeState }), "STORE_NOT_APPROVED");
    }
  });

  it("ترفض تصنيفاً غيرَ ورقةٍ وسعراً كسريّاً وعُملةً أخرى", () => {
    expectCode(() => draftProduct({ ...input, category: ROOT }), "PRODUCT_CATEGORY_NOT_LEAF");
    expectCode(() => draftProduct({ ...input, priceMinorUnits: 29.5 }), "MARKETPLACE_VALIDATION_FAILED");
    expectCode(() => draftProduct({ ...input, currencyCode: "USD" }), "MARKETPLACE_VALIDATION_FAILED");
  });

  it("النشرُ يلزمه اعتدالٌ معتمَدٌ ومسوّدةٌ قائمة", () => {
    expect(() =>
      assertProductPublishable({ productState: "draft", moderationState: "approved" }),
    ).not.toThrow();
    expectCode(
      () => assertProductPublishable({ productState: "draft", moderationState: "pending" }),
      "PRODUCT_NOT_MODERATED",
    );
    expectCode(
      () => assertProductPublishable({ productState: "published", moderationState: "approved" }),
      "MARKETPLACE_VALIDATION_FAILED",
    );
  });
});
