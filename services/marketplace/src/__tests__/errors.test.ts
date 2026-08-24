/**
 * حرسُ كتالوجِ الأخطاء: الرمزُ من العقد، والحالةُ تُشتقّ من صنفِه، و`details` مفاتيحُها مُقفَلة.
 *
 * أهمُّ اختبارٍ هنا هو الموجَبُ الشامل: كلُّ رمزٍ في كتالوجِ العقدِ الأربعةِ والعشرين يُبنى
 * فيُشتقُّ له صنفٌ وحالةٌ بلا استثناء. فلو أُضيف رمزٌ خامسٌ وعشرون في العقدِ بلا صنفٍ لسقطت
 * هذه الدفعةُ لا دفعةُ التشغيل.
 *
 * وخريطةُ «الصنف ← الحالة» مكتوبةٌ هنا بيدٍ **عن قصد** خلافاً لقاعدةِ عدمِ التكرار: هذا
 * الملفُّ اختبارٌ لا مصدرَ حقيقةٍ، ووظيفتُه أن يُقارن ما يُنتجه المجالُ بما يُتوقَّع مستقلّاً؛
 * ولو قرأ الخريطةَ من العقدِ لصار يُقارن الشيءَ بنفسِه فيمرّ على أيّ تغييرٍ فيها.
 */
import { describe, expect, it } from "vitest";

import {
  MARKETPLACE_ERROR_CLASS_STATUS,
  MARKETPLACE_ERROR_CODES,
  MARKETPLACE_ERROR_CODE_CLASS,
  type MarketplaceErrorClass,
} from "../domain/contract-sets.js";
import {
  MarketplaceError,
  inventoryInsufficientQuantity,
  isMarketplaceError,
  storeDecisionNotAllowed,
  storeOwnerLimitReached,
  storeOwnerRoleImmutable,
  storeSlugReserved,
  validationFailed,
} from "../domain/errors.js";

/** التوقُّعُ المستقلّ: خمسةُ أصنافٍ لا سادسَ، ولا 502 بينها. */
const EXPECTED_STATUS: Record<MarketplaceErrorClass, number> = {
  validation_error: 400,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  service_unavailable: 503,
};

describe("الكتالوجُ واحدٌ ولا يُنسَخ", () => {
  it("أربعةٌ وعشرون رمزاً لكلٍّ منها صنفٌ مُعلَن", () => {
    expect(MARKETPLACE_ERROR_CODES).toHaveLength(24);
    expect(new Set(MARKETPLACE_ERROR_CODES).size).toBe(24);
    for (const code of MARKETPLACE_ERROR_CODES) {
      expect(Object.keys(EXPECTED_STATUS)).toContain(MARKETPLACE_ERROR_CODE_CLASS[code]);
    }
  });

  it("خريطةُ الصنفِ إلى الحالةِ في العقدِ هي المُتوقَّعةُ حرفاً", () => {
    expect(MARKETPLACE_ERROR_CLASS_STATUS).toEqual(EXPECTED_STATUS);
  });

  it("كلُّ رمزٍ يُبنى ويُشتقُّ له صنفٌ وحالةٌ بلا استثناء", () => {
    for (const code of MARKETPLACE_ERROR_CODES) {
      const error = new MarketplaceError(code, "رسالةٌ للإنسان");
      expect(error.code).toBe(code);
      expect(error.errorClass).toBe(MARKETPLACE_ERROR_CODE_CLASS[code]);
      expect(error.httpStatus).toBe(EXPECTED_STATUS[error.errorClass]);
    }
  });

  it("لا حالةَ 502 في الكتالوج: الخدمةُ لا تتحدّث عن وسيطٍ لا تملكه", () => {
    const statuses = new Set(
      MARKETPLACE_ERROR_CODES.map((code) => new MarketplaceError(code, "م").httpStatus),
    );
    expect(statuses.has(502)).toBe(false);
    expect([...statuses].sort((a, b) => a - b)).toEqual([400, 404, 409, 422, 503]);
  });

  it("وتعذُّرُ الخدمةِ وحدَه 503 — فلا يُقرأ عجزٌ مؤقّتٌ رفضاً دائماً", () => {
    expect(new MarketplaceError("MARKETPLACE_UNAVAILABLE", "م").httpStatus).toBe(503);
  });
});

describe("شكلُ الخطأ", () => {
  it("خطأٌ حقيقيٌّ يُلتقَط بـ`instanceof` وبالحارسِ النوعيّ", () => {
    const error = validationFailed("slug", "pattern");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(MarketplaceError);
    expect(isMarketplaceError(error)).toBe(true);
    expect(error.name).toBe("MarketplaceError");
    expect(typeof error.stack).toBe("string");
  });

  it("الحارسُ يرفض ما ليس خطأَ سوقٍ ولو حمل رمزاً", () => {
    expect(isMarketplaceError(new Error("boom"))).toBe(false);
    expect(isMarketplaceError({ code: "MARKETPLACE_VALIDATION_FAILED" })).toBe(false);
    expect(isMarketplaceError(null)).toBe(false);
    expect(isMarketplaceError(undefined)).toBe(false);
  });

  it("`details` غائبةٌ إن لم تُعطَ ولا تصير كائناً فارغاً", () => {
    expect(new MarketplaceError("MARKETPLACE_VALIDATION_FAILED", "م").details).toBeUndefined();
  });
});

describe("البانونَ يُعطون المفاتيحَ التي يقبلها العقدُ وحدَها", () => {
  it("`validationFailed` يُسمّي الحقلَ وتوقُّعَه", () => {
    const error = validationFailed("price_minor_units", "integer");
    expect(error.code).toBe("MARKETPLACE_VALIDATION_FAILED");
    expect(error.httpStatus).toBe(400);
    expect(error.details?.field).toBe("price_minor_units");
    expect(error.details?.expected).toBe("integer");
  });

  it("`storeDecisionNotAllowed` يُعيد الحالتَين لا رسالةً تشرحُهما", () => {
    const error = storeDecisionNotAllowed("archived", "approved", "approved");
    expect(error.httpStatus).toBe(409);
    expect(error.details?.from_state).toBe("archived");
    expect(error.details?.to_state).toBe("approved");
  });

  it("`storeSlugReserved` يُعيد اللاحقةَ المرفوضةَ نفسَها", () => {
    const error = storeSlugReserved("support");
    expect(error.code).toBe("STORE_SLUG_RESERVED");
    expect(error.details?.store_slug).toBe("support");
    expect(error.httpStatus).toBe(422);
  });

  it("`storeOwnerRoleImmutable` يُسمّي الفهرسَ الذي يمنعه المحرّك", () => {
    /**
     * الحالةُ 422 لا 409 بنصِّ العقد: الطلبُ مفهومٌ وشكلُه صحيحٌ لكنّ قاعدةَ المجالِ ترفضه،
     * وليس تعارضاً على مورِدٍ مُتزامِن. وذكرُ اسمِ الفهرسِ يجعل خطأَ المحرّكِ وخطأَ المجالِ
     * جواباً واحداً لا جوابَين مختلفَين لنفسِ المنعِ.
     */
    const error = storeOwnerRoleImmutable("WS-0000000001");
    expect(error.details?.member_public_id).toBe("WS-0000000001");
    expect(error.details?.constraint).toBe("ux_store_staff_single_owner");
    expect(error.httpStatus).toBe(422);
  });

  it("`storeOwnerLimitReached` يُسمّي الحدَّ نصّاً وفهرسَ متجرِ المالكِ الواحد", () => {
    const error = storeOwnerLimitReached(1);
    expect(error.details?.constraint).toBe("ux_stores_owner_active");
    expect(error.details?.expected).toContain("1");
  });

  it("`inventoryInsufficientQuantity` يُعيد الرصيدَ الحاضرَ لا الفرقَ المطلوب", () => {
    const error = inventoryInsufficientQuantity(4);
    expect(error.code).toBe("INVENTORY_INSUFFICIENT_QUANTITY");
    expect(error.details?.quantity_on_hand).toBe(4);
    expect(error.httpStatus).toBe(422);
  });

  it("ولا مفتاحَ في `details` خارجَ ما يُعلنه العقد", () => {
    /**
     * الحارسُ الذي يمنع تسريبَ حقلٍ حرٍّ إلى الأسلاك: العقدُ يُقفل مفاتيحَ `details` بعشرةِ
     * أسماء، وأوّلُ `message` أو `sql` أو `stack` يُدَسّ هنا يصير جزءاً من جوابٍ عامٍّ لا
     * يُراجعه أحد. والتحقّقُ يمسح ما تُنتجه البانونَ فعلاً لا ما يُصرَّح به نوعاً.
     */
    const allowed = new Set([
      "field",
      "expected",
      "store_slug",
      "product_id",
      "category_slug",
      "member_public_id",
      "from_state",
      "to_state",
      "quantity_on_hand",
      "constraint",
    ]);
    const produced = [
      validationFailed("slug", "pattern"),
      storeDecisionNotAllowed("draft", "approved", "approved"),
      storeSlugReserved("api"),
      storeOwnerRoleImmutable("WS-0000000001"),
      storeOwnerLimitReached(1),
      inventoryInsufficientQuantity(0),
    ];
    for (const error of produced) {
      const keys = Object.keys(error.details ?? {});
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(allowed.has(key)).toBe(true);
    }
    expect(allowed.size).toBe(10);
  });

  it("ولا نصَّ رسالةٍ يُختبَر: الرمزُ هو العقدُ لا العربيّة", () => {
    /**
     * قاعدةُ البيتِ التي تُحفظ هنا اختباراً: الرسالةُ العربيّةُ للإنسان والرمزُ للمستهلك.
     * ولو ربط اختبارٌ نفسَه بنصِّ الرسالةِ لصار تحسينُ صياغةٍ عربيّةٍ يُفشل دفعةً — فيُدرَّب
     * المُراجعُ على أن يُجمّد النصَّ أو يتجاهلَ الحارس.
     */
    const error = validationFailed("slug", "pattern");
    expect(error.code).toBe("MARKETPLACE_VALIDATION_FAILED");
    expect(error.message.length).toBeGreaterThan(0);
  });
});
