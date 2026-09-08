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
 *    `sku`) + optional category filter.
 * 2. Domain `rankProduct` scores every candidate with the explained ladder
 *    (exact > prefix > fts > trigram) — the SAME tested rules unit tests cover,
 *    so SQL matching and domain scoring cannot drift on intent.
 *
 * ## `total` is exact, and depth is refused out loud (review 5/N · RISK-0029)
 *
 * The previous version bounded the query by `LIMIT 500` and then reported
 * `total = candidates.length`. On 2000 matching documents it answered
 * `total = 500` — the cap truncated the COUNT, not just the page, so a client
 * paginating on that number was paginating on a lie. Two changes close it:
 *
 *  - **`count(*) OVER ()`** is computed by PostgreSQL over the FULL match set
 *    BEFORE `LIMIT`, so `total` is the exact number of visible matching
 *    documents no matter how large the corpus is.
 *  - **The cap became a declared ranking window** (`DEFAULT_RANKING_WINDOW`,
 *    constructor-overridable). Global relevance ordering is only honest for the
 *    rows actually scored; so a page whose last row would fall OUTSIDE the
 *    window is REFUSED with `SEARCH_PAGE_OUT_OF_RANGE` (400) instead of being
 *    served from a silently truncated set. Deep pagination is a bounded feature,
 *    not an accidental one (the same choice Elasticsearch makes with
 *    `max_result_window`).
 *
 * ## Who decides membership, and who decides order
 *
 * The SQL predicate decides **who matches** (that is what `count(*) OVER ()`
 * counts); the domain ladder decides **the order** and the reported `score`.
 * The reader therefore scores candidates WITHOUT dropping any — dropping a
 * zero-score row here would make `items` and `total` disagree by construction.
 * The exit gate measures that the two authorities agree on a real corpus rather
 * than assuming it.
 *
 * Non-relevance sorts (price_asc / price_desc / newest) order the matched
 * candidates directly; each item still carries its relevance score so the
 * `score` field is meaningful regardless of ordering.
 */

import type { Pool, QueryResultRow } from "pg";

import type { SearchProductsQuery, SearchProductsReadPort } from "../ports.js";
import type { SearchPage, SearchResult, IndexedProduct } from "../domain/model.js";
import { normalizeQuery } from "../domain/query.js";
import { rankProduct } from "../domain/ranking.js";
import { SearchUnavailableError, SearchValidationError } from "../http/errors.js";

/**
 * Default ranking window — the maximum number of matching rows that are pulled
 * out of PostgreSQL and scored by the domain ladder for one request. It bounds
 * WORK, not TRUTH: `total` is counted over the full match set regardless of it
 * (see file header). Raised from the v1 cap of 500 and made overridable so a
 * deployment can trade memory for depth without editing code.
 */
export const DEFAULT_RANKING_WINDOW = 5000;

export interface SearchIndexReaderOptions {
  /** Override the ranking window (must be >= 1). */
  readonly rankingWindow?: number;
}

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
  private readonly rankingWindow: number;

  constructor(
    private readonly pool: Pool,
    options: SearchIndexReaderOptions = {},
  ) {
    const window = options.rankingWindow ?? DEFAULT_RANKING_WINDOW;
    if (!Number.isInteger(window) || window < 1) {
      throw new RangeError("rankingWindow must be a positive integer");
    }
    this.rankingWindow = window;
  }

  async search(query: SearchProductsQuery): Promise<SearchPage> {
    const offset = (query.page - 1) * query.pageSize;
    // Refuse depth BEFORE touching the database: a page that ends beyond the
    // ranking window cannot be ordered honestly, so it is an out-of-range page,
    // not a page served from a truncated set (RISK-0029).
    if (offset + query.pageSize > this.rankingWindow) {
      throw new SearchValidationError(
        "SEARCH_PAGE_OUT_OF_RANGE",
        `الترقيمُ العميقُ محدودٌ بنافذةِ ترتيبٍ قدرُها ${this.rankingWindow} نتيجةً`,
      );
    }

    const categoryFilter =
      query.categorySlug !== null ? " AND category_slug = $2" : "";

    // `count(*) OVER ()` is evaluated over the whole match set BEFORE LIMIT —
    // this is what makes `total` exact rather than capped.
    const sql = `
      SELECT ${SELECT_COLUMNS}, count(*) OVER () AS match_total
      FROM search_product_index
      WHERE ${VISIBILITY_WHERE}
        AND (${MATCH_SQL})
        ${categoryFilter}
      LIMIT ${this.rankingWindow}
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

    // Exact, uncapped: PostgreSQL counted the whole match set. With zero rows
    // there is no window value to read, and zero is the truthful answer.
    const total = rows.length > 0 ? Number(rows[0].match_total) : 0;
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
 * Apply the requested sort. Every matched candidate is kept in ALL sorts: the
 * SQL predicate decided membership, so dropping a zero-score row here would make
 * `items` disagree with the exact `total` (see file header). For `relevance` the
 * domain ladder supplies the order; other sorts order by their dimension while
 * still carrying the ladder score in `score`.
 */
function rankBySort(
  candidates: ReaderRow[],
  query: SearchProductsQuery,
): SearchResult[] {
  const nq = normalizeQuery(query.q);

  const scored = candidates.map((product) => ({
    product,
    score: rankProduct(product, nq).score,
  }));

  if (query.sort === "relevance") {
    // Stable within equal scores: product_id breaks ties so two identical
    // requests cannot return two different orders (pagination depends on it).
    scored.sort(
      (a, b) =>
        b.score - a.score ||
        a.product.product_id.localeCompare(b.product.product_id),
    );
  } else if (query.sort === "price_asc") {
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
