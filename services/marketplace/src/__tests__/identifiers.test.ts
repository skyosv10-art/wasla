/**
 * حرسُ المُعرّفاتِ والنصوصِ والسعر: صيغةٌ واحدةٌ من العقدِ ورمزٌ يُقرأ لكلّ رفض.
 */
import { describe, expect, it } from "vitest";

import {
  MARKETPLACE_CURRENCY_CODE,
  PRICE_MINOR_UNITS_MAX,
  PRICE_MINOR_UNITS_MIN,
  RESERVED_STORE_SLUGS,
} from "../domain/contract-sets.js";
import { MarketplaceError } from "../domain/errors.js";
import {
  assertBoundedText,
  assertCategorySlug,
  assertOptionalBoundedText,
  assertProductSku,
  assertStoreSlug,
  assertUuid,
  assertWaslaPublicId,
  isReservedStoreSlug,
} from "../domain/identifiers.js";
import { assertCurrencyCode, assertPriceMinorUnits } from "../domain/pricing.js";

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error("expected a MarketplaceError to be thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(MarketplaceError);
    expect((error as MarketplaceError).code).toBe(code);
  }
}

describe("المُعرّفُ العلنيُّ المُعتِم", () => {
  it("يقبل الصيغةَ المُعلَنةَ وحدَها", () => {
    expect(assertWaslaPublicId("WS-0123456789")).toBe("WS-0123456789");
    for (const bad of ["WS-123", "ws-0123456789", "WS-01234567890", "0123456789", "", 42, null]) {
      expectCode(() => assertWaslaPublicId(bad), "MARKETPLACE_VALIDATION_FAILED");
    }
  });

  it("يقبل UUID ويرفض ما سواه", () => {
    expect(assertUuid("7d0f4b1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b")).toBe(
      "7d0f4b1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
    );
    expectCode(() => assertUuid("not-a-uuid"), "MARKETPLACE_VALIDATION_FAILED");
  });
});

describe("لاحقةُ المتجر", () => {
  it("تقبل الصغيرةَ المطابقةَ وترفض الكبيرةَ بلا تحويلٍ صامت", () => {
    expect(assertStoreSlug("riyadh-sweets")).toBe("riyadh-sweets");
    expectCode(() => assertStoreSlug("Riyadh-Sweets"), "MARKETPLACE_VALIDATION_FAILED");
    expectCode(() => assertStoreSlug("1shop"), "MARKETPLACE_VALIDATION_FAILED");
    expectCode(() => assertStoreSlug("ab"), "MARKETPLACE_VALIDATION_FAILED");
  });

  it("ترفض المحجوزةَ برمزٍ خاصٍّ لا برمزِ تحقّق", () => {
    for (const reserved of RESERVED_STORE_SLUGS) {
      expect(isReservedStoreSlug(reserved)).toBe(true);
      expectCode(() => assertStoreSlug(reserved), "STORE_SLUG_RESERVED");
    }
    expect(RESERVED_STORE_SLUGS).toContain("support");
  });

  it("الحجزُ يُقاس بلا حساسيّةِ حالةٍ موافقةً لفهرسِ `LOWER(slug)`", () => {
    expect(isReservedStoreSlug("SUPPORT")).toBe(true);
    expect(isReservedStoreSlug("Wasla")).toBe(true);
  });

  it("لاحقةُ التصنيفِ أقصرُ ولها حارسُها", () => {
    expect(assertCategorySlug("grills")).toBe("grills");
    expectCode(() => assertCategorySlug("A"), "MARKETPLACE_VALIDATION_FAILED");
  });
});

describe("الرقمُ التسلسليُّ للمنتج", () => {
  it("يحفظ حالةَ الحرفِ كما كتبها التاجر", () => {
    expect(assertProductSku("SKU-90.A_1")).toBe("SKU-90.A_1");
    expectCode(() => assertProductSku("-leading"), "MARKETPLACE_VALIDATION_FAILED");
    expectCode(() => assertProductSku("A"), "MARKETPLACE_VALIDATION_FAILED");
    expectCode(() => assertProductSku("A".repeat(41)), "MARKETPLACE_VALIDATION_FAILED");
  });
});

describe("النصوصُ المحدودة", () => {
  it("تُقاس بعد قصِّ الفراغِ فلا عنوانَ من مسافات", () => {
    expect(assertBoundedText("  حلويات المدينة  ", "title_ar", 2, 80)).toBe("حلويات المدينة");
    expectCode(() => assertBoundedText("   ", "title_ar", 2, 80), "MARKETPLACE_VALIDATION_FAILED");
    expectCode(() => assertBoundedText("أ".repeat(81), "title_ar", 2, 80), "MARKETPLACE_VALIDATION_FAILED");
  });

  it("الاختياريُّ الفارغُ يصير غائباً لا سلسلةً فارغةً تُخزَّن", () => {
    expect(assertOptionalBoundedText("   ", "title_en", 80)).toBeUndefined();
    expect(assertOptionalBoundedText(undefined, "title_en", 80)).toBeUndefined();
    expect(assertOptionalBoundedText(null, "title_en", 80)).toBeUndefined();
    expect(assertOptionalBoundedText(" Madinah Sweets ", "title_en", 80)).toBe("Madinah Sweets");
    expectCode(
      () => assertOptionalBoundedText("x".repeat(2001), "description_ar", 2000),
      "MARKETPLACE_VALIDATION_FAILED",
    );
  });
});

describe("السعرُ عددٌ صحيحٌ بالهللات", () => {
  it("يقبل الحدَّين ويرفض ما خارجَهما", () => {
    expect(assertPriceMinorUnits(PRICE_MINOR_UNITS_MIN)).toBe(PRICE_MINOR_UNITS_MIN);
    expect(assertPriceMinorUnits(PRICE_MINOR_UNITS_MAX)).toBe(PRICE_MINOR_UNITS_MAX);
    expect(assertPriceMinorUnits(2950)).toBe(2950);
    expectCode(() => assertPriceMinorUnits(0), "MARKETPLACE_VALIDATION_FAILED");
    expectCode(() => assertPriceMinorUnits(-1), "MARKETPLACE_VALIDATION_FAILED");
    expectCode(() => assertPriceMinorUnits(PRICE_MINOR_UNITS_MAX + 1), "MARKETPLACE_VALIDATION_FAILED");
  });

  it("يرفض الكسرَ ولا يُقرّبه", () => {
    expectCode(() => assertPriceMinorUnits(29.5), "MARKETPLACE_VALIDATION_FAILED");
    expectCode(() => assertPriceMinorUnits("2950"), "MARKETPLACE_VALIDATION_FAILED");
  });

  it("العُملةُ تُفحَص ولا تُفترَض", () => {
    expect(assertCurrencyCode("SAR")).toBe(MARKETPLACE_CURRENCY_CODE);
    expectCode(() => assertCurrencyCode("USD"), "MARKETPLACE_VALIDATION_FAILED");
    expectCode(() => assertCurrencyCode(undefined), "MARKETPLACE_VALIDATION_FAILED");
  });
});
