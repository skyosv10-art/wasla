/**
 * Store-order cancellation — the PURE decision (ADR-026 §3.1 · §3.3).
 *
 * Cancellation is the one command a customer may issue after placement, so
 * it is the one place where a permissive implementation quietly breaks the
 * published tables. This file answers a single question — "is `cancelled`
 * reachable from where this order and its task stand?" — by ASKING THE
 * TABLES (`state-machine.ts`), never by re-listing states in a condition.
 *
 * ## Two aggregates, two tables, one command
 *
 * The order's fulfillment edge (§3.1) and the task's edge (§3.3) are
 * independent: §3.1 publishes `draft|placed|confirmed|ready_for_delivery →
 * cancelled`, while §3.3 publishes `eligible|dispatch_requested|
 * driver_assigned → cancelled`. The intersection is NOT total, and the gap
 * is real, not a modelling slip we may paper over:
 *
 *  - A JUST-PLACED order has a task in `pending_eligibility`, and §3.3 has
 *    NO edge from there to `cancelled`. So the order becomes `cancelled`
 *    while its task stays `pending_eligibility`. We do NOT invent the edge:
 *    the tables are the contract and a silent extra edge in code is drift.
 *    The consequence — a cancelled order whose task is still waiting for an
 *    eligibility decision — is declared in ADR-026 §4.9-1, and the correct
 *    fix is a contract revision (either an edge, or an explicit rule that
 *    eligibility resolution must check the order first).
 *  - `picking` and `picked` have NO fulfillment cancel edge: once a store
 *    started picking, the customer path is refusal by the store, not
 *    cancellation by the customer. Those return
 *    `DELIVERY_CANCEL_NOT_ALLOWED` (409), which is an ANSWER, not a bug.
 *
 * ## Why a dedicated error code and not the generic transition error
 *
 * `DELIVERY_CANCEL_NOT_ALLOWED` exists in the catalog precisely so a client
 * can distinguish "you may not cancel THIS, now" from any other refused
 * transition. Re-using `DELIVERY_TRANSITION_NOT_ALLOWED` here would collapse
 * that distinction into a message string.
 */

import type { StoreOrderCancelReasonCode } from "@wasla/contracts-delivery";

import { DeliveryError } from "./errors.js";
import type { DeliveryTask, StoreOrder } from "./model.js";
import {
  isDeliveryTaskTransitionAllowed,
  isFulfillmentTransitionAllowed,
} from "./state-machine.js";

export interface CancellationDecision {
  readonly fromFulfillmentState: StoreOrder["fulfillmentState"];
  readonly reasonCode: StoreOrderCancelReasonCode;
  /**
   * The task edge, only when §3.3 publishes one from its current state.
   * `null` means "the task keeps its state" — see the header: the gap is
   * declared, not silently bridged.
   */
  readonly taskCancellation: { readonly taskId: string; readonly fromState: DeliveryTask["state"] } | null;
}

/**
 * Decide a cancellation. Throws `DELIVERY_CANCEL_NOT_ALLOWED` when §3.1 has
 * no edge from the order's current fulfillment state — including the
 * already-`cancelled` case, where `to === from` is not a transition at all
 * (the schema's `CHECK (to_state <> from_state)` says the same thing).
 */
export function decideCancellation(
  order: StoreOrder,
  task: DeliveryTask | null,
  reasonCode: StoreOrderCancelReasonCode,
): CancellationDecision {
  if (!isFulfillmentTransitionAllowed(order.fulfillmentState, "cancelled")) {
    throw new DeliveryError(
      "DELIVERY_CANCEL_NOT_ALLOWED",
      `الإلغاءُ غيرُ مسموحٍ من ${order.fulfillmentState} — ليس في جدولِ ADR-026 §3.1`,
      { details: { from: order.fulfillmentState, to: "cancelled" } },
    );
  }

  const taskCancellation =
    task !== null && isDeliveryTaskTransitionAllowed(task.state, "cancelled")
      ? { taskId: task.taskId, fromState: task.state }
      : null;

  return {
    fromFulfillmentState: order.fulfillmentState,
    reasonCode,
    taskCancellation,
  };
}
