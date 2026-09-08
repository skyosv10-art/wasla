/**
 * Search service domain model (Phase 12).
 *
 * Bilingual search result + indexed document shapes. The indexed document is a
 * DERIVED READ MODEL (ADR-025): visibility is rebuilt from consumed marketplace
 * state (ADR-016 decision 3), never stored as a flag. The relay maintains
 * projection state tables (`search_marketplace_*_state`) as the source of the
 * consumed state; `search_product_index` is the denormalized searchable doc.
 */

export interface Locale {
  readonly locale: "ar" | "en";
}

export const DEFAULT_LOCALE: Locale = { locale: "ar" };

/**
 * The searchable document. State columns are the SAME ones the visibility
 * predicate filters on at query time (ADR-025 §2.2), so a doc whose state
 * changed is hidden by the WHERE clause without a delete. `sku` and
 * `category_slug` come from the catalog read port (GET /products/{productId}),
 * never fabricated here.
 */
export interface IndexedProduct {
  readonly product_id: string;
  readonly store_id: string;
  readonly store_slug: string;
  readonly sku: string;
  readonly category_slug: string;
  readonly title_ar: string;
  readonly title_en: string | null;
  /** Integer halalas. Catalog datum, NOT a transaction (ADR-016 decision 4). */
  readonly price_minor_units: number;
  readonly currency_code: "SAR";
  readonly store_state: string;
  readonly product_state: string;
  readonly moderation_state: string;
  readonly quantity_on_hand: number;
}

export interface SearchResult {
  readonly product_id: string;
  readonly store_id: string;
  readonly store_slug: string;
  readonly sku: string;
  readonly title_ar: string;
  readonly title_en: string | null;
  readonly price_minor_units: number;
  readonly currency_code: "SAR";
  readonly category_slug: string;
  /** Explained match score 0..1. exact > prefix > fts > trigram. */
  readonly score: number;
}

export interface SearchPage {
  readonly items: readonly SearchResult[];
  readonly page: number;
  readonly page_size: number;
  readonly total: number;
}
