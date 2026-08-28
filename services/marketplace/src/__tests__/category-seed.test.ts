/**
 * حرسُ بذرةِ التصنيفات: **الآليّةُ مفحوصةٌ، والمحتوى مُعلَنٌ فارغاً بقرار**.
 *
 * وأوّلُ اختبارٍ هنا هو الاختبارُ الذي يُثبِّت القرارَ نفسَه: `MARKETPLACE_CATEGORY_SEED`
 * فارغةٌ. ولمَ يُحرَس الفراغُ؟ لأنّ الشجرةَ لو دخلت يوماً بلا ADR لمرّت في مراجعةٍ لا يقرؤها
 * مالكُ منتَج، ثمّ صار حذفُها تعديلَ بياناتٍ في الإنتاج. فهذا الاختبارُ يجعل إضافةَ تصنيفٍ
 * **تُفشل البناءَ** حتّى يُحدَّث معه هذا السطرُ صراحةً — أي حتّى يصير القرارُ مكتوباً.
 *
 * وباقي الملفِّ يفحص الآليّةَ على شجرةِ اختبارٍ حقيقيّةٍ، كي يكون يومُ القرارِ سطرَ بياناتٍ
 * لا مراجعةَ كود.
 */
import { describe, expect, it } from "vitest";

import {
  CATEGORY_LABEL_MAX_LENGTH,
  CATEGORY_SORT_ORDER_MAX,
  MARKETPLACE_CATEGORY_SEED,
  assertCategorySeedTree,
  flattenCategorySeed,
  type CategorySeedRoot,
} from "../domain/category-seed.js";
import { MarketplaceError } from "../domain/errors.js";

const FIXTURE: readonly CategorySeedRoot[] = Object.freeze([
  Object.freeze({
    slug: "root-one",
    labelAr: "الجذرُ الأوّل",
    labelEn: "Root one",
    sortOrder: 10,
    children: Object.freeze([
      Object.freeze({ slug: "leaf-one", labelAr: "ورقةٌ أولى", sortOrder: 1 }),
      Object.freeze({ slug: "leaf-two", labelAr: "ورقةٌ ثانية" }),
    ]),
  }),
  Object.freeze({
    slug: "root-two",
    labelAr: "الجذرُ الثاني",
    sortOrder: 20,
    children: Object.freeze([]),
  }),
]) as readonly CategorySeedRoot[];

describe("القرارُ المُعلَنُ: لا شجرةَ قبلَ قرارِ مالك", () => {
  it("الشجرةُ المبذورةُ فارغةٌ ومُجمَّدة", () => {
    expect(MARKETPLACE_CATEGORY_SEED).toEqual([]);
    expect(Object.isFrozen(MARKETPLACE_CATEGORY_SEED)).toBe(true);
  });

  it("وتسطيحُها يُعطي صفراً من الصفوفِ — فلا سطرَ يُكتب في قاعدةٍ لشجرةٍ لا مالكَ لها", () => {
    expect(flattenCategorySeed(MARKETPLACE_CATEGORY_SEED)).toEqual([]);
  });
});

describe("التسطيحُ يُرتِّب الأبَ قبلَ أوراقِه", () => {
  it("الترتيبُ جذرٌ ثمّ أوراقُه، ثمّ الجذرُ التالي", () => {
    expect(flattenCategorySeed(FIXTURE).map((row) => row.slug)).toEqual([
      "root-one",
      "leaf-one",
      "leaf-two",
      "root-two",
    ]);
  });

  it("والعمقُ محسوبٌ لا مُمرَّرٌ: جذرٌ 1 وورقةٌ 2، ولاحقةُ الأبِ للأوراقِ وحدَها", () => {
    expect(
      flattenCategorySeed(FIXTURE).map((row) => `${row.slug}:${row.depth}:${row.parentSlug ?? "∅"}`),
    ).toEqual(["root-one:1:∅", "leaf-one:2:root-one", "leaf-two:2:root-one", "root-two:1:∅"]);
  });

  it("والترتيبُ المُعلَنُ يُحفَظ، والغائبُ يصير صفراً لا `undefined`", () => {
    const rows = flattenCategorySeed(FIXTURE);
    expect(rows.map((row) => row.sortOrder)).toEqual([10, 1, 0, 20]);
  });

  it("والعنوانُ الاختياريُّ يغيب مفتاحاً حين يغيب — لا يُكتب `null` في صفٍّ صرف", () => {
    const [root, leaf] = flattenCategorySeed(FIXTURE);
    expect(Object.keys(root!).sort()).toEqual([
      "depth",
      "labelAr",
      "labelEn",
      "slug",
      "sortOrder",
    ]);
    expect(Object.keys(leaf!).sort()).toEqual([
      "depth",
      "labelAr",
      "parentSlug",
      "slug",
      "sortOrder",
    ]);
  });

  it("والناتجُ مُجمَّدٌ، وشجرةٌ فارغةٌ من الأوراقِ مقبولةٌ (جذرٌ بلا فرعٍ قرارُ مالكٍ لا خطأ)", () => {
    expect(Object.isFrozen(flattenCategorySeed(FIXTURE))).toBe(true);
    expect(flattenCategorySeed([FIXTURE[1]!])).toHaveLength(1);
  });
});

describe("الشكلُ محروسٌ: ما يُخالف العقدَ لا يُسطَّح", () => {
  function root(overrides: Partial<CategorySeedRoot>): CategorySeedRoot {
    return { slug: "ok-root", labelAr: "عنوانٌ", children: [], ...overrides };
  }

  it("لاحقةٌ لا تُطابق نمطَ العقدِ مرفوضةٌ — كبيرةً أو قصيرةً أو ببدايةٍ رقميّة", () => {
    for (const slug of ["A-root", "a", "1root", "root_one", "-root", ""]) {
      expect(() => assertCategorySeedTree([root({ slug })])).toThrowError(MarketplaceError);
    }
  });

  it("ولاحقةٌ مُكرَّرةٌ مرفوضةٌ عبرَ الشجرةِ كلِّها لا في مستوىً واحد", () => {
    expect(() =>
      assertCategorySeedTree([root({ slug: "same" }), root({ slug: "same" })]),
    ).toThrowError(MarketplaceError);
    expect(() =>
      assertCategorySeedTree([
        root({ slug: "same", children: [{ slug: "same", labelAr: "عنوانٌ" }] }),
      ]),
    ).toThrowError(MarketplaceError);
  });

  it("وعنوانٌ عربيٌّ أقصرُ من حدِّ العقدِ أو أطولُ منه مرفوضٌ", () => {
    expect(() => assertCategorySeedTree([root({ labelAr: "ع" })])).toThrowError(MarketplaceError);
    expect(() =>
      assertCategorySeedTree([root({ labelAr: "ع".repeat(CATEGORY_LABEL_MAX_LENGTH + 1) })]),
    ).toThrowError(MarketplaceError);
    expect(
      flattenCategorySeed([root({ labelAr: "ع".repeat(CATEGORY_LABEL_MAX_LENGTH) })]),
    ).toHaveLength(1);
  });

  it("وترتيبٌ خارجَ مدى العقدِ مرفوضٌ، والحدُّ نفسُه مقبول", () => {
    expect(() => assertCategorySeedTree([root({ sortOrder: -1 })])).toThrowError(MarketplaceError);
    expect(() =>
      assertCategorySeedTree([root({ sortOrder: CATEGORY_SORT_ORDER_MAX + 1 })]),
    ).toThrowError(MarketplaceError);
    expect(() => assertCategorySeedTree([root({ sortOrder: 1.5 })])).toThrowError(MarketplaceError);
    expect(
      flattenCategorySeed([root({ sortOrder: CATEGORY_SORT_ORDER_MAX })])[0]!.sortOrder,
    ).toBe(CATEGORY_SORT_ORDER_MAX);
  });

  it("والفحصُ يقع على الأوراقِ كما يقع على الجذور", () => {
    expect(() =>
      assertCategorySeedTree([root({ children: [{ slug: "BAD", labelAr: "عنوانٌ" }] })]),
    ).toThrowError(MarketplaceError);
    expect(() =>
      assertCategorySeedTree([root({ children: [{ slug: "leaf", labelAr: "ع" }] })]),
    ).toThrowError(MarketplaceError);
  });

  it("والفاحصُ يُعيد الشجرةَ نفسَها حين تصحّ — بابٌ يُقرأ نيّةً في مكانِ النداء", () => {
    expect(assertCategorySeedTree(FIXTURE)).toBe(FIXTURE);
  });
});
