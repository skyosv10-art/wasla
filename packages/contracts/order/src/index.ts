/**
 * @wasla/contracts-order
 *
 * Typed Order Engine contracts:
 *  - API types generated from the OpenAPI source-of-truth via `openapi-typescript`.
 *  - Event types hand-derived from the JSON Schema Event Contract (events.json).
 *  - The stable error-code catalog and the closed reason-code catalog
 *    (both drift-guarded against errors.md).
 *
 * These are Contract First artifacts (ADR-004) — NOT a runtime implementation.
 * The state machine, ports and use-cases land in MR 2/6; persistence in MR 3/6;
 * HTTP in MR 4/6.
 *
 * Boundary reminders (ADR-010):
 *  - This service owns the order lifecycle and mints `order_public_id`.
 *  - It RECORDS assignments; Phase 07 decides them (candidates, waves, timeouts).
 *  - `driver_public_id` / `customer_public_id` are opaque refs — no FK, no profile
 *    lookup, no eligibility check here.
 *  - The channel does not exist at this boundary: no chat_id, no telegram.
 *
 * Regenerate API types: pnpm --filter @wasla/contracts-order generate
 */

export type * from "./api-types.js";
export type * from "./events-types.js";
export { ORDER_EVENT_TYPES } from "./events-types.js";

// --- API contract types (from OpenAPI) --------------------------------
import type { paths, components } from "./api-types.js";

/** All API paths and their operations. */
export type { paths };

/** Ride or delivery. */
export type OrderType = components["schemas"]["OrderType"];

/** Closed vehicle-class enum — must match the customer contract literally. */
export type VehicleClass = components["schemas"]["VehicleClass"];

/** Explicit customer offer or negotiable — no implicit estimate. */
export type PriceMode = components["schemas"]["PriceMode"];

/** Pickup or dropoff. */
export type StopKind = components["schemas"]["StopKind"];

/** How the customer produced the stop (map, saved place, manual zone, ...). */
export type StopSource = components["schemas"]["StopSource"];

/** Integer minor units + ISO currency — never a floating point amount. */
export type Money = components["schemas"]["Money"];

/** A stop on the order. */
export type Stop = components["schemas"]["Stop"];

/** Delivery-only shipment details. */
export type ShipmentDetails = components["schemas"]["ShipmentDetails"];

/**
 * The payload the customers service hands over through `OrderIntakePort`.
 * Mirrors `OrderIntakeRequest` in the customer contract; the drift guard in
 * `__tests__/contracts.test.ts` fails the build if the two diverge.
 */
export type OrderIntakeRequest = components["schemas"]["OrderIntakeRequest"];

/** Acceptance result: the engine's public id + acceptance timestamp. */
export type OrderIntakeResult = components["schemas"]["OrderIntakeResult"];

/** A persisted order. */
export type Order = components["schemas"]["Order"];

/** A recorded assignment offer (§16). */
export type Assignment = components["schemas"]["Assignment"];

/** One audit row: a single state transition. */
export type StatusHistoryEntry = components["schemas"]["StatusHistoryEntry"];

/** Request body for the single transition route. */
export type TransitionRequest = components["schemas"]["TransitionRequest"];

/** Standard error payload: { code, message, trace_id }. */
export type ErrorResponse = components["schemas"]["ErrorResponse"];

// --- Event contract types (from events.json) --------------------------
import type {
  EventEnvelope,
  OrderAggregateType,
  OrderActorType,
  OrderAssignmentState,
  OrderAssignmentResolution,
  OrderStatus,
  OrderEventStop,
  OrderCreatedV1,
  OrderStatusChangedV1,
  OrderAssignmentOfferedV1,
  OrderAssignmentResolvedV1,
  OrderDomainEvent,
  OrderEventType,
} from "./events-types.js";

export type {
  EventEnvelope,
  OrderAggregateType,
  OrderActorType,
  OrderAssignmentState,
  OrderAssignmentResolution,
  OrderStatus,
  OrderEventStop,
  OrderCreatedV1,
  OrderStatusChangedV1,
  OrderAssignmentOfferedV1,
  OrderAssignmentResolvedV1,
  OrderDomainEvent,
  OrderEventType,
};

// --- Error catalog (from errors.md) -----------------------------------

/**
 * Stable error codes for the Order Engine service.
 *
 * Codes are part of the contract: their meaning never changes after release,
 * only additions are allowed. Tests assert codes — never the Arabic copy.
 * Drift guard: `__tests__/contracts.test.ts` parses errors.md and asserts this
 * catalog matches the documented table exactly.
 */
export const ORDER_ERROR_CODES = [
  "ORDER_VALIDATION_FAILED",
  "ORDER_NOT_FOUND",
  "ORDER_ASSIGNMENT_NOT_FOUND",
  "ORDER_ILLEGAL_TRANSITION",
  "ORDER_IDEMPOTENCY_KEY_REUSED",
  "ORDER_ASSIGNMENT_DUPLICATE",
  "ORDER_ASSIGNMENT_ALREADY_RESOLVED",
  "ORDER_REQUEST_ALREADY_INGESTED",
  "ORDER_ASSIGNMENT_REQUIRED",
  "ORDER_ASSIGNMENT_FORBIDDEN",
  "ORDER_REASON_CODE_REQUIRED",
  "ORDER_REASON_CODE_UNKNOWN",
  "ORDER_ACTOR_REF_REQUIRED",
  "ORDER_ACTOR_REF_FORBIDDEN",
  "ORDER_PRICE_MODE_MISMATCH",
  "ORDER_SHIPMENT_NOT_ALLOWED",
  "ORDER_STOPS_INVALID",
  "ORDER_ENGINE_UNAVAILABLE",
] as const;

/** A stable Order Engine error code. */
export type OrderErrorCode = (typeof ORDER_ERROR_CODES)[number];

/** Error classes and their HTTP status, as documented in errors.md. */
export const ORDER_ERROR_CLASS_STATUS = {
  validation_error: 400,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  service_unavailable: 503,
} as const;

/** The documented class of each error code. */
export type OrderErrorClass = keyof typeof ORDER_ERROR_CLASS_STATUS;

/**
 * Code → class mapping. The HTTP status is derived from the class, so a code can
 * never drift into an undocumented status.
 */
export const ORDER_ERROR_CODE_CLASS: Record<OrderErrorCode, OrderErrorClass> = {
  ORDER_VALIDATION_FAILED: "validation_error",
  ORDER_NOT_FOUND: "not_found",
  ORDER_ASSIGNMENT_NOT_FOUND: "not_found",
  ORDER_ILLEGAL_TRANSITION: "conflict",
  ORDER_IDEMPOTENCY_KEY_REUSED: "conflict",
  ORDER_ASSIGNMENT_DUPLICATE: "conflict",
  ORDER_ASSIGNMENT_ALREADY_RESOLVED: "conflict",
  ORDER_REQUEST_ALREADY_INGESTED: "conflict",
  ORDER_ASSIGNMENT_REQUIRED: "unprocessable",
  ORDER_ASSIGNMENT_FORBIDDEN: "unprocessable",
  ORDER_REASON_CODE_REQUIRED: "unprocessable",
  ORDER_REASON_CODE_UNKNOWN: "unprocessable",
  ORDER_ACTOR_REF_REQUIRED: "unprocessable",
  ORDER_ACTOR_REF_FORBIDDEN: "unprocessable",
  ORDER_PRICE_MODE_MISMATCH: "unprocessable",
  ORDER_SHIPMENT_NOT_ALLOWED: "unprocessable",
  ORDER_STOPS_INVALID: "unprocessable",
  ORDER_ENGINE_UNAVAILABLE: "service_unavailable",
};

/** HTTP status for an error code, derived from its documented class. */
export function httpStatusForOrderError(code: OrderErrorCode): number {
  return ORDER_ERROR_CLASS_STATUS[ORDER_ERROR_CODE_CLASS[code]];
}

// --- Reason-code catalog (from errors.md) -----------------------------

/**
 * Closed catalog of transition reason codes (ADR-010 decision 7).
 *
 * Why closed: a free-text reason produces analytics that cannot be aggregated,
 * and user-authored text could leak into events. Adding a code is a contract
 * change recorded in TASK_LOG. Drift guard: `__tests__/contracts.test.ts`
 * parses the reason-code tables in errors.md and asserts an exact match.
 */
export const ORDER_REASON_CODES = [
  // expiry / unavailability
  "SEARCH_WINDOW_EXPIRED",
  "NO_CANDIDATES_FOUND",
  "ALL_CANDIDATES_DECLINED",
  // cancellation
  "CUSTOMER_CHANGED_MIND",
  "CUSTOMER_WAIT_TOO_LONG",
  "CUSTOMER_PRICE_REJECTED",
  "DRIVER_UNAVAILABLE",
  "DRIVER_VEHICLE_ISSUE",
  "DRIVER_NO_SHOW_CUSTOMER",
  "PARTNER_CANCELLED_ORDER",
  "PARTNER_OUT_OF_STOCK",
  // assignment
  "DRIVER_DECLINED",
  "OFFER_TIMED_OUT",
  "SEARCH_RESUMED",
  // block / review / failure
  "FRAUD_SUSPECTED",
  "POLICY_VIOLATION",
  "SAFETY_INCIDENT",
  "TECHNICAL_FAILURE",
  "PAYMENT_FAILED",
  "DISPUTE_OPENED",
  "MANUAL_REVIEW_OPENED",
  "REVIEW_CLEARED",
  "REVIEW_UPHELD_BLOCK",
  "REVIEW_UPHELD_FAILURE",
] as const;

/** A reason code from the closed catalog. */
export type OrderReasonCode = (typeof ORDER_REASON_CODES)[number];

// --- Contract-level lifecycle constants -------------------------------

/**
 * Every order status, in contract order.
 *
 * Kept as a value (not just a type) because the state machine in MR 2/6 must
 * iterate the full status × status space to prove the transition table has no
 * unreachable state.
 */
export const ORDER_STATUSES = [
  "published",
  "searching",
  "offered",
  "negotiating",
  "accepted",
  "assigned",
  "driver_en_route",
  "arrived",
  "in_progress",
  "completed",
  "driver_rejected",
  "driver_timeout",
  "expired",
  "no_driver_found",
  "customer_cancelled",
  "driver_cancelled",
  "partner_cancelled",
  "blocked",
  "failed",
  "payment_disputed",
  "under_review",
] as const;

/** The one and only initial state. There is no `draft` (ADR-010 decision 2). */
export const ORDER_INITIAL_STATUS = "published" as const;

/**
 * Terminal statuses: no outgoing transition, and a `reason_code` is mandatory.
 *
 * This list is the CONTRACT view (it matches the `ck_orders_terminal_needs_reason`
 * constraint in schema.sql, asserted by `__tests__/contracts.test.ts`). MR 2/6
 * must additionally assert that the set derived from the transition table — the
 * states with an empty outgoing set — equals this list. If the two ever differ,
 * one of them is lying about the lifecycle.
 */
export const ORDER_TERMINAL_STATUSES = [
  "expired",
  "no_driver_found",
  "customer_cancelled",
  "driver_cancelled",
  "partner_cancelled",
  "blocked",
  "failed",
] as const;

/**
 * Statuses that name a driver: they require an accepted active assignment
 * (ADR-010 decision 3.8). Enforced in the domain and by
 * `ck_orders_assignment_matches_status` in schema.sql.
 */
export const ORDER_DRIVER_BOUND_STATUSES = [
  "accepted",
  "assigned",
  "driver_en_route",
  "arrived",
  "in_progress",
  "completed",
] as const;

/**
 * Pre-acceptance statuses: they must carry NO active assignment. A searching
 * order that already names a driver is an impossible state.
 */
export const ORDER_PRE_ASSIGNMENT_STATUSES = [
  "published",
  "searching",
  "offered",
  "negotiating",
] as const;

/**
 * Transient statuses that look terminal but are not (ADR-010 decision 3.5):
 * a driver rejection or timeout returns the order to the search, it does not
 * end it. This resolved the §15.1 vs §16 contradiction in the master document.
 */
export const ORDER_TRANSIENT_STATUSES = ["driver_rejected", "driver_timeout"] as const;

/** Order public id format — opaque text for consumers, minted from a DB sequence. */
export const ORDER_PUBLIC_ID_PATTERN = /^ORD-[0-9]{10}$/;

/** Wasla public id format — opaque identity reference, no FK across services. */
export const WASLA_PUBLIC_ID_PATTERN = /^WS-[0-9]{10}$/;

/** Stops per order in Phase 06: exactly pickup + dropoff (ADR-009 decision 3). */
export const STOPS_PER_ORDER = 2;

/** The service's HTTP port (CONTAINERS §4.2). */
export const ORDER_SERVICE_PORT = 8087;
