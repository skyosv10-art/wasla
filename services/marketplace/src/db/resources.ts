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

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { DbOrTx } from "./client.js";
import { translateConstraint } from "./constraints.js";
import { products, stores } from "./schema.js";
import { toProduct, toStore, type ProductRecord, type StoreRecord } from "./rows.js";
import { STORE_ACTIVE_STATES } from "../domain/catalog.js";
import { validationFailed } from "../domain/errors.js";
import type { ProductDraft, StoreDraft } from "../domain/model.js";

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
}
