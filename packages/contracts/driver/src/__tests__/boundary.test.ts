import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DRIVER_CANDIDACY_ELIGIBILITY_SOURCE, DRIVER_CANDIDACY_UPDATED_BY,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = resolve(__dirname, "../../../../../services/drivers/contracts");
const api = readFileSync(resolve(base, "api.openapi.yml"), "utf8");
const schema = readFileSync(resolve(base, "schema.sql"), "utf8");

/**
 * **سطح المسارات والعمليات وحده** — بلا أسماء مكوّنات ولا نثر تفسيري.
 *
 * المكوّنات مستثناة بقصد: `CandidacyPublishFailed` استجابةُ خطأ 502 تُعلن أنّ النشر فشل،
 * وهي **إثبات** أنّ الترشيح خلف منفذ لا مسار عندنا، فلا يصحّ أن يقرأها حارس الحدود تسريباً.
 */
const routeSurface = api.split("\n")
  .filter((line) => /^  \/|^      operationId:/.test(line))
  .join("\n").toLowerCase();
/** سطح المكوّنات المُسمّاة، لحدودٍ يجب أن تغيب حتى كنوع بيانات (اشتراك · تقييم · محفظة). */
const surface = api.split("\n")
  .filter((line) => /^  \/|^    [A-Z][A-Za-z0-9]+:|^      operationId:/.test(line))
  .join("\n").toLowerCase();

describe("ADR-012 driver core boundary", () => {
  it("exposes no matching, dispatch, or order route", () => {
    for (const token of ["candidate", "candidacy", "offer", "wave", "assignment", "/orders", "ruleset"]) {
      expect(routeSurface, token).not.toContain(token);
    }
  });
  it("has no foreign key outside its own tables", () => {
    expect(schema).not.toMatch(/REFERENCES\s+(?!driver_profiles\b|driver_vehicles\b|driver_eligibility_policies\b)[a-z_]+/i);
  });
  it("keys the role profile on the identity public id without a foreign key", () => {
    expect(schema).toContain("wasla_public_id");
    expect(schema).not.toMatch(/REFERENCES\s+users\b/i);
  });
  it("exposes no subscription or reputation surface (Phase 09 · Phase 10 own them)", () => {
    for (const token of ["subscription", "rating", "reputation", "payment", "wallet"]) {
      expect(surface, token).not.toContain(token);
    }
  });
});

describe("ADR-012 decision 3: publication crosses a port, never a database", () => {
  it("publishes with the values matching's projection already expects", () => {
    expect(DRIVER_CANDIDACY_ELIGIBILITY_SOURCE).toBe("driver_core");
    expect(DRIVER_CANDIDACY_UPDATED_BY).toBe("driver_core");
  });
  it("records every publication attempt, so a silent failure is impossible", () => {
    expect(schema).toContain("driver_candidacy_publications");
  });
  it("writes no matching table", () => {
    expect(schema).not.toMatch(/\b(driver_candidacy|matching_rulesets|matching_decisions)\b\s*\(/);
  });
});
