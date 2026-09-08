import { describe, expect, it } from "vitest";
import {
  isBlankQuery,
  isQueryTooLong,
  MAX_QUERY_LENGTH,
  normalizeQuery,
} from "../domain/query.js";

describe("normalizeQuery — Arabic", () => {
  it("strips tashkeel and tatweel", () => {
    const raw = "إِلِكْتُرُونِيَّاتـان"; // with diacritics + tatweel
    const nq = normalizeQuery(raw);
    expect(nq.terms).toEqual(["إلكترونياتان"]);
  });

  it("collapses whitespace and trims", () => {
    const nq = normalizeQuery("  هاتف   ذكي  ");
    expect(nq.normalized).toBe("هاتف ذكي");
    expect(nq.terms).toEqual(["هاتف", "ذكي"]);
  });

  it("lowercases latin text", () => {
    const nq = normalizeQuery("SmartPhone");
    expect(nq.normalized).toBe("smartphone");
  });
});

describe("normalizeQuery — blank detection", () => {
  it("empty string is blank", () => {
    expect(isBlankQuery(normalizeQuery(""))).toBe(true);
  });

  it("whitespace-only is blank", () => {
    expect(isBlankQuery(normalizeQuery("   "))).toBe(true);
  });

  it("diacritics-only becomes blank", () => {
    expect(isBlankQuery(normalizeQuery("ِ ُ ّ"))).toBe(true);
  });

  it("real query is not blank", () => {
    expect(isBlankQuery(normalizeQuery("إلكترونيات"))).toBe(false);
  });
});

describe("normalizeQuery — length guard", () => {
  it("respects MAX_QUERY_LENGTH", () => {
    expect(MAX_QUERY_LENGTH).toBe(200);
    expect(isQueryTooLong("a".repeat(200))).toBe(false);
    expect(isQueryTooLong("a".repeat(201))).toBe(true);
  });
});

describe("normalizeQuery — bilingual equivalence", () => {
  it("arabic variant and english variant both tokenize to non-empty terms", () => {
    const ar = normalizeQuery("إلكترونيات");
    const en = normalizeQuery("electronics");
    expect(ar.terms.length).toBeGreaterThan(0);
    expect(en.terms.length).toBeGreaterThan(0);
  });
});
