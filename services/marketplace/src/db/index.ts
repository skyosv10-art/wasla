/**
 * سطحُ طبقةِ الاستمراريّة (Phase 11 · المراجعة 3/6) — مُصدَّرٌ في مسارٍ منفصلٍ `./db`.
 *
 * ولمَ لا يُصدَّر من `src/index.ts`؟ لأنّ الجذرَ سطحُ **المجال**: مَن استورد الخدمةَ ليشتقّ
 * حالةً أو يحكم في ظهورِ منتجٍ لا يجب أن يجرّ معه `pg` و`drizzle-orm` ولا مسبحَ اتصالٍ لا
 * يحتاجه. والفصلُ في `exports` هو ما يجعل هذا حدّاً محروساً لا نصيحةً: `purity.test.ts` يُثبت
 * أنّ ملفاتِ القاعدةِ هي هذه **بالاسمِ** ولا غيرُها يعرف مُشغّلاً أو نظامَ ملفات.
 */

export { createMarketplaceDb, type Db, type DbOrTx, type MarketplaceDbConfig } from "./client.js";
export {
  SCHEMA_CONTRACT_PATH,
  applyMarketplaceSchema,
  readSchemaContract,
} from "./migrate.js";
export {
  SEQUENCE_RACE_CONSTRAINTS,
  TRANSLATED_CONSTRAINTS,
  constraintOf,
  isSequenceRace,
  translateConstraint,
  type TranslationContext,
} from "./constraints.js";
export { PostgresCategoryStore, type CategoryDraft } from "./categories.js";
export { PostgresMarketplaceLedger } from "./ledger.js";
export { PostgresMarketplaceProjection } from "./projection.js";
export { PostgresResourceStore } from "./resources.js";
export { PostgresStaffStore } from "./staff.js";
export {
  iso,
  toCategory,
  toInventory,
  toInventoryAdjustment,
  toProduct,
  toProductReview,
  toStore,
  toStoreReview,
  toStoreStaff,
  type CategoryRecord,
  type InventoryAdjustmentRecord,
  type InventoryRecord,
  type ProductRecord,
  type ProductReviewRecord,
  type StoreRecord,
  type StoreReviewRecord,
  type StoreStaffRecord,
} from "./rows.js";
export {
  MAX_DECISION_ATTEMPTS,
  MarketplaceUnitOfWork,
  bindStores,
  type MarketplaceStores,
  type TransactionProbe,
  type UnitOfWork,
  type UnitOfWorkContext,
} from "./unit-of-work.js";
export { NOT_MIRRORED_TABLES } from "./schema.js";
export * as marketplaceSchema from "./schema.js";
