/**
 * @wasla/contracts-delivery — Store Orders & Delivery domain event types.
 *
 * Hand-derived from services/delivery/contracts/events.json (JSON Schema
 * Event Contract). Every decision payload carries from_state/to_state, a
 * closed reason code and the actor — an event is the effect of a decision
 * that entered a ledger, never an announcement of intent (ADR-026).
 *
 * Privacy (ADR-026 §2.6 · ADR-001 · ADR-007): no names, phones, emails,
 * coordinates or channel ids anywhere — humans are opaque WS-##########
 * refs, and live status is a STATE TRANSITION, not a location.
 *
 * Money: order snapshots only, integer minor units (halalas), SAR alone —
 * this service never processes money (payment is a mirrored external ref,
 * §2.2; billing is M5-17).
 *
 * Versioned: any backward-incompatible change requires v2 + ADR.
 */

import type { components } from "./api-types.js";

/** Shared schema pieces. */
export type WaslaPublicId = components["schemas"]["WaslaPublicId"];
export type FulfillmentState = components["schemas"]["FulfillmentState"];
export type PaymentState = components["schemas"]["PaymentState"];
export type DeliveryTaskState = components["schemas"]["DeliveryTaskState"];
export type ProofType = components["schemas"]["ProofType"];

export type StoreOrderActorType =
  | "system"
  | "customer"
  | "store"
  | "courier"
  | "admin";

export type DeliveryActorType = StoreOrderActorType | "dispatch";

/** The envelope every event must carry. No event without an envelope. */
export interface DeliveryEventEnvelope {
  event_id: string;
  event_type: string;
  event_version: string;
  occurred_at: string;
  producer: "delivery-service";
  aggregate: {
    type: "store_order" | "delivery_task";
    id: string;
  };
  trace_id?: string | null;
}

export interface DeliveryActor {
  actor_type: DeliveryActorType;
  actor_ref?: string | null;
}

/** Closed reason-code catalogs (mirror of events.json $defs). */
export const STORE_ORDER_CANCEL_REASON_CODES = [
  "CUSTOMER_CHANGED_MIND",
  "CUSTOMER_UNAVAILABLE",
  "PAYMENT_FAILED",
  "STORE_REQUESTED",
  "SYSTEM_MAINTENANCE",
  "DELIVERY_NOT_FEASIBLE",
] as const;
export type StoreOrderCancelReasonCode = (typeof STORE_ORDER_CANCEL_REASON_CODES)[number];

export const STORE_ORDER_REJECT_REASON_CODES = [
  "OUT_OF_STOCK",
  "STORE_CLOSED",
  "ITEM_UNAVAILABLE",
  "PRICE_MISMATCH",
  "POLICY_VIOLATION",
] as const;
export type StoreOrderRejectReasonCode = (typeof STORE_ORDER_REJECT_REASON_CODES)[number];

export const FULFILLMENT_REASON_CODES = [
  "CART_CONFIRMED",
  "PAYMENT_AUTHORIZED",
  "PICKING_STARTED",
  "PICKING_COMPLETED",
  "READY_FOR_HANDOVER",
  "COURIER_ACCEPTED",
  "DELIVERED_WITH_PROOF",
  "DELIVERY_ATTEMPTS_EXHAUSTED",
  "SUBSTITUTION_APPLIED",
] as const;
export type FulfillmentReasonCode = (typeof FULFILLMENT_REASON_CODES)[number];

export const PAYMENT_REASON_CODES = [
  "AUTHORIZATION_SUCCEEDED",
  "CAPTURE_SUCCEEDED",
  "AUTHORIZATION_FAILED",
  "REFUND_INITIATED",
  "REFUND_COMPLETED",
  "PARTIAL_REFUND_COMPLETED",
] as const;
export type PaymentReasonCode = (typeof PAYMENT_REASON_CODES)[number];

export const SUBSTITUTION_REASON_CODES = [
  "out_of_stock",
  "customer_approved_alternative",
  "store_policy",
] as const;
export type SubstitutionReasonCode = (typeof SUBSTITUTION_REASON_CODES)[number];

export const INELIGIBILITY_REASON_CODES = [
  "outside_coverage",
  "store_not_orderable",
  "no_courier_service",
] as const;
export type IneligibilityReasonCode = (typeof INELIGIBILITY_REASON_CODES)[number];

export const DELIVERY_FAIL_REASON_CODES = [
  "CUSTOMER_UNREACHABLE",
  "ADDRESS_NOT_FOUND",
  "ORDER_DAMAGED",
  "COURIER_ABORTED",
  "ATTEMPTS_EXHAUSTED",
] as const;
export type DeliveryFailReasonCode = (typeof DELIVERY_FAIL_REASON_CODES)[number];

/** Order money snapshot — integer halalas, SAR alone (ADR-026 §2.6). */
export interface OrderTotals {
  currency_code: "SAR";
  items_total_minor_units: number;
  delivery_fee_minor_units: number;
  total_minor_units: number;
}

/** Item snapshot taken at order time — never read from the catalog again. */
export interface OrderLineSnapshot {
  line_no: number;
  product_id: string;
  sku: string;
  quantity: number;
  unit_price_minor_units: number;
  line_total_minor_units: number;
}

/* ------------------------------------------------------------------ */
/* store_order.* events                                                */
/* ------------------------------------------------------------------ */

export interface StoreOrderCreatedV1 extends DeliveryEventEnvelope {
  event_type: "store_order.created";
  event_version: "v1";
  aggregate: { type: "store_order"; id: string };
  payload: {
    public_id: WaslaPublicId;
    customer_ref: WaslaPublicId;
    store_id: string;
    store_public_id: WaslaPublicId;
    from_state: FulfillmentState;
    to_state: FulfillmentState;
    items: OrderLineSnapshot[];
    totals: OrderTotals;
    actor: DeliveryActor;
  };
}

export interface StoreOrderFulfillmentStateChangedV1 extends DeliveryEventEnvelope {
  event_type: "store_order.fulfillment_state_changed";
  event_version: "v1";
  aggregate: { type: "store_order"; id: string };
  payload: {
    public_id: WaslaPublicId;
    from_state: FulfillmentState;
    to_state: FulfillmentState;
    reason_code: FulfillmentReasonCode | StoreOrderCancelReasonCode | StoreOrderRejectReasonCode;
    payment_state?: PaymentState;
    proof?: { proof_type: ProofType; proof_ref: string } | null;
    actor: DeliveryActor;
  };
}

export interface StoreOrderPaymentStateChangedV1 extends DeliveryEventEnvelope {
  event_type: "store_order.payment_state_changed";
  event_version: "v1";
  aggregate: { type: "store_order"; id: string };
  payload: {
    public_id: WaslaPublicId;
    from_state: PaymentState;
    to_state: PaymentState;
    reason_code: PaymentReasonCode;
    payment_ref?: string | null;
    actor: DeliveryActor;
  };
}

export interface StoreOrderItemSubstitutedV1 extends DeliveryEventEnvelope {
  event_type: "store_order.item_substituted";
  event_version: "v1";
  aggregate: { type: "store_order"; id: string };
  payload: {
    public_id: WaslaPublicId;
    line_no: number;
    original_product_id: string;
    substituted_product_id: string;
    quantity: number;
    reason_code: SubstitutionReasonCode;
    /** محسوبٌ لا مُخمَّن: سعرُ البديلِ ناقصَ لقطةِ الأصليِّ — قد يكونُ سالباً. */
    price_delta_minor_units: number;
    actor: DeliveryActor;
  };
}

/* ------------------------------------------------------------------ */
/* delivery.* events                                                   */
/* ------------------------------------------------------------------ */

export interface DeliveryTaskCreatedV1 extends DeliveryEventEnvelope {
  event_type: "delivery.task_created";
  event_version: "v1";
  aggregate: { type: "delivery_task"; id: string };
  payload: {
    order_id: string;
    order_public_id: WaslaPublicId;
    from_state: DeliveryTaskState;
    to_state: DeliveryTaskState;
  };
}

export interface DeliveryEligibilityResolvedV1 extends DeliveryEventEnvelope {
  event_type: "delivery.eligibility_resolved";
  event_version: "v1";
  aggregate: { type: "delivery_task"; id: string };
  payload: {
    order_id: string;
    from_state: DeliveryTaskState;
    to_state: DeliveryTaskState;
    eligible: boolean;
    ineligibility_reason: IneligibilityReasonCode | null;
  };
}

export interface DeliveryDispatchRequestedV1 extends DeliveryEventEnvelope {
  event_type: "delivery.dispatch_requested";
  event_version: "v1";
  aggregate: { type: "delivery_task"; id: string };
  payload: {
    order_id: string;
    from_state: DeliveryTaskState;
    to_state: DeliveryTaskState;
    /** مرجعُ مهمّةِ dispatch الناتجةِ — التفويضُ بالمرجعِ لا بنسخِ المنطقِ. */
    dispatch_job_ref: string;
  };
}

export interface DeliveryDriverAssignedV1 extends DeliveryEventEnvelope {
  event_type: "delivery.driver_assigned";
  event_version: "v1";
  aggregate: { type: "delivery_task"; id: string };
  payload: {
    order_id: string;
    from_state: DeliveryTaskState;
    to_state: DeliveryTaskState;
    courier_ref: WaslaPublicId;
    reason_code: "dispatch_offer_accepted" | "reassignment_cycle";
  };
}

export interface DeliveryStatusChangedV1 extends DeliveryEventEnvelope {
  event_type: "delivery.status_changed";
  event_version: "v1";
  aggregate: { type: "delivery_task"; id: string };
  payload: {
    order_id: string;
    from_state: DeliveryTaskState;
    to_state: DeliveryTaskState;
    reason_code:
      | "picked_up_from_store"
      | "in_transit"
      | "arrived_at_customer"
      | "offer_timed_out"
      | "offers_exhausted";
    courier_ref?: WaslaPublicId | null;
    actor: DeliveryActor;
  };
}

export interface DeliveryCompletedV1 extends DeliveryEventEnvelope {
  event_type: "delivery.completed";
  event_version: "v1";
  aggregate: { type: "delivery_task"; id: string };
  payload: {
    order_id: string;
    from_state: DeliveryTaskState;
    to_state: "delivered";
    proof_type: ProofType;
    proof_ref: string;
    courier_ref: WaslaPublicId;
  };
}

export interface DeliveryFailedV1 extends DeliveryEventEnvelope {
  event_type: "delivery.failed";
  event_version: "v1";
  aggregate: { type: "delivery_task"; id: string };
  payload: {
    order_id: string;
    from_state: DeliveryTaskState;
    to_state: "failed";
    reason_code: DeliveryFailReasonCode;
  };
}

export interface DeliveryTaskCancelledV1 extends DeliveryEventEnvelope {
  event_type: "delivery.task_cancelled";
  event_version: "v1";
  aggregate: { type: "delivery_task"; id: string };
  payload: {
    order_id: string;
    from_state: DeliveryTaskState;
    to_state: "cancelled";
    reason_code: StoreOrderCancelReasonCode;
  };
}

/** The union of everything this service may publish. */
export type DeliveryDomainEvent =
  | StoreOrderCreatedV1
  | StoreOrderFulfillmentStateChangedV1
  | StoreOrderPaymentStateChangedV1
  | StoreOrderItemSubstitutedV1
  | DeliveryTaskCreatedV1
  | DeliveryEligibilityResolvedV1
  | DeliveryDispatchRequestedV1
  | DeliveryDriverAssignedV1
  | DeliveryStatusChangedV1
  | DeliveryCompletedV1
  | DeliveryFailedV1
  | DeliveryTaskCancelledV1;

/** Every event type this service publishes, as a runtime catalog. */
export const DELIVERY_EVENT_TYPES = {
  STORE_ORDER_CREATED: "store_order.created",
  STORE_ORDER_FULFILLMENT_STATE_CHANGED: "store_order.fulfillment_state_changed",
  STORE_ORDER_PAYMENT_STATE_CHANGED: "store_order.payment_state_changed",
  STORE_ORDER_ITEM_SUBSTITUTED: "store_order.item_substituted",
  DELIVERY_TASK_CREATED: "delivery.task_created",
  DELIVERY_ELIGIBILITY_RESOLVED: "delivery.eligibility_resolved",
  DELIVERY_DISPATCH_REQUESTED: "delivery.dispatch_requested",
  DELIVERY_DRIVER_ASSIGNED: "delivery.driver_assigned",
  DELIVERY_STATUS_CHANGED: "delivery.status_changed",
  DELIVERY_COMPLETED: "delivery.completed",
  DELIVERY_FAILED: "delivery.failed",
  DELIVERY_TASK_CANCELLED: "delivery.task_cancelled",
} as const;

export type DeliveryEventType = (typeof DELIVERY_EVENT_TYPES)[keyof typeof DELIVERY_EVENT_TYPES];
