/**
 * Order Engine Domain Event types — hand-derived from the canonical Event
 * Contract (services/orders/contracts/events.json, JSON Schema 2020-12).
 *
 * Why hand-derived (not codegen): `json-schema-to-typescript` emits a generic
 * index signature for a $defs-only root schema, which is unusable. Same
 * rationale as @wasla/contracts-customer and @wasla/contracts-geography.
 *
 * Drift guard: `__tests__/events.test.ts` reads events.json and asserts the
 * event_type literals, required fields and enum members stay in sync with
 * these types. A silent divergence here would let a producer emit a payload
 * no consumer can read.
 *
 * Privacy rule encoded here (ADR-010 decision 7): payloads carry zone-level
 * location only — never raw coordinates, never user-authored text (stop label,
 * shipment description, notes), never a channel id (chat_id / telegram).
 * `__tests__/boundary.test.ts` digs through every payload shape to enforce it.
 *
 * Canonical source = events.json. If the contract changes, update this file to
 * match and re-run the drift-guard tests.
 */

/** Aggregate kinds emitted by this service. */
export type OrderAggregateType = "order" | "order_assignment";

/** Who performed a transition. `system` covers timeouts and expiry. */
export type OrderActorType = "system" | "customer" | "driver" | "partner" | "admin";

/** Assignment lifecycle as recorded (not decided) by the engine (§16). */
export type OrderAssignmentState = "offered" | "accepted" | "rejected" | "expired" | "cancelled";

/** Terminal assignment states — an offer is resolved exactly once. */
export type OrderAssignmentResolution = Exclude<OrderAssignmentState, "offered">;

/**
 * Order lifecycle states.
 *
 * Note two ADR-010 constraints baked in:
 *  - there is no `draft`: an unreachable state is an impossible state;
 *  - `driver_rejected` and `driver_timeout` are TRANSIENT, not terminal.
 */
export type OrderStatus =
  | "published"
  | "searching"
  | "offered"
  | "negotiating"
  | "accepted"
  | "assigned"
  | "driver_en_route"
  | "arrived"
  | "in_progress"
  | "completed"
  | "driver_rejected"
  | "driver_timeout"
  | "expired"
  | "no_driver_found"
  | "customer_cancelled"
  | "driver_cancelled"
  | "partner_cancelled"
  | "blocked"
  | "failed"
  | "payment_disputed"
  | "under_review";

/** Base envelope shared by all Order Engine domain events. */
export interface EventEnvelope {
  /** UUID. */
  event_id: string;
  /** Discriminator (e.g. "order.status_changed"). */
  event_type: string;
  /** Schema version, pattern ^v[0-9]+$. */
  event_version: string;
  /** ISO-8601 date-time. */
  occurred_at: string;
  /** Always "orders-service". */
  producer: "orders-service";
  /** The aggregate the event concerns. */
  aggregate: {
    type: OrderAggregateType;
    /** `order_public_id` for `order`, assignment UUID for `order_assignment`. */
    id: string;
  };
  /** Optional trace/correlation id. */
  trace_id?: string | null;
}

/** A stop as it appears in an event: zone level only, no label, no coordinates. */
export interface OrderEventStop {
  kind: "pickup" | "dropoff";
  /** Opaque geography zone reference. */
  zone_id: string;
}

/** An order was created in `published` (there is no draft event). */
export interface OrderCreatedV1 extends EventEnvelope {
  event_type: "order.created";
  event_version: "v1";
  data: {
    order_public_id: string;
    customer_public_id: string;
    order_type: "ride" | "delivery";
    vehicle_class: "sedan" | "suv" | "van" | "pickup" | "motorcycle" | "truck_small";
    price_mode: "customer_offer" | "negotiable";
    /** Integer minor units — never a floating point amount. */
    offered_amount_minor?: number | null;
    currency?: string | null;
    status: "published";
    stops: OrderEventStop[];
    requested_at: string;
  };
}

/**
 * The order moved. Emitted for EVERY transition without exception, including
 * creation (`from_status: null`) and terminal ones — it is the evidence that no
 * state changed silently.
 */
export interface OrderStatusChangedV1 extends EventEnvelope {
  event_type: "order.status_changed";
  event_version: "v1";
  data: {
    order_public_id: string;
    customer_public_id: string;
    /** `null` exactly once per order: at creation. */
    from_status?: OrderStatus | null;
    to_status: OrderStatus;
    /** Per-order transition ordinal; lets consumers detect redelivery. */
    sequence: number;
    reason_code?: string | null;
    actor_type: OrderActorType;
    actor_ref?: string | null;
    /** Driver of the active assignment, if any. Opaque reference. */
    driver_public_id?: string | null;
    /** Derived from the transition table, never hand-written. */
    is_terminal: boolean;
  };
}

/** An assignment offer was recorded (Phase 07 decided it; the engine logged it). */
export interface OrderAssignmentOfferedV1 extends EventEnvelope {
  event_type: "order.assignment_offered";
  event_version: "v1";
  data: {
    order_public_id: string;
    driver_public_id: string;
    sequence: number;
    offered_at: string;
  };
}

/**
 * An assignment offer ended. A rejection or timeout does NOT end the order
 * (ADR-010 decision 3.5) — consumers must not infer termination from this.
 */
export interface OrderAssignmentResolvedV1 extends EventEnvelope {
  event_type: "order.assignment_resolved";
  event_version: "v1";
  data: {
    order_public_id: string;
    driver_public_id: string;
    sequence: number;
    assignment_state: OrderAssignmentResolution;
    reason_code?: string | null;
    resolved_at: string;
  };
}

/** Every event this service publishes. */
export type OrderDomainEvent =
  | OrderCreatedV1
  | OrderStatusChangedV1
  | OrderAssignmentOfferedV1
  | OrderAssignmentResolvedV1;

/** Stable event_type literals. Consumers switch on these, not on strings. */
export const ORDER_EVENT_TYPES = {
  ORDER_CREATED: "order.created",
  ORDER_STATUS_CHANGED: "order.status_changed",
  ORDER_ASSIGNMENT_OFFERED: "order.assignment_offered",
  ORDER_ASSIGNMENT_RESOLVED: "order.assignment_resolved",
} as const;

export type OrderEventType = (typeof ORDER_EVENT_TYPES)[keyof typeof ORDER_EVENT_TYPES];
