/**
 * سطحُ طبقةِ الاستمرارية (Phase 10 · المراجعة 3/6) — مُصدَّرٌ في مسارٍ منفصل `./db`.
 *
 * ولمَ لا يُصدَّر من `src/index.ts`؟ لأنّ الجذرَ سطحُ **المجال**: من استورد الخدمةَ ليحسب
 * حالةً أو يقرأ خطّةً لا يجب أن يجرّ معه `pg` و`drizzle-orm`. والفصلُ في `exports` هو ما
 * يجعل هذا حدّاً محروساً لا نصيحةً: `purity.test.ts` يُثبت أنّ ملفاتِ القاعدةِ هي هذه
 * **بالاسم** ولا غيرُها يعرف مُشغّلاً.
 */

export { createSubscriptionDb, type Db, type DbOrTx, type SubscriptionDbConfig } from "./client.js";
export {
  SCHEMA_CONTRACT_PATH,
  applySubscriptionSchema,
  migrateSubscriptions,
  readSchemaContract,
  seedPlanCatalog,
} from "./migrate.js";
export {
  PostgresSubscriptionLedger,
  TRANSLATED_CONSTRAINTS,
  toPeriod,
  type LedgerTrace,
  type TransitionRecord,
} from "./repository.js";
export {
  MAX_TRANSITION_ATTEMPTS,
  SubscriptionUnitOfWork,
  bindStores,
  type SubscriptionStores,
  type TransactionProbe,
  type UnitOfWorkContext,
} from "./unit-of-work.js";
export { NOT_MIRRORED_TABLES } from "./schema.js";
export * as subscriptionSchema from "./schema.js";
