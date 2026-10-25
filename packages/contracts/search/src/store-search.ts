/**
 * @wasla/contracts-search — store-name search contract constants
 * (G-S9.7 · CLM-0649 · ADR-025 §6.4). Mirrors `GET /search/stores` in
 * services/search/contracts/api.openapi.yml; `__tests__/contracts.test.ts`
 * fails if the two drift. The service imports these — one source for bounds.
 */

export const STORE_SEARCH_LOCALES = ["ar", "en", "ur"] as const;
export type StoreSearchLocale = (typeof STORE_SEARCH_LOCALES)[number];

/**
 * Bounds bound by the owner's decision (CLM-0652 · ADR-025 §6.8) — the same
 * bounds already approved for `GET /search/products`: `q` 1..200 characters
 * (code points, after trim; still non-empty after normalization), `page` ≥ 1
 * with **no** upper bound (only "is an exact integer" — `Number.isSafeInteger`
 * — which is representation, not policy), `page_size` 1..50 defaulting to 20.
 * CLM-0649 had shipped 2..64 · page ≤ 50 · page_size ≤ 20 (default 10) without
 * a decision; that was the drift corrected here.
 */
export const STORE_SEARCH_LIMITS = Object.freeze({
  qMinLength: 1,
  qMaxLength: 200,
  pageMin: 1,
  pageSizeMin: 1,
  pageSizeMax: 50,
  pageSizeDefault: 20,
});

/** The only query keys `GET /search/stores` accepts; anything else is 400. */
export const STORE_SEARCH_QUERY_KEYS = ["q", "locale", "page", "page_size"] as const;

/** The public projection — exactly these fields per item, nothing internal. */
export const STORE_SEARCH_RESULT_FIELDS = ["store_slug", "title", "category_slug"] as const;
