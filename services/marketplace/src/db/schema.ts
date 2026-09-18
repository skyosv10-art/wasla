/**
 * مرآةُ Drizzle لعقدِ PostgreSQL — **الجداولُ العشرةُ كلُّها**، بأسمائها وأنواعها وقيودِها المُسمّاة.
 *
 * ## هذا الملفُّ مرآةٌ لا مصدر
 *
 * الحقيقةُ في `services/marketplace/contracts/schema.sql` (مُجمَّدٌ منذ المراجعة 1/6)، وهو
 * نفسُه **الترحيل**: مُغلَّفٌ بـ`BEGIN;`/`COMMIT;`. ولا يُولّد هذا الملفُّ DDL ولا يُنشئ جدولاً؛
 * `migrate.ts` يُطبّق نصَّ العقدِ كما هو. ولو صار توليدُ Drizzle هو ما يُطبَّق لصار للمخطّطِ
 * مصدران، ولاختلفا أوّلَ مرّةٍ يُضاف قيدٌ في أحدِهما بلا أن يفشل شيء.
 *
 * ## ولماذا كانت ثمانيةً قبل اليوم — وهذا **قرارٌ مكتوبٌ لا نقصٌ**
 *
 * وقد كان `marketplace_idempotency` و`marketplace_outbox` موجودَين في العقدِ بلا مرآةٍ هنا،
 * لأنّ **لا مخزنَ لهما** يومَها؛ ومرآةٌ لجدولٍ بلا مخزنٍ وعدٌ بلا مُنفِّذٍ ولا اختبار. وقد وصل
 * الأوّلُ مخزنَه في 4/6 والثاني في 5/6، فصارت المرآةُ عشرةً من عشرةٍ و`NOT_MIRRORED_TABLES`
 * قائمةً **فارغةً** — لا محذوفةً: حارسُ الانحرافِ يقارنها بفرقِ (العقدِ − المرآة)، فبقاؤها
 * فارغةً هو ما يُسقِط أوّلَ جدولٍ يُضاف غداً بلا مرآة.
 *
 * وهذا بالضبط هو الدرسُ الذي كتبه العقدُ نفسُه على الطور 10 في تعليقِ
 * `marketplace_idempotency`: هناك جاء مخزنُ منعِ التكرارِ في المراجعة 3/6 وبقي **غيرَ موصولٍ**
 * بمسارِ HTTP حتّى 6/6، فكان مُتَّصلٌ يُعيد إرسالَ طلبٍ فيستلم «موجودٌ سابقاً» بدلَ الجوابِ
 * المحفوظ. فهنا يهبط كلُّ مخزنٍ **في المراجعةِ التي تصله**: منعُ التكرارِ مع طبقةِ HTTP (4/6)
 * لأنّ `Idempotency-Key` رأسُ طلبٍ لا مفهومَ قاعدة، وصندوقُ الصادرِ مع الأحداثِ (5/6) لأنّه
 * يُكتب في معاملةِ القرارِ نفسِها ولا معنى له خارجَها.
 *
 * وقائمةُ `NOT_MIRRORED_TABLES` ليست سطراً مُهمَلاً: `schema-drift.test.ts` يُطابقها مع فرقِ
 * (جداولِ العقدِ − جداولِ المرآة) **بالضبط**، فجدولٌ يُضاف إلى العقدِ غداً بلا مرآةٍ يُفشل
 * البناءَ حتّى يُعلَن بالاسمِ ومعه سببُه.
 *
 * ## القيودُ غيرُ المُسمّاةِ صارت مرآةً بأسمائِها الكنونيّةِ — [مصالحة ADR-024 · الموجة 3]
 *
 * تعداداتُ الحالاتِ وصيغُ المُعرّفاتِ وحدودُ الأطوالِ مكتوبةٌ في العقدِ فحوصاً **بلا أسماء**
 * (`CHECK (state IN (...))` · `CHECK (slug ~ '...')`)، وظلّت بلا مرآةٍ زمناً بحجّةِ أنّ حارسَ
 * الانحرافِ يقارنُ المُسمّى بحرفِه. لكنّ ولادةَ المولّدِ (`drizzle-kit` · ADR-024) غيّرتِ
 * الحسابَ: ترحيلٌ مولَّدٌ من إسقاطٍ بلا القيودِ المضمّنةِ كان سيُنشئَ قاعدةً **أرخى من العقدِ** —
 * انحدارٌ صامتٌ يعيشُ في الإنتاج. فأُلحِقت كلُّها هنا بأسمائِها الكنونيّةِ
 * `<table>_<column>_check` (الاسمُ الذي يُسمّيهِ PostgreSQLُ القيدَ المضمّنَ عندَ تطبيقِ
 * العقدِ — اسمٌ حقيقيٌّ في الكتالوجِ يقيسُهُ اختبارُ الدورةِ في سبعةِ أبعاد)، وحارسُ
 * الانحرافِ صار **يشتقّها من نصّ العقدِ** كذلك فلا يبقى قيدٌ في المرآةِ بلا عقدٍ ولا عكس. أمّا
 * الفحصُ في القاعدةِ فبقي خطَّ الدفاعِ الثاني، ويُقابله في الكودِ فحصٌ مُسمّىً قبلَ الكتابةِ من
 * طبقةِ المجالِ (`assertStoreSlug` · `assertQuantityDelta` · `assertPriceMinorUnits`).
 *
 * ## والفهارسُ الجزئيّةُ والتعبيريّةُ انعكست كذلك
 *
 * `ux_stores_slug_lower` (فريدٌ على `LOWER(slug)`) و`ux_stores_owner_active` (فريدٌ جزئيٌّ
 * `WHERE state <> 'archived'`) و`ix_marketplace_outbox_unpublished` (جزئيٌّ على `WHERE
 * published_at IS NULL`) كانت مكتوبةً في العقدِ **خارجَ** جسمِ الجدولِ فلم تُنعكس، واليوم
 * تُعلَن هنا بأسمائِها لتولّدَ ترحيلاً متكافئاً؛ و`ix_store_reviews_store_seq` صار
 * بترتيبِه الكاملِ (`state_sequence DESC`) كما في العقد.
 *
 * وأنواعُ `TIMESTAMPTZ` تبقى على تمثيلِ Drizzle الافتراضيّ (`Date`) ويُحوّلها المخزنُ إلى نصِّ
 * ISO في موضعٍ واحدٍ (`iso()` في `rows.ts`). و`mode: "string"` كان أقصرَ ظاهرياً وأسوأ: عميلُ
 * `pg` يُعيد صيغةَ Postgres (`2026-03-01 12:00:00+00`) لا ISO، فيصير صفُّ القاعدةِ غيرَ مساوٍ
 * لصفِّ الذاكرةِ بـ`toEqual` بلا فرقٍ في المعنى.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** عمودُ لحظةٍ بمنطقةٍ زمنيّة. التحويلُ إلى نصِّ ISO مسؤوليّةُ المخزنِ لا المرآة. */
const instant = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------
// 1) store_categories — تصنيفٌ مبذورٌ بعمقِ مستويَين، لا شجرةٌ يبنيها المستخدم
// ---------------------------------------------------------------------------

export const storeCategories = pgTable(
  "store_categories",
  {
    categoryId: uuid("category_id").primaryKey(),
    slug: text("slug").notNull(),
    depth: smallint("depth").notNull(),
    parentCategoryId: uuid("parent_category_id"),
    labelAr: text("label_ar").notNull(),
    labelEn: text("label_en"),
    labelUr: text("label_ur"),
    sortOrder: smallint("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("ux_store_categories_slug").on(table.slug),
    foreignKey({
      name: "fk_store_categories_parent",
      columns: [table.parentCategoryId],
      foreignColumns: [table.categoryId],
    }),
    check("store_categories_slug_check", sql`${table.slug} ~ '^[a-z][a-z0-9-]{1,47}$'`),
    check("store_categories_depth_check", sql`${table.depth} IN (1, 2)`),
    check("store_categories_label_ar_check", sql`char_length(${table.labelAr}) BETWEEN 2 AND 64`),
    check(
      "store_categories_label_en_check",
      sql`${table.labelEn} IS NULL OR char_length(${table.labelEn}) BETWEEN 2 AND 64`,
    ),
    check(
      "store_categories_label_ur_check",
      sql`${table.labelUr} IS NULL OR char_length(${table.labelUr}) BETWEEN 2 AND 64`,
    ),
    check("store_categories_sort_order_check", sql`${table.sortOrder} BETWEEN 0 AND 999`),
    check(
      "ck_store_categories_depth_parent",
      sql`(${table.depth} = 1 AND ${table.parentCategoryId} IS NULL) OR (${table.depth} = 2 AND ${table.parentCategoryId} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 2) stores — المتجرُ، وحالتُه صفٌّ مُتحقِّقٌ من دفترِ المراجعات (القرار 1)
// ---------------------------------------------------------------------------

export const stores = pgTable(
  "stores",
  {
    storeId: uuid("store_id").primaryKey(),
    ownerPublicId: text("owner_public_id").notNull(),
    slug: text("slug").notNull(),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en"),
    titleUr: text("title_ur"),
    descriptionAr: text("description_ar"),
    categoryId: uuid("category_id").notNull(),
    state: text("state").notNull().default("draft"),
    stateSequence: integer("state_sequence").notNull().default(1),
    firstApprovedAt: instant("first_approved_at"),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "fk_stores_category",
      columns: [table.categoryId],
      foreignColumns: [storeCategories.categoryId],
    }),
    check("stores_owner_public_id_check", sql`${table.ownerPublicId} ~ '^WS-[0-9]{10}$'`),
    check("stores_slug_check", sql`${table.slug} ~ '^[a-z][a-z0-9-]{2,47}$'`),
    check("stores_title_ar_check", sql`char_length(${table.titleAr}) BETWEEN 2 AND 80`),
    check(
      "stores_title_en_check",
      sql`${table.titleEn} IS NULL OR char_length(${table.titleEn}) BETWEEN 2 AND 80`,
    ),
    check(
      "stores_title_ur_check",
      sql`${table.titleUr} IS NULL OR char_length(${table.titleUr}) BETWEEN 2 AND 80`,
    ),
    check(
      "stores_description_ar_check",
      sql`${table.descriptionAr} IS NULL OR char_length(${table.descriptionAr}) <= 2000`,
    ),
    check(
      "stores_state_check",
      sql`${table.state} IN ('draft', 'pending_review', 'approved', 'rejected', 'suspended', 'archived')`,
    ),
    check("stores_state_sequence_check", sql`${table.stateSequence} >= 1`),
    check(
      "ck_stores_first_approved_state",
      sql`${table.firstApprovedAt} IS NULL OR ${table.state} <> 'draft'`,
    ),
    uniqueIndex("ux_stores_slug_lower").on(sql`lower(${table.slug})`),
    uniqueIndex("ux_stores_owner_active")
      .on(table.ownerPublicId)
      .where(sql`${table.state} <> 'archived'`),
    index("ix_stores_state_category").on(table.state, table.categoryId),
  ],
);

// ---------------------------------------------------------------------------
// 3) store_reviews — دفترُ قراراتِ المتجر، لا يُعدَّل ولا يُحذف
// ---------------------------------------------------------------------------

export const storeReviews = pgTable(
  "store_reviews",
  {
    reviewId: uuid("review_id").primaryKey(),
    storeId: uuid("store_id").notNull(),
    decision: text("decision").notNull(),
    reasonCode: text("reason_code"),
    actorType: text("actor_type").notNull(),
    actorPublicId: text("actor_public_id"),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    stateSequence: integer("state_sequence").notNull(),
    decidedAt: instant("decided_at").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "fk_store_reviews_store",
      columns: [table.storeId],
      foreignColumns: [stores.storeId],
    }),
    unique("ux_store_reviews_sequence").on(table.storeId, table.stateSequence),
    check(
      "store_reviews_decision_check",
      sql`${table.decision} IN ('review_requested', 'approved', 'rejected', 'suspended', 'reinstated', 'archived')`,
    ),
    check(
      "store_reviews_reason_code_check",
      sql`${table.reasonCode} IS NULL OR ${table.reasonCode} IN (
            'incomplete_profile', 'prohibited_category', 'duplicate_store',
            'misleading_title', 'unverified_owner', 'policy_violation', 'owner_request'
        )`,
    ),
    check("store_reviews_actor_type_check", sql`${table.actorType} IN ('owner', 'moderator', 'system')`),
    check(
      "store_reviews_actor_public_id_check",
      sql`${table.actorPublicId} IS NULL OR ${table.actorPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "store_reviews_from_state_check",
      sql`${table.fromState} IS NULL OR ${table.fromState} IN ('draft', 'pending_review', 'approved', 'rejected', 'suspended', 'archived')`,
    ),
    check(
      "store_reviews_to_state_check",
      sql`${table.toState} IN ('draft', 'pending_review', 'approved', 'rejected', 'suspended', 'archived')`,
    ),
    check("store_reviews_state_sequence_check", sql`${table.stateSequence} >= 1`),
    check(
      "ck_store_reviews_reason_required",
      sql`(${table.decision} IN ('rejected', 'suspended') AND ${table.reasonCode} IS NOT NULL)
          OR (${table.decision} NOT IN ('rejected', 'suspended') AND (${table.decision} = 'archived' OR ${table.reasonCode} IS NULL))`,
    ),
    check(
      "ck_store_reviews_actor",
      sql`(${table.actorType} = 'system' AND ${table.actorPublicId} IS NULL) OR (${table.actorType} <> 'system' AND ${table.actorPublicId} IS NOT NULL)`,
    ),
    index("ix_store_reviews_store_seq").on(table.storeId, table.stateSequence.desc()),
  ],
);

// ---------------------------------------------------------------------------
// 4) store_staff — الأدوارُ، ولا صفَّ يُحذف (القرار 8)
// ---------------------------------------------------------------------------

export const storeStaff = pgTable(
  "store_staff",
  {
    staffId: uuid("staff_id").primaryKey(),
    storeId: uuid("store_id").notNull(),
    memberPublicId: text("member_public_id").notNull(),
    role: text("role").notNull(),
    addedByPublicId: text("added_by_public_id").notNull(),
    addedAt: instant("added_at").notNull(),
    removedAt: instant("removed_at"),
    removedByPublicId: text("removed_by_public_id"),
  },
  (table) => [
    foreignKey({
      name: "fk_store_staff_store",
      columns: [table.storeId],
      foreignColumns: [stores.storeId],
    }),
    check("store_staff_member_public_id_check", sql`${table.memberPublicId} ~ '^WS-[0-9]{10}$'`),
    check("store_staff_role_check", sql`${table.role} IN ('owner', 'manager', 'staff')`),
    check("store_staff_added_by_public_id_check", sql`${table.addedByPublicId} ~ '^WS-[0-9]{10}$'`),
    check("store_staff_removed_by_public_id_check", sql`${table.removedByPublicId} ~ '^WS-[0-9]{10}$'`),
    check(
      "ck_store_staff_removed_pair",
      sql`(${table.removedAt} IS NULL AND ${table.removedByPublicId} IS NULL) OR (${table.removedAt} IS NOT NULL AND ${table.removedByPublicId} IS NOT NULL)`,
    ),
    check(
      "ck_store_staff_removed_after_added",
      sql`${table.removedAt} IS NULL OR ${table.removedAt} >= ${table.addedAt}`,
    ),
    /**
     * القيدان الجزئيّان يقيمان في العقدِ فهرسَين لا قيدَين مُسمّيَين، فلا يقرؤهما حارسُ
     * الانحراف (وهو يقارن `CONSTRAINT` بحرفِه). ويُنعكسان هنا كي يبقى اسمُهما مقروناً
     * بالمرآة، ويُثبت `migrate.integration.test.ts` وجودَهما في القاعدةِ **بالاسم**.
     */
    uniqueIndex("ux_store_staff_active_member")
      .on(table.storeId, table.memberPublicId)
      .where(sql`${table.removedAt} IS NULL`),
    uniqueIndex("ux_store_staff_single_owner")
      .on(table.storeId)
      .where(sql`${table.role} = 'owner' AND ${table.removedAt} IS NULL`),
  ],
);

// ---------------------------------------------------------------------------
// 5) products — حالةُ نشرٍ يملكها المتجرُ، وحالةُ اعتدالٍ يملكها المُراجع
// ---------------------------------------------------------------------------

export const products = pgTable(
  "products",
  {
    productId: uuid("product_id").primaryKey(),
    storeId: uuid("store_id").notNull(),
    sku: text("sku").notNull(),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en"),
    titleUr: text("title_ur"),
    descriptionAr: text("description_ar"),
    categoryId: uuid("category_id").notNull(),
    priceMinorUnits: integer("price_minor_units").notNull(),
    currencyCode: text("currency_code").notNull().default("SAR"),
    state: text("state").notNull().default("draft"),
    moderationState: text("moderation_state").notNull().default("pending"),
    moderationSequence: integer("moderation_sequence").notNull().default(1),
    createdByPublicId: text("created_by_public_id").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "fk_products_store",
      columns: [table.storeId],
      foreignColumns: [stores.storeId],
    }),
    foreignKey({
      name: "fk_products_category",
      columns: [table.categoryId],
      foreignColumns: [storeCategories.categoryId],
    }),
    unique("ux_products_store_sku").on(table.storeId, table.sku),
    check("products_sku_check", sql`${table.sku} ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$'`),
    check("products_title_ar_check", sql`char_length(${table.titleAr}) BETWEEN 2 AND 120`),
    check(
      "products_title_en_check",
      sql`${table.titleEn} IS NULL OR char_length(${table.titleEn}) BETWEEN 2 AND 120`,
    ),
    check(
      "products_title_ur_check",
      sql`${table.titleUr} IS NULL OR char_length(${table.titleUr}) BETWEEN 2 AND 120`,
    ),
    check(
      "products_description_ar_check",
      sql`${table.descriptionAr} IS NULL OR char_length(${table.descriptionAr}) <= 4000`,
    ),
    check(
      "products_price_minor_units_check",
      sql`${table.priceMinorUnits} BETWEEN 1 AND 100000000`,
    ),
    check("products_currency_code_check", sql`${table.currencyCode} = 'SAR'`),
    check("products_state_check", sql`${table.state} IN ('draft', 'published', 'archived')`),
    check(
      "products_moderation_state_check",
      sql`${table.moderationState} IN ('pending', 'approved', 'rejected')`,
    ),
    check("products_moderation_sequence_check", sql`${table.moderationSequence} >= 1`),
    check(
      "products_created_by_public_id_check",
      sql`${table.createdByPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "ck_products_published_moderated",
      sql`${table.state} <> 'published' OR ${table.moderationState} = 'approved'`,
    ),
    index("ix_products_store_state").on(table.storeId, table.state),
    index("ix_products_category_state").on(table.categoryId, table.state, table.moderationState),
  ],
);

// ---------------------------------------------------------------------------
// 6) product_reviews — دفترُ قراراتِ اعتدالِ المنتج
// ---------------------------------------------------------------------------

export const productReviews = pgTable(
  "product_reviews",
  {
    reviewId: uuid("review_id").primaryKey(),
    productId: uuid("product_id").notNull(),
    decision: text("decision").notNull(),
    reasonCode: text("reason_code"),
    actorType: text("actor_type").notNull(),
    actorPublicId: text("actor_public_id"),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    moderationSequence: integer("moderation_sequence").notNull(),
    decidedAt: instant("decided_at").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "fk_product_reviews_product",
      columns: [table.productId],
      foreignColumns: [products.productId],
    }),
    unique("ux_product_reviews_sequence").on(table.productId, table.moderationSequence),
    check("product_reviews_decision_check", sql`${table.decision} IN ('approved', 'rejected')`),
    check(
      "product_reviews_reason_code_check",
      sql`${table.reasonCode} IS NULL OR ${table.reasonCode} IN (
            'prohibited_item', 'misleading_title', 'wrong_category', 'price_implausible', 'duplicate_listing', 'policy_violation'
        )`,
    ),
    check("product_reviews_actor_type_check", sql`${table.actorType} IN ('moderator', 'system')`),
    check(
      "product_reviews_actor_public_id_check",
      sql`${table.actorPublicId} IS NULL OR ${table.actorPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "product_reviews_from_state_check",
      sql`${table.fromState} IS NULL OR ${table.fromState} IN ('pending', 'approved', 'rejected')`,
    ),
    check(
      "product_reviews_to_state_check",
      sql`${table.toState} IN ('pending', 'approved', 'rejected')`,
    ),
    check(
      "product_reviews_moderation_sequence_check",
      sql`${table.moderationSequence} >= 1`,
    ),
    check(
      "ck_product_reviews_reason_required",
      sql`(${table.decision} = 'rejected' AND ${table.reasonCode} IS NOT NULL) OR (${table.decision} <> 'rejected' AND ${table.reasonCode} IS NULL)`,
    ),
    check(
      "ck_product_reviews_actor",
      sql`(${table.actorType} = 'system' AND ${table.actorPublicId} IS NULL) OR (${table.actorType} <> 'system' AND ${table.actorPublicId} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 7) inventory_adjustments — دفترُ المخزون: فروقٌ مُسمّاةُ السبب (القرار 5)
// ---------------------------------------------------------------------------

export const inventoryAdjustments = pgTable(
  "inventory_adjustments",
  {
    adjustmentId: uuid("adjustment_id").primaryKey(),
    productId: uuid("product_id").notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    quantityAfter: integer("quantity_after").notNull(),
    reasonCode: text("reason_code").notNull(),
    actorPublicId: text("actor_public_id").notNull(),
    adjustmentSequence: integer("adjustment_sequence").notNull(),
    occurredAt: instant("occurred_at").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "fk_inventory_adjustments_product",
      columns: [table.productId],
      foreignColumns: [products.productId],
    }),
    unique("ux_inventory_adjustments_sequence").on(table.productId, table.adjustmentSequence),
    check(
      "inventory_adjustments_quantity_delta_check",
      sql`${table.quantityDelta} <> 0 AND ${table.quantityDelta} BETWEEN -1000000 AND 1000000`,
    ),
    check("inventory_adjustments_quantity_after_check", sql`${table.quantityAfter} >= 0`),
    check(
      "inventory_adjustments_reason_code_check",
      sql`${table.reasonCode} IN ('initial_stock', 'restock', 'correction', 'shrinkage', 'archive_zeroed', 'reservation', 'reservation_release')`,
    ),
    check(
      "inventory_adjustments_actor_public_id_check",
      sql`${table.actorPublicId} ~ '^WS-[0-9]{10}$' OR ${table.actorPublicId} ~ '^system:[a-z_]+$'`,
    ),
    check(
      "inventory_adjustments_adjustment_sequence_check",
      sql`${table.adjustmentSequence} >= 1`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 8) product_inventory — الرصيدُ: صفٌّ مُتحقِّقٌ واحدٌ لكلِّ منتج
// ---------------------------------------------------------------------------

export const productInventory = pgTable(
  "product_inventory",
  {
    productId: uuid("product_id").primaryKey(),
    quantityOnHand: integer("quantity_on_hand").notNull().default(0),
    lastAdjustmentSequence: integer("last_adjustment_sequence").notNull().default(0),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "fk_product_inventory_product",
      columns: [table.productId],
      foreignColumns: [products.productId],
    }),
    check("product_inventory_quantity_on_hand_check", sql`${table.quantityOnHand} >= 0`),
    check(
      "product_inventory_last_adjustment_sequence_check",
      sql`${table.lastAdjustmentSequence} >= 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 9) marketplace_idempotency — مفتاحٌ واحدٌ لكلّ كتابة، والجوابُ يُحفَظ
// ---------------------------------------------------------------------------

/**
 * مرآةُ جدولِ منعِ التكرار — دخلت في المراجعة 4/6 مع الطبقةِ التي تقرأ الترويسة.
 *
 * والمفتاحُ الأوّليُّ **مركّبٌ** `(route_key, idempotency_key)` كما في نصِّ العقد، وليس
 * `idempotency_key` وحدَه: مفتاحٌ من مُتَّصلٍ يصلح لمسارٍ واحد، وجدولٌ بمفتاحٍ واحدٍ كان
 * سيجعل `POST /stores` و`POST /stores/{slug}/products` يتزاحمان على مفتاحٍ أعاده عميلٌ بحسنِ
 * نيّة — فيُردُّ جوابُ متجرٍ عن طلبِ منتج.
 *
 * ولا قيدَ مُسمّىً هنا: نصُّ العقدِ يكتب `CHECK` لا اسمَ لها، وحارسُ الانحرافِ يقارن
 * أسماءَ القيودِ حرفاً — فقيدٌ مُسمّىً في المرآةِ وحدَها كان سيُسقطه.
 */
export const marketplaceIdempotency = pgTable(
  "marketplace_idempotency",
  {
    idempotencyKey: text("idempotency_key").notNull(),
    routeKey: text("route_key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "marketplace_idempotency_pkey",
      columns: [table.routeKey, table.idempotencyKey],
    }),
    check(
      "marketplace_idempotency_idempotency_key_check",
      sql`char_length(${table.idempotencyKey}) BETWEEN 8 AND 128`,
    ),
    check(
      "marketplace_idempotency_route_key_check",
      sql`${table.routeKey} ~ '^[a-z][a-z0-9_.]{2,63}$'`,
    ),
    check(
      "marketplace_idempotency_request_hash_check",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "marketplace_idempotency_response_status_check",
      sql`${table.responseStatus} BETWEEN 200 AND 299`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 10) marketplace_outbox — الحدثُ يُكتب في معاملةِ القرارِ نفسِها
// ---------------------------------------------------------------------------

/**
 * مرآةُ صندوقِ الصادر — دخلت في المراجعة 5/6 مع الأحداثِ التي تُكتب فيه.
 *
 * ## `outbox_id` بلا `defaultRandom()` في المرآة
 *
 * العقدُ يكتب العمودَ `UUID PRIMARY KEY` بلا افتراضٍ، والمُعرِّفُ يُطلَب من المحرّكِ عند
 * الإدراجِ بـ`sql\`gen_random_uuid()\`` كما في بقيّةِ المخازن. و`defaultRandom()` في المرآةِ
 * كان سيُصبح افتراضاً لا وجودَ له في القاعدة: حارسُ الانحرافِ لا يقارن الافتراضاتِ، فكان
 * سيمرّ ويُنتج صفّاً بلا مُعرِّفٍ يومَ يُدرَج بلا العمود.
 *
 * ## ولا فحوصَ مُسمّاةً هنا

 * فحوصُ العقدِ الثلاثةُ على هذا الجدولِ (صيغةُ `event_type` وصيغةُ `event_version` وتعدادُ
 * `aggregate_type`) مكتوبةٌ **بلا أسماء**، فلا تُسمّى في العقدِ. وأُلحقت هنا بأسمائِها
 * الكنونيّةِ `<table>_<column>_check` في مصالحةِ ADR-024 ليولّدَ المولّدُ ترحيلاً متكافئاً،
 * ويشتقّ حارسُ الانحرافِ الأسماءَ نفسَها من نصّ العقد. ويُقابلها في الكودِ
 * `domain/events.ts`: النوعُ والإصدارُ والجذرُ قيمٌ من قائمةٍ مُعلَنةٍ لا
 * نصوصٌ يُمرِّرها المُنادي.
 *
 * ## والفهرسُ الجزئيُّ انعكس في مصالحةِ ADR-024
 *
 * `ix_marketplace_outbox_unpublished` مُقيَّدٌ بـ`WHERE published_at IS NULL`، ويُنشَأ في
 * العقدِ **خارجَ** جسمِ الجدول. انعكس هنا [بمصالحةِ ADR-024] كي يكونَ الترحيلُ المولَّدُ
 * متكافئاً مع العقدِ في الأبعادِ السبعةِ كلِّها — واختبارُ الدورةِ يقيسُ التكافؤَ حرفاً.
 */
export const marketplaceOutbox = pgTable(
  "marketplace_outbox",
  {
    outboxId: uuid("outbox_id").primaryKey(),
    eventType: text("event_type").notNull(),
    eventVersion: text("event_version").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: instant("occurred_at").notNull(),
    publishedAt: instant("published_at"),
    createdAt: instant("created_at").notNull().defaultNow(),
    sequenceNumber: bigint("sequence_number", { mode: "number" }).notNull(),
  },
  (table) => [
    check(
      "marketplace_outbox_event_type_check",
      sql`${table.eventType} ~ '^marketplace\\.[a-z_]+$'`,
    ),
    check("marketplace_outbox_event_version_check", sql`${table.eventVersion} ~ '^v[0-9]+$'`),
    check(
      "marketplace_outbox_aggregate_type_check",
      sql`${table.aggregateType} IN ('store', 'product', 'inventory')`,
    ),
    index("ix_marketplace_outbox_unpublished")
      .on(table.sequenceNumber)
      .where(sql`${table.publishedAt} IS NULL`),
  ],
);

/**
 * جداولُ العقدِ التي لا مرآةَ لها — **فارغةٌ منذ المراجعة 5/6**.
 *
 * والقائمةُ تبقى مُعلَنةً وهي فارغةٌ: `schema-drift.test.ts` يُطابقها مع فرقِ (جداولِ العقدِ −
 * جداولِ المرآة) **بالضبط**، فحذفُها كان سيحذف الحارسَ نفسَه، وجدولٌ يُضاف إلى العقدِ غداً بلا
 * مرآةٍ يُفشل البناءَ حتّى يُعلَن بالاسمِ ومعه سببُه.
 */
export const NOT_MIRRORED_TABLES: ReadonlyArray<string> = Object.freeze([]);
