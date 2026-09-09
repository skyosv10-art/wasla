/**
 * The store-order & delivery-task state machines — the single source of what
 * may happen to each (ADR-026 §3).
 *
 * The tables below are written out EDGE BY EDGE on purpose (same decision as
 * ADR-010 decision 3). A derived rule ("terminal states are final") reads
 * nicely and fails silently on the one case it did not anticipate — the
 * impossible state this phase forbids is exactly that case. Hand-written rows
 * are the cheaper mistake.
 *
 * These tables must stay identical to the published tables in
 * ADR-026 §3 (the binding reference). `__tests__/state-machine.test.ts`
 * parses the ADR document and compares this table against it, row by row,
 * failing on any divergence in either direction — the same style of guard as
 * ORDER_ENGINE.md in the orders phase.
 *
 * What this module deliberately does NOT enforce:
 *  - **the actor.** Each edge records the actor the lifecycle expects, but
 *    nothing here rejects a mismatch: this review has no authentication, so
 *    `actor_type` is an unverified claim. What IS enforced is the shape
 *    rule: `system` carries no actor ref, anyone else must carry one.
 *  - **which reason code belongs to which edge.** The table records a
 *    typical reason; membership in the closed catalog is enforced elsewhere.
 *
 * What this module DOES enforce beyond the raw graph:
 *  - `placed → confirmed` additionally requires paymentState = authorized
 *    (§2.2 — the composite transition, tested, not reviewed).
 *  - `handed_to_courier → delivered` and `arrived → delivered` additionally
 *    require a proof of delivery (§2.4).
 */

import {
  FULFILLMENT_STATES,
  FULFILLMENT_TERMINAL_STATES,
  PAYMENT_STATES,
  PAYMENT_TERMINAL_STATES,
  DELIVERY_TASK_STATES,
  DELIVERY_TASK_TERMINAL_STATES,
  type FulfillmentState,
  type PaymentState,
  type DeliveryTaskState,
} from "@wasla/contracts-delivery";

import type { ProofOfDelivery } from "./model.js";

/** One allowed edge of the fulfillment lifecycle graph. */
export interface FulfillmentTransitionRule {
  readonly from: FulfillmentState;
  readonly to: FulfillmentState;
  /** The actor the lifecycle expects. Documentation, not authorization. */
  readonly expectedActor: "system" | "customer" | "store" | "courier" | "admin";
  /** The typical reason code. `null` where the edge is the happy default. */
  readonly typicalReason: string | null;
}

/**
 * The 14 allowed fulfillment transitions (ADR-026 §3.1: 11 states).
 * Grouped by source state, in ADR order.
 */
export const FULFILLMENT_TRANSITIONS: readonly FulfillmentTransitionRule[] = [
  // draft (2) — the cart is confirmed or abandoned.
  { from: "draft", to: "placed", expectedActor: "customer", typicalReason: "CART_CONFIRMED" },
  { from: "draft", to: "cancelled", expectedActor: "customer", typicalReason: "CUSTOMER_CHANGED_MIND" },

  // placed (2) — the composite gate lives here (§2.2).
  { from: "placed", to: "confirmed", expectedActor: "system", typicalReason: "PAYMENT_AUTHORIZED" },
  { from: "placed", to: "cancelled", expectedActor: "customer", typicalReason: "CUSTOMER_CHANGED_MIND" },

  // confirmed (3)
  { from: "confirmed", to: "picking", expectedActor: "store", typicalReason: "PICKING_STARTED" },
  { from: "confirmed", to: "rejected", expectedActor: "store", typicalReason: "OUT_OF_STOCK" },
  { from: "confirmed", to: "cancelled", expectedActor: "customer", typicalReason: "CUSTOMER_CHANGED_MIND" },

  // picking (2) — substitution happens INSIDE this state only (§2.5).
  { from: "picking", to: "picked", expectedActor: "store", typicalReason: "PICKING_COMPLETED" },
  { from: "picking", to: "rejected", expectedActor: "store", typicalReason: "ITEM_UNAVAILABLE" },

  // picked (1)
  { from: "picked", to: "ready_for_delivery", expectedActor: "store", typicalReason: "READY_FOR_HANDOVER" },

  // ready_for_delivery (2) — the last point a customer may cancel.
  { from: "ready_for_delivery", to: "handed_to_courier", expectedActor: "system", typicalReason: "COURIER_ACCEPTED" },
  { from: "ready_for_delivery", to: "cancelled", expectedActor: "customer", typicalReason: "CUSTOMER_CHANGED_MIND" },

  // handed_to_courier (2) — delivered REQUIRES proof (§2.4).
  { from: "handed_to_courier", to: "delivered", expectedActor: "courier", typicalReason: "DELIVERED_WITH_PROOF" },
  { from: "handed_to_courier", to: "failed", expectedActor: "system", typicalReason: "DELIVERY_ATTEMPTS_EXHAUSTED" },
];

/** One allowed edge of the payment-mirror lifecycle graph. */
export interface PaymentTransitionRule {
  readonly from: PaymentState;
  readonly to: PaymentState;
  readonly expectedActor: "system";
  readonly typicalReason: string;
}

/**
 * The 7 allowed payment-mirror transitions (ADR-026 §3.2: 7 states).
 * A mirror, not a wallet: these edges record what the external intent did.
 */
export const PAYMENT_TRANSITIONS: readonly PaymentTransitionRule[] = [
  { from: "pending", to: "authorized", expectedActor: "system", typicalReason: "AUTHORIZATION_SUCCEEDED" },
  { from: "pending", to: "failed", expectedActor: "system", typicalReason: "AUTHORIZATION_FAILED" },
  { from: "authorized", to: "captured", expectedActor: "system", typicalReason: "CAPTURE_SUCCEEDED" },
  { from: "captured", to: "refunding", expectedActor: "system", typicalReason: "REFUND_INITIATED" },
  { from: "captured", to: "partially_refunded", expectedActor: "system", typicalReason: "PARTIAL_REFUND_COMPLETED" },
  { from: "refunding", to: "refunded", expectedActor: "system", typicalReason: "REFUND_COMPLETED" },
  { from: "partially_refunded", to: "refunding", expectedActor: "system", typicalReason: "REFUND_INITIATED" },
];

/** One allowed edge of the delivery-task lifecycle graph. */
export interface DeliveryTaskTransitionRule {
  readonly from: DeliveryTaskState;
  readonly to: DeliveryTaskState;
  readonly expectedActor: "system" | "customer" | "courier" | "dispatch";
  readonly typicalReason: string;
}

/**
 * The 19 allowed delivery-task transitions (ADR-026 §3.3: 14 states).
 * A coarse mirror of dispatch outcomes — no offer/wave logic is rebuilt here.
 */
export const DELIVERY_TASK_TRANSITIONS: readonly DeliveryTaskTransitionRule[] = [
  // pending_eligibility (2) — eligibility is resolved by the marketplace port (§2.3).
  { from: "pending_eligibility", to: "eligible", expectedActor: "system", typicalReason: "eligibility_ok" },
  { from: "pending_eligibility", to: "ineligible", expectedActor: "system", typicalReason: "outside_coverage" },

  // eligible (2) — dispatch is delegated by reference (§2.4).
  { from: "eligible", to: "dispatch_requested", expectedActor: "system", typicalReason: "dispatch_delegated" },
  { from: "eligible", to: "cancelled", expectedActor: "customer", typicalReason: "CUSTOMER_CHANGED_MIND" },

  // dispatch_requested (3)
  { from: "dispatch_requested", to: "driver_assigned", expectedActor: "dispatch", typicalReason: "dispatch_offer_accepted" },
  { from: "dispatch_requested", to: "exhausted", expectedActor: "dispatch", typicalReason: "offers_exhausted" },
  { from: "dispatch_requested", to: "cancelled", expectedActor: "customer", typicalReason: "CUSTOMER_CHANGED_MIND" },

  // driver_assigned (3)
  { from: "driver_assigned", to: "picked_up", expectedActor: "courier", typicalReason: "picked_up_from_store" },
  { from: "driver_assigned", to: "timed_out", expectedActor: "dispatch", typicalReason: "offer_timed_out" },
  { from: "driver_assigned", to: "cancelled", expectedActor: "customer", typicalReason: "CUSTOMER_CHANGED_MIND" },

  // timed_out (1) — a new offer cycle.
  { from: "timed_out", to: "reassigned", expectedActor: "dispatch", typicalReason: "reassignment_cycle" },

  // reassigned (2)
  { from: "reassigned", to: "driver_assigned", expectedActor: "dispatch", typicalReason: "dispatch_offer_accepted" },
  { from: "reassigned", to: "exhausted", expectedActor: "dispatch", typicalReason: "offers_exhausted" },

  // the live leg — a state transition, never a location (§2.6).
  { from: "picked_up", to: "in_transit", expectedActor: "courier", typicalReason: "in_transit" },
  { from: "in_transit", to: "arrived", expectedActor: "courier", typicalReason: "arrived_at_customer" },
  { from: "arrived", to: "delivered", expectedActor: "courier", typicalReason: "delivery_completed_with_proof" },

  // failure from any live leg.
  { from: "picked_up", to: "failed", expectedActor: "system", typicalReason: "ATTEMPTS_EXHAUSTED" },
  { from: "in_transit", to: "failed", expectedActor: "system", typicalReason: "ATTEMPTS_EXHAUSTED" },
  { from: "arrived", to: "failed", expectedActor: "system", typicalReason: "ATTEMPTS_EXHAUSTED" },
];

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

export function isFulfillmentTerminal(state: FulfillmentState): boolean {
  return (FULFILLMENT_TERMINAL_STATES as readonly string[]).includes(state);
}

export function isPaymentTerminal(state: PaymentState): boolean {
  return (PAYMENT_TERMINAL_STATES as readonly string[]).includes(state);
}

export function isDeliveryTaskTerminal(state: DeliveryTaskState): boolean {
  return (DELIVERY_TASK_TERMINAL_STATES as readonly string[]).includes(state);
}

/**
 * May the fulfillment state move from → to at all (pure graph membership)?
 *
 * The composite payment gate (§2.2) and the proof gate (§2.4) are NOT
 * checked here — they need context this function does not have; see
 * `canConfirmOrder` and `canCompleteDelivery` below.
 */
export function isFulfillmentTransitionAllowed(
  from: FulfillmentState,
  to: FulfillmentState,
): boolean {
  return FULFILLMENT_TRANSITIONS.some((r) => r.from === from && r.to === to);
}

export function isPaymentTransitionAllowed(from: PaymentState, to: PaymentState): boolean {
  return PAYMENT_TRANSITIONS.some((r) => r.from === from && r.to === to);
}

export function isDeliveryTaskTransitionAllowed(
  from: DeliveryTaskState,
  to: DeliveryTaskState,
): boolean {
  return DELIVERY_TASK_TRANSITIONS.some((r) => r.from === from && r.to === to);
}

/**
 * The composite transition (ADR-026 §2.2): placed → confirmed ONLY when the
 * payment mirror says authorized. Enforced in the machine, not scattered in
 * guards — so it is proven by a test, not by review.
 */
export function canConfirmOrder(order: {
  fulfillmentState: FulfillmentState;
  paymentState: PaymentState;
}): boolean {
  return (
    order.fulfillmentState === "placed" &&
    order.paymentState === "authorized" &&
    isFulfillmentTransitionAllowed("placed", "confirmed")
  );
}

/**
 * The proof gate (ADR-026 §2.4): delivered ONLY with proof of delivery —
 * and proof is never recorded on a non-delivered task.
 */
export function canCompleteDelivery(
  task: { state: DeliveryTaskState; proof: ProofOfDelivery | null },
  to: DeliveryTaskState = "delivered",
): boolean {
  if (to !== "delivered") return false;
  if (task.state !== "arrived") return false;
  return task.proof !== null && isDeliveryTaskTransitionAllowed(task.state, "delivered");
}

/** Exposed for tests that iterate the full state × state space. */
export const STATE_SPACES = {
  fulfillment: FULFILLMENT_STATES,
  payment: PAYMENT_STATES,
  deliveryTask: DELIVERY_TASK_STATES,
} as const;
