/**
 * Query normalization — the bilingual search entry point (ADR-025 §2.4).
 *
 * "الكترونيات" and "electronics" and "إلكترونيات" must find the same products.
 * Normalization is RULE-BASED and testable, not magical. The gap between
 * "normalizes and tokenizes" and "understands Arabic" is declared in ADR-025
 * and TASK_LOG — full stemming/relevance is a later gate.
 *
 * Principles:
 * - Arabic diacritics (tashkeel) and tatweel are stripped.
 * - Common Arabic-English transliteration variants are NOT attempted here —
 *   trigram fallback in the schema handles approximate matching instead.
 * - Case-insensitive, whitespace-collapsed, trimmed.
 * - Empty result after normalization => invalid query (caller rejects).
 */

const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;

export interface NormalizedQuery {
  readonly original: string;
  readonly normalized: string;
  readonly terms: readonly string[];
}

export function normalizeQuery(raw: string): NormalizedQuery {
  const original = raw;
  // 1. Strip Arabic diacritics + tatweel, normalize whitespace, trim, lower-case.
  let s = raw.replace(ARABIC_DIACRITICS, "");
  s = s.replace(/\s+/g, " ").trim().toLowerCase();
  // 2. Tokenize on whitespace. Empty terms => empty normalized.
  const terms = s.length > 0 ? s.split(" ").filter((t) => t.length > 0) : [];
  return {
    original,
    normalized: s,
    terms,
  };
}

export function isBlankQuery(nq: NormalizedQuery): boolean {
  return nq.terms.length === 0;
}

/** Max query length (matches OpenAPI maxLength 200). */
export const MAX_QUERY_LENGTH = 200;

export function isQueryTooLong(raw: string): boolean {
  return raw.length > MAX_QUERY_LENGTH;
}
