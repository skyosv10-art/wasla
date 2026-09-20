/**
 * مرآةُ Drizzle لعقدِ PostgreSQL في خدمةِ البحثِ — **الجداولُ الستّةُ كلُّها**، بأسمائِها
 * وأنواعِها وإلزامِها وقيودِها وفهارسِها البُنيويّةِ (btree).
 *
 * ## هذا الملفُّ مرآةٌ لا مصدر
 *
 * الحقيقةُ في `services/search/contracts/schema.sql`، وهو نفسُهُ ما يُطبَّقُ على القاعدةِ
 * (`applySearchSchema` في `migrate.ts`) وما يُطبِّقُهُ مُراقبُ الاختبارِ (`__tests__/pg-harness.ts`).
 * ولا يُنشئُ هذا الملفُّ جدولاً في أيِّ مسارِ تشغيلٍ؛ وظيفتُهُ اثنتانِ لا ثالثةَ لهما:
 *
 *   1. **إسقاطٌ آمنٌ أنواعِيّاً** يُتيحُ `drizzle-kit generate` فيُنتِجَ ترحيلاً عكوساً
 *      مُرقَّماً (ADR-024) بدلَ «طبِّقِ العقدَ كاملاً أو لا شيءَ» — فيصيرُ للبيئاتِ مسارٌ
 *      عكوسٌ لا يعتمدُ على قاعدةٍ فارغةٍ.
 *   2. **حارسُ انحرافٍ بلا قاعدةٍ**: `__tests__/schema-drift.test.ts` يُقابلُ هذه المرآةَ
 *      بنصِّ العقدِ في الاتّجاهَينِ، فيفشلُ البناءُ لا النشرُ.
 *
 * ولو صارَ توليدُ Drizzle هوَ ما يُطبَّقُ لصارَ للمخطَّطِ مصدرانِ يفترقانِ صامتَينِ. فيبقى
 * العقدُ هوَ المُطبَّقُ، ويُقاسُ **تكافؤُ** الترحيلِ المولَّدِ معَهُ في سبعةِ أبعادِ كتالوجٍ في
 * `__tests__/migrations.integration.test.ts` (سابقةُ `services/marketplace` و`services/delivery`).
 *
 * ## وما لا تُعبِّرُ عنهُ المرآةُ يُعلَنُ هنا بالحرفِ لا يُسكَتُ عنهُ
 *
 * عقدُ البحثِ يحملُ أربعةَ أشياءَ لا يملكُ `drizzle-kit` تعبيراً عنها في الإسقاطِ:
 *
 *   - `CREATE EXTENSION pg_trgm` (امتدادٌ لا كائنُ مخطَّطٍ).
 *   - فهرسانِ من نوعِ `gin`: أحدُهما على **تعبيرٍ** (`to_tsvector('english', coalesce(…))`)
 *     والآخرُ بصنفِ مُعاملاتٍ (`gin_trgm_ops`).
 *   - دالّتا `plpgsql` (`search_set_indexed_at` · `search_set_updated_at`).
 *   - أربعةُ مُطلِقاتٍ (`BEFORE UPDATE … EXECUTE FUNCTION …`).
 *
 * فهذه تُلحَقُ **بيدٍ مُعلَمةٍ صريحاً** في ذيلِ الترحيلِ المولَّدِ (`drizzle/0000_*.sql`)
 * كسابقةِ `services/customers`، ولا يُمَسُّ الإسقاطُ (`drizzle/meta/*_snapshot.json`) كي لا
 * يُنتِجَ `db:generate` التاليَ فرقاً وهميّاً. وتُعلَنُ الفهارسُ غيرُ المُمَرأةِ في
 * `NOT_MIRRORED_INDEXES` أدناهُ ليقيسَها حارسُ الانحرافِ **عدّاً لا ظنّاً**، ويُقاسُ بقاؤها
 * مطابقةً للعقدِ حرفاً في بُعدَي «الفهارسِ» و«المُطلِقاتِ» و«الدوالِّ» من اختبارِ الدورةِ.
 *
 * ## وأسماءُ القيودِ مُعلَنةٌ لا متروكةٌ للمولِّدِ
 *
 * يكتبُ العقدُ فحوصَهُ بلا أسماءٍ (`CHECK (status IN (…))`)، وPostgreSQLُ يُسمّيها عندَ
 * التطبيقِ `<table>_<column>_check`. والمولَّدُ يكتبُ ما تُعلنُهُ المرآةُ **صراحةً**، فاسمٌ
 * مخالفٌ يُنتجُ قاعدتَينِ متكافئتَينِ في المعنى مختلفتَينِ في الكتالوجِ — وهوَ ما يُسقِطُهُ
 * اختبارُ الدورةِ. وكلُّ فحوصِ هذا العقدِ أحاديّةُ العمودِ ولا يتجاوزُ أطولُ اسمٍ فيها
 * 58 حرفاً، فلا `<table>_check` ولا قصَّ إلى 63 حرفاً هنا (بخلافِ عقدِ التوصيلِ).
 */

import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/** عمودُ لحظةٍ بمنطقةٍ زمنيّةٍ — نفسُ اصطلاحِ مرآتَي السوقِ والتوصيلِ. */
const instant = (name: string) => timestamp(name, { withTimezone: true });

const STORE_STATES = "'draft','pending_review','approved','rejected','suspended','archived'";
const PRODUCT_STATES = "'draft','published','archived'";
const MODERATION_STATES = "'pending','approved','rejected'";
const CONSUMED_STATES = "'pending','applied','skipped','skipped_stale','ignored','poisoned'";

// ---------------------------------------------------------------------------
// 1) search_product_index — وثيقةُ فهرسِ المنتجِ (نموذجُ قراءةٍ مشتقٌّ)
//    لا عمودَ `is_visible`: الظهورُ مُشتقٌّ عندَ القراءةِ (ADR-025 §2.2).
// ---------------------------------------------------------------------------

export const searchProductIndex = pgTable(
  "search_product_index",
  {
    productId: uuid("product_id").primaryKey(),
    storeId: uuid("store_id").notNull(),
    storeSlug: text("store_slug").notNull(),
    sku: text("sku").notNull(),
    categorySlug: text("category_slug").notNull(),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en"),
    priceMinorUnits: integer("price_minor_units").notNull(),
    currencyCode: text("currency_code").notNull(),
    storeState: text("store_state").notNull(),
    productState: text("product_state").notNull(),
    moderationState: text("moderation_state").notNull(),
    quantityOnHand: integer("quantity_on_hand").notNull(),
    indexedAt: instant("indexed_at").notNull().defaultNow(),
    archivedAt: instant("archived_at"),
  },
  (table) => [
    check(
      "search_product_index_title_ar_check",
      sql`char_length(${table.titleAr}) BETWEEN 1 AND 256`,
    ),
    check(
      "search_product_index_title_en_check",
      sql`${table.titleEn} IS NULL OR char_length(${table.titleEn}) BETWEEN 1 AND 256`,
    ),
    check("search_product_index_price_minor_units_check", sql`${table.priceMinorUnits} >= 0`),
    check("search_product_index_currency_code_check", sql`${table.currencyCode} = 'SAR'`),
    check("search_product_index_store_state_check", sql`${table.storeState} IN (${sql.raw(STORE_STATES)})`),
    check(
      "search_product_index_product_state_check",
      sql`${table.productState} IN (${sql.raw(PRODUCT_STATES)})`,
    ),
    check(
      "search_product_index_moderation_state_check",
      sql`${table.moderationState} IN (${sql.raw(MODERATION_STATES)})`,
    ),
    check("search_product_index_quantity_on_hand_check", sql`${table.quantityOnHand} >= 0`),

    // فهرسُ البادئةِ (slug/sku) — مطابقةٌ تامّةٌ وبادئةٌ.
    index("ix_search_products_slug").on(table.storeSlug, table.sku),
    // الفهرسانِ الجزئيّانِ: الظهورُ شرطٌ مُشتقٌّ لا عمودٌ، فالفهرسُ يُغطّي أربعةً من شروطِهِ.
    index("ix_search_products_category")
      .on(table.categorySlug)
      .where(sql`${table.archivedAt} IS NULL`),
    index("ix_search_products_visible")
      .on(table.storeState, table.productState, table.moderationState, table.quantityOnHand)
      .where(sql`${table.archivedAt} IS NULL`),
  ],
);

// ---------------------------------------------------------------------------
// 2) search_marketplace_store_state — حالةُ المتجرِ المُستهلكةُ (إسقاطٌ)
// ---------------------------------------------------------------------------

export const searchMarketplaceStoreState = pgTable(
  "search_marketplace_store_state",
  {
    storeId: uuid("store_id").primaryKey(),
    storeSlug: text("store_slug").notNull(),
    categorySlug: text("category_slug").notNull(),
    storeState: text("store_state").notNull(),
    stateSequence: integer("state_sequence").notNull(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check(
      "search_marketplace_store_state_store_state_check",
      sql`${table.storeState} IN (${sql.raw(STORE_STATES)})`,
    ),
    check("search_marketplace_store_state_state_sequence_check", sql`${table.stateSequence} >= 1`),
  ],
);

// ---------------------------------------------------------------------------
// 3) search_marketplace_product_state — حالةُ المنتجِ المُستهلكةُ (إسقاطٌ)
// ---------------------------------------------------------------------------

export const searchMarketplaceProductState = pgTable(
  "search_marketplace_product_state",
  {
    productId: uuid("product_id").primaryKey(),
    storeId: uuid("store_id").notNull(),
    storeSlug: text("store_slug").notNull(),
    sku: text("sku").notNull(),
    categorySlug: text("category_slug").notNull(),
    productState: text("product_state").notNull(),
    moderationState: text("moderation_state").notNull(),
    moderationSequence: integer("moderation_sequence").notNull().default(0),
    quantityOnHand: integer("quantity_on_hand").notNull().default(0),
    adjustmentSequence: integer("adjustment_sequence").notNull().default(0),
    archivedAt: instant("archived_at"),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check(
      "search_marketplace_product_state_product_state_check",
      sql`${table.productState} IN (${sql.raw(PRODUCT_STATES)})`,
    ),
    check(
      "search_marketplace_product_state_moderation_state_check",
      sql`${table.moderationState} IN (${sql.raw(MODERATION_STATES)})`,
    ),
    check(
      "search_marketplace_product_state_moderation_sequence_check",
      sql`${table.moderationSequence} >= 0`,
    ),
    check(
      "search_marketplace_product_state_quantity_on_hand_check",
      sql`${table.quantityOnHand} >= 0`,
    ),
    check(
      "search_marketplace_product_state_adjustment_sequence_check",
      sql`${table.adjustmentSequence} >= 0`,
    ),
    index("ix_search_product_state_store")
      .on(table.storeId)
      .where(sql`${table.archivedAt} IS NULL`),
  ],
);

// ---------------------------------------------------------------------------
// 4) search_outbox — صندوقُ أحداثِ دورةِ حياةِ الفهرسِ (لا أحداثِ السوقِ)
// ---------------------------------------------------------------------------

export const searchOutbox = pgTable(
  "search_outbox",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    eventId: uuid("event_id").notNull(),
    eventType: text("event_type").notNull(),
    eventVersion: text("event_version").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: instant("occurred_at").notNull().defaultNow(),
    publishedAt: instant("published_at"),
    /** M2-07 G3 (wave 2): delivery attempts recorded in the row, not in memory. */
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (table) => [
    unique("search_outbox_event_id_key").on(table.eventId),
    index("ix_search_outbox_unpublished")
      .on(table.id)
      .where(sql`${table.publishedAt} IS NULL`),
  ],
);

// ---------------------------------------------------------------------------
// 5) search_relay_consumed_events — الإهمالُ والحرفُ السامُّ (idempotency)
// ---------------------------------------------------------------------------

export const searchRelayConsumedEvents = pgTable(
  "search_relay_consumed_events",
  {
    outboxId: uuid("outbox_id").primaryKey(),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    consumedAt: instant("consumed_at").notNull().defaultNow(),
    // إقرارُ المسمومِ (`CLM-0249`) — سابقةُ `delivery_relay_consumed_events` حرفاً.
    acknowledgedAt: instant("acknowledged_at"),
    acknowledgedBy: text("acknowledged_by"),
    acknowledgementReason: text("acknowledgement_reason"),
  },
  (table) => [
    check(
      "search_relay_consumed_events_status_check",
      sql`${table.status} IN (${sql.raw(CONSUMED_STATES)})`,
    ),
    check("search_relay_consumed_events_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check(
      "search_relay_consumed_events_ack_by_check",
      sql`${table.acknowledgedBy} IS NULL OR char_length(${table.acknowledgedBy}) BETWEEN 1 AND 128`,
    ),
    check(
      "search_relay_consumed_events_ack_reason_check",
      sql`${table.acknowledgementReason} IS NULL OR char_length(${table.acknowledgementReason}) BETWEEN 12 AND 512`,
    ),
    check(
      "ck_search_relay_consumed_events_ack_triple",
      sql`(${table.acknowledgedAt} IS NULL) = (${table.acknowledgedBy} IS NULL) AND (${table.acknowledgedAt} IS NULL) = (${table.acknowledgementReason} IS NULL)`,
    ),
    // القيدُ الذي يُلزِمُ **اليدَ** بمحوِ الثلاثيِّ عندَ الإعادةِ: لا إقرارَ على صفٍّ حيٍّ.
    check(
      "ck_search_relay_consumed_events_ack_poisoned_only",
      sql`${table.acknowledgedAt} IS NULL OR ${table.status} = 'poisoned'`,
    ),
    index("ix_search_relay_consumed_unacknowledged")
      .on(table.consumedAt)
      .where(sql`${table.status} = 'poisoned' AND ${table.acknowledgedAt} IS NULL`),
    // الفهرسُ الجزئيُّ يحملُ **نفيَ** الحالاتِ النهائيّةِ: صفوفُ العملِ الباقيةِ وحدَها.
    index("ix_search_consumed_status")
      .on(table.status)
      .where(
        sql`${table.status} NOT IN ('applied','skipped','skipped_stale','ignored','poisoned')`,
      ),
  ],
);

// ---------------------------------------------------------------------------
// 6) search_relay_checkpoint — تقدُّمُ الاستهلاكِ (offset يملكُهُ البحثُ)
// ---------------------------------------------------------------------------

export const searchRelayCheckpoint = pgTable("search_relay_checkpoint", {
  consumerId: text("consumer_id").primaryKey(),
  lastOutboxId: uuid("last_outbox_id").notNull(),
  lastCreatedAt: instant("last_created_at").notNull(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

/**
 * جداولُ العقدِ بلا مرآةٍ — **فارغةٌ** لا محذوفةٌ: حارسُ الانحرافِ يُقابلُها بفرقِ
 * (جداولِ العقدِ − جداولِ المرآةِ) بالضبطِ، فبقاؤها فارغةً هو ما يُسقِطُ أوّلَ جدولٍ يُضافُ
 * غداً إلى العقدِ بلا مرآةٍ هنا.
 */
export const NOT_MIRRORED_TABLES: ReadonlyArray<string> = Object.freeze([]);

/**
 * فهارسُ العقدِ بلا مرآةٍ — **مُعلَنةٌ بالحرفِ** لأنّ `drizzle-kit` لا يُصدِرُ فهرسَ `gin`
 * على تعبيرٍ ولا بصنفِ مُعاملاتٍ. وهما مُلحَقانِ بيدٍ في ذيلِ الترحيلِ المولَّدِ، ويُقاسُ
 * تطابقُهما مع العقدِ في بُعدِ «الفهارسِ» من اختبارِ الدورةِ. وهذهِ القائمةُ **حصريّةٌ**:
 * حارسُ الانحرافِ يطلبُ أن يكونَ فرقُ (فهارسِ العقدِ − فهارسِ المرآةِ) مساوياً لها تماماً،
 * فلا يمرُّ فهرسٌ ثالثٌ يُنسى غداً بلا مرآةٍ ولا إلحاقٍ.
 */
export const NOT_MIRRORED_INDEXES: ReadonlyArray<string> = Object.freeze([
  "ix_search_products_fts_en",
  "ix_search_products_trgm_ar",
]);
