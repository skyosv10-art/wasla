/**
 * @wasla/contracts-search — Search API types (Contract-First, ADR-004).
 *
 * Generated from services/search/contracts/api.openapi.yml via
 * `pnpm --filter @wasla/contracts-search generate`. Hand-authored here to
 * match the OpenAPI source of truth; regenerate after any OpenAPI change.
 *
 * The search index is a DERIVED READ MODEL, not a source of truth (ADR-025).
 * Visibility is rebuilt from consumed marketplace state (ADR-016 decision 3):
 * store approved · product published · moderation approved · quantity > 0.
 * No `is_visible` column is stored in the index.
 */

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

export interface paths {
  "/search/products": {
    get: operations["searchProducts"];
  };
  "/search/health": {
    get: operations["health"];
  };
}

/* ------------------------------------------------------------------ */
/* Components / Schemas                                                */
/* ------------------------------------------------------------------ */

export interface components {
  schemas: {
    Locale:
      | "ar"
      | "en";
    SearchSort:
      | "relevance"
      | "price_asc"
      | "price_desc"
      | "newest";
    SearchQuery: {
      /** نص البحث الحر (عربي/إنجليزي). يُطبَّع ويُجزَّأ قبل التنفيذ. */
      q: string;
      /** اللغة المطلوبة للنتائج. الافتراضي ar. */
      locale?: components["schemas"]["Locale"];
      /** مقطعُ التصنيفِ (filter). من أصلِ السوقِ لا يُخترَع هنا. */
      category_slug?: string;
      /** تجزئة الصفحة (1-based). الافتراضي 1. */
      page?: number;
      /** حجم الصفحة. الافتراضي 20، الحد الأعلى 50. */
      page_size?: number;
      /** ترتيب النتائج. الافتراضي relevance. */
      sort?: components["schemas"]["SearchSort"];
    };
    ProductSearchResult: {
      product_id: string;
      store_id: string;
      store_slug: string;
      /** رقمُ المنتجِ الواحدُ داخلَ متجرٍه (يأتيه من منفذِ قراءةِ الكتالوجِ). */
      sku: string;
      title_ar: string;
      title_en: string | null;
      /** سعرٌ صحيحٌ بأصغرِ وحدةٍ (هللة). بيانُ كتالوجٍ لا معاملة (ADR-016 قرار 4). */
      price_minor_units: number;
      currency_code: "SAR";
      /** مقطعُ التصنيفِ من السوقِ (منفذُ قراءةِ الكتالوجِ يُعيدهُ لا مُعرِّفُها). */
      category_slug: string;
      /** درجةُ المطابقةِ المفسَّرةُ (0..1). ليست سحراً: exact > prefix > fts > trigram. */
      score: number;
    };
    SearchPage: {
      items: components["schemas"]["ProductSearchResult"][];
      page: number;
      page_size: number;
      total: number;
    };
    ErrorResponse: {
      code: string;
      message: string;
      trace_id?: string;
    };
  };
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

export interface operations {
  searchProducts: {
    parameters: {
      query: {
        q: string;
        locale?: components["schemas"]["Locale"];
        category_slug?: string;
        page?: number;
        page_size?: number;
        sort?: components["schemas"]["SearchSort"];
      };
    };
    responses: {
      200: {
        content: {
          "application/json": components["schemas"]["SearchPage"];
        };
      };
      400: {
        content: {
          "application/json": components["schemas"]["ErrorResponse"];
        };
      };
      503: {
        content: {
          "application/json": components["schemas"]["ErrorResponse"];
        };
      };
    };
  };
  health: {
    responses: {
      200: {
        content: {
          "application/json": { status: "ok" };
        };
      };
    };
  };
}
