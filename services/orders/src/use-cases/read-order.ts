/**
 * Reads.
 *
 * `getOrderDetail` returns the order WITH its audit trail and assignment records
 * in one call rather than offering three endpoints. The three are always read
 * together — support answering "why is this order in this state?" needs all of
 * them — and separate reads would let the three answers come from three moments
 * and disagree.
 */

import { OrderError } from "../domain/errors.js";
import type { Assignment, OrderDetail } from "../domain/model.js";
import type { OrderDependencies } from "../ports.js";

/** Read an order by internal id, with history and assignments. */
export async function getOrderDetail(
  deps: Pick<OrderDependencies, "repository">,
  orderId: string,
  options: { readonly traceId?: string } = {},
): Promise<OrderDetail> {
  const order = await deps.repository.findOrderById(orderId);
  if (!order) {
    throw new OrderError("ORDER_NOT_FOUND", `الطلب ${orderId} غير موجود`, {
      traceId: options.traceId,
    });
  }
  const [statusHistory, assignments] = await Promise.all([
    deps.repository.listStatusHistory(order.id),
    deps.repository.listAssignments(order.id),
  ]);
  const activeAssignment: Assignment | null =
    order.activeAssignmentId == null
      ? null
      : assignments.find((a) => a.id === order.activeAssignmentId) ?? null;
  return { order, statusHistory, assignments, activeAssignment };
}

/**
 * Read an order by its public id.
 *
 * Exists because `order_public_id` is the reference every OTHER service holds:
 * the customers service stores it after handover and never learns the UUID. A
 * caller forced to translate would need a lookup the engine already owns.
 */
export async function getOrderDetailByPublicId(
  deps: Pick<OrderDependencies, "repository">,
  orderPublicId: string,
  options: { readonly traceId?: string } = {},
): Promise<OrderDetail> {
  const order = await deps.repository.findOrderByPublicId(orderPublicId);
  if (!order) {
    throw new OrderError("ORDER_NOT_FOUND", `الطلب ${orderPublicId} غير موجود`, {
      traceId: options.traceId,
    });
  }
  return getOrderDetail(deps, order.id, options);
}

/**
 * Read only the order row for service-to-service matching decisions.
 *
 * Loading customer text, stops and history here would widen a cross-service
 * privacy boundary without helping negotiation decide whether it may record.
 */
export async function getOrderByPublicId(
  deps: Pick<OrderDependencies, "repository">,
  orderPublicId: string,
  options: { readonly traceId?: string } = {},
) {
  const order = await deps.repository.findOrderByPublicId(orderPublicId);
  if (!order) {
    throw new OrderError("ORDER_NOT_FOUND", `الطلب ${orderPublicId} غير موجود`, {
      traceId: options.traceId,
    });
  }
  return order;
}
