/**
 * The order state machine — the single source of what may happen to an order.
 *
 * The table below is written out EDGE BY EDGE on purpose (ADR-010 decision 3).
 * A derived rule ("never go backwards", "terminal states are final") reads
 * nicely and fails silently on the one case it did not anticipate — and the
 * impossible state this phase's exit gate forbids is exactly that case. 72
 * hand-written rows are the cheaper mistake.
 *
 * This table must stay identical to the published table in
 * `docs/03-domain/ORDER_ENGINE.md` §4. Two guards enforce that:
 *  - `packages/contracts/order` parses the document and checks it is coherent;
 *  - `__tests__/state-machine.test.ts` compares this table against the same
 *    document, row by row, and fails on any divergence in either direction.
 *
 * What this module deliberately does NOT enforce:
 *  - **the actor**. Each edge records the actor the lifecycle expects, but
 *    nothing here rejects a mismatch: Phase 06 has no authentication (that is
 *    the gateway's decision), so `actor_type` is an unverified claim. Rejecting
 *    an unverified claim is theatre — it stops honest callers and not dishonest
 *    ones. What IS enforced is the shape rule the schema can also enforce:
 *    `system` carries no actor ref, anyone else must carry one.
 *  - **which reason code belongs to which edge**. The document lists a typical
 *    reason per edge; pinning exactly one would reject legitimate variants
 *    (a customer cancelling while searching may have changed their mind OR
 *    waited too long). Membership in the closed catalog IS enforced.
 */

import {
  ORDER_DRIVER_BOUND_STATUSES,
  ORDER_INITIAL_STATUS,
  ORDER_PRE_ASSIGNMENT_STATUSES,
  ORDER_STATUSES,
  ORDER_TERMINAL_STATUSES,
  ORDER_TRANSIENT_STATUSES,
  type OrderActorType,
  type OrderReasonCode,
  type OrderStatus,
} from "@wasla/contracts-order";

/** One allowed edge of the lifecycle graph. */
export interface OrderTransitionRule {
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  /** The actor the lifecycle expects. Documentation, not authorization. */
  readonly expectedActor: OrderActorType;
  /** The typical reason code. `null` where the edge is part of the happy path. */
  readonly typicalReason: OrderReasonCode | null;
}

/**
 * The 72 allowed transitions out of 441 possible pairs (21 × 21).
 *
 * Grouped by source state, in the order of ORDER_ENGINE.md §4.1 → §4.15.
 */
export const ORDER_TRANSITIONS: readonly OrderTransitionRule[] = [
  // §4.1 published (6) — the order entered the system already validated.
  { from: "published", to: "searching", expectedActor: "system", typicalReason: null },
  { from: "published", to: "customer_cancelled", expectedActor: "customer", typicalReason: "CUSTOMER_CHANGED_MIND" },
  { from: "published", to: "partner_cancelled", expectedActor: "partner", typicalReason: "PARTNER_CANCELLED_ORDER" },
  { from: "published", to: "expired", expectedActor: "system", typicalReason: "SEARCH_WINDOW_EXPIRED" },
  { from: "published", to: "blocked", expectedActor: "admin", typicalReason: "FRAUD_SUSPECTED" },
  { from: "published", to: "failed", expectedActor: "system", typicalReason: "TECHNICAL_FAILURE" },

  // §4.2 searching (7)
  { from: "searching", to: "offered", expectedActor: "system", typicalReason: null },
  { from: "searching", to: "no_driver_found", expectedActor: "system", typicalReason: "NO_CANDIDATES_FOUND" },
  { from: "searching", to: "expired", expectedActor: "system", typicalReason: "SEARCH_WINDOW_EXPIRED" },
  { from: "searching", to: "customer_cancelled", expectedActor: "customer", typicalReason: "CUSTOMER_WAIT_TOO_LONG" },
  { from: "searching", to: "partner_cancelled", expectedActor: "partner", typicalReason: "PARTNER_OUT_OF_STOCK" },
  { from: "searching", to: "blocked", expectedActor: "admin", typicalReason: "POLICY_VIOLATION" },
  { from: "searching", to: "failed", expectedActor: "system", typicalReason: "TECHNICAL_FAILURE" },

  // §4.3 offered (9) — `accepted` requires a recorded accepted assignment.
  { from: "offered", to: "accepted", expectedActor: "driver", typicalReason: null },
  { from: "offered", to: "negotiating", expectedActor: "driver", typicalReason: null },
  { from: "offered", to: "driver_rejected", expectedActor: "driver", typicalReason: "DRIVER_DECLINED" },
  { from: "offered", to: "driver_timeout", expectedActor: "system", typicalReason: "OFFER_TIMED_OUT" },
  { from: "offered", to: "customer_cancelled", expectedActor: "customer", typicalReason: "CUSTOMER_CHANGED_MIND" },
  { from: "offered", to: "partner_cancelled", expectedActor: "partner", typicalReason: "PARTNER_CANCELLED_ORDER" },
  { from: "offered", to: "expired", expectedActor: "system", typicalReason: "SEARCH_WINDOW_EXPIRED" },
  { from: "offered", to: "blocked", expectedActor: "admin", typicalReason: "SAFETY_INCIDENT" },
  { from: "offered", to: "failed", expectedActor: "system", typicalReason: "TECHNICAL_FAILURE" },

  // §4.4 negotiating (8)
  { from: "negotiating", to: "accepted", expectedActor: "customer", typicalReason: null },
  { from: "negotiating", to: "driver_rejected", expectedActor: "driver", typicalReason: "DRIVER_DECLINED" },
  { from: "negotiating", to: "driver_timeout", expectedActor: "system", typicalReason: "OFFER_TIMED_OUT" },
  { from: "negotiating", to: "customer_cancelled", expectedActor: "customer", typicalReason: "CUSTOMER_PRICE_REJECTED" },
  { from: "negotiating", to: "partner_cancelled", expectedActor: "partner", typicalReason: "PARTNER_CANCELLED_ORDER" },
  { from: "negotiating", to: "expired", expectedActor: "system", typicalReason: "SEARCH_WINDOW_EXPIRED" },
  { from: "negotiating", to: "blocked", expectedActor: "admin", typicalReason: "POLICY_VIOLATION" },
  { from: "negotiating", to: "failed", expectedActor: "system", typicalReason: "TECHNICAL_FAILURE" },

  // §4.5 accepted (6)
  { from: "accepted", to: "assigned", expectedActor: "system", typicalReason: null },
  { from: "accepted", to: "driver_cancelled", expectedActor: "driver", typicalReason: "DRIVER_UNAVAILABLE" },
  { from: "accepted", to: "customer_cancelled", expectedActor: "customer", typicalReason: "CUSTOMER_CHANGED_MIND" },
  { from: "accepted", to: "partner_cancelled", expectedActor: "partner", typicalReason: "PARTNER_CANCELLED_ORDER" },
  { from: "accepted", to: "blocked", expectedActor: "admin", typicalReason: "FRAUD_SUSPECTED" },
  { from: "accepted", to: "failed", expectedActor: "system", typicalReason: "TECHNICAL_FAILURE" },

  // §4.6 assigned (6)
  { from: "assigned", to: "driver_en_route", expectedActor: "driver", typicalReason: null },
  { from: "assigned", to: "driver_cancelled", expectedActor: "driver", typicalReason: "DRIVER_VEHICLE_ISSUE" },
  { from: "assigned", to: "customer_cancelled", expectedActor: "customer", typicalReason: "CUSTOMER_CHANGED_MIND" },
  { from: "assigned", to: "partner_cancelled", expectedActor: "partner", typicalReason: "PARTNER_CANCELLED_ORDER" },
  { from: "assigned", to: "blocked", expectedActor: "admin", typicalReason: "SAFETY_INCIDENT" },
  { from: "assigned", to: "failed", expectedActor: "system", typicalReason: "TECHNICAL_FAILURE" },

  // §4.7 driver_en_route (6)
  { from: "driver_en_route", to: "arrived", expectedActor: "driver", typicalReason: null },
  { from: "driver_en_route", to: "driver_cancelled", expectedActor: "driver", typicalReason: "DRIVER_VEHICLE_ISSUE" },
  { from: "driver_en_route", to: "customer_cancelled", expectedActor: "customer", typicalReason: "CUSTOMER_CHANGED_MIND" },
  { from: "driver_en_route", to: "partner_cancelled", expectedActor: "partner", typicalReason: "PARTNER_CANCELLED_ORDER" },
  { from: "driver_en_route", to: "blocked", expectedActor: "admin", typicalReason: "SAFETY_INCIDENT" },
  { from: "driver_en_route", to: "failed", expectedActor: "system", typicalReason: "TECHNICAL_FAILURE" },

  // §4.8 arrived (6)
  { from: "arrived", to: "in_progress", expectedActor: "driver", typicalReason: null },
  { from: "arrived", to: "driver_cancelled", expectedActor: "driver", typicalReason: "DRIVER_NO_SHOW_CUSTOMER" },
  { from: "arrived", to: "customer_cancelled", expectedActor: "customer", typicalReason: "CUSTOMER_CHANGED_MIND" },
  { from: "arrived", to: "partner_cancelled", expectedActor: "partner", typicalReason: "PARTNER_CANCELLED_ORDER" },
  { from: "arrived", to: "blocked", expectedActor: "admin", typicalReason: "SAFETY_INCIDENT" },
  { from: "arrived", to: "failed", expectedActor: "system", typicalReason: "TECHNICAL_FAILURE" },

  // §4.9 in_progress (4) — deliberately NO customer_cancelled: a ride under way
  // is not cancelled by a button. Allowing it would open "who pays for the
  // distance already covered?", a Phase 12 question that must not be opened by
  // a state.
  { from: "in_progress", to: "completed", expectedActor: "driver", typicalReason: null },
  { from: "in_progress", to: "driver_cancelled", expectedActor: "driver", typicalReason: "DRIVER_VEHICLE_ISSUE" },
  { from: "in_progress", to: "blocked", expectedActor: "admin", typicalReason: "SAFETY_INCIDENT" },
  { from: "in_progress", to: "failed", expectedActor: "system", typicalReason: "TECHNICAL_FAILURE" },

  // §4.10 driver_rejected (4) — TRANSIENT: it returns to the search.
  { from: "driver_rejected", to: "searching", expectedActor: "system", typicalReason: "SEARCH_RESUMED" },
  { from: "driver_rejected", to: "no_driver_found", expectedActor: "system", typicalReason: "ALL_CANDIDATES_DECLINED" },
  { from: "driver_rejected", to: "expired", expectedActor: "system", typicalReason: "SEARCH_WINDOW_EXPIRED" },
  { from: "driver_rejected", to: "customer_cancelled", expectedActor: "customer", typicalReason: "CUSTOMER_WAIT_TOO_LONG" },

  // §4.11 driver_timeout (4) — TRANSIENT.
  { from: "driver_timeout", to: "searching", expectedActor: "system", typicalReason: "SEARCH_RESUMED" },
  { from: "driver_timeout", to: "no_driver_found", expectedActor: "system", typicalReason: "ALL_CANDIDATES_DECLINED" },
  { from: "driver_timeout", to: "expired", expectedActor: "system", typicalReason: "SEARCH_WINDOW_EXPIRED" },
  { from: "driver_timeout", to: "customer_cancelled", expectedActor: "customer", typicalReason: "CUSTOMER_WAIT_TOO_LONG" },

  // §4.12 completed (2)
  { from: "completed", to: "payment_disputed", expectedActor: "customer", typicalReason: "DISPUTE_OPENED" },
  { from: "completed", to: "under_review", expectedActor: "admin", typicalReason: "MANUAL_REVIEW_OPENED" },

  // §4.13 payment_disputed (1) — every dispute is adjudicated through review, so
  // the verdict has exactly one source.
  { from: "payment_disputed", to: "under_review", expectedActor: "admin", typicalReason: "MANUAL_REVIEW_OPENED" },

  // §4.14 under_review (3) — a review ends in a verdict, never back where it came from.
  { from: "under_review", to: "completed", expectedActor: "admin", typicalReason: "REVIEW_CLEARED" },
  { from: "under_review", to: "blocked", expectedActor: "admin", typicalReason: "REVIEW_UPHELD_BLOCK" },
  { from: "under_review", to: "failed", expectedActor: "admin", typicalReason: "REVIEW_UPHELD_FAILURE" },

  // §4.15 the seven terminal states have no outgoing edge at all.
];

// ---------------------------------------------------------------------------
// Derived indexes — computed once, never hand-maintained
// ---------------------------------------------------------------------------

const TRANSITION_INDEX: Map<string, OrderTransitionRule> = new Map(
  ORDER_TRANSITIONS.map((rule) => [`${rule.from}→${rule.to}`, rule]),
);

const OUTGOING: Map<OrderStatus, ReadonlySet<OrderStatus>> = new Map(
  ORDER_STATUSES.map((status) => [
    status,
    new Set(ORDER_TRANSITIONS.filter((r) => r.from === status).map((r) => r.to)),
  ]),
);

/** Total number of allowed edges. Exported so tests can assert it explicitly. */
export const ORDER_TRANSITION_COUNT = ORDER_TRANSITIONS.length;

/** Size of the full pair space (21 × 21). */
export const ORDER_TRANSITION_SPACE = ORDER_STATUSES.length * ORDER_STATUSES.length;

/** Is this pair in the table? */
export function isTransitionAllowed(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITION_INDEX.has(`${from}→${to}`);
}

/** The rule for a pair, or `undefined` if the pair is not allowed. */
export function transitionRule(
  from: OrderStatus,
  to: OrderStatus,
): OrderTransitionRule | undefined {
  return TRANSITION_INDEX.get(`${from}→${to}`);
}

/** Everything reachable from a state in one step. */
export function allowedTargets(from: OrderStatus): ReadonlySet<OrderStatus> {
  return OUTGOING.get(from) ?? new Set();
}

/**
 * Terminal = no outgoing edge, DERIVED from the table.
 *
 * Never hand-written: `is_terminal` travels in every status-changed event, and
 * a hand-maintained list would eventually disagree with the graph. The test
 * suite asserts this derived set equals the contract's ORDER_TERMINAL_STATUSES —
 * if they ever differ, one of the two is lying about the lifecycle.
 */
export const DERIVED_TERMINAL_STATUSES: readonly OrderStatus[] = ORDER_STATUSES.filter(
  (status) => (OUTGOING.get(status)?.size ?? 0) === 0,
);

const DERIVED_TERMINAL_SET = new Set<OrderStatus>(DERIVED_TERMINAL_STATUSES);

/** Is this state final? Derived from the transition table, not from a list. */
export function isTerminalStatus(status: OrderStatus): boolean {
  return DERIVED_TERMINAL_SET.has(status);
}

/** Terminal states demand a reason: an order never ends without one. */
export function requiresReasonCode(to: OrderStatus): boolean {
  return isTerminalStatus(to);
}

// ---------------------------------------------------------------------------
// Assignment coupling
// ---------------------------------------------------------------------------

const DRIVER_BOUND = new Set<OrderStatus>(ORDER_DRIVER_BOUND_STATUSES);
const PRE_ASSIGNMENT = new Set<OrderStatus>(ORDER_PRE_ASSIGNMENT_STATUSES);

/**
 * How a state relates to the active assignment.
 *
 * `required`  — the state names a driver, so an accepted assignment must exist.
 * `forbidden` — the state precedes acceptance, so no assignment may be bound.
 * `optional`  — terminal, transient and post-completion states: the order may
 *               have failed before any offer, or long after one.
 *
 * This mirrors `ck_orders_assignment_matches_status` in schema.sql exactly, so
 * the domain and the database cannot disagree about what a row may look like.
 */
export function assignmentRequirement(
  status: OrderStatus,
): "required" | "forbidden" | "optional" {
  if (DRIVER_BOUND.has(status)) return "required";
  if (PRE_ASSIGNMENT.has(status)) return "forbidden";
  return "optional";
}

// ---------------------------------------------------------------------------
// Graph properties, computed rather than asserted in prose
// ---------------------------------------------------------------------------

/** Every state reachable from `published` by any number of steps. */
export function reachableStatuses(): ReadonlySet<OrderStatus> {
  const seen = new Set<OrderStatus>([ORDER_INITIAL_STATUS]);
  const queue: OrderStatus[] = [ORDER_INITIAL_STATUS];
  while (queue.length > 0) {
    for (const next of allowedTargets(queue.shift()!)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/**
 * States that cannot be reached from `published`.
 *
 * An unreachable state IS an impossible state, which is what this phase's exit
 * gate forbids. This must always be empty; the test asserts it.
 */
export function unreachableStatuses(): readonly OrderStatus[] {
  const reachable = reachableStatuses();
  return ORDER_STATUSES.filter((status) => !reachable.has(status));
}

/** Re-exported for callers that need the lifecycle vocabulary in one import. */
export {
  ORDER_STATUSES,
  ORDER_INITIAL_STATUS,
  ORDER_TERMINAL_STATUSES,
  ORDER_TRANSIENT_STATUSES,
};
