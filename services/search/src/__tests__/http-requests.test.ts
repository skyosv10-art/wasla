/**
 * Unit tests for search request parsing & validation (ADR-025 §2.4 / §5).
 *
 * No DB, no HTTP — `parseSearchRequest` is a pure function. These tests are the
 * guard against silent coercion: a present-but-invalid value must throw the
 * right 400 code, never fall back to a default and hide the malformed call.
 */

import { describe, expect, it } from "vitest";

import { parseSearchRequest } from "../http/requests.js";
import { SearchValidationError } from "../http/errors.js";

describe("parseSearchRequest", () => {
  it("accepts a minimal valid query and fills defaults", () => {
    const parsed = parseSearchRequest({ q: "آيفون" });
    expect(parsed.q).toBe("آيفون");
    expect(parsed.locale).toBe("ar");
    expect(parsed.categorySlug).toBeNull();
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
    expect(parsed.sort).toBe("relevance");
  });

  it("accepts all optional parameters", () => {
    const parsed = parseSearchRequest({
      q: "سماعة",
      locale: "en",
      category_slug: "electronics",
      page: 2,
      page_size: 50,
      sort: "price_asc",
    });
    expect(parsed.locale).toBe("en");
    expect(parsed.categorySlug).toBe("electronics");
    expect(parsed.page).toBe(2);
    expect(parsed.pageSize).toBe(50);
    expect(parsed.sort).toBe("price_asc");
  });

  it("strips Arabic diacritics and collapses whitespace in q", () => {
    const parsed = parseSearchRequest({ q: "  سَمّاعَة   بلوتوث  " });
    expect(parsed.q).toBe("سماعة بلوتوث");
  });

  it("treats an empty category_slug as null (not a filter)", () => {
    const parsed = parseSearchRequest({ q: "كتاب", category_slug: "   " });
    expect(parsed.categorySlug).toBeNull();
  });

  it("rejects a missing q with SEARCH_QUERY_EMPTY", () => {
    expect(() => parseSearchRequest({})).toThrow(SearchValidationError);
    expect(() => parseSearchRequest({})).toThrow(
      expect.objectContaining({ code: "SEARCH_QUERY_EMPTY" }),
    );
  });

  it("rejects a whitespace-only q with SEARCH_QUERY_EMPTY", () => {
    expect(() => parseSearchRequest({ q: "   " })).toThrow(
      expect.objectContaining({ code: "SEARCH_QUERY_EMPTY" }),
    );
  });

  it("rejects an over-length q with SEARCH_QUERY_TOO_LONG", () => {
    expect(() => parseSearchRequest({ q: "x".repeat(201) })).toThrow(
      expect.objectContaining({ code: "SEARCH_QUERY_TOO_LONG" }),
    );
  });

  it("rejects an unsupported locale with SEARCH_UNSUPPORTED_LOCALE", () => {
    expect(() => parseSearchRequest({ q: "x", locale: "fr" })).toThrow(
      expect.objectContaining({ code: "SEARCH_UNSUPPORTED_LOCALE" }),
    );
  });

  it("rejects an unknown sort with SEARCH_SORT_INVALID", () => {
    expect(() => parseSearchRequest({ q: "x", sort: "popular" })).toThrow(
      expect.objectContaining({ code: "SEARCH_SORT_INVALID" }),
    );
  });

  it("rejects a page below 1 with SEARCH_PAGE_OUT_OF_RANGE", () => {
    expect(() => parseSearchRequest({ q: "x", page: 0 })).toThrow(
      expect.objectContaining({ code: "SEARCH_PAGE_OUT_OF_RANGE" }),
    );
  });

  it("rejects page_size out of range with SEARCH_PAGE_SIZE_INVALID", () => {
    expect(() => parseSearchRequest({ q: "x", page_size: 0 })).toThrow(
      expect.objectContaining({ code: "SEARCH_PAGE_SIZE_INVALID" }),
    );
    expect(() => parseSearchRequest({ q: "x", page_size: 51 })).toThrow(
      expect.objectContaining({ code: "SEARCH_PAGE_SIZE_INVALID" }),
    );
  });

  it("rejects array-valued parameters rather than taking the first element", () => {
    expect(() => parseSearchRequest({ q: ["a", "b"] })).toThrow(
      SearchValidationError,
    );
    expect(() => parseSearchRequest({ q: "x", locale: ["ar", "en"] })).toThrow(
      expect.objectContaining({ code: "SEARCH_UNSUPPORTED_LOCALE" }),
    );
    expect(() => parseSearchRequest({ q: "x", sort: ["relevance"] })).toThrow(
      expect.objectContaining({ code: "SEARCH_SORT_INVALID" }),
    );
  });
});
