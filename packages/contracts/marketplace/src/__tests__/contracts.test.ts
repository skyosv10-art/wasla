import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATEGORY_MAX_DEPTH, INVENTORY_DELTA_ABS_MAX, MARKETPLACE_API_OPERATION_COUNT, MARKETPLACE_API_PATHS,
  MARKETPLACE_CURRENCY_CODE, MARKETPLACE_DEEP_LINK_MAX_PAYLOAD_LENGTH, MARKETPLACE_DEEP_LINK_PREFIXES,
  MARKETPLACE_ERROR_CLASS_STATUS, MARKETPLACE_ERROR_CODE_CLASS, MARKETPLACE_ERROR_CODES,
  MARKETPLACE_HTTP_STATUS_CODES, MARKETPLACE_SERVICE_PORT, PRICE_MINOR_UNITS_MAX, PRICE_MINOR_UNITS_MIN,
  RESERVED_STORE_SLUGS, STORE_ACTIVE_LIMIT_PER_OWNER, STORE_SLUG_PATTERN,
  buildProductDeepLinkPayload, buildStoreDeepLinkPayload, httpStatusForMarketplaceError, isProductVisible,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(__dirname, "../../../../../services/marketplace/contracts");
const errorsMd = readFileSync(resolve(CONTRACTS_DIR, "errors.md"), "utf8");
const openApiYml = readFileSync(resolve(CONTRACTS_DIR, "api.openapi.yml"), "utf8");

function section(title: string): string {
  const start = errorsMd.indexOf(title); expect(start, `${title} يجب أن يوجد`).toBeGreaterThan(-1);
  const next = errorsMd.indexOf("\n## ", start + title.length);
  return errorsMd.slice(start, next === -1 ? undefined : next);
}
/** جدول الأخطاء وحده يقرن الرمز برمز HTTP، فلا يلتقط الحارس أمثلة الشرح. */
const errorRows = [...section("## أكواد الأخطاء").matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|\s*(\d{3})\s*\|/gm)]
  .map((m) => [m[1]!, Number(m[2]!)] as const);
function apiPaths(yml: string): string[] { return [...yml.matchAll(/^  (\/[^:]+):/gm)].map((m) => m[1]!); }
function apiStatuses(yml: string): number[] {
  return [...yml.matchAll(/^\s{8,}'?(\d{3})'?:/gm)].map((m) => Number(m[1]!));
}
function apiOperationCount(yml: string): number {
  return [...yml.matchAll(/^    (?:get|post|put|patch|delete):/gm)].length;
}

describe("كتالوج أخطاء السوق ↔ errors.md", () => {
  it("يمنع رمز خطأ موثقاً غير مُصدَّر أو رمزاً مُصدَّراً بلا توثيق", () => {
    expect(errorRows.map(([code]) => code)).toEqual([...MARKETPLACE_ERROR_CODES]);
  });
  it("يمنع أن يختلف رمز HTTP الموثق عن تصنيف الرمز", () => {
    for (const [code, status] of errorRows) {
      expect(httpStatusForMarketplaceError(code as never), code).toBe(status);
      expect(MARKETPLACE_ERROR_CLASS_STATUS[MARKETPLACE_ERROR_CODE_CLASS[code as never]], code).toBe(status);
    }
  });
  it("يمنع كوداً موثقاً بلا صنف خطأ معروف", () => {
    for (const code of MARKETPLACE_ERROR_CODES) {
      expect(Object.keys(MARKETPLACE_ERROR_CLASS_STATUS), code).toContain(MARKETPLACE_ERROR_CODE_CLASS[code]);
    }
  });
  /**
   * لماذا هذا الحارس: لا تابعَ متزامناً في مسار الطلب كي يصير فشله بوابةً خارجية.
   * النسخة الخاطئة الأرخص: إضافة 502 «احتياطاً» فتفترض العميلات تبعيةً غير موجودة.
   */
  it("يمنع 502 من كتالوج الأخطاء ومن عقد OpenAPI", () => {
    expect([...MARKETPLACE_HTTP_STATUS_CODES]).not.toContain(502 as never);
    expect(Object.values(MARKETPLACE_ERROR_CLASS_STATUS)).not.toContain(502 as never);
    expect(apiStatuses(openApiYml)).not.toContain(502);
    expect(errorsMd).not.toMatch(/^\|[^\n]*\|\s*502\s*\|/m);
  });
  /**
   * لماذا هذا الحارس: الظهور اقتران أربعة شروط (ADR-016 القرار 3)، ورمزٌ واحدٌ لأربعة
   * أسبابٍ يترك المستهلك لا يعرف أيَّها وقع فلا يقول لصاحب المتجر ما ينقصه.
   * النسخة الخاطئة الأرخص: PRODUCT_NOT_VISIBLE «لتبسيط الواجهة» فيضيع السبب.
   */
  it("يمنع رمزاً جامعاً للظهور ويثبت وجود أسبابه المنفصلة", () => {
    for (const forbidden of ["PRODUCT_NOT_VISIBLE", "STORE_NOT_VISIBLE", "PAYMENT_FAILED", "OWNER_BANNED"]) {
      expect([...MARKETPLACE_ERROR_CODES], forbidden).not.toContain(forbidden as never);
      expect(errorsMd, forbidden).not.toMatch(new RegExp(`^\\|\\s*\`${forbidden}\``, "m"));
    }
    for (const code of ["STORE_NOT_APPROVED", "PRODUCT_NOT_MODERATED", "INVENTORY_INSUFFICIENT_QUANTITY"]) {
      expect([...MARKETPLACE_ERROR_CODES], code).toContain(code as never);
    }
  });
});

describe("تمثيل OpenAPI للسوق", () => {
  it("يمنع مساراً زائداً أو مساراً مُصدَّراً غائباً من العقد", () => {
    expect(apiPaths(openApiYml).sort()).toEqual([...MARKETPLACE_API_PATHS].sort());
  });
  it("يمنع اختلاف عدد العمليات عن الثابت المعلن", () => {
    expect(apiOperationCount(openApiYml)).toBe(MARKETPLACE_API_OPERATION_COUNT);
    expect(MARKETPLACE_API_OPERATION_COUNT).toBe(19);
  });
  it("يمنع رمز استجابة خارج كتالوج HTTP المعلن", () => {
    for (const status of apiStatuses(openApiYml)) expect([...MARKETPLACE_HTTP_STATUS_CODES]).toContain(status as never);
  });
  /**
   * لماذا هذا الحارس: المنفذ جزء من سطح العميل ولا ينبغي أن يتشعب بين خدمة ومستهلك.
   * النسخة الخاطئة الأرخص: نسخ localhost:809x من طور آخر فيتصل عميل بخدمة مختلفة.
   */
  it("يثبت أن الخادم الأول يستعمل منفذ السوق 8094", () => {
    expect(MARKETPLACE_SERVICE_PORT).toBe(8094);
    const firstServer = /^servers:\n\s*- url: ([^\n]+)/m.exec(openApiYml);
    expect(firstServer?.[1]).toContain(`:${MARKETPLACE_SERVICE_PORT}`);
  });
});

describe("حدود الكتالوج المعلنة (ADR-016 القرارات 4 و5)", () => {
  /**
   * لماذا هذا الحارس: السعر عدد صحيح بالهللات وعملة واحدة؛ والحدّ الأدنى 1 لا 0 لأنّ
   * منتجاً بسعر صفرٍ نموذجٌ نُسي حقلُه لا عرضٌ مجّانيّ.
   * النسخة الخاطئة الأرخص: minimum: 0 في العقد فيمرّ نموذجٌ ناقصٌ إلى كتالوجٍ ظاهر.
   */
  it("يمنع تعارض حدود السعر بين الثوابت وعقد OpenAPI", () => {
    expect(PRICE_MINOR_UNITS_MIN).toBe(1);
    expect(PRICE_MINOR_UNITS_MAX).toBe(100000000);
    expect(MARKETPLACE_CURRENCY_CODE).toBe("SAR");
    const priceBlock = openApiYml.slice(openApiYml.indexOf("        price_minor_units:"));
    expect(priceBlock.slice(0, 400)).toContain(`minimum: ${PRICE_MINOR_UNITS_MIN}`);
    expect(priceBlock.slice(0, 400)).toContain(`maximum: ${PRICE_MINOR_UNITS_MAX}`);
    // العملة مُثبَّتة بـ`const` لا بتعداد: تعدادٌ بعنصرٍ واحد يقول «قد يزيد» ويفتح فرعاً في المستهلك.
    const currencyPins = [...openApiYml.matchAll(/currency_code:[\s\S]{0,120}?const: ([A-Z]{3})/g)].map((m) => m[1]!);
    expect(currencyPins.length).toBeGreaterThan(0);
    for (const pin of currencyPins) expect(pin).toBe(MARKETPLACE_CURRENCY_CODE);
  });
  it("يمنع تعارض سقف فرق المخزون وعمق التصنيف وحدّ المالك", () => {
    expect(INVENTORY_DELTA_ABS_MAX).toBe(1000000);
    expect(CATEGORY_MAX_DEPTH).toBe(2);
    expect(STORE_ACTIVE_LIMIT_PER_OWNER).toBe(1);
    const deltaBlock = openApiYml.slice(openApiYml.indexOf("        quantity_delta:"));
    expect(deltaBlock.slice(0, 400)).toContain(`minimum: -${INVENTORY_DELTA_ABS_MAX}`);
    expect(deltaBlock.slice(0, 400)).toContain(`maximum: ${INVENTORY_DELTA_ABS_MAX}`);
  });
});

describe("الروابط العميقة: قالبٌ يُبنى ولا يُخزَّن (القرار 7)", () => {
  /**
   * لماذا هذا الحارس: حمولة الرابط تعبر قناة تحدّ طولها بأربعة وستين حرفاً، وقالبٌ
   * يتجاوزها بأقصى مدخلٍ مشروعٍ يفشل عند تاجرٍ واحدٍ فقط فلا يُكتشف في التجربة.
   * النسخة الخاطئة الأرخص: بادئة وصفية طويلة مثل `marketplace_store_` تبدو أوضح ثم تكسر الحدّ.
   */
  it("يمنع قالباً يتجاوز حدّ حمولة القناة بأقصى مدخل ممكن", () => {
    const longestSlug = `a${"b".repeat(47)}`;
    expect(STORE_SLUG_PATTERN.test(longestSlug)).toBe(true);
    expect(buildStoreDeepLinkPayload(longestSlug).length)
      .toBeLessThanOrEqual(MARKETPLACE_DEEP_LINK_MAX_PAYLOAD_LENGTH);
    const uuid = "0189d1e4-7d3f-7c2a-9f11-6b4a2c8e5d70";
    expect(buildProductDeepLinkPayload(uuid).length)
      .toBeLessThanOrEqual(MARKETPLACE_DEEP_LINK_MAX_PAYLOAD_LENGTH);
  });
  it("يمنع بادئةً مشتركةً تجعل حمولة متجر تُقرأ منتجاً", () => {
    expect(MARKETPLACE_DEEP_LINK_PREFIXES.store).not.toBe(MARKETPLACE_DEEP_LINK_PREFIXES.product);
    expect(buildStoreDeepLinkPayload("wasla-market")).toBe("s_wasla-market");
    expect(buildProductDeepLinkPayload("abc")).toBe("p_abc");
  });
  it("يمنع تخزين الرابط بأن يبقى العقد بلا عمود ولا حقل له", () => {
    expect(openApiYml).not.toMatch(/^\s+deep_link\w*:/m);
  });
});

describe("الظهورُ دالّةٌ مُشتقّة لا عمود (القرار 3)", () => {
  /**
   * لماذا هذا الحارس: البحث (Phase 12) وبوت العميل يحتاجان الشرط نفسه، ولو كتب كلٌّ
   * فرعَه لظهر منتجٌ في نتيجة بحثٍ واختفى عند فتحه.
   * النسخة الخاطئة الأرخص: is_visible يُحدَّث بمُشغِّل، فيصير إيقاف متجرٍ كتابةً على كل
   * منتجاته وأوّلُ فشلٍ في المنتصف يترك سوقاً نصفَ ظاهر.
   */
  it("يمنع ظهوراً بأيّ شرطٍ ناقص من الأربعة", () => {
    const visible = { storeState: "approved", productState: "published", moderationState: "approved", quantityOnHand: 1 } as const;
    expect(isProductVisible(visible)).toBe(true);
    expect(isProductVisible({ ...visible, storeState: "suspended" })).toBe(false);
    expect(isProductVisible({ ...visible, productState: "draft" })).toBe(false);
    expect(isProductVisible({ ...visible, moderationState: "pending" })).toBe(false);
    expect(isProductVisible({ ...visible, quantityOnHand: 0 })).toBe(false);
  });
});

describe("slugات محجوزة (القرار 7)", () => {
  it("يمنع قائمة محجوزات بمخالفٍ للصيغة أو بتكرار", () => {
    expect(new Set(RESERVED_STORE_SLUGS).size).toBe(RESERVED_STORE_SLUGS.length);
    for (const slug of RESERVED_STORE_SLUGS) expect(STORE_SLUG_PATTERN.test(slug), slug).toBe(true);
    expect([...RESERVED_STORE_SLUGS]).toContain("wasla");
    expect([...RESERVED_STORE_SLUGS]).toContain("support");
  });
});
