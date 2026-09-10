/**
 * Cancel a store order (ADR-026 §3.1 · §3.3).
 *
 * Read the order, ask the domain whether `cancelled` is reachable, build the
 * events, and let the store apply the whole decision in ONE transaction
 * guarded by the version the decision was made against.
 *
 * ## Why the version travels with the write
 *
 * The decision is made on a snapshot read outside the transaction. Between
 * the read and the write, a store could confirm the order or dispatch could
 * assign a driver. Sending `expectedVersion` lets the adapter re-check under
 * `SELECT ... FOR UPDATE` and answer `DELIVERY_CONCURRENT_UPDATE` (409)
 * instead of cancelling an order that has moved on. Optimistic concurrency
 * is a promise the whole aggregate makes (`version` in the schema); a use
 * case that dropped it would make that column decorative.
 *
 * ## The task edge may legitimately be absent
 *
 * `decideCancellation` returns `taskCancellation: null` when §3.3 has no
 * edge from the task's current state (a just-placed order sits in
 * `pending_eligibility`). This use case does NOT compensate: no invented
 * transition, no forced state. The gap is declared in ADR-026 §4.9-1.
 */

import type { StoreOrderCancelReasonCode, WaslaPublicId } from "@wasla/contracts-delivery";

import { DeliveryError } from "../domain/errors.js";
import {
  deliveryTaskCancelledEvent,
  storeOrderFulfillmentStateChangedEvent,
  type DeliveryDomainEvent,
  type EventContext,
} from "../domain/events.js";
import type { StoreOrder } from "../domain/model.js";
import { decideCancellation } from "../domain/store-order-cancellation.js";
import type {
  CancellationWrite,
  StoreOrderReadPort,
  StoreOrderWritePort,
} from "../ports.js";

export interface CancelStoreOrderDeps {
  readonly readPort: StoreOrderReadPort;
  readonly writePort: StoreOrderWritePort;
  readonly newUuid: () => string;
  readonly now: () => string;
}

export async function cancelStoreOrder(
  deps: CancelStoreOrderDeps,
  publicId: WaslaPublicId,
  reasonCode: StoreOrderCancelReasonCode,
  traceId: string | null,
): Promise<StoreOrder> {
  const order = await deps.readPort.getOrderByPublicId(publicId);
  if (order === null) {
    throw new DeliveryError("DELIVERY_ORDER_NOT_FOUND", "لا طلبَ بهذا المرجعِ", {
      traceId: traceId ?? undefined,
      details: { field: "orderPublicId", actual: publicId },
    });
  }

  const task = await deps.readPort.getTaskByOrderPublicId(publicId);
  const decision = decideCancellation(order, task, reasonCode);

  const occurredAt = deps.now();
  // The order AFTER the decision — the event builder reads `to_state` from
  // the aggregate, so the aggregate must already carry it.
  const cancelled: StoreOrder = { ...order, fulfillmentState: "cancelled", version: order.version + 1 };

  const events: DeliveryDomainEvent[] = [
    storeOrderFulfillmentStateChangedEvent(
      cancelled,
      decision.fromFulfillmentState,
      reasonCode,
      { eventId: deps.newUuid(), occurredAt, traceId } satisfies EventContext,
      { actor_type: "customer", actor_ref: order.customerRef },
    ),
  ];

  if (decision.taskCancellation !== null && task !== null) {
    events.push(
      deliveryTaskCancelledEvent(
        { ...task, state: "cancelled", version: task.version + 1 },
        decision.taskCancellation.fromState,
        reasonCode,
        { eventId: deps.newUuid(), occurredAt, traceId },
      ),
    );
  }

  const write: CancellationWrite = {
    orderId: order.orderId,
    expectedVersion: order.version,
    fromFulfillmentState: decision.fromFulfillmentState,
    reasonCode,
    taskCancellation: decision.taskCancellation,
    events,
    traceId,
  };

  return deps.writePort.cancelOrder(write);
}
