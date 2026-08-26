/**
 * مخزنُ الموردَين: صفُّ المتجرِ وصفُّ المنتج — إنشاءٌ وقراءةٌ لا قرارٌ ولا اشتقاق.
 *
 * ## القرار: المخزنُ يكتب ما أُعطي ولا يُقرّر شيئاً
 *
 * `draftStore` و`draftProduct` في `domain/catalog.ts` هما مَن يفحص اللاحقةَ والعنوانَ والسعرَ
 * ويضع الحالةَ الأوّليّةَ والتسلسلَ. والمخزنُ يكتب. ومخزنٌ يضع `state: "draft"` بنفسِه كان
 * سيصير مصدرَ حقيقةٍ ثانياً للحالةِ الأوّليّة، فيختلف مسارُ الإنشاءِ من HTTP عن مسارِ البذرِ
 * بلا أن يفشل اختبارٌ واحد.
 *
 * ## والمُعرّفُ يُولَّد في القاعدةِ لا في العقدة
 *
 * `gen_random_uuid()` لا `crypto.randomUUID()`: العشوائيّةُ في التطبيقِ تُدخل مصدرَ لا-حتميّةٍ
 * في حزمةٍ يحرسها `purity.test.ts` صريحاً (`randomUUID` نمطٌ محرَّمٌ فيها)، وتُنتج اختباراً
 * لا يُقارَن ناتجُه إلّا بنفسِه. والقاعدةُ تُولّده في نفسِ الاستعلامِ فيعود في `RETURNING`.
 *
 * ## ولا لحظةَ إنشاءٍ تُمرَّر
 *
 * `created_at` و`updated_at` لهما `DEFAULT now()` في العقد، فلا يُمرَّران هنا: لحظةُ الدفترِ
 * (`decided_at` · `occurred_at` · `added_at`) حقيقةٌ يملكها القرارُ ويُمرّرها المُنادي، أمّا
 * لحظةُ الكتابةِ فمسكُ دفترٍ تملكه القاعدة. وخلطُهما كان سيُلزم هذه الطبقةَ بساعةٍ حقيقيّةٍ
 * فتسقط أوّلُ قائمةٍ في حارسِ النقاء (`REAL_CLOCK_FILES` تبقى فارغة).
 *
 * ## ولا تحديثَ حالةٍ هنا
 *
 * تحديثُ `state` و`state_sequence` و`moderation_state` يقيم في `projection.ts` وحدَه، لأنّه
 * إسقاطٌ لدفترٍ لا كتابةٌ مستقلّة. وكتابةُ الحالةِ من هنا كانت ستسمح بمتجرٍ يصير `approved`
 * بلا صفٍّ في `store_reviews` — وذاك **عطبٌ** بنصِّ القرار 1 لا اختصار.
 */

import { and, asc, desc, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm";

import type { DbOrTx } from "./client.js";
import { translateConstraint } from "./constraints.js";
import { productInventory, products, stores } from "./schema.js";
import { toProduct, toStore, type ProductRecord, type StoreRecord } from "./rows.js";
import { boundedPageLimit, type Page } from "./paging.js";
import { STORE_ACTIVE_STATES } from "../domain/catalog.js";
import { validationFailed } from "../domain/errors.js";
import type { ProductDraft, StoreDraft } from "../domain/model.js";
import { INVENTORY_INITIAL_QUANTITY, INVENTORY_INITIAL_SEQUENCE } from "../domain/inventory.js";

/**
 * نافذةُ الموضعِ لا بدَّ أن تكون شرطاً حاضراً.
 *
 * `or` و`and` في Drizzle تُعيدان `undefined` حين لا مُعامِلَ لهما، وتمريرُ `undefined` إلى
 * `where` يُسقط الشرطَ كلَّه بصمتٍ — فتصير صفحةٌ ثانيةٌ **مسحاً كاملاً** يُعيد ما سبق. والرفضُ
 * الصريحُ هنا يجعل هذا العيبَ خطأً مقروءاً لا صفحةً مكرّرةً يُكتشَف تكرارُها في الإنتاج.
 */
function keysetWindow(condition: SQL | undefined): SQL {
  if (condition === undefined) throw validationFailed("cursor", "a decodable keyset position");
  return condition;
}
import type {
  ProductModerationState,
  ProductState,
  StoreState,
} from "../domain/contract-sets.js";

/**
 * موضعُ الاستمرارِ في قراءةٍ مُصفَّحة: لحظةُ الإنشاءِ ثمّ المُعرِّفُ فاصلاً.
 *
 * ولمَ عمودان لا `OFFSET`؟ لأنّ `OFFSET` يقرأ ما تجاوزه ثمّ يُهمله — فتكلفةُ الصفحةِ العاشرةِ
 * عشرةُ أمثالِ الأولى — **ثمّ يُخطئ**: صفٌّ جديدٌ يُدرَج في الأثناءِ يُزحزح كلَّ شيءٍ فيُقرأ
 * صفٌّ مرّتَين أو يُقفَز صفٌّ بلا قراءة. والمفتاحُ المُركَّبُ يُصيب الفهرسَ ويبقى صادقاً مع
 * الكتابةِ المتزامنة، و`createdAt` وحدَه لا يكفي لأنّه ليس فريداً.
 */
export interface StorePageCursor {
  readonly createdAt: string;
  readonly storeId: string;
}

/** مُرشِّحاتُ قراءةِ المتاجر — واحدٌ منها على الأقلّ إلزاميٌّ، والإلزامُ يُفرَض على الحدّ. */
export interface StorePageFilter {
  readonly state?: StoreState;
  readonly ownerPublicId?: string;
  readonly categoryId?: string;
  readonly after?: StorePageCursor;
  readonly limit?: number;
}

/** موضعُ الاستمرارِ في قراءةِ منتجاتِ متجر. */
export interface ProductPageCursor {
  readonly createdAt: string;
  readonly productId: string;
}

export interface ProductPageFilter {
  readonly state?: ProductState;
  readonly moderationState?: ProductModerationState;
  readonly after?: ProductPageCursor;
  readonly limit?: number;
}

/**
 * منتجٌ مع حقائقِ الظهورِ الثلاثِ الأخرى في قراءةٍ واحدة.
 *
 * الظهورُ يُحسَب وقتَ القراءةِ من أربعةِ شروطٍ (القرار 3)، وثلاثةٌ منها في جدولَين آخرَين.
 * فإمّا أن تُقرأ معه في وصلةٍ واحدةٍ، وإمّا أن تُقرأ في حلقةٍ صفّاً صفّاً — وهي `N+1` التي
 * تجعل صفحةً من خمسينَ منتجاً مئةً وواحداً من الاستعلامات.
 */
export interface ProductVisibilityRow {
  readonly product: ProductRecord;
  readonly storeState: StoreState;
  readonly storeSlug: string;
  readonly quantityOnHand: number;
  readonly lastAdjustmentSequence: number;
}

export class PostgresResourceStore {
  constructor(private readonly db: DbOrTx) {}

  /** يُنشئ صفَّ متجرٍ من مسوّدةٍ فُحِصت في المجالِ، ويُعيده بمُعرّفِه المُولَّد. */
  async insertStore(draft: StoreDraft): Promise<StoreRecord> {
    try {
      const rows = await this.db
        .insert(stores)
        .values({
          storeId: sql`gen_random_uuid()`,
          ownerPublicId: draft.ownerPublicId,
          slug: draft.slug,
          titleAr: draft.titleAr,
          titleEn: draft.titleEn ?? null,
          titleUr: draft.titleUr ?? null,
          descriptionAr: draft.descriptionAr ?? null,
          categoryId: draft.categoryId,
          state: draft.state,
          stateSequence: draft.stateSequence,
        })
        .returning();
      const row = rows[0];
      if (!row) throw validationFailed("store", "one inserted row");
      return toStore(row);
    } catch (error) {
      throw translateConstraint(error, { storeSlug: draft.slug }) ?? error;
    }
  }

  async findStoreById(storeId: string): Promise<StoreRecord | undefined> {
    const rows = await this.db.select().from(stores).where(eq(stores.storeId, storeId)).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toStore(row);
  }

  /**
   * يقرأ المتجرَ باللاحقةِ **بلا حساسيّةِ حالةِ الأحرف** — مطابقاً للفهرسِ الفريدِ في العقد.
   *
   * `LOWER(slug) = LOWER($1)` لا `slug = $1`: الفهرسُ الفريدُ `ux_stores_slug_lower` يمنع
   * وجودَ `Wasla-Store` و`wasla-store` معاً، فقراءةٌ حسّاسةٌ للحالةِ كانت ستُعيد «غيرَ موجود»
   * لرابطٍ نُسخ من رسالةٍ بحرفٍ كبير — أي 404 على متجرٍ قائم. والدالّةُ تُطابق **الفهرسَ**
   * فيبقى مسارُ القراءةِ على فهرسٍ لا على مسحٍ كامل.
   */
  async findStoreBySlug(slug: string): Promise<StoreRecord | undefined> {
    const rows = await this.db
      .select()
      .from(stores)
      .where(sql`lower(${stores.slug}) = lower(${slug})`)
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toStore(row);
  }

  /**
   * يعدّ متاجرَ مالكٍ في الحالاتِ النشطة — مُدخلُ `assertOwnerStoreLimit`.
   *
   * القائمةُ `STORE_ACTIVE_STATES` تُقرأ من المجالِ ولا تُكتب هنا حالاتٍ ثانيةً: نسخُها كان
   * سيجعل حدَّ المالكِ يُحسب في القاعدةِ على قائمةٍ وفي المجالِ على أخرى، فيُرفض مالكٌ له متجرٌ
   * مؤرشفٌ وحدَه — وهو أوّلُ ما يشتكي منه مَن أغلق متجراً ليفتح غيرَه.
   */
  async countActiveStoresForOwner(ownerPublicId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(stores)
      .where(
        and(
          eq(stores.ownerPublicId, ownerPublicId),
          inArray(stores.state, [...STORE_ACTIVE_STATES]),
        ),
      );
    return rows[0]?.count ?? 0;
  }

  async insertProduct(draft: ProductDraft): Promise<ProductRecord> {
    try {
      const rows = await this.db
        .insert(products)
        .values({
          productId: sql`gen_random_uuid()`,
          storeId: draft.storeId,
          sku: draft.sku,
          titleAr: draft.titleAr,
          titleEn: draft.titleEn ?? null,
          titleUr: draft.titleUr ?? null,
          descriptionAr: draft.descriptionAr ?? null,
          categoryId: draft.categoryId,
          priceMinorUnits: draft.priceMinorUnits,
          currencyCode: draft.currencyCode,
          state: draft.state,
          moderationState: draft.moderationState,
          moderationSequence: draft.moderationSequence,
          createdByPublicId: draft.createdByPublicId,
        })
        .returning();
      const row = rows[0];
      if (!row) throw validationFailed("product", "one inserted row");
      return toProduct(row);
    } catch (error) {
      throw translateConstraint(error) ?? error;
    }
  }

  async findProductById(productId: string): Promise<ProductRecord | undefined> {
    const rows = await this.db
      .select()
      .from(products)
      .where(eq(products.productId, productId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toProduct(row);
  }

  /**
   * منتجاتُ متجرٍ مرتّبةً برمزِ الصنفِ — ترتيبٌ مُعلَنٌ لا ما يعطيه المحرّك.
   *
   * قراءةٌ بلا `ORDER BY` تعود بترتيبٍ غيرِ محدَّدٍ يتغيّر بعد أوّلِ `VACUUM`، فيصير اختبارٌ
   * يمرّ اليومَ ويسقط بعد شهرٍ بلا تغييرِ سطرٍ واحدٍ في الكود. و`sku` فريدٌ داخلَ المتجرِ
   * (`ux_products_store_sku`) فالترتيبُ به تامٌّ لا يحتاج فاصلاً ثانياً.
   */
  async listProductsByStore(storeId: string): Promise<ReadonlyArray<ProductRecord>> {
    const rows = await this.db
      .select()
      .from(products)
      .where(eq(products.storeId, storeId))
      .orderBy(asc(products.sku));
    return rows.map(toProduct);
  }
  /**
   * صفحةُ متاجرَ بمُرشِّحٍ ومفتاحٍ مُركَّب — الأحدثُ أوّلاً.
   *
   * والقراءةُ تطلب `limit + 1` صفّاً ثمّ تُسقط الزائد: هذه هي الطريقةُ الوحيدةُ لمعرفةِ «هل
   * بعدها شيء؟» بلا `count(*)` على المجموعةِ كلِّها. وغيابُ `next_cursor` هو إشارةُ الانتهاءِ
   * الوحيدة — لا عددُ الصفوفِ، لأنّ صفحةً تامّةً قد تكون الأخيرة.
   *
   * ولا فرعَ «بلا مُرشِّح» هنا: المسحُ الكاملُ يُرفض على الحدِّ برمزٍ مُسمّىً
   * (`MARKETPLACE_FILTER_REQUIRED`) قبل أن يصل المخزنَ.
   */
  async listStoresPage(filter: StorePageFilter): Promise<Page<StoreRecord, StorePageCursor>> {
    const limit = boundedPageLimit(filter.limit);
    const conditions = [];
    if (filter.state !== undefined) conditions.push(eq(stores.state, filter.state));
    if (filter.ownerPublicId !== undefined) {
      conditions.push(eq(stores.ownerPublicId, filter.ownerPublicId));
    }
    if (filter.categoryId !== undefined) conditions.push(eq(stores.categoryId, filter.categoryId));
    if (filter.after !== undefined) {
      const boundary = new Date(filter.after.createdAt);
      conditions.push(
        keysetWindow(
          or(
            lt(stores.createdAt, boundary),
            and(eq(stores.createdAt, boundary), lt(stores.storeId, filter.after.storeId)),
          ),
        ),
      );
    }

    const rows = await this.db
      .select()
      .from(stores)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .orderBy(desc(stores.createdAt), desc(stores.storeId))
      .limit(limit + 1);

    const page = rows.slice(0, limit).map(toStore);
    const last = rows.length > limit ? page[page.length - 1] : undefined;
    return last === undefined
      ? { items: page }
      : { items: page, nextCursor: { createdAt: last.createdAt, storeId: last.storeId } };
  }

  /**
   * صفحةُ منتجاتِ متجرٍ مع حقائقِ ظهورِها — الأحدثُ أوّلاً.
   *
   * ولا مُرشِّحَ `visible_only` في هذا الاستعلام: الظهورُ دالّةٌ في المجال (`isVisible`)،
   * وكتابةُ شروطِها الأربعةِ ثانيةً في `WHERE` كانت ستُنشئ نسختَين تنحرف إحداهما عن الأخرى
   * عند أوّلِ تعديلٍ للشرط. فالمخزنُ يُعيد الحقائق، والطبقةُ العليا تسأل المجالَ — ولذلك قد
   * تعود صفحةٌ أقصرَ من `limit` عند `visible_only=true`، وغيابُ `next_cursor` وحدَه هو
   * الانتهاء.
   */
  async listProductsPage(
    storeId: string,
    filter: ProductPageFilter = {},
  ): Promise<Page<ProductVisibilityRow, ProductPageCursor>> {
    const limit = boundedPageLimit(filter.limit);
    const conditions = [eq(products.storeId, storeId)];
    if (filter.state !== undefined) conditions.push(eq(products.state, filter.state));
    if (filter.moderationState !== undefined) {
      conditions.push(eq(products.moderationState, filter.moderationState));
    }
    if (filter.after !== undefined) {
      const boundary = new Date(filter.after.createdAt);
      conditions.push(
        keysetWindow(
          or(
            lt(products.createdAt, boundary),
            and(eq(products.createdAt, boundary), lt(products.productId, filter.after.productId)),
          ),
        ),
      );
    }

    const rows = await this.db
      .select({
        product: products,
        store: stores,
        quantityOnHand: productInventory.quantityOnHand,
        lastAdjustmentSequence: productInventory.lastAdjustmentSequence,
      })
      .from(products)
      .innerJoin(stores, eq(stores.storeId, products.storeId))
      .leftJoin(productInventory, eq(productInventory.productId, products.productId))
      .where(and(...conditions))
      .orderBy(desc(products.createdAt), desc(products.productId))
      .limit(limit + 1);

    const page: ProductVisibilityRow[] = rows.slice(0, limit).map((row) => ({
      product: toProduct(row.product),
      storeState: toStore(row.store).state,
      storeSlug: row.store.slug,
      quantityOnHand: row.quantityOnHand ?? INVENTORY_INITIAL_QUANTITY,
      lastAdjustmentSequence: row.lastAdjustmentSequence ?? INVENTORY_INITIAL_SEQUENCE,
    }));
    const last = rows.length > limit ? page[page.length - 1] : undefined;
    return last === undefined
      ? { items: page }
      : {
          items: page,
          nextCursor: {
            createdAt: last.product.createdAt,
            productId: last.product.productId,
          },
        };
  }

  /**
   * منتجٌ واحدٌ مع حقائقِ ظهورِه — نفسُ الوصلةِ بلا تصفيح.
   *
   * ولمَ لا `findProductById` ثمّ قراءتان؟ لأنّ ثلاثَ قراءاتٍ في معاملةٍ واحدةٍ تُعيد ثلاثَ
   * لقطاتٍ منسجمةً هنا، لكنّها في قراءةٍ بلا معاملةٍ (وهو حالُ `GET`) قد تُصيب حالتَي متجرٍ
   * مختلفتَين قبلَ وبعدَ قرارِ مُعتدِلٍ — فيُقال «ظاهرٌ» عن منتجٍ في متجرٍ أُوقف.
   */
  async findProductVisibility(productId: string): Promise<ProductVisibilityRow | undefined> {
    const rows = await this.db
      .select({
        product: products,
        store: stores,
        quantityOnHand: productInventory.quantityOnHand,
        lastAdjustmentSequence: productInventory.lastAdjustmentSequence,
      })
      .from(products)
      .innerJoin(stores, eq(stores.storeId, products.storeId))
      .leftJoin(productInventory, eq(productInventory.productId, products.productId))
      .where(eq(products.productId, productId))
      .limit(1);
    const row = rows[0];
    return row === undefined
      ? undefined
      : {
          product: toProduct(row.product),
          storeState: toStore(row.store).state,
          storeSlug: row.store.slug,
          quantityOnHand: row.quantityOnHand ?? INVENTORY_INITIAL_QUANTITY,
          lastAdjustmentSequence: row.lastAdjustmentSequence ?? INVENTORY_INITIAL_SEQUENCE,
        };
  }
}
