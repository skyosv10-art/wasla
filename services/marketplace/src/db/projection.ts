/**
 * الإسقاطُ: كتابةُ ما اشتُقَّ من الدفترِ في الصفِّ المُتحقِّق — لا قرارٌ جديدٌ ولا حقيقةٌ ثانية.
 *
 * ## القرار: الحالةُ إسقاطٌ لا مصدر (القرار 1 · §19.2/1)
 *
 * `stores.state` و`products.moderation_state` و`product_inventory.quantity_on_hand` أعمدةُ
 * قراءةٍ سريعةٍ لا أكثر: كلُّها قابلةٌ لإعادةِ البناءِ من `store_reviews` و`product_reviews`
 * و`inventory_adjustments` **بلا فقدِ حقيقةٍ**. ولذلك تأخذ كلُّ دالّةٍ هنا مُدخلاً اشتقّه
 * المجالُ (`DerivedStoreState` · `DerivedProductModeration` · فرقُ مخزونٍ مُطبَّق) ولا تحسب
 * شيئاً.
 *
 * وكتابةُ العمودِ بلا صفٍّ في الدفترِ **عطبٌ** لا اختصار: متجرٌ يصير `approved` ولا أحدَ يعرف
 * مَن اعتمده ولا متى ولا على أيِّ سببٍ — وأوّلُ شكوى تصل الاعتدالَ لا يوجد ما يُقرأ للجواب.
 * والحارسُ اليومَ اختبارُ تكاملٍ يُعيد بناءَ الحالةِ من الدفترِ ويقارنها بالعمودِ صفّاً صفّاً.
 *
 * ## ولماذا التحديثُ مشروطٌ بالتسلسل
 *
 * `WHERE state_sequence < :sequence` ليس تشدّداً: التسليمُ في هذا النظامِ at-least-once
 * وإعادةُ التشغيلِ واردةٌ، فإسقاطٌ قديمٌ قد يصل بعد أحدث. وتحديثٌ بلا شرطٍ كان سيُرجع متجراً
 * معتمَداً إلى `pending_review` لأنّ محاولةً أقدمَ تأخّرت في الشبكة — وهو أسوأُ عطبٍ ممكنٍ في
 * لوحةِ الاعتدال: حالةٌ ترتدّ بلا قرارٍ يُفسّرها. والشرطُ يجعل الأقدمَ **لا يفعل شيئاً**
 * ويُعيد `undefined`، فيُقرأ التجاهلُ صريحاً لا صمتاً.
 *
 * ## و`first_approved_at` يُكتب مرّةً ولا يُدهَس
 *
 * `COALESCE(first_approved_at, :value)` لا إسنادٌ مباشر: بها تُقفَل اللاحقةُ إلى الأبدِ من
 * أوّلِ اعتمادٍ (القرار 7). وإسنادٌ مباشرٌ كان سيجعل إيقافاً ثمّ إعادةَ تشغيلٍ يُعيد كتابةَ
 * اللحظةِ، فتُفتح لاحقةُ متجرٍ نُشِر رابطُه للتغيير — وذاك بابُ انتحالٍ لا مجرَّدُ حقلٍ خطأ.
 */

import { and, eq, lt, sql } from "drizzle-orm";

import type { DbOrTx } from "./client.js";
import { translateConstraint } from "./constraints.js";
import { productInventory, products, stores } from "./schema.js";
import {
  toInventory,
  toProduct,
  toStore,
  type InventoryRecord,
  type ProductRecord,
  type StoreRecord,
} from "./rows.js";
import type {
  DerivedProductModeration,
  DerivedStoreState,
  InventoryAdjustmentEntry,
} from "../domain/model.js";

export class PostgresMarketplaceProjection {
  constructor(private readonly db: DbOrTx) {}

  /**
   * يكتب حالةَ متجرٍ مُشتقّةً إن كانت أحدثَ من المكتوب، وإلّا لا يفعل شيئاً.
   *
   * `updated_at = now()` هنا لأنّ هذه لحظةُ مسكِ دفترٍ لا حقيقةُ قرار: لحظةُ القرارِ محفوظةٌ
   * في `store_reviews.decided_at` ولا تُنسخ في المورد. ونسخُها كان سيُنتج مصدرَ حقيقةٍ ثانياً
   * للحظةٍ يُقارن بها المستهلكُ الترتيبَ.
   */
  async projectStoreState(
    storeId: string,
    derived: DerivedStoreState,
  ): Promise<StoreRecord | undefined> {
    const rows = await this.db
      .update(stores)
      .set({
        state: derived.state,
        stateSequence: derived.stateSequence,
        firstApprovedAt:
          derived.firstApprovedAt === undefined
            ? sql`${stores.firstApprovedAt}`
            : sql`coalesce(${stores.firstApprovedAt}, ${new Date(derived.firstApprovedAt)})`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(stores.storeId, storeId), lt(stores.stateSequence, derived.stateSequence)))
      .returning();
    const row = rows[0];
    return row === undefined ? undefined : toStore(row);
  }

  /**
   * يكتب اعتدالَ منتجٍ مُشتقّاً.
   *
   * ولو كان المنتجُ منشوراً وصار اعتدالُه `rejected` لسقط `ck_products_published_moderated`
   * في القاعدة — وهذا **مقصود**: القرارُ الصحيحُ هو خفضُ حالةِ النشرِ في نفسِ المعاملةِ
   * (`projectProductState`) لا ترْكُ منتجٍ منشورٍ مرفوضِ الاعتدالِ في الكتالوج. والقيدُ يجعل
   * النسيانَ فشلاً عند الكتابةِ لا شكوىً بعد أسبوع.
   */
  async projectProductModeration(
    productId: string,
    derived: DerivedProductModeration,
  ): Promise<ProductRecord | undefined> {
    try {
      const rows = await this.db
        .update(products)
        .set({
          moderationState: derived.moderationState,
          moderationSequence: derived.moderationSequence,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(products.productId, productId),
            lt(products.moderationSequence, derived.moderationSequence),
          ),
        )
        .returning();
      const row = rows[0];
      return row === undefined ? undefined : toProduct(row);
    } catch (error) {
      throw translateConstraint(error, { moderationState: derived.moderationState }) ?? error;
    }
  }

  /**
   * يكتب حالةَ نشرِ منتجٍ (`draft` · `published` · `archived`) بقرارٍ من المتجر لا من المُراجع.
   *
   * لا شرطَ تسلسلٍ هنا لأنّ حالةَ النشرِ ليست دفتراً مُسلسلاً: هي قرارُ صاحبِ المتجرِ الحاضر،
   * ويحكمُ انتقالَها `assertProductTransition` في المجالِ وقيدُ العقدِ عند الكتابة.
   */
  async projectProductState(
    productId: string,
    state: ProductRecord["state"],
  ): Promise<ProductRecord | undefined> {
    try {
      const rows = await this.db
        .update(products)
        .set({ state, updatedAt: sql`now()` })
        .where(eq(products.productId, productId))
        .returning();
      const row = rows[0];
      return row === undefined ? undefined : toProduct(row);
    } catch (error) {
      throw translateConstraint(error) ?? error;
    }
  }

  async findInventory(productId: string): Promise<InventoryRecord | undefined> {
    const rows = await this.db
      .select()
      .from(productInventory)
      .where(eq(productInventory.productId, productId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toInventory(row);
  }

  /**
   * يكتب رصيدَ منتجٍ بعد فرقٍ مُطبَّق — إنشاءً في أوّلِ فرقٍ وتحديثاً بعده.
   *
   * `onConflictDoUpdate` باستعلامٍ واحدٍ لا «اقرأ ثمّ قرّر»: قراءةٌ فكتابةٌ في استعلامَين
   * تُنتج فرقَين متزامنَين يُنشئان الصفَّ مرّتين فيسقط الثاني على المفتاحِ الأوّليّ. والشرطُ
   * `last_adjustment_sequence < :sequence` في `where` يجعل الفرقَ المُعادَ إرسالُه (نفسُ
   * التسلسل) لا يُغيّر شيئاً — وهذا هو ما يجعل إعادةَ التشغيلِ سالمةً بلا مفتاحِ تفرّدٍ في
   * هذه الطبقة.
   *
   * ولا حسابَ هنا: `quantity_after` محسوبٌ في `applyInventoryAdjustment` ومكتوبٌ في الدفتر،
   * والرصيدُ ينسخُه. وجمعُ الفروقِ في SQL (`quantity_on_hand + :delta`) كان سيصير مصدرَ
   * حقيقةٍ ثانياً يختلف عن الدفترِ عند أوّلِ إعادةِ تشغيلٍ، وحارسُ الانحرافِ وُجد ليمسك هذا.
   */
  async applyInventoryProjection(
    productId: string,
    entry: InventoryAdjustmentEntry,
  ): Promise<InventoryRecord | undefined> {
    const rows = await this.db
      .insert(productInventory)
      .values({
        productId,
        quantityOnHand: entry.quantityAfter,
        lastAdjustmentSequence: entry.adjustmentSequence,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: productInventory.productId,
        set: {
          quantityOnHand: entry.quantityAfter,
          lastAdjustmentSequence: entry.adjustmentSequence,
          updatedAt: sql`now()`,
        },
        where: lt(productInventory.lastAdjustmentSequence, entry.adjustmentSequence),
      })
      .returning();
    const row = rows[0];
    return row === undefined ? undefined : toInventory(row);
  }
}
