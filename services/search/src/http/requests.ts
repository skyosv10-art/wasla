/**
 * Request parsing & validation for `GET /search/products` (ADR-025 §2.4).
 *
 * The contract (api.openapi.yml) is the source of truth for parameter names,
 * types, defaults, and bounds. This module is the ONLY place that decides what
 * a valid search request looks like — handlers call `parseSearchRequest` and
 * throw `SearchValidationError` on the first rejected input. No silent coercion
 * to defaults for present-but-invalid values: a bad enum is `400`, not a fallback.
 *
 * Arrays are rejected (a repeated query key is a client mistake), never silently
 * taking the first element — that would hide a malformed call from the caller.
 */

import {
  isBlankQuery,
  isQueryTooLong,
  MAX_QUERY_LENGTH,
  normalizeQuery,
} from "../domain/query.js";
import { SearchValidationError } from "./errors.js";

const LOCALES: ReadonlySet<string> = new Set(["ar", "en"]);
const SORTS: ReadonlySet<string> = new Set([
  "relevance",
  "price_asc",
  "price_desc",
  "newest",
]);

export interface ParsedSearchRequest {
  /** Normalized query (diacritics stripped, whitespace-collapsed, lower-cased). */
  readonly q: string;
  readonly locale: "ar" | "en";
  /** Category filter, or null when absent/blank. Verbatim — not fabricated here. */
  readonly categorySlug: string | null;
  /** 1-based page. */
  readonly page: number;
  readonly pageSize: number;
  readonly sort: "relevance" | "price_asc" | "price_desc" | "newest";
}

/**
 * Accept a query value only if it is a single string. A present-but-non-string
 * value (array, number, object) is a malformed call — rejected, never coerced.
 */
function requireString(
  value: unknown,
  code: string,
  message: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new SearchValidationError(code, message);
  return value;
}

function parsePositiveInt(
  value: unknown,
  code: string,
  message: string,
): number | undefined {
  if (value === undefined) return undefined;
  let n: number;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new SearchValidationError(code, message);
    n = value;
  } else if (
    typeof value === "string" &&
    /^-?\d+$/.test(value.trim())
  ) {
    n = Number(value);
  } else {
    throw new SearchValidationError(code, message);
  }
  return n;
}

/** Search params as Fastify provides them in `request.query`. */
export type SearchQueryInput = Record<string, unknown>;

export function parseSearchRequest(query: SearchQueryInput): ParsedSearchRequest {
  // ── q (required) ──────────────────────────────────────────────────────────
  const qRaw = requireString(
    query.q,
    "SEARCH_QUERY_EMPTY",
    "نص البحث مفقود",
  );
  if (qRaw === undefined) {
    throw new SearchValidationError(
      "SEARCH_QUERY_EMPTY",
      "نص البحث لا يمكن أن يكون فارغاً",
    );
  }
  if (isQueryTooLong(qRaw)) {
    throw new SearchValidationError(
      "SEARCH_QUERY_TOO_LONG",
      `نص البحث يتجاوز ${MAX_QUERY_LENGTH} حرفاً`,
    );
  }
  const normalized = normalizeQuery(qRaw);
  if (isBlankQuery(normalized)) {
    throw new SearchValidationError(
      "SEARCH_QUERY_EMPTY",
      "نص البحث لا يمكن أن يكون فارغاً",
    );
  }

  // ── locale (optional, default ar) ────────────────────────────────────────
  const localeRaw = requireString(
    query.locale,
    "SEARCH_UNSUPPORTED_LOCALE",
    "قيمة locale غير صالحة",
  );
  const locale = localeRaw ?? "ar";
  if (!LOCALES.has(locale)) {
    throw new SearchValidationError(
      "SEARCH_UNSUPPORTED_LOCALE",
      `locale غير مدعوم: ${locale}`,
    );
  }

  // ── category_slug (optional) ─────────────────────────────────────────────
  const categoryRaw = requireString(
    query.category_slug,
    "SEARCH_SORT_INVALID",
    "قيمة category_slug غير صالحة",
  );
  const categorySlug =
    categoryRaw === undefined || categoryRaw.trim().length === 0
      ? null
      : categoryRaw;

  // ── page (optional, default 1) ────────────────────────────────────────────
  const pageRaw = parsePositiveInt(
    query.page,
    "SEARCH_PAGE_OUT_OF_RANGE",
    "رقم الصفحة غير صالح",
  );
  const page = pageRaw ?? 1;
  if (page < 1) {
    throw new SearchValidationError(
      "SEARCH_PAGE_OUT_OF_RANGE",
      "رقم الصفحة أقل من 1",
    );
  }

  // ── page_size (optional, default 20, max 50) ──────────────────────────────
  const pageSizeRaw = parsePositiveInt(
    query.page_size,
    "SEARCH_PAGE_SIZE_INVALID",
    "حجم الصفحة غير صالح",
  );
  const pageSize = pageSizeRaw ?? 20;
  if (pageSize < 1 || pageSize > 50) {
    throw new SearchValidationError(
      "SEARCH_PAGE_SIZE_INVALID",
      "حجم الصفحة يجب أن يكون بين 1 و 50",
    );
  }

  // ── sort (optional, default relevance) ───────────────────────────────────
  const sortRaw = requireString(
    query.sort,
    "SEARCH_SORT_INVALID",
    "قيمة sort غير صالحة",
  );
  const sort = sortRaw ?? "relevance";
  if (!SORTS.has(sort)) {
    throw new SearchValidationError(
      "SEARCH_SORT_INVALID",
      `ترتيب غير معروف: ${sort}`,
    );
  }

  return {
    q: normalized.normalized,
    locale: locale as "ar" | "en",
    categorySlug,
    page,
    pageSize,
    sort: sort as "relevance" | "price_asc" | "price_desc" | "newest",
  };
}
