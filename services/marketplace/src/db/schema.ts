/**
 * مرآةُ Drizzle لعقدِ PostgreSQL — **ثمانيةُ جداولٍ من عشرة**، بأسمائها وأنواعها وقيودِها المُسمّاة.
 *
 * ## هذا الملفُّ مرآةٌ لا مصدر
 *
 * الحقيقةُ في `services/marketplace/contracts/schema.sql` (مُجمَّدٌ منذ المراجعة 1/6)، وهو
 * نفسُه **الترحيل**: مُغلَّفٌ بـ`BEGIN;`/`COMMIT;`. ولا يُولّد هذا الملفُّ DDL ولا يُنشئ جدولاً؛
 * `migrate.ts` يُطبّق نصَّ العقدِ كما هو. ولو صار توليدُ Drizzle هو ما يُطبَّق لصار للمخطّطِ
 * مصدران، ولاختلفا أوّلَ مرّةٍ يُضاف قيدٌ في أحدِهما بلا أن يفشل شيء.
 *
 * ## ولماذا ثمانيةٌ لا عشرة — وهذا **قرارٌ مكتوبٌ لا نقصٌ**
 *
 * `marketplace_idempotency` و`marketplace_outbox` موجودان في العقدِ ويُنشئهما الترحيلُ، ولا
 * مرآةَ لهما هنا لأنّ **لا مخزنَ لهما في هذه المراجعة**. ومرآةٌ لجدولٍ بلا مخزنٍ وعدٌ بلا
 * مُنفِّذٍ ولا اختبار.
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
 * ## والقيودُ غيرُ المُسمّاةِ لا مرآةَ لها بقصد
 *
 * تعداداتُ الحالاتِ وصيغُ المُعرّفاتِ وحدودُ الأطوالِ مكتوبةٌ في العقدِ فحوصاً **بلا أسماء**
 * (`CHECK (state IN (...))` · `CHECK (slug ~ '...')`)، فلا تُنعكس هنا: حارسُ الانحرافِ يقارن
 * القيودَ **المُسمّاةَ** بحرفِها، واسمٌ نخترعه في المرآةِ لا وجودَ له في القاعدةِ يجعل الحارسَ
 * يُثبت اتفاقَ مرآةٍ مع نفسِها. أمّا الفحصُ نفسُه فيبقى خطَّ الدفاعِ الثاني في القاعدة،
 * ويُقابله في الكودِ فحصٌ مُسمّىً قبلَ الكتابةِ من طبقةِ المجالِ (`assertStoreSlug` ·
 * `assertQuantityDelta` · `assertPriceMinorUnits`).
 *
 * وأنواعُ `TIMESTAMPTZ` تبقى على تمثيلِ Drizzle الافتراضيّ (`Date`) ويُحوّلها المخزنُ إلى نصِّ
 * ISO في موضعٍ واحدٍ (`iso()` في `rows.ts`). و`mode: "string"` كان أقصرَ ظاهرياً وأسوأ: عميلُ
 * `pg` يُعيد صيغةَ Postgres (`2026-03-01 12:00:00+00`) لا ISO، فيصير صفُّ القاعدةِ غيرَ مساوٍ
 * لصفِّ الذاكرةِ بـ`toEqual` بلا فرقٍ في المعنى.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
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
    check(
      "ck_stores_first_approved_state",
      sql`${table.firstApprovedAt} IS NULL OR ${table.state} <> 'draft'`,
    ),
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
      "ck_store_reviews_reason_required",
      sql`(${table.decision} IN ('rejected', 'suspended') AND ${table.reasonCode} IS NOT NULL)
          OR (${table.decision} NOT IN ('rejected', 'suspended') AND (${table.decision} = 'archived' OR ${table.reasonCode} IS NULL))`,
    ),
    check(
      "ck_store_reviews_actor",
      sql`(${table.actorType} = 'system' AND ${table.actorPublicId} IS NULL) OR (${table.actorType} <> 'system' AND ${table.actorPublicId} IS NOT NULL)`,
    ),
    index("ix_store_reviews_store_seq").on(table.storeId, table.stateSequence),
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
  ],
);

/**
 * جداولُ العقدِ التي لا مرآةَ لها في هذه المراجعة — **بالاسمِ ومعه المراجعةُ التي تصلها**.
 *
 * الترحيلُ يُنشئهما (العقدُ نصٌّ واحدٌ يُنفَّذ كما هو)، والقائمةُ تُقارَن في
 * `schema-drift.test.ts` بفرقِ (العقدِ − المرآة) بالضبط: فلا تنقص مرآةٌ صامتةً، ولا تبقى
 * القائمةُ تحمل اسماً انعكس فعلاً.
 */
export const NOT_MIRRORED_TABLES: ReadonlyArray<string> = Object.freeze([
  "marketplace_idempotency", // ← المراجعة 4/6، مع طبقةِ HTTP التي تقرأ `Idempotency-Key`
  "marketplace_outbox", // ← المراجعة 5/6، مع الأحداثِ في معاملةِ القرارِ نفسِها
]);
