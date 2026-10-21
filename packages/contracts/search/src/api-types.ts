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
  "/search/stores": {
    get: operations["searchStores"];
  };
  "/search/health": {
    get: operations["health"];
  };
  "/search/ready": {
    get: operations["ready"];
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
      /**
       * عددُ المطابقاتِ **كلِّها** — تحسبُه القاعدةُ قبلَ التحديدِ (`count(*) OVER ()`)،
       * فليس عددَ ما التُقِطَ للترتيبِ ولا عددَ عناصرِ الصفحةِ. وعمقُ الترقيمِ محدودٌ
       * بنافذةِ ترتيبٍ، وما تجاوزَها يُرَدُّ `SEARCH_PAGE_OUT_OF_RANGE` لا يُخدَمُ مقصوصاً.
       */
      total: number;
    };
    /** لغاتُ اسمِ المتجرِ الثلاثُ (ADR-025 §6.4). ar الافتراضيُّ والرجوعُ. */
    StoreSearchLocale:
      | "ar"
      | "en"
      | "ur";
    /**
     * الإسقاطُ العامُّ لمتجرٍ في نتيجةِ البحثِ — **هذه الحقولُ الثلاثةُ وحدَها**
     * (`additionalProperties: false`): لا owner_public_id ولا حالةٌ ولا توقيتاتٌ.
     */
    StoreSearchResult: {
      store_slug: string;
      /** الاسمُ بلغةِ locale، أو العربيّةُ إن غابَ. */
      title: string;
      category_slug: string;
    };
    StoreSearchPage: {
      items: components["schemas"]["StoreSearchResult"][];
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
  /**
   * بحثُ المتاجرِ بالاسمِ (G-S9.7 · ADR-025 §6). المتجرُ يظهرُ إن وفقط إن كانَ
   * approved وله منتجٌ ظاهرٌ واحدٌ على الأقلِّ؛ أيُّ معاملٍ غيرِ هذه الأربعةِ يُرفَضُ.
   */
  searchStores: {
    parameters: {
      query: {
        /** 1..200 محرفٍ بعدَ القصِّ، وغيرُ فارغٍ بعدَ التطبيعِ (CLM-0652). */
        q: string;
        locale?: components["schemas"]["StoreSearchLocale"];
        /** عددٌ صحيحٌ ≥ 1 بلا حدٍّ أعلى · الافتراضيُّ 1 (CLM-0652). */
        page?: number;
        /** 1..50 · الافتراضيُّ 20 (CLM-0652). */
        page_size?: number;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": components["schemas"]["StoreSearchPage"];
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
  /** نبضةُ حياةٍ: لا تبعيّةَ ولا سؤالَ للفهرسِ. لا تُستعمَلُ للتوجيهِ. */
  health: {
    responses: {
      200: {
        content: {
          "application/json": { status: "ok" };
        };
      };
    };
  };
  /**
   * مسبارُ جاهزيّةٍ: يلمسُ نموذجَ القراءةِ فعلاً. `503` حينَ لا يُجيبُ الفهرسُ أو حينَ
   * لا مسبارَ مُركَّبٌ — لا جاهزيّةَ افتراضاً بلا إثباتٍ. وفهرسٌ فارغٌ **جاهزٌ**.
   */
  ready: {
    responses: {
      200: {
        content: {
          "application/json": {
            status: "ready";
            index_reachable: true;
            /** عيّنةٌ محدودةٌ لا عدٌّ كاملٌ — المسبارُ يجري كلَّ نبضةٍ. */
            indexed_documents: number;
          };
        };
      };
      503: {
        content: {
          "application/json": components["schemas"]["ErrorResponse"];
        };
      };
    };
  };
}
