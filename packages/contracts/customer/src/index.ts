/**
 * @wasla/contracts-customer
 *
 * Typed Customer Core contracts:
 *  - API types generated from the OpenAPI source-of-truth via `openapi-typescript`.
 *  - Event types hand-derived from the JSON Schema Event Contract (events.json).
 *  - The stable error-code catalog (drift-guarded against errors.md).
 *
 * These are Contract First artifacts (ADR-004) — NOT a runtime implementation.
 * Consumers (customers service, customer bot, order engine adapters) import
 * these types to stay aligned with the published Customer API + Event contracts.
 *
 * Boundary reminder (ADR-009): the customers service hands an OrderIntakeRequest
 * to the order engine through a port; it never owns the order lifecycle and
 * never mints `order_public_id`.
 *
 * Regenerate API types: pnpm --filter @wasla/contracts-customer generate
 */

export type * from "./api-types.js";
export type * from "./events-types.js";
export { CUSTOMER_EVENT_TYPES } from "./events-types.js";

// --- API contract types (from OpenAPI) --------------------------------
import type { paths, components } from "./api-types.js";

/** All API paths and their operations. */
export type { paths };

/** Supported locale for customer-facing copy. */
export type Locale = components["schemas"]["Locale"];

/** Ride or delivery. */
export type OrderType = components["schemas"]["OrderType"];

/** Closed vehicle-class enum. */
export type VehicleClass = components["schemas"]["VehicleClass"];

/** Explicit customer offer or negotiable — no implicit estimate. */
export type PriceMode = components["schemas"]["PriceMode"];

/** Pickup or dropoff. */
export type StopKind = components["schemas"]["StopKind"];

/** How the customer produced the stop (map, saved place, manual zone, ...). */
export type StopSource = components["schemas"]["StopSource"];

/** Delivery status of the request toward the order engine (not order state). */
export type OrderRequestStatus = components["schemas"]["OrderRequestStatus"];

/** Integer minor units + ISO currency — never a floating point amount. */
export type Money = components["schemas"]["Money"];

/** Optional latitude/longitude pair (display/handoff only in Phase 04). */
export type Coordinates = components["schemas"]["Coordinates"];

/** A stop as submitted by the customer. */
export type StopInput = components["schemas"]["StopInput"];

/** A persisted, ordered stop. */
export type Stop = components["schemas"]["Stop"];

/** The customer role profile. */
export type CustomerProfile = components["schemas"]["CustomerProfile"];

/** Request body for creating/updating a customer profile. */
export type UpsertCustomerProfileRequest =
  components["schemas"]["UpsertCustomerProfileRequest"];

/** A saved place belonging to a customer. */
export type SavedPlace = components["schemas"]["SavedPlace"];

/** Request body for saving a place. */
export type CreateSavedPlaceRequest =
  components["schemas"]["CreateSavedPlaceRequest"];

/** Request body for previewing/creating an order request. */
export type OrderRequestInput = components["schemas"]["OrderRequestInput"];

/** Delivery-only shipment details. */
export type ShipmentDetails = components["schemas"]["ShipmentDetails"];

/** Read-only validation result before submission (with warnings). */
export type OrderRequestPreview = components["schemas"]["OrderRequestPreview"];

/** A persisted customer order request. */
export type OrderRequest = components["schemas"]["OrderRequest"];

/** The payload handed to the order engine through OrderIntakePort. */
export type OrderIntakeRequest = components["schemas"]["OrderIntakeRequest"];

/** The order engine's acceptance result (it owns order_public_id). */
export type OrderIntakeResult = components["schemas"]["OrderIntakeResult"];

/** Standard error payload: { code, message, trace_id }. */
export type ErrorResponse = components["schemas"]["ErrorResponse"];

// --- Event contract types (from events.json) --------------------------
import type {
  EventEnvelope,
  CustomerAggregateType,
  CustomerProfileCreatedV1,
  CustomerProfileUpdatedV1,
  CustomerPlaceSavedV1,
  CustomerPlaceRemovedV1,
  CustomerOrderRequestSubmittedV1,
  CustomerOrderRequestSubmissionFailedV1,
  CustomerOrderIntakeFailureReason,
  CustomerEvent,
  CustomerEventType,
  CustomerEventByType,
} from "./events-types.js";

export type {
  EventEnvelope,
  CustomerAggregateType,
  CustomerProfileCreatedV1,
  CustomerProfileUpdatedV1,
  CustomerPlaceSavedV1,
  CustomerPlaceRemovedV1,
  CustomerOrderRequestSubmittedV1,
  CustomerOrderRequestSubmissionFailedV1,
  CustomerOrderIntakeFailureReason,
  CustomerEvent,
  CustomerEventType,
  CustomerEventByType,
};

// --- Error catalog (from errors.md) -----------------------------------

/**
 * Stable error codes for the Customer Core service.
 *
 * Codes are part of the contract: their meaning never changes after release,
 * only additions are allowed. Tests assert codes — never the Arabic copy.
 * Drift guard: `__tests__/contracts.test.ts` parses errors.md and asserts this
 * catalog matches the documented table exactly.
 */
export const CUSTOMER_ERROR_CODES = [
  "CUSTOMER_INVALID_PUBLIC_ID",
  "CUSTOMER_INVALID_REQUEST_BODY",
  "CUSTOMER_MISSING_IDEMPOTENCY_KEY",
  "CUSTOMER_PROFILE_NOT_FOUND",
  "CUSTOMER_IDENTITY_NOT_FOUND",
  "CUSTOMER_ZONE_NOT_FOUND",
  "CUSTOMER_PLACE_NOT_FOUND",
  "CUSTOMER_ORDER_REQUEST_NOT_FOUND",
  "CUSTOMER_PLACE_LABEL_TAKEN",
  "CUSTOMER_IDEMPOTENCY_KEY_REUSED",
  "CUSTOMER_ZONE_INACTIVE",
  "CUSTOMER_PROFILE_SUSPENDED",
  "CUSTOMER_PLACE_LIMIT_REACHED",
  "CUSTOMER_PRICE_MODE_MISMATCH",
  "CUSTOMER_MULTI_STOP_NOT_SUPPORTED",
  "CUSTOMER_SHIPMENT_NOT_ALLOWED_FOR_RIDE",
  "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
  "CUSTOMER_INTERNAL_ERROR",
] as const;

/** A stable Customer Core error code. */
export type CustomerErrorCode = (typeof CUSTOMER_ERROR_CODES)[number];

/** Error classes and their HTTP status, as documented in errors.md. */
export const CUSTOMER_ERROR_CLASS_STATUS = {
  validation_error: 400,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  service_unavailable: 503,
} as const;

/** The documented class of each error code. */
export type CustomerErrorClass = keyof typeof CUSTOMER_ERROR_CLASS_STATUS;

/**
 * Code → class mapping. The HTTP status is derived from the class, so a code
 * can never drift into an undocumented status.
 */
export const CUSTOMER_ERROR_CODE_CLASS: Record<
  CustomerErrorCode,
  CustomerErrorClass
> = {
  CUSTOMER_INVALID_PUBLIC_ID: "validation_error",
  CUSTOMER_INVALID_REQUEST_BODY: "validation_error",
  CUSTOMER_MISSING_IDEMPOTENCY_KEY: "validation_error",
  CUSTOMER_PROFILE_NOT_FOUND: "not_found",
  CUSTOMER_IDENTITY_NOT_FOUND: "not_found",
  CUSTOMER_ZONE_NOT_FOUND: "not_found",
  CUSTOMER_PLACE_NOT_FOUND: "not_found",
  CUSTOMER_ORDER_REQUEST_NOT_FOUND: "not_found",
  CUSTOMER_PLACE_LABEL_TAKEN: "conflict",
  CUSTOMER_IDEMPOTENCY_KEY_REUSED: "conflict",
  CUSTOMER_ZONE_INACTIVE: "conflict",
  CUSTOMER_PROFILE_SUSPENDED: "conflict",
  CUSTOMER_PLACE_LIMIT_REACHED: "unprocessable",
  CUSTOMER_PRICE_MODE_MISMATCH: "unprocessable",
  CUSTOMER_MULTI_STOP_NOT_SUPPORTED: "unprocessable",
  CUSTOMER_SHIPMENT_NOT_ALLOWED_FOR_RIDE: "unprocessable",
  CUSTOMER_ORDER_INTAKE_UNAVAILABLE: "service_unavailable",
  CUSTOMER_INTERNAL_ERROR: "service_unavailable",
};

/** HTTP status for an error code, derived from its documented class. */
export function httpStatusForCustomerError(code: CustomerErrorCode): number {
  return CUSTOMER_ERROR_CLASS_STATUS[CUSTOMER_ERROR_CODE_CLASS[code]];
}

// --- Phase 04 policy constants ----------------------------------------

/**
 * Maximum saved places per customer. A use-case policy (not a schema constant)
 * so it can become per-customer later without a migration — see schema.sql.
 */
export const SAVED_PLACES_LIMIT = 20;

/**
 * Stops per order request in Phase 04: exactly pickup + dropoff. Stored as an
 * ordered list so Multi-stop (Phase 13) lifts this without a migration.
 */
export const STOPS_PER_ORDER_REQUEST = 2;

/** Wasla public id format — opaque identity reference, no FK across services. */
export const WASLA_PUBLIC_ID_PATTERN = /^WS-[0-9]{10}$/;
