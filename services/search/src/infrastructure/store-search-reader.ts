/**
 * StoreSearchReader — store-name search over the derived read model
 * (G-S9.7 · CLM-0649 · ADR-025 §6). Reads ONLY search-owned tables:
 *   - `search_store_index`               (names, fetched by the signed read port)
 *   - `search_marketplace_store_state`   (consumed store state + category_slug)
 *   - `search_marketplace_product_state` (consumed product/moderation/stock state)
 * No JOIN crosses into marketplace tables; nothing here is a stored flag.
 *
 * ## Eligibility is a WHERE (ADR-025 §6.3)
 * A store is returned iff `store_state = 'approved'` AND ∃ product of that store
 * with `product_state = 'published'` ∧ `moderation_state = 'approved'` ∧
 * `quantity_on_hand > 0` ∧ `archived_at IS NULL` — `isProductVisible` with the
 * store condition already fixed by the outer predicate. Losing the last visible
 * product removes the store on the very next query; no delete needed.
 *
 * ## Matching and order (ADR-025 §6.4)
 * The query is normalized by the same `normalizeStoreName` the relay applied
 * to `name_norm_*`, then LIKE-escaped so `%`, `_` and `\` are literal. It is
 * matched against ALL name columns (ar/en/ur). Order is deterministic: the best
 * tier across names (exact 0 · prefix 1 · contains 2), then `store_slug` ASC.
 * `total` is `count(*) OVER ()` over the full match set before LIMIT.
 */

import type { Pool } from "pg";

import type { SearchStoresQuery, SearchStoresReadPort, StoreSearchPage } from "../ports.js";
import { escapeLike, localizedTitle } from "../domain/store-search.js";

/** Exported for the mutation checks: each clause is load-bearing and tested. */
export const STORE_ELIGIBILITY_SQL = `ss.store_state = 'approved'
     AND EXISTS (
       SELECT 1 FROM search_marketplace_product_state p
        WHERE p.store_id = si.store_id
          AND p.product_state = 'published'
          AND p.moderation_state = 'approved'
          AND p.quantity_on_hand > 0
          AND p.archived_at IS NULL
     )`;

const NAME_COLUMNS = ["si.name_norm_ar", "si.name_norm_en", "si.name_norm_ur"] as const;

export function buildStoreSearchSql(eligibility: string = STORE_ELIGIBILITY_SQL): string {
  const any = (op: string, param: string): string =>
    NAME_COLUMNS.map((c) => `${c} ${op} ${param}${op === "LIKE" ? " ESCAPE '\\'" : ""}`).join(" OR ");
  return `SELECT si.store_slug, ss.category_slug, si.title_ar, si.title_en, si.title_ur,
            CASE WHEN ${any("=", "$3")} THEN 0
                 WHEN ${any("LIKE", "$2")} THEN 1
                 ELSE 2 END AS tier,
            count(*) OVER () AS total
       FROM search_store_index si
       JOIN search_marketplace_store_state ss ON ss.store_id = si.store_id
      WHERE ${eligibility}
        AND (${any("LIKE", "$1")})
      ORDER BY tier ASC, si.store_slug ASC
      LIMIT $4 OFFSET ($5::bigint - 1) * $4::bigint`;
}

/** Count over the same predicate — used only when the page lies past the last match. */
export function buildStoreCountSql(eligibility: string = STORE_ELIGIBILITY_SQL): string {
  const like = NAME_COLUMNS.map((c) => `${c} LIKE $1 ESCAPE '\\'`).join(" OR ");
  return `SELECT count(*) AS total
       FROM search_store_index si
       JOIN search_marketplace_store_state ss ON ss.store_id = si.store_id
      WHERE ${eligibility}
        AND (${like})`;
}

interface Row {
  store_slug: string;
  category_slug: string;
  title_ar: string;
  title_en: string | null;
  title_ur: string | null;
  tier: number;
  total: string | number;
}

export class StoreSearchReader implements SearchStoresReadPort {
  private readonly sql: string;
  private readonly countSql: string;

  constructor(
    private readonly pool: Pick<Pool, "query">,
    opts: { readonly escape?: (s: string) => string; readonly eligibilitySql?: string } = {},
  ) {
    this.escape = opts.escape ?? escapeLike;
    this.sql = buildStoreSearchSql(opts.eligibilitySql);
    this.countSql = buildStoreCountSql(opts.eligibilitySql);
  }

  /** Overridable only so mutation checks can prove escaping is load-bearing. */
  private readonly escape: (s: string) => string;

  async searchStores(query: SearchStoresQuery): Promise<StoreSearchPage> {
    const esc = this.escape(query.q);
    const r = await this.pool.query<Row>(this.sql, [
      `%${esc}%`,
      `${esc}%`,
      query.q,
      query.pageSize,
      // The page, not a JS-computed offset: `page` has no upper bound (CLM-0652),
      // and (page - 1) * page_size past 2^53 is not exact in a JS number. The
      // offset is computed in bigint by PostgreSQL (≤ 2^53 · 50 < 2^63).
      query.page,
    ]);
    let total = r.rows.length > 0 ? Number(r.rows[0]!.total) : 0;
    if (r.rows.length === 0 && query.page > 1) {
      // A page past the last match still reports the true total, not 0.
      const c = await this.pool.query<{ total: string }>(this.countSql, [`%${esc}%`]);
      total = Number(c.rows[0]?.total ?? 0);
    }
    return {
      items: r.rows.map((row) => ({
        store_slug: row.store_slug,
        title: localizedTitle(row, query.locale),
        category_slug: row.category_slug,
      })),
      page: query.page,
      page_size: query.pageSize,
      total,
    };
  }
}
