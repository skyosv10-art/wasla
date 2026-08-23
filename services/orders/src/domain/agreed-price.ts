/**
 * Agreed-price rules belong beside the order model, not at the HTTP edge.
 *
 * Negotiation calls this service today, but a replay worker can call the same
 * use case tomorrow. Keeping the policy here prevents the two callers from
 * disagreeing about which lifecycle states may carry negotiation evidence.
 */

import { OrderError } from "./errors.js";
import type { Order } from "./model.js";

const AGREED_PRICE_OPEN_STATUSES = new Set<Order["status"]>([
  "published",
  "searching",
  "offered",
  "negotiating",
  "accepted",
]);

/**
 * A negotiated price is meaningful only before the order leaves the matching
 * window. It records evidence; it never decides the next lifecycle state.
 */
export function assertOrderAcceptsAgreedPrice(order: Order, traceId?: string): void {
  if (order.priceMode !== "negotiable") {
    throw new OrderError(
      "ORDER_PRICE_NOT_NEGOTIABLE",
      "لا يسجّل سعر متفق عليه إلا لطلب قابل للتفاوض",
      { traceId },
    );
  }
  if (!AGREED_PRICE_OPEN_STATUSES.has(order.status)) {
    throw new OrderError(
      "ORDER_NOT_OPEN_FOR_AGREED_PRICE",
      "حالة الطلب لا تقبل تسجيلاً جديداً لسعر متفق عليه",
      { traceId, details: { from: order.status } },
    );
  }
}
