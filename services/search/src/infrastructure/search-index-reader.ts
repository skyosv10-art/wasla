/**
 * SearchIndexReader — the production read-side adapter (ADR-025 §2.4 / §5).
 *
 * Implements `SearchProductsReadPort` over a `pg.Pool`, reading ONLY
 * `search_product_index` (search-owned). It never JOINs marketplace tables —
 * the catalog datum was fetched by the relay via the sanctioned read port
 * (ADR-016 decision 9 / ADR-025 §2.3).
 *
 * ## Visibility is a WHERE, not a flag
 *
 * The four visibility conditions (ADR-016 decision 3) are enforced in the SQL
 * `WHERE` on the consumed-state columns — no `is_visible` is stored. A doc whose
 * state changed is hidden by the clause without a delete.
 *
 * ## Two-stage matching
 *
 * 1. SQL narrows the candidate set: visibility + text match (trigram similarity
 *    on `title_ar`, English FTS on `coalesce(title_en, title_ar)`, substring on
 *    `sku`) + optional category filter. Bounded by a candidate cap (v1: 500) — a
 *    documented limitation the relevance/load exit-gate review will revisit.
 * 2. Domain `rankAndSort` re-scores candidates with the explained ladder
 *    (exact > prefix > fts > trigram) — the SAME tested rules unit tests cover,
 *    so SQL matching and domain scoring cannot drift on intent.
 *
 * Non-relevance sorts (price_asc / price_desc / newest) order the matched
 * candidates directly; each item still carries its relevance score so the
 * `score` field is meaningful regardless of ordering. Pagination is applied
 * after scoring/sorting so `total` reflects the true result count.
 */

import type { Pool, QueryResultRow } from "pg";

import type { SearchProductsQuery, SearchProductsReadPort } from "../ports.js";
import type { SearchPage, SearchResult, IndexedProduct } from "../domain/model.js";
import { normalizeQuery } from "../domain/query.js";
import { rankAndSort } from "../domain/ranking.js";
import { SearchUnavailableError } from "../http/errors.js";

/** v1 candidate cap — see file header. */
const CANDIDATE_CAP = 500;

const VISIBILITY_WHERE = [
  "store_state = 'approved'",
  "product_state = 'published'",
  "moderation_state = 'approved'",
  "quantity_on_hand > 0",
  "archived_at IS NULL",
].join(" AND ");

const MATCH_SQL = [
  "title_ar ILIKE '%' || $1 || '%'",
  "title_ar % $1",
  "to_tsvector('english', coalesce(title_en, title_ar)) @@ plainto_tsquery('english', $1)",
  "sku ILIKE '%' || $1 || '%'",
].join(" OR ");

const SELECT_COLUMNS = [
  "product_id",
  "store_id",
  "store_slug",
  "sku",
  "category_slug",
  "title_ar",
  "title_en",
  "price_minor_units",
  "currency_code",
  "store_state",
  "product_state",
  "moderation_state",
  "quantity_on_hand",
  "indexed_at",
].join(", ");

interface ReaderRow extends IndexedProduct {
  readonly indexed_at: Date | null;
}

export class SearchIndexReader implements SearchProductsReadPort {
  constructor(private readonly pool: Pool) {}

  async search(query: SearchProductsQuery): Promise<SearchPage> {
    const categoryFilter =
      query.categorySlug !== null ? " AND category_slug = $2" : "";

    const sql = `
      SELECT ${SELECT_COLUMNS}
      FROM search_product_index
      WHERE ${VISIBILITY_WHERE}
        AND (${MATCH_SQL})
        ${categoryFilter}
      LIMIT ${CANDIDATE_CAP}
    `;

    // $1 = q (always bound). $2 = category_slug, bound only when present.
    const params: string[] = [query.q];
    if (query.categorySlug !== null) params.push(query.categorySlug);

    let rows: QueryResultRow[];
    try {
      const result = await this.pool.query(sql, params);
      rows = result.rows;
    } catch {
      throw new SearchUnavailableError(
        "SEARCH_INDEX_DEGRADED",
        "تعذّرَ الاستعلامُ من الفهرس",
      );
    }

    const candidates: ReaderRow[] = rows.map(rowToReaderRow);
    const ranked = rankBySort(candidates, query);

    const total = ranked.length;
    const offset = (query.page - 1) * query.pageSize;
    const items = ranked.slice(offset, offset + query.pageSize);

    return {
      items,
      page: query.page,
      page_size: query.pageSize,
      total,
    };
  }
}

function rowToReaderRow(row: QueryResultRow): ReaderRow {
  return {
    product_id: String(row.product_id),
    store_id: String(row.store_id),
    store_slug: String(row.store_slug),
    sku: String(row.sku),
    category_slug: String(row.category_slug),
    title_ar: String(row.title_ar),
    title_en: row.title_en === null ? null : String(row.title_en),
    price_minor_units: Number(row.price_minor_units),
    currency_code: "SAR",
    store_state: String(row.store_state),
    product_state: String(row.product_state),
    moderation_state: String(row.moderation_state),
    quantity_on_hand: Number(row.quantity_on_hand),
    indexed_at:
      row.indexed_at === null ? null : new Date(String(row.indexed_at)),
  };
}

/**
 * Apply the requested sort. For `relevance`, the domain ladder scores and
 * filters (score > 0). For other sorts, all matched candidates are kept and
 * ordered by the requested dimension — each item still carries its relevance
 * score so the `score` field is meaningful regardless of ordering.
 */
function rankBySort(
  candidates: ReaderRow[],
  query: SearchProductsQuery,
): SearchResult[] {
  const nq = normalizeQuery(query.q);

  if (query.sort === "relevance") {
    const ranked = rankAndSort(candidates, nq);
    return ranked.map((r) => toSearchResult(r.product, r.score));
  }

  const scored = candidates.map((product) => ({
    product,
    score: scoreOf(product, nq),
  }));

  if (query.sort === "price_asc") {
    scored.sort(
      (a, b) => a.product.price_minor_units - b.product.price_minor_units,
    );
  } else if (query.sort === "price_desc") {
    scored.sort(
      (a, b) => b.product.price_minor_units - a.product.price_minor_units,
    );
  } else {
    // newest — by indexed_at descending (nulls last).
    scored.sort((a, b) =>
      compareDesc(a.product.indexed_at, b.product.indexed_at),
    );
  }

  return scored.map((s) => toSearchResult(s.product, s.score));
}

function compareDesc(a: Date | null, b: Date | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b.getTime() - a.getTime();
}

/** Reuse the domain ladder to assign a single product's score. */
function scoreOf(
  product: IndexedProduct,
  nq: ReturnType<typeof normalizeQuery>,
): number {
  const ranked = rankAndSort([product], nq);
  return ranked.length > 0 ? ranked[0].score : 0;
}

function toSearchResult(
  product: IndexedProduct,
  score: number,
): SearchResult {
  return {
    product_id: product.product_id,
    store_id: product.store_id,
    store_slug: product.store_slug,
    sku: product.sku,
    title_ar: product.title_ar,
    title_en: product.title_en,
    price_minor_units: product.price_minor_units,
    currency_code: product.currency_code,
    category_slug: product.category_slug,
    score,
  };
}
