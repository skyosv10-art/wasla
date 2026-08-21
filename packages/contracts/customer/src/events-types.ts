/**
 * Customer Core Domain Event types — hand-derived from the canonical Event
 * Contract (services/customers/contracts/events.json, JSON Schema 2020-12).
 *
 * Why hand-derived (not codegen): `json-schema-to-typescript` emits a generic
 * index signature for the $defs-only root schema, which is unusable. The event
 * set is small, stable, and versioned (v1; any breaking change requires v2 +
 * ADR), so hand-authoring is reliable and low-drift. Same rationale as
 * @wasla/contracts-geography.
 *
 * Drift guard: `__tests__/events.test.ts` reads events.json and asserts the
 * event_type literals + payload structure stay in sync with these types.
 *
 * Privacy rule encoded here (see events.json): payloads carry zone-level
 * location only — never raw coordinates, never user-authored text (place
 * label, shipment description, notes, display name).
 *
 * Canonical source = events.json. If the contract changes, update this file
 * to match and re-run the drift-guard test.
 */

/** Supported profile locales. */
export type CustomerLocale = "ar" | "en" | "ur";

/** Aggregate kinds emitted by this service. */
export type CustomerAggregateType = "customer" | "customer_order_request";

/** Base envelope shared by all Customer Core domain events. */
export interface EventEnvelope {
  /** UUID. */
  event_id: string;
  /** Discriminator (e.g. "customer.profile.created"). */
  event_type: string;
  /** Schema version, pattern ^v[0-9]+$. */
  event_version: string;
  /** ISO-8601 date-time. */
  occurred_at: string;
  /** Always "customers-service". */
  producer: "customers-service";
  /** The aggregate the event concerns. */
  aggregate: {
    type: CustomerAggregateType;
    /**
     * wasla_public_id (^WS-[0-9]{10}$) for `customer`, or the customer order
     * request UUID for `customer_order_request`.
     */
    id: string;
  };
  /** Optional trace/correlation id. */
  trace_id?: string;
}

/** A customer role profile was created for an existing identity. */
export interface CustomerProfileCreatedV1 extends EventEnvelope {
  event_type: "customer.profile.created";
  event_version: "v1";
  payload: {
    /** Pattern ^WS-[0-9]{10}$. */
    wasla_public_id: string;
    preferred_locale: CustomerLocale;
    /** UUID of the default zone, or null. */
    default_zone_id?: string | null;
    /** Whether a display name was set — the value itself is never published. */
    has_display_name?: boolean;
  };
}

/** An existing customer profile was updated. Announces which fields changed. */
export interface CustomerProfileUpdatedV1 extends EventEnvelope {
  event_type: "customer.profile.updated";
  event_version: "v1";
  payload: {
    /** Pattern ^WS-[0-9]{10}$. */
    wasla_public_id: string;
    /** Non-empty list of changed field names. */
    changed_fields: Array<"display_name" | "preferred_locale" | "default_zone_id">;
    preferred_locale?: CustomerLocale;
    default_zone_id?: string | null;
  };
}

/** The customer saved a place. Zone-level only: no label, address, or coords. */
export interface CustomerPlaceSavedV1 extends EventEnvelope {
  event_type: "customer.place.saved";
  event_version: "v1";
  payload: {
    /** Pattern ^WS-[0-9]{10}$. */
    wasla_public_id: string;
    /** UUID of the saved place. */
    place_id: string;
    /** UUID of the zone. */
    zone_id: string;
    has_coordinates?: boolean;
  };
}

/** The customer removed a saved place. */
export interface CustomerPlaceRemovedV1 extends EventEnvelope {
  event_type: "customer.place.removed";
  event_version: "v1";
  payload: {
    /** Pattern ^WS-[0-9]{10}$. */
    wasla_public_id: string;
    /** UUID of the removed place. */
    place_id: string;
  };
}

/** Order types a customer can request in Phase 04. */
export type CustomerOrderType = "ride" | "delivery";

/** Closed vehicle-class enum (ADR-009 §7). */
export type CustomerVehicleClass =
  | "sedan"
  | "suv"
  | "van"
  | "pickup"
  | "motorcycle"
  | "truck_small";

/** Price modes — explicit offer or negotiable, never an implicit estimate. */
export type CustomerPriceMode = "customer_offer" | "negotiable";

/** Shipment kinds (delivery only). */
export type CustomerShipmentType =
  | "parcel"
  | "documents"
  | "food"
  | "goods"
  | "other";

/** Reasons an order request failed to reach the order engine. */
export type CustomerOrderIntakeFailureReason =
  | "CUSTOMER_ORDER_INTAKE_UNAVAILABLE"
  | "CUSTOMER_ORDER_INTAKE_REJECTED"
  | "CUSTOMER_ORDER_INTAKE_TIMEOUT";

/**
 * The customer's order request was accepted by the order engine.
 *
 * NOTE: this event does NOT announce an order state — the order lifecycle is
 * owned by the Order Engine (Phase 06). `order_public_id` is a reference the
 * engine owns; this service never mints it.
 */
export interface CustomerOrderRequestSubmittedV1 extends EventEnvelope {
  event_type: "customer.order_request.submitted";
  event_version: "v1";
  payload: {
    /** UUID of the customer order request (local aggregate). */
    order_request_id: string;
    /** Pattern ^WS-[0-9]{10}$. */
    customer_public_id: string;
    /** Reference owned by the order engine, or null. */
    order_public_id?: string | null;
    order_type: CustomerOrderType;
    vehicle_class: CustomerVehicleClass;
    price_mode: CustomerPriceMode;
    /** Minor currency units; null in negotiable mode. */
    offered_amount_minor?: number | null;
    /** ISO-4217 alphabetic code; null in negotiable mode. */
    currency?: string | null;
    /** UUID of the pickup zone. */
    pickup_zone_id: string;
    /** UUID of the dropoff zone. */
    dropoff_zone_id: string;
    shipment_type?: CustomerShipmentType | null;
  };
}

/** The order request could not be handed to the engine — failure stays visible. */
export interface CustomerOrderRequestSubmissionFailedV1 extends EventEnvelope {
  event_type: "customer.order_request.submission_failed";
  event_version: "v1";
  payload: {
    /** UUID of the customer order request. */
    order_request_id: string;
    /** Pattern ^WS-[0-9]{10}$. */
    customer_public_id: string;
    reason_code: CustomerOrderIntakeFailureReason;
  };
}

/** Union of all v1 Customer Core domain events. */
export type CustomerEvent =
  | CustomerProfileCreatedV1
  | CustomerProfileUpdatedV1
  | CustomerPlaceSavedV1
  | CustomerPlaceRemovedV1
  | CustomerOrderRequestSubmittedV1
  | CustomerOrderRequestSubmissionFailedV1;

/** Discriminator union of all event_type literals. */
export type CustomerEventType = CustomerEvent["event_type"];

/** All v1 event_type literals, in declaration order. (Drift-guarded by tests.) */
export const CUSTOMER_EVENT_TYPES: readonly CustomerEventType[] = [
  "customer.profile.created",
  "customer.profile.updated",
  "customer.place.saved",
  "customer.place.removed",
  "customer.order_request.submitted",
  "customer.order_request.submission_failed",
] as const;

/** Map an event_type literal to its concrete event interface (type-level). */
export interface CustomerEventByType {
  "customer.profile.created": CustomerProfileCreatedV1;
  "customer.profile.updated": CustomerProfileUpdatedV1;
  "customer.place.saved": CustomerPlaceSavedV1;
  "customer.place.removed": CustomerPlaceRemovedV1;
  "customer.order_request.submitted": CustomerOrderRequestSubmittedV1;
  "customer.order_request.submission_failed": CustomerOrderRequestSubmissionFailedV1;
}
