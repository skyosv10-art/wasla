/**
 * برميلُ طبقةِ التطبيق — الحدُّ الذي تراه `http/` ولا تتجاوزه.
 *
 * `http/` تستورد من هنا ولا تستورد `../db/` ولا `drizzle` ولا `pg`. والفصلُ مفحوصٌ في
 * `purity.test.ts` بقائمةِ `DB_AWARE_FILES`: مسارٌ يستورد مخزناً مباشرةً يُسقط الاختبارَ باسمه،
 * لا يُنبَّه عليه في مراجعةٍ قد تُنسى.
 */

export {
  MARKETPLACE_ROUTE_KEYS,
  loadCategoryFacts,
  loadProductById,
  loadStoreBySlug,
  type MarketplaceServiceDeps,
} from "./context.js";
export {
  CURSOR_MAX_LENGTH,
  decodeCompositeCursor,
  decodeSequenceCursor,
  encodeCompositeCursor,
  encodeSequenceCursor,
  type CompositeCursor,
} from "./cursor.js";
export {
  ReplayedResponse,
  fingerprint,
  isReplayedResponse,
  rememberOutcome,
  replayGuard,
  type IdempotencyEnvelope,
  type IdempotencyReadPort,
  type IdempotencyRememberPort,
  type StoredIdempotentResponse,
} from "./idempotency.js";
export { systemClock } from "./runtime.js";
export {
  MarketplaceStoreService,
  type AddStaffInput,
  type ListStoresQuery,
  type OpaquePage,
  type RegisterStoreInput,
  type StoreDecisionInput,
  type StoreDecisionOutcome,
} from "./stores.js";
export {
  MarketplaceProductService,
  type AdjustInventoryInput,
  type CreateProductInput,
  type InventoryAdjustmentOutcome,
  type InventoryView,
  type ListProductsQuery,
  type ProductDecisionInput,
  type ProductDecisionOutcome,
  type ProductView,
} from "./products.js";
export {
  MarketplaceCatalogService,
  type MarketplaceHealth,
} from "./catalog.js";
