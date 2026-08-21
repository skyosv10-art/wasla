import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const base = resolve(__dirname, "../../../../../services/matching/contracts");
const api = readFileSync(resolve(base, "api.openapi.yml"), "utf8");
const schema = readFileSync(resolve(base, "schema.sql"), "utf8");
/** Public route and named-schema vocabulary, intentionally excluding explanatory prose. */
const surface = api.split("\n").filter((line) => /^  \/|^    [A-Z][A-Za-z0-9]+:|^      operationId:/.test(line)).join("\n").toLowerCase();
describe("ADR-011 matching boundary", () => {
  it("exposes no dispatch route or named API surface", () => {
    for (const token of ["offer", "wave", "timeout", "transition"]) expect(surface, token).not.toContain(token);
  });
  it("has no foreign key to another service", () => expect(schema).not.toMatch(/REFERENCES\s+(?!matching_rulesets\b|matching_decisions\b)[a-z_]+/i));
  it("exposes no Order Engine write route", () => expect(surface).not.toMatch(/\/orders|assignment|orderengine/));
});
