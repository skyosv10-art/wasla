import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NEGOTIATION_API_PATHS, NEGOTIATION_CANCEL_REASON_CODES, NEGOTIATION_CLOSE_REASON_CODES,
  NEGOTIATION_ERROR_CLASS_STATUS, NEGOTIATION_ERROR_CODE_CLASS, NEGOTIATION_ERROR_CODES,
  NEGOTIATION_HTTP_STATUS_CODES, NEGOTIATION_SERVICE_PORT, httpStatusForNegotiationError,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(__dirname, "../../../../../services/negotiations/contracts");
const errorsMd = readFileSync(resolve(CONTRACTS_DIR, "errors.md"), "utf8");
const openApiYml = readFileSync(resolve(CONTRACTS_DIR, "api.openapi.yml"), "utf8");

function section(title: string): string {
  const start = errorsMd.indexOf(title); expect(start, `${title} must exist`).toBeGreaterThan(-1);
  const next = errorsMd.indexOf("\n## ", start + title.length);
  return errorsMd.slice(start, next === -1 ? undefined : next);
}
/** جدول الأكواد وحده يحمل عموداً برمز HTTP، فيُقرأ من قسمه لا من الملفّ كلّه. */
const errorRows = [...section("## أكواد الأخطاء").matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|\s*(\d{3})\s*\|/gm)]
  .map((m) => [m[1]!, Number(m[2]!)] as const);
function apiPaths(yml: string): string[] { return [...yml.matchAll(/^  (\/[^:]+):/gm)].map((m) => m[1]!); }
function apiStatuses(yml: string): number[] {
  return [...yml.matchAll(/^\s{8,}'?(\d{3})'?:/gm)].map((m) => Number(m[1]!));
}

describe("negotiation error catalog ↔ errors.md", () => {
  it("exports every documented error code and no undocumented code", () => {
    expect(errorRows.map(([code]) => code).sort()).toEqual([...NEGOTIATION_ERROR_CODES].sort());
  });
  it("maps every code to its documented HTTP status", () => {
    for (const [code, status] of errorRows) expect(httpStatusForNegotiationError(code as never), code).toBe(status);
  });
  it("classes every exported code using a documented class", () => {
    for (const code of NEGOTIATION_ERROR_CODES) {
      expect(Object.keys(NEGOTIATION_ERROR_CLASS_STATUS)).toContain(NEGOTIATION_ERROR_CODE_CLASS[code]);
    }
  });
  it("keeps codes unique", () => expect(new Set(NEGOTIATION_ERROR_CODES).size).toBe(NEGOTIATION_ERROR_CODES.length));
  /**
   * حارس الحدّ الأهمّ في ADR-013 (القرار 2). من يريد `502` سيكسر هذا الاختبار فيقرأ
   * السبب في `errors.md` قبل أن يُعلن حالةً تنقض اتفاقاً وقع فعلاً.
   */
  it("declares no 502: a failed price hand-off never invalidates an agreement", () => {
    expect(Object.values(NEGOTIATION_ERROR_CLASS_STATUS)).not.toContain(502 as never);
    expect(Object.keys(NEGOTIATION_ERROR_CLASS_STATUS)).not.toContain("bad_gateway");
    expect([...NEGOTIATION_HTTP_STATUS_CODES]).not.toContain(502 as never);
    for (const code of NEGOTIATION_ERROR_CODES) expect(httpStatusForNegotiationError(code), code).not.toBe(502);
    for (const status of apiStatuses(openApiYml)) expect(status).not.toBe(502);
    expect(errorsMd).toContain("ما لا يُنتجه أي رمز في هذا الكتالوج");
  });
  /** رفضُ السعر نتيجةُ عملٍ لا خطأ: رمزٌ له يُفسد كل عدّاد أخطاء في المراقبة. */
  it("declares no error code for a rejection, an expiry tick or a publish failure", () => {
    for (const forbidden of [
      "NEGOTIATION_DECLINED", "NEGOTIATION_REJECTED", "NEGOTIATION_HANDOFF_FAILED",
      "NEGOTIATION_PRICE_HANDOFF_FAILED", "NEGOTIATION_PUBLISH_FAILED", "NEGOTIATION_OUTBOX_FAILED",
    ]) expect([...NEGOTIATION_ERROR_CODES]).not.toContain(forbidden as never);
  });
});

describe("negotiation OpenAPI representation", () => {
  it("represents every documented path and no extra path", () => {
    expect(apiPaths(openApiYml).sort()).toEqual([...NEGOTIATION_API_PATHS].sort());
  });
  it("uses only the documented HTTP status codes", () => {
    for (const status of apiStatuses(openApiYml)) expect([...NEGOTIATION_HTTP_STATUS_CODES]).toContain(status as never);
  });
  it("declares the service port once, in the contract package", () => {
    expect(NEGOTIATION_SERVICE_PORT).toBe(8091);
    expect(openApiYml).toContain("localhost:8091");
  });
  it("refuses an unknown key on every request body (onlyKeys is a contract, not a habit)", () => {
    expect(openApiYml).toContain("additionalProperties: false");
  });
  /** `GET /negotiations` بلا مُرشِّح تعني قراءة محادثات كل الناس. */
  it("keeps a filter mandatory on the thread list", () => {
    expect(errorRows.map(([code]) => code)).toContain("NEGOTIATION_FILTER_REQUIRED");
  });
});

describe("negotiation close reasons ↔ cancel reasons", () => {
  it("keeps every cancel reason a subset of the close reasons", () => {
    for (const reason of NEGOTIATION_CANCEL_REASON_CODES) {
      expect([...NEGOTIATION_CLOSE_REASON_CODES]).toContain(reason as never);
    }
  });
  /** انسحاب طرفٍ رفضٌ لا إلغاء: `POST /cancel` لطرفٍ ثالث فقط. */
  it("forbids a party decline from masquerading as a cancellation", () => {
    expect([...NEGOTIATION_CANCEL_REASON_CODES]).not.toContain("declined_by_customer" as never);
    expect([...NEGOTIATION_CANCEL_REASON_CODES]).not.toContain("declined_by_driver" as never);
    expect([...NEGOTIATION_CANCEL_REASON_CODES]).not.toContain("agreed" as never);
  });
  it("keeps close reason codes unique", () => {
    expect(new Set(NEGOTIATION_CLOSE_REASON_CODES).size).toBe(NEGOTIATION_CLOSE_REASON_CODES.length);
  });
});
