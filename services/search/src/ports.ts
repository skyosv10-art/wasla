/**
 * Relay infrastructure ports (ADR-025 §2.3). The relay depends on these
 * abstractions, not on marketplace internals or a specific DB driver:
 *
 *  - `MarketplaceEventSource`: reads `marketplace_outbox` rows AFTER a
 *    checkpoint offset. The relay never writes to `marketplace_outbox`
 *    (no `markPublished`) — GAP-3: progress is owned by search.
 *  - `CatalogReadPort`: the SANCTIONED read port for catalog data
 *    (GET /products/{productId}). Events carry no title/price (ADR-016
 *    decisions 4 & 10); the relay fetches them here when a product becomes
 *    visible. Tested with a fake in unit tests; HTTP adapter in prod.
 *  - `ProjectionStore`: writes search-owned projection state + index docs +
 *    consumed-event ledger + checkpoint. Idempotent upserts everywhere.
 */

import type { MarketplaceOutboxRow, RelayCheckpoint, CatalogProduct, ConsumedStatus } from "./domain/consumed-events.js";
import type { StoreProjection, ProductProjection } from "./domain/projector.js";
import type { SearchPage } from "./domain/model.js";
import type { SearchDeadLetterLedger, SearchDeadLetterMetric } from "./domain/relay-dead-letters.js";
import type { SearchRequeueDecision } from "./domain/relay-requeue.js";
import type { SearchAcknowledgementDecision } from "./domain/relay-acknowledgement.js";

export interface MarketplaceEventSource {
  /** Read up to `limit` outbox rows strictly after the checkpoint (or from zero). */
  readAfter(checkpoint: RelayCheckpoint | null, limit: number): Promise<readonly MarketplaceOutboxRow[]>;
}

export interface CatalogReadPort {
  /** Fetch the catalog datum for a product (title/price/sku/category). */
  getProduct(productId: string): Promise<CatalogProduct | null>;
}

/**
 * Store names as marketplace owns them (G-S9.7 · ADR-025 §6.2) — fetched
 * through the SIGNED read port (GET /stores/{storeSlug}) when a store is
 * approved. Only what the store-name read model needs: no owner, no review
 * history, no staff, no internal timestamps cross into search.
 */
export interface CatalogStore {
  readonly store_id: string;
  readonly store_slug: string;
  readonly title_ar: string;
  readonly title_en: string | null;
  readonly title_ur: string | null;
}

export interface StoreCatalogReadPort {
  /** Fetch a store's names; null when marketplace answers 404. */
  getStore(storeSlug: string): Promise<CatalogStore | null>;
}

export interface ProjectionStore {
  /**
   * G-S9.20 · CLM-0655 — consumer-level mutual exclusion. Runs `fn` while this
   * caller holds the exclusive lock for `consumerId` and always releases it.
   * A second relay instance on the same consumer waits until the first batch
   * ends (bounded by `batchSize`), then reads the advanced checkpoint — the
   * same design as delivery's relay (M5-13R · relay-advisory-lock.ts).
   * Required on every store so `runRelayBatch` can never run unexcluded.
   */
  withConsumerLock<T>(consumerId: string, fn: () => Promise<T>): Promise<T>;

  getCheckpoint(consumerId: string): Promise<RelayCheckpoint | null>;
  writeCheckpoint(consumerId: string, checkpoint: RelayCheckpoint): Promise<void>;

  getStoreProjection(storeId: string): Promise<StoreProjection | null>;
  getProductProjection(productId: string): Promise<ProductProjection | null>;

  upsertStoreState(row: StoreProjection): Promise<void>;
  upsertProductState(row: ProductProjection): Promise<void>;

  hasIndexDoc(productId: string): Promise<boolean>;
  upsertIndexDoc(catalog: CatalogProduct, projection: ProductProjection, storeState: string): Promise<void>;
  refreshProductStateColumns(productId: string, projection: ProductProjection): Promise<void>;
  updateStoreStateOnDocs(storeId: string, storeState: string): Promise<void>;
  archiveProductDoc(productId: string, archivedAt: string): Promise<void>;

  // ── store-name read model (G-S9.7 · ADR-025 §6) ──
  hasStoreDoc(storeId: string): Promise<boolean>;
  /** Idempotent upsert; normalized name columns are computed by the store. */
  upsertStoreDoc(store: CatalogStore): Promise<void>;

  /** Idempotency ledger: returns the consumed record if already seen. */
  getConsumed(outboxId: string): Promise<{ status: ConsumedStatus; attempt_count: number } | null>;
  markConsumed(outboxId: string, row: Pick<MarketplaceOutboxRow, "event_type" | "aggregate_type" | "aggregate_id">, status: ConsumedStatus, attemptCount: number, lastError?: string | null): Promise<void>;

  /** Full rebuild: clear index, projection state, consumed ledger, checkpoint. */
  clearAll(): Promise<void>;
}

/**
 * Read-side port — query the DERIVED read model (`search_product_index`).
 *
 * This is the query boundary the HTTP layer depends on (ADR-025 §2.4). It reads
 * ONLY search-owned tables — never JOINs marketplace tables directly (the limit
 * from ADR-016 decision 9 / ADR-025 §2.3). Visibility is rebuilt by a WHERE on the
 * four consumed-state columns, never a stored flag.
 *
 * Implementations:
 *  - `SearchIndexReader` (infrastructure, pg Pool) — production, integration-tested.
 *  - a fake in `http-app.test.ts` — unit, no DB.
 *
 * Throws `SearchUnavailableError` (SEARCH_INDEX_DEGRADED / SEARCH_INTERNAL_ERROR)
 * when the read model is degraded or the query fails — the HTTP error handler
 * maps that to 503.
 */
export type SearchSort = "relevance" | "price_asc" | "price_desc" | "newest";

export interface SearchProductsQuery {
  /** Normalized query text (whitespace-collapsed, diacritics stripped, lower-cased). */
  readonly q: string;
  readonly locale: "ar" | "en";
  /** Optional category filter (verbatim from the request — not fabricated here). */
  readonly categorySlug: string | null;
  /** 1-based page. */
  readonly page: number;
  readonly pageSize: number;
  readonly sort: SearchSort;
}

export interface SearchStoresQuery {
  /** Normalized + folded (normalizeStoreName). */
  readonly q: string;
  readonly locale: "ar" | "en" | "ur";
  readonly page: number;
  readonly pageSize: number;
}

export interface StoreSearchItem {
  readonly store_slug: string;
  readonly title: string;
  readonly category_slug: string;
}

export interface StoreSearchPage {
  readonly items: readonly StoreSearchItem[];
  readonly page: number;
  readonly page_size: number;
  readonly total: number;
}

/**
 * Store-name search over the derived model (G-S9.7). Eligibility — approved
 * store with ≥1 product satisfying isProductVisible — is derived inside the
 * query from consumed state; implementations must not read a stored flag.
 */
export interface SearchStoresReadPort {
  searchStores(query: SearchStoresQuery): Promise<StoreSearchPage>;
}

export interface SearchProductsReadPort {
  /** Query the derived read model. Throws on degraded/unavailable (→ 503). */
  search(query: SearchProductsQuery): Promise<SearchPage>;
}

/**
 * Readiness probe over the derived read model (review 5/N · RISK-0030).
 *
 * Separate from `SearchProductsReadPort` on purpose: readiness must be
 * answerable WITHOUT a user query, and a search port that needs `q`, `locale`,
 * `page`… cannot answer "can I serve at all?". Implementations must be cheap
 * enough to run on every orchestrator poll.
 *
 * `probe()` reports reachability; it MUST NOT throw for a merely degraded index —
 * it returns `index_reachable: false` so the HTTP layer owns the status code.
 */
export interface SearchIndexHealth {
  /** True only when the read model answered a query in this call. */
  readonly index_reachable: boolean;
  /** Documents currently in the index; `null` when unknown (unreachable). */
  readonly indexed_documents: number | null;
}

export interface SearchIndexHealthPort {
  probe(): Promise<SearchIndexHealth>;
}

/**
 * قراءةُ مقياسِ المسمومِ في دفترِ استهلاكِ المُرحِّلِ (فجوةُ `G5` · `CLM-0247`).
 *
 * منفذٌ **للقراءةِ وحدَها** بقصدٍ: مسارُ المقياسِ لا يُغيِّرُ صفّاً، وجمعُ
 * الكتابةِ إليهِ كانَ سيجعلُ مسارَ قراءةٍ يملكُ صلاحيّةَ تعديلٍ لا يحتاجُها.
 * وموجتا «اليدِ» و«الإقرارِ» تُضيفانِ منفذَيهما، ولا تُوسِّعانِ هذا.
 *
 * **ولا قيمةَ افتراضيّةَ ولا منفذٌ صامتٌ**: حدُّ HTTP يُجيبُ خطأً حينَ لا منفذَ
 * مُركَّبٌ ولا يُجيبُ صفراً — «لا أدري» ليسَ «لا مسمومَ».
 */
export interface SearchDeadLetterReadPort {
  readSearchDeadLetters(query: { readonly eventTypeLimit: number }): Promise<SearchDeadLetterMetric>;
}

/**
 * إعادةُ صفٍّ مسمومٍ إلى الطابورِ (فجوةُ `G5` · موجةُ **اليدِ** · `CLM-0248`).
 *
 * منفذٌ **مستقلٌّ** عن `SearchDeadLetterReadPort` لا توسيعٌ لهُ: مسارُ القياسِ
 * يقرأُ ولا يكتبُ، وجمعُهما كانَ سيُعطي مسارَ قراءةٍ صلاحيّةَ تعديلٍ لا
 * يحتاجُها — ويجعلُ كلَّ مُنفِّذِ قراءةٍ (اختباراً كانَ أو معواناً) مُلزَماً
 * بكتابةٍ لا يملكُها.
 *
 * ويُعيدُ **قراراً** لا `boolean`: «لا صفَّ» و«صفٌّ ليسَ مسموماً» حكمانِ
 * مختلفانِ، وطيُّهما في `false` كانَ يجعلُ المُشغِّلَ يظنُّ مُعرِّفَهُ خطأً وهوَ
 * صحيحٌ.
 */
export interface SearchRelayRequeuePort {
  requeuePoisonedEvent(cmd: {
    readonly ledger: SearchDeadLetterLedger;
    readonly outboxId: string;
  }): Promise<SearchRequeueDecision>;
}

/**
 * إقرارُ صفٍّ مسمومٍ (فجوةُ `G5` · موجةُ **المحضرِ** · `CLM-0249`).
 *
 * منفذٌ **رابعٌ مستقلٌّ** لا توسيعٌ لمنفذِ الإعادةِ: الإعادةُ تُغيِّرُ حالةَ
 * صفٍّ وتُرجِعُ نقطةَ تقدُّمٍ، والإقرارُ لا يمسُّ واحدةً منهما بل يُضيفُ شهادةً.
 * وجمعُهما كانَ يجعلُ كلَّ مَن يُؤذَنُ لهُ أن يُقِرَّ يملكُ يداً على التيّارِ.
 *
 * و`acknowledgedBy` **يُمرَّرُ مُركَّباً** من الحدِّ HTTP لا يُقرأُ هنا من جسمٍ:
 * مصدرُهُ الهويّةُ المُثبَتةُ وحدَها، والمنفذُ لا يعرِفُ عن HTTP شيئاً فلا يستطيعُ
 * تركيبَهُ بنفسِهِ.
 */
export interface SearchRelayAcknowledgementPort {
  acknowledgePoisonedEvent(cmd: {
    readonly ledger: SearchDeadLetterLedger;
    readonly outboxId: string;
    readonly acknowledgedBy: string;
    readonly reason: string;
    readonly acknowledgedAt: Date;
  }): Promise<SearchAcknowledgementDecision>;
}
