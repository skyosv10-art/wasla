import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DRIVER_API_PATHS, DRIVER_ERROR_CODES, DRIVER_ERROR_CODE_CLASS,
  DRIVER_ERROR_CLASS_STATUS, DRIVER_HTTP_STATUS_CODES,
  ELIGIBILITY_REASON_CODES, DRIVER_SERVICE_PORT, httpStatusForDriverError,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(__dirname, "../../../../../services/drivers/contracts");
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
function reasonCodes(title: string): string[] {
  return [...section(title).matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|/gm)].map((m) => m[1]!);
}
function apiPaths(yml: string): string[] { return [...yml.matchAll(/^  (\/[^:]+):/gm)].map((m) => m[1]!); }
function apiStatuses(yml: string): number[] {
  return [...yml.matchAll(/^\s{8,}'?(\d{3})'?:/gm)].map((m) => Number(m[1]!));
}

describe("driver error catalog ↔ errors.md", () => {
  it("exports every documented error code and no undocumented code", () => {
    expect(errorRows.map(([code]) => code).sort()).toEqual([...DRIVER_ERROR_CODES].sort());
  });
  it("maps every code to its documented HTTP status", () => {
    for (const [code, status] of errorRows) expect(httpStatusForDriverError(code as never), code).toBe(status);
  });
  it("classes every exported code using a documented class", () => {
    for (const code of DRIVER_ERROR_CODES) expect(Object.keys(DRIVER_ERROR_CLASS_STATUS)).toContain(DRIVER_ERROR_CODE_CLASS[code]);
  });
  it("keeps codes unique", () => expect(new Set(DRIVER_ERROR_CODES).size).toBe(DRIVER_ERROR_CODES.length));
  it("classes publish failure as bad_gateway, not a caller error", () => {
    expect(DRIVER_ERROR_CODE_CLASS.DRIVER_CANDIDACY_PUBLISH_FAILED).toBe("bad_gateway");
    expect(httpStatusForDriverError("DRIVER_CANDIDACY_PUBLISH_FAILED")).toBe(502);
  });
});

describe("driver eligibility reason catalog ↔ errors.md", () => {
  it("matches the documented ineligibility codes exactly", () => {
    expect(reasonCodes("## كتالوج أسباب عدم الأهليّة").sort()).toEqual([...ELIGIBILITY_REASON_CODES].sort());
  });
  it("keeps reason codes unique", () => {
    expect(new Set(ELIGIBILITY_REASON_CODES).size).toBe(ELIGIBILITY_REASON_CODES.length);
  });
  it("never overlaps an error code with a reason code", () => {
    for (const reason of ELIGIBILITY_REASON_CODES) expect([...DRIVER_ERROR_CODES]).not.toContain(reason as never);
  });
});

describe("driver OpenAPI representation", () => {
  it("represents every documented path and no extra path", () => {
    expect(apiPaths(openApiYml).sort()).toEqual([...DRIVER_API_PATHS].sort());
  });
  it("represents every documented HTTP status", () => {
    expect([...new Set(apiStatuses(openApiYml)).values()].sort((a, b) => a - b)).toEqual([...DRIVER_HTTP_STATUS_CODES]);
  });
  it("keeps HTTP status catalog unique", () => expect(new Set(DRIVER_HTTP_STATUS_CODES).size).toBe(DRIVER_HTTP_STATUS_CODES.length));
  it("declares the service port exactly once, and the package agrees", () => {
    expect(DRIVER_SERVICE_PORT).toBe(8090);
    expect(openApiYml).toContain(String(DRIVER_SERVICE_PORT));
  });
  /**
   * درس الطور 07: Fastify يردّ 400 على جسم فارغ لعملية تُعلن requestBody.
   * التأكيد على **مفتاح بنيوي** بمحاذاة سطر لا على الكلمة، لأنّ الوصف العربي يشرح غيابها بذكر اسمها.
   */
  it("declares no request body for the eligibility tick", () => {
    const tick = openApiYml.slice(openApiYml.indexOf("  /drivers/eligibility/tick:"));
    const nextPath = tick.indexOf("\n  /", 1);
    const block = nextPath === -1 ? tick : tick.slice(0, nextPath);
    expect(block).not.toMatch(/^\s{6}requestBody:/m);
  });
});
