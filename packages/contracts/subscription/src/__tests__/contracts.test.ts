import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUBSCRIPTION_API_OPERATION_COUNT, SUBSCRIPTION_API_PATHS, SUBSCRIPTION_ERROR_CLASS_STATUS,
  SUBSCRIPTION_ERROR_CODE_CLASS, SUBSCRIPTION_ERROR_CODES, SUBSCRIPTION_HTTP_STATUS_CODES,
  SUBSCRIPTION_SERVICE_PORT, httpStatusForSubscriptionError,
  SUBSCRIPTION_COMMUNITY_FLOOR_ENTITLEMENTS, SUBSCRIPTION_ENTITLEMENTS,
  SUBSCRIPTION_LAUNCH_COMMUNITY_DAILY_ORDER_CAP, SUBSCRIPTION_LAUNCH_COMMUNITY_GRACE_DAYS,
  SUBSCRIPTION_PAID_ONLY_ENTITLEMENTS,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(__dirname, "../../../../../services/subscriptions/contracts");
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

describe("كتالوج أخطاء الاشتراك ↔ errors.md", () => {
  it("يمنع رمز خطأ موثقاً غير مُصدَّر أو رمزاً مُصدَّراً بلا توثيق", () => {
    expect(errorRows.map(([code]) => code)).toEqual([...SUBSCRIPTION_ERROR_CODES]);
  });
  it("يمنع أن يختلف رمز HTTP الموثق عن تصنيف الرمز", () => {
    for (const [code, status] of errorRows) {
      expect(httpStatusForSubscriptionError(code as never), code).toBe(status);
      expect(SUBSCRIPTION_ERROR_CLASS_STATUS[SUBSCRIPTION_ERROR_CODE_CLASS[code as never]], code).toBe(status);
    }
  });
  it("يمنع كوداً موثقاً بلا صنف خطأ معروف", () => {
    for (const code of SUBSCRIPTION_ERROR_CODES) {
      expect(Object.keys(SUBSCRIPTION_ERROR_CLASS_STATUS), code).toContain(SUBSCRIPTION_ERROR_CODE_CLASS[code]);
    }
  });
  /**
   * لماذا هذا الحارس: لا تابعَ متزامناً في مسار الطلب كي يصير فشله بوابةً خارجية.
   * النسخة الخاطئة الأرخص: إضافة 502 «احتياطاً» فتفترض العميلات تبعيةً غير موجودة.
   */
  it("يمنع 502 من كتالوج الأخطاء ومن عقد OpenAPI", () => {
    expect([...SUBSCRIPTION_HTTP_STATUS_CODES]).not.toContain(502 as never);
    expect(Object.values(SUBSCRIPTION_ERROR_CLASS_STATUS)).not.toContain(502 as never);
    expect(apiStatuses(openApiYml)).not.toContain(502);
    expect(errorsMd).not.toMatch(/^\|[^\n]*\|\s*502\s*\|/m);
  });
});

describe("تمثيل OpenAPI للاشتراك", () => {
  it("يمنع مساراً زائداً أو مساراً مُصدَّراً غائباً من العقد", () => {
    expect(apiPaths(openApiYml).sort()).toEqual([...SUBSCRIPTION_API_PATHS].sort());
  });
  it("يمنع اختلاف عدد العمليات عن الثابت المعلن", () => {
    expect(apiOperationCount(openApiYml)).toBe(SUBSCRIPTION_API_OPERATION_COUNT);
    expect(SUBSCRIPTION_API_OPERATION_COUNT).toBe(12);
  });
  it("يمنع رمز استجابة خارج كتالوج HTTP المعلن", () => {
    for (const status of apiStatuses(openApiYml)) expect([...SUBSCRIPTION_HTTP_STATUS_CODES]).toContain(status as never);
  });
  /**
   * لماذا هذا الحارس: المنفذ جزء من سطح العميل ولا ينبغي أن يتشعب بين خدمة ومستهلك.
   * النسخة الخاطئة الأرخص: نسخ localhost:809x جديد في العقد حتى يتصل عميل بمرحلة أخرى.
   */
  it("يثبت أن الخادم الأول يستعمل منفذ الاشتراك 8093", () => {
    expect(SUBSCRIPTION_SERVICE_PORT).toBe(8093);
    const firstServer = /^servers:\n\s*- url: ([^\n]+)/m.exec(openApiYml);
    expect(firstServer?.[1]).toContain(`:${SUBSCRIPTION_SERVICE_PORT}`);
  });
});

describe("تصنيفُ الاستحقاقات: أرضيّة مقابل مدفوع", () => {
  /**
   * لماذا هذا الحارس: طبقةُ المجال تحسب استحقاقات `expired` و`community` من هذَين
   * الثابتَين، فلو بقي رمزٌ غيرَ مُصنَّف قرّر أوّلُ فرعٍ في الكود مصيرَه صمتاً.
   * النسخة الخاطئة الأرخص: قائمةٌ ثالثةٌ تُكتب داخل الخدمة فتتباعد عن العقد بصمت.
   */
  it("يمنع رمز استحقاق غير مُصنَّف أو مُصنَّفاً مرّتَين", () => {
    const union = [...SUBSCRIPTION_COMMUNITY_FLOOR_ENTITLEMENTS, ...SUBSCRIPTION_PAID_ONLY_ENTITLEMENTS];
    expect([...union].sort()).toEqual([...SUBSCRIPTION_ENTITLEMENTS].sort());
    expect(new Set(union).size).toBe(union.length);
  });
  it("يمنع بقاء امتياز مدفوع على الأرضيّة", () => {
    for (const code of SUBSCRIPTION_PAID_ONLY_ENTITLEMENTS) {
      expect([...SUBSCRIPTION_COMMUNITY_FLOOR_ENTITLEMENTS], code).not.toContain(code as never);
    }
    expect([...SUBSCRIPTION_COMMUNITY_FLOOR_ENTITLEMENTS]).toContain("accept_orders");
  });
  it("يثبت سقفَ الأرضيّة المعلن في نسخة خطّة الإطلاق", () => {
    expect(SUBSCRIPTION_LAUNCH_COMMUNITY_DAILY_ORDER_CAP).toBe(3);
    expect(SUBSCRIPTION_LAUNCH_COMMUNITY_DAILY_ORDER_CAP).toBeLessThan(SUBSCRIPTION_LAUNCH_COMMUNITY_GRACE_DAYS + 1000);
  });
});
