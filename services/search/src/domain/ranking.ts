/**
 * Ranking — explained, rule-based, reproducible in tests (ADR-025 §2.4).
 *
 * No ML, no magic. The scoring ladder is:
 *   exact slug/name  >  prefix  >  fts rank  >  trigram similarity
 * Each document's score is the MAX across its matching signals, so a product
 * matching on an exact slug is not demoted by a low trigram similarity.
 */

import type { IndexedProduct } from "./model.js";
import type { NormalizedQuery } from "./query.js";

export interface RankedResult {
  readonly product: IndexedProduct;
  readonly score: number;
}

const EXACT_SCORE = 1.0;
const PREFIX_SCORE = 0.8;
const FTS_SCORE = 0.6;
const TRIGRAM_MIN = 0.1;

/**
 * Pure trigram similarity (Jaccard over character 3-grams). Used as the
 * last-resort signal and to keep the ranking explanation dependency-free in
 * unit tests. The PostgreSQL `pg_trgm` index mirrors this in the schema.
 */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const g of ta) if (tb.has(g)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  const padded = ` ${s} `;
  for (let i = 0; i + 3 <= padded.length; i += 1) {
    out.add(padded.slice(i, i + 3));
  }
  return out;
}

export function rankProduct(
  product: IndexedProduct,
  nq: NormalizedQuery,
): RankedResult {
  const ar = product.title_ar.toLowerCase();
  const en = (product.title_en ?? product.title_ar).toLowerCase();
  const slug = product.product_slug.toLowerCase();
  const q = nq.normalized;

  // exact full match on slug or title
  if (slug === q || ar === q || en === q) {
    return { product, score: EXACT_SCORE };
  }
  // prefix match on slug or title
  if (q.length >= 2 && (slug.startsWith(q) || ar.startsWith(q) || en.startsWith(q))) {
    return { product, score: PREFIX_SCORE };
  }
  // all query terms appear as substrings (fts proxy)
  const allTermsPresent = nq.terms.every((t) => ar.includes(t) || en.includes(t) || slug.includes(t));
  if (allTermsPresent && nq.terms.length > 0) {
    return { product, score: FTS_SCORE };
  }
  // trigram fallback — take best similarity across fields
  const sim = Math.max(
    trigramSimilarity(q, ar),
    trigramSimilarity(q, en),
    trigramSimilarity(q, slug),
  );
  // clamp to (TRIGRAM_MIN, FTS_SCORE)
  const score = sim > 0 ? Math.min(Math.max(sim, TRIGRAM_MIN), FTS_SCORE - 0.01) : 0;
  return { product, score };
}

export function rankAndSort(
  products: readonly IndexedProduct[],
  nq: NormalizedQuery,
): readonly RankedResult[] {
  return products
    .map((p) => rankProduct(p, nq))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}
