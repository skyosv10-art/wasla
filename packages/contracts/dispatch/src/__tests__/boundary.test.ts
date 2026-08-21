import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const base = resolve(__dirname, "../../../../../services/dispatch/contracts");
const api = readFileSync(resolve(base, "api.openapi.yml"), "utf8");
const schema = readFileSync(resolve(base, "schema.sql"), "utf8");
/** Public route and named-schema vocabulary, intentionally excluding explanatory prose. */
const surface = api.split("\n").filter((line) => /^  \/|^    [A-Z][A-Za-z0-9_]+:|^      operationId:/.test(line)).join("\n").toLowerCase();
describe("ADR-011 dispatch boundary", () => {
  it("contains no ranking, score, or weight policy surface except ruleset version", () => {
    for (const token of ["weight", "score", "ranking"]) expect(surface, token).not.toContain(token);
    expect(api).toContain("ruleset_version");
  });
  it("owns no candidacy or eligibility table", () => {
    expect(schema).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+(driver_candidacy|matching_decision|eligibility)/i);
  });
  it("exposes no hidden-timer API surface", () => {
    for (const token of ["settimeout", "timer"]) expect(surface).not.toContain(token);
  });
  it("exposes the explicit tick route", () => expect(api).toContain("/dispatch/tick:"));
});
