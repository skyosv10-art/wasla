/**
 * الحجزُ والإفراجُ: بناءُ فروقٍ موقّعةٍ لطلبِ حجزٍ واردٍ من خدمةِ التسليم.
 *
 * ADR-026 §2.3: «حجزُ الكميّةِ ملكُ السوقِ (طلبُ حجزٍ واردٌ من هذا الطورِ)». السوقُ يملكُ
 * دفترَ المخزون، وطلبُ الحجزِ يأتيه من خدمةِ التسليم (الطور 13) لا من صاحبِ المتجر. ولذلك
 * الفاعلُ `system:delivery` لا `WS-##########`، وسبَبُ الفرقِ `reservation` أو `reservation_release`.
 *
 * ## لماذا فروقٌ سالبةٌ لا عمودَ حجزٍ
 *
 * الحجزُ فرقٌ سالبٌ في دفترِ المخزونِ كأيِّ فرقٍ آخر — لذلك يُطوى مع الدفترِ ويُقارَن به، ولا
 * يحتاج عموداً ثانياً (`quantity_reserved`) ينسى مسارٌ تحديثَه. والإفراجُ فرقٌ موجبٌ يُعيد
 * الكميّةَ إلى الرصيد. وعمودُ حجزٍ بلا مالكٍ للإفراجِ يتسرّب أوّلَ مرّةٍ تفشل عمليّةُ شراء.
 *
 * ## ولماذا يُفحَص الرصيدُ قبل الكتابة
 *
 * `applyInventoryAdjustment` يرفع `INVENTORY_INSUFFICIENT_QUANTITY` عند النزولِ تحت الصفر، وهو
 * رمزُ 422 في العقد. ولكنّ الحجزَ يجب أن يُعاد برمزِ 409 (تعارض) لا 422 — لأنّ الكميّةَ
 * غيرُ كافيةٍ ليست خطأَ إدخالٍ بل تعارضُ حالةٍ مع طلبِ شراءٍ قائم. ولذلك يُفحَص الرصيدُ
 * في طبقةِ التطبيقِ ويُعاد 409 قبل أن يصلَ إلى المجال.
 */

import { applyInventoryAdjustment, INVENTORY_INITIAL_QUANTITY, INVENTORY_INITIAL_SEQUENCE } from "./inventory.js";
import type { InventoryAdjustmentEntry } from "./model.js";
import type { InventoryReasonCode } from "./contract-sets.js";

/** الفاعلُ الثابتُ لكلِّ فروقِ الحجزِ والإفراج. */
export const RESERVATION_ACTOR_PUBLIC_ID = "system:delivery";

/** صنفٌ في طلبِ حجزٍ أو إفراج. */
export interface ReservationItem {
  readonly productId: string;
  readonly quantity: number;
}

/** نتيجةُ فرقٍ واحدٍ في الحجزِ أو الإفراج. */
export interface ReservationResult {
  readonly productId: string;
  readonly quantityDelta: number;
  readonly quantityAfter: number;
  readonly adjustmentSequence: number;
  readonly reasonCode: InventoryReasonCode;
}

/**
 * يبني فروقَ حجزٍ سالبةً لكلِّ صنفٍ — يُفحَص الرصيدُ ويُطبَّق الفرقُ بسبَب `reservation`.
 *
 * ولمَ يُعاد `InventoryAdjustmentEntry` لا `ReservationResult`؟ لأنّ الدفترَ يكتب `Entry`
 * لا `Result`، والنتيجةُ تُبنى من الصفِّ المكتوب. ودالّةٌ صرفةٌ تُنتج ما سيُكتب لا ما
 * سيُعاد — فتبقى قابلةً للاختبارِ بلا قاعدة.
 */
export function buildReservationAdjustments(
  items: ReadonlyArray<ReservationItem>,
  inventories: ReadonlyMap<string, { readonly quantityOnHand: number; readonly lastAdjustmentSequence: number }>,
  occurredAt: string,
): ReadonlyArray<InventoryAdjustmentEntry> {
  return items.map((item) => {
    const inventory = inventories.get(item.productId);
    const quantityOnHand = inventory?.quantityOnHand ?? INVENTORY_INITIAL_QUANTITY;
    const lastSequence = inventory?.lastAdjustmentSequence ?? INVENTORY_INITIAL_SEQUENCE;
    return applyInventoryAdjustment({
      quantityOnHand,
      quantityDelta: -item.quantity,
      reasonCode: "reservation",
      actorPublicId: RESERVATION_ACTOR_PUBLIC_ID,
      adjustmentSequence: lastSequence + 1,
      occurredAt,
    });
  });
}

/**
 * يبني فروقَ إفراجٍ موجبةً لكلِّ صنفٍ — بسبَب `reservation_release`.
 *
 * ولا فحصَ للرصيدِ هنا: الإفراجُ زيادةٌ لا سحب، فلا نزولَ تحت الصفر. والتسلسلُ يُقرأ من
 * الإسقاطِ كما في الحجز.
 */
export function buildReleaseAdjustments(
  items: ReadonlyArray<ReservationItem>,
  inventories: ReadonlyMap<string, { readonly quantityOnHand: number; readonly lastAdjustmentSequence: number }>,
  occurredAt: string,
): ReadonlyArray<InventoryAdjustmentEntry> {
  return items.map((item) => {
    const inventory = inventories.get(item.productId);
    const quantityOnHand = inventory?.quantityOnHand ?? INVENTORY_INITIAL_QUANTITY;
    const lastSequence = inventory?.lastAdjustmentSequence ?? INVENTORY_INITIAL_SEQUENCE;
    return applyInventoryAdjustment({
      quantityOnHand,
      quantityDelta: item.quantity,
      reasonCode: "reservation_release",
      actorPublicId: RESERVATION_ACTOR_PUBLIC_ID,
      adjustmentSequence: lastSequence + 1,
      occurredAt,
    });
  });
}

/**
 * يحوّل صفوفَ الدفترِ المكتوبة إلى نتائجَ تُعاد في الجواب.
 *
 * ولمَ لا يُعاد `InventoryAdjustmentRecord` مباشرةً؟ لأنّ الجوابَ يحمل `product_id` وحقولَ
 * مُنتقاةً لا `adjustment_id` ولا `store_id` ولا `actor_public_id` — فهي تفاصيلُ داخليةٌ
 * لا تهمُّ خدمةَ التسليم. والنتيجةُ تُبنى من الصفِّ المكتوب لا من المُدخل.
 */
export function toReservationResults(
  adjustments: ReadonlyArray<{ readonly productId: string; readonly quantityDelta: number; readonly quantityAfter: number; readonly adjustmentSequence: number; readonly reasonCode: InventoryReasonCode }>,
): ReadonlyArray<ReservationResult> {
  return adjustments.map((adjustment) => ({
    productId: adjustment.productId,
    quantityDelta: adjustment.quantityDelta,
    quantityAfter: adjustment.quantityAfter,
    adjustmentSequence: adjustment.adjustmentSequence,
    reasonCode: adjustment.reasonCode,
  }));
}
