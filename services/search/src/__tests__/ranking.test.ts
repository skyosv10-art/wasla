import { describe, expect, it } from "vitest";
import { rankAndSort, rankProduct, trigramSimilarity } from "../domain/ranking.js";
import type { IndexedProduct } from "../domain/model.js";
import { normalizeQuery } from "../domain/query.js";

function product(overrides: Partial<IndexedProduct>): IndexedProduct {
  return {
    product_id: "p1",
    store_id: "s1",
    store_slug: "acme",
    product_slug: "smart-phone",
    category_id: "c1",
    title_ar: "هاتف ذكي",
    title_en: "Smart Phone",
    price_minor_units: 50000,
    currency_code: "SAR",
    ...overrides,
  };
}

describe("trigramSimilarity", () => {
  it("identical strings score highest", () => {
    expect(trigramSimilarity("phone", "phone")).toBeGreaterThan(0.99);
  });

  it("disjoint strings score low", () => {
    expect(trigramSimilarity("aaa", "zzz")).toBeLessThan(0.2);
  });

  it("empty strings score zero", () => {
    expect(trigramSimilarity("", "abc")).toBe(0);
  });
});

describe("rankProduct — scoring ladder (exact > prefix > fts > trigram)", () => {
  it("exact slug match => score 1.0", () => {
    const p = product({});
    const nq = normalizeQuery("smart-phone");
    const r = rankProduct(p, nq);
    expect(r.score).toBe(1.0);
  });

  it("exact arabic title match => score 1.0", () => {
    const p = product({});
    const nq = normalizeQuery("هاتف ذكي");
    const r = rankProduct(p, nq);
    expect(r.score).toBe(1.0);
  });

  it("prefix match => score 0.8", () => {
    const p = product({});
    const nq = normalizeQuery("smart");
    const r = rankProduct(p, nq);
    expect(r.score).toBe(0.8);
  });

  it("all terms present (fts proxy) => score 0.6", () => {
    const p = product({ title_en: "A Smart Phone", product_slug: "device", title_ar: "هاتف" });
    const nq = normalizeQuery("smart phone");
    const r = rankProduct(p, nq);
    expect(r.score).toBe(0.6);
  });

  it("no overlap => score 0", () => {
    const p = product({});
    const nq = normalizeQuery("سيارة حمراء");
    const r = rankProduct(p, nq);
    expect(r.score).toBe(0);
  });
});

describe("rankAndSort — ordering", () => {
  const products: IndexedProduct[] = [
    product({ product_id: "a", title_ar: "هاتف ذكي", title_en: null, product_slug: "a" }),
    product({ product_id: "b", title_ar: "هاتف", title_en: null, product_slug: "phone" }),
    product({ product_id: "c", title_ar: "سيارة", title_en: null, product_slug: "car" }),
  ];

  it("sorts by descending score and drops zero-score", () => {
    const nq = normalizeQuery("هاتف");
    const ranked = rankAndSort(products, nq);
    // "هاتف" matches exactly on product b's title_ar => 1.0
    // product a title "هاتف ذكي" => prefix match => 0.8
    // product c no overlap => dropped
    expect(ranked.map((r) => r.product.product_id)).toEqual(["b", "a"]);
  });
});
