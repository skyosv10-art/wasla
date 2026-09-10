/**
 * Delivery service event builders.
 *
 * Events are built here, in the domain — never at the (deferred) HTTP layer —
 * so a state that changes through ANY entry point emits its event, and the
 * outbox append happens in the same logical operation as the write. This
 * phase's promise: no state changes silently.
 *
 * The envelope shape is contract-owned (@wasla/contracts-delivery):
 * `producer` is always "delivery-service", `aggregate.type` is
 * "store_order" | "delivery_task", and `aggregate.id` is the ORDER UUID for
 * order events and the TASK UUID for task events (internal identity; the
 * public `WS-##########` refs travel inside payloads).
 *
 * Privacy (ADR-026 §2.6): builders accept opaque refs only — there is no
 * parameter through which a name, phone, address or coordinate could enter
 * an event, by construction.
 */

import {
  DELIVERY_EVENT_TYPES,
  type DeliveryActor,
  type DeliveryDomainEvent,
  type DeliveryCompletedV1,
  type DeliveryDispatchRequestedV1,
  type DeliveryDriverAssignedV1,
  type DeliveryEligibilityResolvedV1,
  type DeliveryFailedV1,
  type DeliveryStatusChangedV1,
  type DeliveryTaskCancelledV1,
  type DeliveryTaskCreatedV1,
  type FulfillmentReasonCode,
  type FulfillmentState,
  type IneligibilityReasonCode,
  type InventoryState,
  type OrderLineSnapshot,
  type OrderTotals,
  type PaymentReasonCode,
  type PaymentState,
  type StoreOrderCancelReasonCode,
  type StoreOrderCreatedV1,
  type StoreOrderFulfillmentStateChangedV1,
  type StoreOrderInventoryReservedV1,
  type StoreOrderInventoryReleasedV1,
  type StoreOrderInventoryConsumedV1,
  type StoreOrderItemSubstitutedV1,
  type StoreOrderPaymentStateChangedV1,
  type SubstitutionReasonCode,
  type WaslaPublicId,
} from "@wasla/contracts-delivery";

import type { DeliveryTask, ProofOfDelivery, StoreOrder } from "./model.js";

export type { DeliveryDomainEvent };

/** What every builder needs and cannot invent for itself. */
export interface EventContext {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly traceId?: string | null;
}

/**
 * `store_order.created` — placed with the full item snapshot and money
 * snapshot. The prices here are ORDER snapshots (their own source), not
 * catalog data (ADR-026 §2.6).
 */
export function storeOrderCreatedEvent(
  order: StoreOrder,
  context: EventContext,
  actor: DeliveryActor,
): StoreOrderCreatedV1 {
  return {
    event_id: context.eventId,
    event_type: DELIVERY_EVENT_TYPES.STORE_ORDER_CREATED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "delivery-service",
    aggregate: { type: "store_order", id: order.orderId },
    trace_id: context.traceId ?? null,
    payload: {
      public_id: order.publicId,
      customer_ref: order.customerRef,
      store_id: order.storeId,
      store_slug: order.storeSlug,
      from_state: "draft",
      to_state: order.fulfillmentState,
      items: order.items.map(toLineSnapshot),
      totals: toTotals(order),
      actor,
    },
  };
}

/** `store_order.fulfillment_state_changed` — the decision ledger entry. */
export function storeOrderFulfillmentStateChangedEvent(
  order: StoreOrder,
  from: FulfillmentState,
  reasonCode: FulfillmentReasonCode | StoreOrderCancelReasonCode,
  context: EventContext,
  actor: DeliveryActor,
  options: { proof?: ProofOfDelivery | null } = {},
): StoreOrderFulfillmentStateChangedV1 {
  return {
    event_id: context.eventId,
    event_type: DELIVERY_EVENT_TYPES.STORE_ORDER_FULFILLMENT_STATE_CHANGED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "delivery-service",
    aggregate: { type: "store_order", id: order.orderId },
    trace_id: context.traceId ?? null,
    payload: {
      public_id: order.publicId,
      from_state: from,
      to_state: order.fulfillmentState,
      reason_code: reasonCode,
      payment_state: order.paymentState,
      proof: options.proof
        ? { proof_type: options.proof.proofType, proof_ref: options.proof.proofRef }
        : null,
      actor,
    },
  };
}

/** `store_order.payment_state_changed` — the mirror update, by reference. */
export function storeOrderPaymentStateChangedEvent(
  order: StoreOrder,
  from: PaymentState,
  reasonCode: PaymentReasonCode,
  context: EventContext,
  actor: DeliveryActor,
): StoreOrderPaymentStateChangedV1 {
  return {
    event_id: context.eventId,
    event_type: DELIVERY_EVENT_TYPES.STORE_ORDER_PAYMENT_STATE_CHANGED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "delivery-service",
    aggregate: { type: "store_order", id: order.orderId },
    trace_id: context.traceId ?? null,
    payload: {
      public_id: order.publicId,
      from_state: from,
      to_state: order.paymentState,
      reason_code: reasonCode,
      payment_ref: order.paymentRef,
      actor,
    },
  };
}

/** `store_order.inventory_reserved` — reservation placed at marketplace (§2.3, review 10/N). */
export function storeOrderInventoryReservedEvent(
  order: StoreOrder,
  context: EventContext,
  details: { reservation_ref: string },
): StoreOrderInventoryReservedV1 {
  return {
    event_id: context.eventId,
    event_type: DELIVERY_EVENT_TYPES.STORE_ORDER_INVENTORY_RESERVED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "delivery-service",
    aggregate: { type: "store_order", id: order.orderId },
    trace_id: context.traceId ?? null,
    payload: {
      public_id: order.publicId,
      from_state: order.inventoryState as InventoryState,
      to_state: "reserved",
      reason_code: "INVENTORY_RESERVED",
      reservation_ref: details.reservation_ref,
      actor: { actor_type: "system", actor_ref: null },
    },
  };
}

/** `store_order.inventory_released` — reservation released on cancellation (§2.3, review 10/N). */
export function storeOrderInventoryReleasedEvent(
  order: StoreOrder,
  context: EventContext,
  details: { reservation_ref: string },
): StoreOrderInventoryReleasedV1 {
  return {
    event_id: context.eventId,
    event_type: DELIVERY_EVENT_TYPES.STORE_ORDER_INVENTORY_RELEASED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "delivery-service",
    aggregate: { type: "store_order", id: order.orderId },
    trace_id: context.traceId ?? null,
    payload: {
      public_id: order.publicId,
      from_state: order.inventoryState as InventoryState,
      to_state: "released",
      reason_code: "INVENTORY_RELEASED",
      reservation_ref: details.reservation_ref,
      actor: { actor_type: "system", actor_ref: null },
    },
  };
}

/** `store_order.inventory_consumed` — final consumption at delivery (§4.13, review 11/N). */
export function storeOrderInventoryConsumedEvent(
  order: StoreOrder,
  context: EventContext,
  details: { reservation_ref: string },
): StoreOrderInventoryConsumedV1 {
  return {
    event_id: context.eventId,
    event_type: DELIVERY_EVENT_TYPES.STORE_ORDER_INVENTORY_CONSUMED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "delivery-service",
    aggregate: { type: "store_order", id: order.orderId },
    trace_id: context.traceId ?? null,
    payload: {
      public_id: order.publicId,
      from_state: order.inventoryState as InventoryState,
      to_state: "consumed",
      reason_code: "INVENTORY_CONSUMED",
      reservation_ref: details.reservation_ref,
      actor: { actor_type: "system", actor_ref: null },
    },
  };
}

/**
 * `store_order.item_substituted` — a LINE decision during picking (§2.5).
 * The price delta is computed here from snapshots, never accepted as input.
 */
export function storeOrderItemSubstitutedEvent(
  order: StoreOrder,
  line: { lineNo: number; originalProductId: string; substitutedProductId: string; quantity: number },
  reasonCode: SubstitutionReasonCode,
  substitutedUnitPriceMinorUnits: number,
  context: EventContext,
  actor: DeliveryActor,
): StoreOrderItemSubstitutedV1 {
  const original = order.items.find((i) => i.lineNo === line.lineNo);
  if (!original) {
    throw new Error(`line ${line.lineNo} not found in order ${order.orderId}`);
  }
  const delta =
    (substitutedUnitPriceMinorUnits - original.unitPriceMinorUnits) * line.quantity;
  return {
    event_id: context.eventId,
    event_type: DELIVERY_EVENT_TYPES.STORE_ORDER_ITEM_SUBSTITUTED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "delivery-service",
    aggregate: { type: "store_order", id: order.orderId },
    trace_id: context.traceId ?? null,
    payload: {
      public_id: order.publicId,
      line_no: line.lineNo,
      original_product_id: line.originalProductId,
      substituted_product_id: line.substitutedProductId,
      quantity: line.quantity,
      reason_code: reasonCode,
      price_delta_minor_units: delta,
      actor,
    },
  };
}

/** `delivery.task_created` — the coarse mirror is born pending eligibility. */
export function deliveryTaskCreatedEvent(
  task: DeliveryTask,
  orderPublicId: WaslaPublicId,
  context: EventContext,
): DeliveryTaskCreatedV1 {
  return {
    event_id: context.eventId,
    event_type: DELIVERY_EVENT_TYPES.DELIVERY_TASK_CREATED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "delivery-service",
    aggregate: { type: "delivery_task", id: task.taskId },
    trace_id: context.traceId ?? null,
    payload: {
      order_id: task.orderId,
      order_public_id: orderPublicId,
      from_state: "pending_eligibility",
      to_state: task.state,
    },
  };
}

/** `delivery.eligibility_resolved` — the marketplace port answered (§2.3). */
export function deliveryEligibilityResolvedEvent(
  task: DeliveryTask,
  from: DeliveryTask["state"],
  eligible: boolean,
  ineligibilityReason: IneligibilityReasonCode | null,
  context: EventContext,
): DeliveryEligibilityResolvedV1 {
  return {
    event_id: context.eventId,
    event_type: DELIVERY_EVENT_TYPES.DELIVERY_ELIGIBILITY_RESOLVED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "delivery-service",
    aggregate: { type: "delivery_task", id: task.taskId },
    trace_id: context.traceId ?? null,
    payload: {
      order_id: task.orderId,
      from_state: from,
      to_state: task.state,
      eligible,
      ineligibility_reason: ineligibilityReason,
    },
  };
}

/** `delivery.dispatch_requested` — delegation by reference (§2.4). */
export function deliveryDispatchRequestedEvent(
  task: DeliveryTask,
  from: DeliveryTask["state"],
  context: EventContext,
): DeliveryDispatchRequestedV1 {
  return {
    event_id: context.eventId,
    event_type: DELIVERY_EVENT_TYPES.DELIVERY_DISPATCH_REQUESTED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "delivery-service",
    aggregate: { type: "delivery_task", id: task.taskId },
    trace_id: context.traceId ?? null,
    payload: {
      order_id: task.orderId,
      from_state: from,
      to_state: task.state,
      dispatch_job_ref: task.dispatchJobRef ?? "",
    },
  };
}

/** `delivery.driver_assigned` — the mirror records dispatch's outcome. */
export function deliveryDriverAssignedEvent(
  task: DeliveryTask,
  from: DeliveryTask["state"],
  reasonCode: "dispatch_offer_accepted" | "reassignment_cycle",
  context: EventContext,
): DeliveryDriverAssignedV1 {
  return {
    event_id: context.eventId,
    event_type: DELIVERY_EVENT_TYPES.DELIVERY_DRIVER_ASSIGNED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "delivery-service",
    aggregate: { type: "delivery_task", id: task.taskId },
    trace_id: context.traceId ?? null,
    payload: {
      order_id: task.orderId,
      from_state: from,
      to_state: task.state,
      courier_ref: task.courierRef ?? ("" as WaslaPublicId),
      reason_code: reasonCode,
    },
  };
}

/**
 * `delivery.status_changed` — live status is a STATE TRANSITION, never a
 * location: there is no field here through which coordinates could enter.
 */
export function deliveryStatusChangedEvent(
  task: DeliveryTask,
  from: DeliveryTask["state"],
  reasonCode: "picked_up_from_store" | "in_transit" | "arrived_at_customer" | "offer_timed_out" | "reassignment_cycle" | "offers_exhausted",
  context: EventContext,
  actor: DeliveryActor,
): DeliveryStatusChangedV1 {
  return {
    event_id: context.eventId,
    event_type: DELIVERY_EVENT_TYPES.DELIVERY_STATUS_CHANGED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "delivery-service",
    aggregate: { type: "delivery_task", id: task.taskId },
    trace_id: context.traceId ?? null,
    payload: {
      order_id: task.orderId,
      from_state: from,
      to_state: task.state,
      reason_code: reasonCode,
      courier_ref: task.courierRef,
      actor,
    },
  };
}

/** `delivery.completed` — proof REQUIRED, carried in the payload (§2.4). */
export function deliveryCompletedEvent(
  task: DeliveryTask,
  from: DeliveryTask["state"],
  proof: ProofOfDelivery,
  context: EventContext,
): DeliveryCompletedV1 {
  return {
    event_id: context.eventId,
    event_type: DELIVERY_EVENT_TYPES.DELIVERY_COMPLETED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "delivery-service",
    aggregate: { type: "delivery_task", id: task.taskId },
    trace_id: context.traceId ?? null,
    payload: {
      order_id: task.orderId,
      from_state: from,
      to_state: "delivered",
      proof_type: proof.proofType,
      proof_ref: proof.proofRef,
      courier_ref: task.courierRef ?? ("" as WaslaPublicId),
    },
  };
}

/** `delivery.failed` — a closed reason, nothing else. */
export function deliveryFailedEvent(
  task: DeliveryTask,
  from: DeliveryTask["state"],
  reasonCode: "CUSTOMER_UNREACHABLE" | "ADDRESS_NOT_FOUND" | "ORDER_DAMAGED" | "COURIER_ABORTED" | "ATTEMPTS_EXHAUSTED",
  context: EventContext,
): DeliveryFailedV1 {
  return {
    event_id: context.eventId,
    event_type: DELIVERY_EVENT_TYPES.DELIVERY_FAILED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "delivery-service",
    aggregate: { type: "delivery_task", id: task.taskId },
    trace_id: context.traceId ?? null,
    payload: {
      order_id: task.orderId,
      from_state: from,
      to_state: "failed",
      reason_code: reasonCode,
    },
  };
}

/** `delivery.task_cancelled` — the order's cancellation cascaded. */
export function deliveryTaskCancelledEvent(
  task: DeliveryTask,
  from: DeliveryTask["state"],
  reasonCode: StoreOrderCancelReasonCode,
  context: EventContext,
): DeliveryTaskCancelledV1 {
  return {
    event_id: context.eventId,
    event_type: DELIVERY_EVENT_TYPES.DELIVERY_TASK_CANCELLED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "delivery-service",
    aggregate: { type: "delivery_task", id: task.taskId },
    trace_id: context.traceId ?? null,
    payload: {
      order_id: task.orderId,
      from_state: from,
      to_state: "cancelled",
      reason_code: reasonCode,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Internal mappers                                                    */
/* ------------------------------------------------------------------ */

function toLineSnapshot(item: StoreOrder["items"][number]): OrderLineSnapshot {
  return {
    line_no: item.lineNo,
    product_id: item.productId,
    sku: item.sku,
    quantity: item.quantity,
    unit_price_minor_units: item.unitPriceMinorUnits,
    line_total_minor_units: item.lineTotalMinorUnits,
  };
}

function toTotals(order: StoreOrder): OrderTotals {
  return {
    currency_code: order.currencyCode,
    items_total_minor_units: order.itemsTotalMinorUnits,
    delivery_fee_minor_units: order.deliveryFeeMinorUnits,
    total_minor_units: order.totalMinorUnits,
  };
}
