/**
 * قرارُ حجزِ المخزونِ (ADR-026 §2.3 · §3.1 · المراجعةُ 10/N).
 *
 * الحجزُ طلبٌ يُرسَلُ إلى السوقِ عبرَ الحدِّ المتَّفقِ عليهِ: السوقُ يخصمُ من
 * `quantity_on_hand` بحدثِ `marketplace.inventory_adjusted`، والتوصيلُ يخزّنُ
 * المرجعَ والكميّةَ المسؤولَ عنها. التوصيلُ لا يملكُ الرصيدَ — يملكُ الطلبَ.
 *
 * مفتاحُ التماثُلِ مشتقٌّ حتميّاً من `orderPublicId`: إعادةُ المحاولةِ بعدَ
 * انقطاعٍ تُكمِلُ الحجزَ نفسَهُ لا تنشئُ نسخةً. وهذا هو ما يمنعُ الحجزَ المزدوجَ
 * تحتَ التزامنِ: طلبانِ على آخرِ وحدةٍ — مفتاحانِ مختلفانِ، والثاني يرى
 * الرصيدَ صفراً فيرفضُهُ السوقُ.
 */

import type { StoreOrder, StoreOrderItem } from "./model.js";
import type { InventoryState } from "@wasla/contracts-delivery";

/** بنودُ الحجزِ المُشتقَّةُ من أصنافِ الطلبِ. */
export interface ReservationLine {
  readonly productId: string;
  readonly quantity: number;
}

/** ما يحتاجُهُ منفذُ الحجزِ ليبنيَ الطلبَ إلى السوقِ. */
export interface ReservationCommand {
  readonly orderPublicId: string;
  readonly storeSlug: string;
  readonly items: readonly ReservationLine[];
}

/** مفتاحُ التماثُلِ الحتميُّ المشتقُّ من مرجعِ الطلبِ العام. */
export function reservationIdempotencyKey(orderPublicId: string): string {
  return `delivery-reserve:${orderPublicId}:v1`;
}

/** مفتاحُ التماثُلِ لطلبِ التحريرِ. */
export function releaseIdempotencyKey(orderPublicId: string): string {
  return `delivery-release:${orderPublicId}:v1`;
}

/** يبني بندَ حجزٍ واحدٍ من صنفِ طلبٍ واحدٍ. */
export function buildReservationLine(item: StoreOrderItem): ReservationLine {
  return {
    productId: item.productId,
    quantity: item.quantity,
  };
}

/** يبني طلبَ الحجزِ كاملًا من الطلبِ وأصنافِهِ. */
export function buildReservationCommand(order: StoreOrder): ReservationCommand {
  return {
    orderPublicId: order.publicId,
    storeSlug: order.storeSlug,
    items: order.items.map(buildReservationLine),
  };
}

/** هل الحالةُ تسمحُ بالحجزِ؟ فقط `placed` يبدأُ الحجزَ. */
export function canReserveInventory(state: InventoryState): boolean {
  return state === "none" || state === "reserving";
}

/** هل الحالةُ تسمحُ بالتحريرِ؟ `reserved` يُحرَّرُ، و`released` تكرارٌ لا أثرَ لهُ. */
export function canReleaseInventory(state: InventoryState): boolean {
  return state === "reserved" || state === "released";
}

/** هل الطلبُ مؤهَّلٌ للتأكيدِ من حيثُ المخزونُ؟ */
export function isInventoryReserved(state: InventoryState): boolean {
  return state === "reserved";
}
