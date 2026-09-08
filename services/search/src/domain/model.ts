/**
 * Search service domain model (Phase 12).
 *
 * Bilingual search result + indexed document shapes. The indexed document is a
 * DERIVED READ MODEL (ADR-025): visibility is rebuilt from consumed marketplace
 * state (ADR-016 decision 3), never stored as a flag.
 */

export interface Locale {
  readonly locale: "ar" | "en";
}

export const DEFAULT_LOCALE: Locale = { locale: "ar" };

export interface IndexedProduct {
  readonly product_id: string;
  readonly store_id: string;
  readonly store_slug: string;
  readonly product_slug: string;
  readonly category_id: string;
  readonly title_ar: string;
  readonly title_en: string | null;
  /** Integer halalas. Catalog datum, NOT a transaction (ADR-016 decision 4). */
  readonly price_minor_units: number;
  readonly currency_code: "SAR";
}

export interface SearchResult {
  readonly product_id: string;
  readonly store_id: string;
  readonly store_slug: string;
  readonly product_slug: string;
  readonly title_ar: string;
  readonly title_en: string | null;
  readonly price_minor_units: number;
  readonly currency_code: "SAR";
  readonly category_id: string;
  /** Explained match score 0..1. exact > prefix > fts > trigram. */
  readonly score: number;
}

export interface SearchPage {
  readonly items: readonly SearchResult[];
  readonly page: number;
  readonly page_size: number;
  readonly total: number;
}
