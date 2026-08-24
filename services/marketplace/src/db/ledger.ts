/**
 * الدفاترُ الثلاثة: مراجعاتُ المتجرِ · مراجعاتُ اعتدالِ المنتجِ · فروقُ المخزون.
 *
 * ## القرار: إضافةٌ وقراءةٌ فقط — ولا `update` ولا `delete` في هذا الملفِّ بحال
 *
 * الدفترُ هو الحقيقةُ (القرار 1 و5). وتعديلُ صفٍّ فيه يُبدّل ماضياً قرأه غيرُنا: لوحةُ اعتدالٍ
 * أرَت أنّ متجراً رُفض لسببٍ، ثمّ صار السببُ غيرَه، فلا أحدَ يعرف أيَّهما أُبلغ صاحبُ المتجر.
 * وحذفُ صفٍّ يجعل «مَن قرّر هذا؟» سؤالاً بلا جواب. والحارسُ ليس نيّةً: `purity.test.ts` يمنع
 * `.delete(` و`DELETE`/`TRUNCATE` في كلِّ الحزمةِ **بلا استثناء**، ويمنع `.update(` في هذا
 * الملفِّ باسمه.
 *
 * ## والتسلسلُ يُمرَّر ولا يُخترَع هنا
 *
 * `stateSequence` يأتي محسوباً من `deriveStoreState(ledger).stateSequence + 1` في الطبقةِ
 * التي قرأت الدفترَ. ومخزنٌ يحسب `MAX(state_sequence) + 1` بنفسِه كان سيُخفي السباقَ: القراءةُ
 * والكتابةُ في استعلامَين، فقرارانِ متزامنانِ يقرآن نفسَ الأقصى ويكتبان نفسَ التسلسل. والحارسُ
 * فهرسٌ فريدٌ في العقدِ (`ux_store_reviews_sequence`) يُسقط الثاني **فشلاً مُسمّىً**، ووحدةُ
 * العملِ تُعيد تشغيل العمليّةِ من قراءةٍ جديدة (`unit-of-work.ts`). فالتسلسلُ مُدخلٌ ظاهرٌ لا
 * حسابٌ مدفونٌ في المخزن.
 *
 * ## ولا اشتقاقَ حالةٍ ولا طيَّ رصيدٍ هنا
 *
 * `listStoreReviews` تُعيد الدفترَ مرتّباً و`deriveStoreState` تشتقّ. ولو اشتقّ المخزنُ لصار
 * للاشتقاقِ نسختان: واحدةٌ في SQL وأخرى في TypeScript، وأوّلُ قرارٍ يُضاف إلى العقدِ يُحدَّث في
 * إحداهما — فتقول لوحةُ الاعتدالِ حالةً ويقول مسارُ القراءةِ غيرَها.
 *
 * والترتيبُ بالتسلسلِ **صاعداً** لا بالزمن: قرارانِ في نفسِ المللي ثانيةِ يجعلان الترتيبَ
 * الزمنيَّ غيرَ حاسمٍ، والتسلسلُ فريدٌ بقيدٍ فالترتيبُ به تامٌّ وحتميّ.
 */

import { asc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

import type { DbOrTx } from "./client.js";
import { translateConstraint } from "./constraints.js";
import { inventoryAdjustments, productReviews, storeReviews } from "./schema.js";
import {
  toInventoryAdjustment,
  toProductReview,
  toStoreReview,
  type InventoryAdjustmentRecord,
  type ProductReviewRecord,
  type StoreReviewRecord,
} from "./rows.js";
import { validationFailed } from "../domain/errors.js";
import type {
  InventoryAdjustmentEntry,
  ProductReviewEntry,
  StoreReviewEntry,
} from "../domain/model.js";

export class PostgresMarketplaceLedger {
  constructor(private readonly db: DbOrTx) {}

  /** يُضيف قرارَ متجرٍ إلى الدفتر. الأخطاءُ المُسمّاةُ تُترجَم، وغيرُها يُعاد رميُه خامّاً. */
  async appendStoreReview(
    storeId: string,
    entry: StoreReviewEntry,
  ): Promise<StoreReviewRecord> {
    try {
      const rows = await this.db
        .insert(storeReviews)
        .values({
          reviewId: sql`gen_random_uuid()`,
          storeId,
          decision: entry.decision,
          reasonCode: entry.reasonCode ?? null,
          actorType: entry.actorType,
          actorPublicId: entry.actorPublicId ?? null,
          fromState: entry.fromState,
          toState: entry.toState,
          stateSequence: entry.stateSequence,
          decidedAt: new Date(entry.decidedAt),
        })
        .returning();
      const row = rows[0];
      if (!row) throw validationFailed("store_review", "one inserted row");
      return toStoreReview(row);
    } catch (error) {
      throw translateConstraint(error) ?? error;
    }
  }

  async listStoreReviews(storeId: string): Promise<ReadonlyArray<StoreReviewRecord>> {
    const rows = await this.db
      .select()
      .from(storeReviews)
      .where(eq(storeReviews.storeId, storeId))
      .orderBy(asc(storeReviews.stateSequence));
    return rows.map(toStoreReview);
  }

  async appendProductReview(
    productId: string,
    entry: ProductReviewEntry,
  ): Promise<ProductReviewRecord> {
    try {
      const rows = await this.db
        .insert(productReviews)
        .values({
          reviewId: sql`gen_random_uuid()`,
          productId,
          decision: entry.decision,
          reasonCode: entry.reasonCode ?? null,
          actorType: entry.actorType,
          actorPublicId: entry.actorPublicId ?? null,
          fromState: entry.fromState,
          toState: entry.toState,
          moderationSequence: entry.moderationSequence,
          decidedAt: new Date(entry.decidedAt),
        })
        .returning();
      const row = rows[0];
      if (!row) throw validationFailed("product_review", "one inserted row");
      return toProductReview(row);
    } catch (error) {
      throw translateConstraint(error) ?? error;
    }
  }

  async listProductReviews(productId: string): Promise<ReadonlyArray<ProductReviewRecord>> {
    const rows = await this.db
      .select()
      .from(productReviews)
      .where(eq(productReviews.productId, productId))
      .orderBy(asc(productReviews.moderationSequence));
    return rows.map(toProductReview);
  }

  /**
   * يُضيف فرقَ مخزونٍ محسوباً في `applyInventoryAdjustment`.
   *
   * `quantityAfter` يُكتب كما حُسِب ولا يُحسب هنا: المجالُ يمنع النزولَ تحت الصفرِ برمزٍ
   * مُسمّىً (`INVENTORY_INSUFFICIENT_QUANTITY`) قبل الكتابة، والفحصُ في العقدِ
   * (`quantity_after >= 0`) خطُّ دفاعٍ ثانٍ لا بديل. وحسابُه في SQL كان سيجعل الرصيدَ يُشتقّ
   * في موضعَين ويختلفان أوّلَ مرّةٍ يُكتب فرقٌ خارجَ هذا المسار.
   */
  async appendInventoryAdjustment(
    productId: string,
    entry: InventoryAdjustmentEntry,
  ): Promise<InventoryAdjustmentRecord> {
    try {
      const rows = await this.db
        .insert(inventoryAdjustments)
        .values({
          adjustmentId: sql`gen_random_uuid()`,
          productId,
          quantityDelta: entry.quantityDelta,
          quantityAfter: entry.quantityAfter,
          reasonCode: entry.reasonCode,
          actorPublicId: entry.actorPublicId,
          adjustmentSequence: entry.adjustmentSequence,
          occurredAt: new Date(entry.occurredAt),
        })
        .returning();
      const row = rows[0];
      if (!row) throw validationFailed("inventory_adjustment", "one inserted row");
      return toInventoryAdjustment(row);
    } catch (error) {
      throw translateConstraint(error) ?? error;
    }
  }

  async listInventoryAdjustments(
    productId: string,
  ): Promise<ReadonlyArray<InventoryAdjustmentRecord>> {
    const rows = await this.db
      .select()
      .from(inventoryAdjustments)
      .where(eq(inventoryAdjustments.productId, productId))
      .orderBy(asc(inventoryAdjustments.adjustmentSequence));
    return rows.map(toInventoryAdjustment);
  }
}
