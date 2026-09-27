/**
 * @wasla/billing-service/pg — محوِّلاتُ Postgres للمُرحِّلِ ومُطبِّقُ العقد (M5-17Q · CLM-0376).
 *
 * سطحٌ منفصلٌ عن `.` لأنَّ الجذرَ مجالٌ ومنافذُ بلا `pg`. يُستهلَكُ من جذرِ التركيبِ
 * (`http/server.ts`) ومن بوّابةِ `packages/billing-e2e` التي تُثبِتُ المُرحِّلَ على
 * صفوفٍ يكتبُها منتِجُ التوصيلِ الحقيقيُّ — فالبوّابةُ تُركِّبُ ما يُركِّبُهُ الإنتاجُ حرفيّاً.
 */

export { applyBillingSchema, readSchemaContract } from "./db/migrate.js";
export {
  BILLING_RELAY_ADVISORY_LOCK_NAMESPACE,
  PostgresConsumedEventLedger,
  PostgresDeliveryEventSource,
  PostgresRelayCheckpointStore,
  PostgresRelayConsumerLock,
  PostgresRelayTransactionRunner,
  PostgresStoreOrderSnapshotStore,
} from "./infrastructure/pg/relay-stores.js";
