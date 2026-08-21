import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DISPATCH_API_PATHS, DISPATCH_ERROR_CODES, DISPATCH_ERROR_CODE_CLASS,
  DISPATCH_ERROR_CLASS_STATUS, DISPATCH_HTTP_STATUS_CODES, DISPATCH_REASON_CODES,
  httpStatusForDispatchError,
} from "../index.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const base = resolve(__dirname, "../../../../../services/dispatch/contracts");
const errorsMd = readFileSync(resolve(base, "errors.md"), "utf8");
const openApiYml = readFileSync(resolve(base, "api.openapi.yml"), "utf8");
const errorRows = [...errorsMd.matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|\s*(\d{3})\s*\|/gm)].map((m) => [m[1]!, Number(m[2]!)] as const);
const reasonSection = errorsMd.slice(errorsMd.indexOf("## كتالوج أكواد الأسباب"));
const documentedReasons = [...reasonSection.matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|/gm)].map((m) => m[1]!);
function paths(yml: string): string[] { return [...yml.matchAll(/^  (\/[^:]+):/gm)].map((m) => m[1]!); }
function statuses(yml: string): number[] { return [...yml.matchAll(/^\s{8,}'?(\d{3})'?:/gm)].map((m) => Number(m[1]!)); }

describe("dispatch error catalog ↔ errors.md", () => {
  it("exports every documented error code and no undocumented code", () => expect(errorRows.map(([c]) => c).sort()).toEqual([...DISPATCH_ERROR_CODES].sort()));
  it("maps every code to its documented HTTP status", () => { for (const [code, status] of errorRows) expect(httpStatusForDispatchError(code as never)).toBe(status); });
  it("classes every code using a documented class", () => { for (const code of DISPATCH_ERROR_CODES) expect(Object.keys(DISPATCH_ERROR_CLASS_STATUS)).toContain(DISPATCH_ERROR_CODE_CLASS[code]); });
  it("keeps error codes unique", () => expect(new Set(DISPATCH_ERROR_CODES).size).toBe(DISPATCH_ERROR_CODES.length));
});
describe("dispatch reason catalog ↔ errors.md", () => {
  it("exports every documented reason and no undocumented reason", () => expect([...new Set(documentedReasons)].sort()).toEqual([...DISPATCH_REASON_CODES].sort()));
  it("keeps reason codes unique", () => expect(new Set(DISPATCH_REASON_CODES).size).toBe(DISPATCH_REASON_CODES.length));
});
describe("dispatch OpenAPI representation", () => {
  it("represents every documented path and no extra path", () => expect(paths(openApiYml).sort()).toEqual([...DISPATCH_API_PATHS].sort()));
  it("represents every documented HTTP status", () => expect([...new Set(statuses(openApiYml)).values()].sort((a,b) => a-b)).toEqual([...DISPATCH_HTTP_STATUS_CODES]));
  it("keeps HTTP status catalog unique", () => expect(new Set(DISPATCH_HTTP_STATUS_CODES).size).toBe(DISPATCH_HTTP_STATUS_CODES.length));
});
