/**
 * قرارُ انتقالِ التنفيذِ (المراجعةُ 11/N · ADR-026 §4.13).
 *
 * انتقالاتُ الإكمالِ الستّةُ الباقيةُ (`confirmed → picking → picked →
 * ready_for_delivery → handed_to_courier → delivered`) تُدارُ من مسارٍ واحدٍ.
 *
 * # البوّابةُ المركَّبةُ: `delivered` يتطلَّبُ إثباتاً
 *
 * حافّةُ `handed_to_courier → delivered` هي الحافّةُ الوحيدةُ التي تتطلَّبُ إثباتَ
 * تسليمٍ (§2.4). ولا يُسمحُ بالوصولِ إلى `delivered` من أيِّ طريقٍ آخر.
 *
 * # الخصمُ النهائيُّ عندَ `delivered`
 *
 * عندَ `handed_to_courier → delivered` تنتقلُ حالةُ المخزونِ من `reserved` إلى
 * `consumed` في نفسِ المعاملةِ. لا نداءَ للسوقِ: الحجزُ خصمٌ بالفعل، والخصمُ
 * النهائيُّ قرارُ تسليمٍ داخليٌّ. والإلغاءُ بعدَ `consumed` لا يُطلِقُ الحجزَ.
 */

import { illegalTransition } from "./errors.js";
import type { StoreOrder } from "./model.js";
import type { ProofOfDelivery } from "./model.js";
import { isFulfillmentTransitionAllowed } from "./state-machine.js";
import type { FulfillmentReasonCode, FulfillmentState } from "@wasla/contracts-delivery";

/** ما يحتاجُهُ المخزنُ ليكتبَ انتقالَ التنفيذِ. */
export interface FulfillmentTransitionDecision {
  readonly fromFulfillmentState: FulfillmentState;
  readonly toFulfillmentState: FulfillmentState;
  readonly reasonCode: FulfillmentReasonCode;
  /** true when this edge consumes inventory (handed_to_courier → delivered). */
  readonly consumesInventory: boolean;
}

const REASON_CODES: Record<string, FulfillmentReasonCode> = {
  "confirmed→picking": "PICKING_STARTED",
  "picking→picked": "PICKING_COMPLETED",
  "picked→ready_for_delivery": "READY_FOR_HANDOVER",
  "ready_for_delivery→handed_to_courier": "COURIER_ACCEPTED",
  "handed_to_courier→delivered": "DELIVERED_WITH_PROOF",
};

/**
 * @param order - The order as read from the store.
 * @param toState - The target fulfillment state.
 * @param proof - Proof of delivery (required for `delivered`).
 * @param traceId - For error context.
 */
export function decideFulfillmentTransition(
  order: StoreOrder,
  toState: FulfillmentState,
  proof: ProofOfDelivery | null,
  traceId?: string,
): FulfillmentTransitionDecision {
  const from = order.fulfillmentState;

  if (!isFulfillmentTransitionAllowed(from, toState)) {
    throw illegalTransition(from, toState, traceId);
  }

  // The proof gate (§2.4): delivered ONLY with proof of delivery.
  if (toState === "delivered" && proof === null) {
    throw illegalTransition(from, toState, traceId);
  }

  const key = `${from}→${toState}`;
  const reasonCode = REASON_CODES[key] ?? "FULFILLMENT_TRANSITION";

  const consumesInventory = from === "handed_to_courier" && toState === "delivered";

  return {
    fromFulfillmentState: from,
    toFulfillmentState: toState,
    reasonCode,
    consumesInventory,
  };
}
