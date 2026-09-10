/**
 * قرارُ التأكيدِ — البوّابةُ المركَّبةُ (ADR-026 §2.2 · §3.1 · المراجعةُ 9/N).
 *
 * حالتانِ متعامدتانِ لطلبٍ واحدٍ: تنفيذٌ تقرّرُهُ هذه الخدمةُ، ودفعٌ تعكسُهُ. و
 * `placed → confirmed` هي الحافّةُ الوحيدةُ التي **تقرأُ الحالتَينِ معاً**: لا تأكيدَ
 * بلا مرآةٍ `authorized`. وقد كانَ هذا الشرطُ مُعرَّفاً في آلةِ الحالاتِ منذُ المراجعةِ
 * الأولى (`canConfirmOrder`) ولا مسارَ يستدعيهِ — والمراجعةُ 9/N هي التي وصلَتْهُ.
 *
 * # جوابانِ مختلفانِ لسببَينِ مختلفَينِ
 *
 * طلبٌ في `draft` أو `cancelled` ⇒ `409 DELIVERY_TRANSITION_NOT_ALLOWED`: لا طريقَ
 * من هناكَ إلى `confirmed` في جدولِ §3.1 ولن يكونَ.
 *
 * وطلبٌ في `placed` بمرآةٍ `pending` ⇒ `409 DELIVERY_PAYMENT_NOT_AUTHORIZED`: الطريقُ
 * موجودٌ والشرطُ لم يتحقَّق **بعدُ**. ودمجُ الجوابَينِ في رمزٍ واحدٍ كانَ سيجعلُ
 * العميلَ يتوقّفُ عن الانتظارِ حيثُ الانتظارُ هو الجوابُ الصحيحُ.
 *
 * # ولا تأكيدَ مرّتَينِ
 *
 * `confirmed → confirmed` ليسَ حافّةً، فالتأكيدُ الثاني بلا مفتاحِ تماثُلٍ يُرفَضُ
 * انتقالاً غيرَ مشروعٍ؛ وبالمفتاحِ نفسِهِ يُعادُ جوابُ الأوّلِ. الفرقُ مقصودٌ وهو
 * نفسُ فرقِ الإلغاءِ (`use-cases/cancel-store-order.ts`).
 */

import { illegalTransition, paymentNotAuthorized } from "./errors.js";
import type { StoreOrder } from "./model.js";
import { canConfirmOrder, isFulfillmentTransitionAllowed } from "./state-machine.js";

/** ما يحتاجُهُ المخزنُ ليكتبَ التأكيدَ: الحالةُ التي جاءَ منها. */
export interface ConfirmationDecision {
  readonly fromFulfillmentState: StoreOrder["fulfillmentState"];
}

export function decideConfirmation(order: StoreOrder, traceId?: string): ConfirmationDecision {
  const from = order.fulfillmentState;

  // أوّلاً الطريقُ، ثمّ الشرطُ: طلبٌ ملغىً لا يُقالُ لهُ «انتظِر التخويلَ».
  if (!isFulfillmentTransitionAllowed(from, "confirmed")) {
    throw illegalTransition(from, "confirmed", traceId);
  }

  if (!canConfirmOrder(order)) throw paymentNotAuthorized(order.paymentState, traceId);

  return { fromFulfillmentState: from };
}
