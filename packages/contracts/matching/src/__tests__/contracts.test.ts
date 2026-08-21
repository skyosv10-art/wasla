import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MATCHING_API_PATHS, MATCHING_ERROR_CODES, MATCHING_ERROR_CODE_CLASS,
  MATCHING_ERROR_CLASS_STATUS, MATCHING_HTTP_STATUS_CODES,
  MATCHING_EMPTY_REASON_CODES, MATCHING_AVAILABILITY_REASON_CODES, httpStatusForMatchingError,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(__dirname, "../../../../../services/matching/contracts");
const errorsMd = readFileSync(resolve(CONTRACTS_DIR, "errors.md"), "utf8");
const openApiYml = readFileSync(resolve(CONTRACTS_DIR, "api.openapi.yml"), "utf8");
const errorRows = [...errorsMd.matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|\s*(\d{3})\s*\|/gm)]
  .map((m) => [m[1]!, Number(m[2]!)] as const);
function section(title: string): string {
  const start = errorsMd.indexOf(title); expect(start, `${title} must exist`).toBeGreaterThan(-1);
  const next = errorsMd.indexOf("\n## ", start + title.length);
  return errorsMd.slice(start, next === -1 ? undefined : next);
}
function reasonCodes(title: string): string[] {
  return [...section(title).matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|/gm)].map((m) => m[1]!);
}
function apiPaths(yml: string): string[] { return [...yml.matchAll(/^  (\/[^:]+):/gm)].map((m) => m[1]!); }
function apiStatuses(yml: string): number[] {
  return [...yml.matchAll(/^\s{8,}'?(\d{3})'?:/gm)].map((m) => Number(m[1]!));
}

describe("matching error catalog ↔ errors.md", () => {
  it("exports every documented error code and no undocumented code", () => {
    expect(errorRows.map(([code]) => code).sort()).toEqual([...MATCHING_ERROR_CODES].sort());
  });
  it("maps every code to its documented HTTP status", () => {
    for (const [code, status] of errorRows) expect(httpStatusForMatchingError(code as never)).toBe(status);
  });
  it("classes every exported code using a documented class", () => {
    for (const code of MATCHING_ERROR_CODES) expect(Object.keys(MATCHING_ERROR_CLASS_STATUS)).toContain(MATCHING_ERROR_CODE_CLASS[code]);
  });
  it("keeps codes unique", () => expect(new Set(MATCHING_ERROR_CODES).size).toBe(MATCHING_ERROR_CODES.length));
});

describe("matching reason catalogs ↔ errors.md", () => {
  it("matches empty-result codes exactly", () => {
    expect(reasonCodes("## كتالوج أسباب النتيجة الفارغة").sort()).toEqual([...MATCHING_EMPTY_REASON_CODES].sort());
  });
  it("matches availability-change codes exactly", () => {
    expect(reasonCodes("## كتالوج أسباب تغيّر التوافر").sort()).toEqual([...MATCHING_AVAILABILITY_REASON_CODES].sort());
  });
  it("has no duplicate reason codes", () => {
    const all = [...MATCHING_EMPTY_REASON_CODES, ...MATCHING_AVAILABILITY_REASON_CODES];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("matching OpenAPI representation", () => {
  it("represents every documented path and no extra path", () => {
    expect(apiPaths(openApiYml).sort()).toEqual([...MATCHING_API_PATHS].sort());
  });
  it("represents every documented HTTP status", () => {
    expect([...new Set(apiStatuses(openApiYml)).values()].sort((a, b) => a - b)).toEqual([...MATCHING_HTTP_STATUS_CODES]);
  });
  it("keeps HTTP status catalog unique", () => expect(new Set(MATCHING_HTTP_STATUS_CODES).size).toBe(MATCHING_HTTP_STATUS_CODES.length));
});
