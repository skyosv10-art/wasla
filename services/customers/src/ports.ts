/**
 * Ports (hexagonal boundaries) for the Customer Core domain.
 *
 * Use cases depend on these interfaces only. Adapters live in ./infrastructure:
 * in-memory + fakes here (MR 2/6), Drizzle/Postgres repositories in MR 3/6, and
 * the HTTP order-engine adapter in Phase 06.
 *
 * The dependency direction is one-way: customers → identity (read),
 * customers → geography (read), customers → order engine (handover through a
 * contract). Nothing depends on customers in Phase 04 (ADR-009).
 */

import type { CustomerEvent } from "@wasla/contracts-customer";

import type {
  CustomerOrderRequest,
  CustomerProfile,
  IntakeFailureReason,
  Money,
  OrderRequestStatus,
  OrderType,
  PriceMode,
  SavedPlace,
  ShipmentDetails,
  Stop,
  VehicleClass,
  ZoneReference,
} from "./domain/model.js";

/** Wall-clock time as an ISO-8601 string. */
export interface Clock {
  now(): string;
}

/** UUID generator (entity ids and event ids). */
export interface IdGenerator {
  uuid(): string;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

/** Row to insert for a saved place (ids and timestamps decided by the caller). */
export interface InsertSavedPlaceInput {
  readonly id: string;
  readonly waslaPublicId: string;
  readonly label: string;
  readonly zoneId: string;
  readonly addressText: string | null;
  readonly coordinates: SavedPlace["coordinates"];
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

/** Row to insert for an order request, including its ordered stops. */
export interface InsertOrderRequestInput {
  readonly id: string;
  readonly waslaPublicId: string;
  readonly idempotencyKey: string;
  readonly status: OrderRequestStatus;
  readonly orderType: OrderType;
  readonly vehicleClass: VehicleClass;
  readonly priceMode: PriceMode;
  readonly offeredPrice: Money | null;
  readonly stops: readonly Stop[];
  readonly shipment: ShipmentDetails | null;
  readonly notes: string | null;
  readonly orderPublicId: string | null;
  readonly submittedAt: string | null;
  readonly failureReasonCode: IntakeFailureReason | null;
  readonly createdAt: string;
}

/** The outcome of a handover attempt, applied to an existing request row. */
export interface OrderRequestOutcome {
  readonly status: OrderRequestStatus;
  readonly orderPublicId: string | null;
  readonly submittedAt: string | null;
  readonly failureReasonCode: IntakeFailureReason | null;
  readonly updatedAt: string;
}

/**
 * The customer repository. One port for the three aggregates because they share
 * one database and one transaction boundary; splitting it would suggest they can
 * live apart, which they cannot.
 *
 * Implementations must enforce the schema.sql constraints — in particular the
 * unique `(wasla_public_id, idempotency_key)` pairs and the case-insensitive
 * place-label uniqueness — so the in-memory and Postgres adapters make the use
 * cases behave identically.
 */
export interface CustomerRepository {
  // --- profile ---
  findProfile(waslaPublicId: string): Promise<CustomerProfile | null>;
  saveProfile(profile: CustomerProfile): Promise<CustomerProfile>;

  // --- saved places ---
  /** Places of a customer, most recently used first, then newest first. */
  listPlaces(waslaPublicId: string): Promise<SavedPlace[]>;
  findPlace(waslaPublicId: string, placeId: string): Promise<SavedPlace | null>;
  /** Label match is case-insensitive (schema: unique on lower(label)). */
  findPlaceByLabel(waslaPublicId: string, label: string): Promise<SavedPlace | null>;
  findPlaceByIdempotencyKey(
    waslaPublicId: string,
    idempotencyKey: string,
  ): Promise<SavedPlace | null>;
  countPlaces(waslaPublicId: string): Promise<number>;
  insertPlace(input: InsertSavedPlaceInput): Promise<SavedPlace>;
  deletePlace(waslaPublicId: string, placeId: string): Promise<boolean>;
  /** Record that a place was used as a stop, for the bot's ordering. */
  touchPlace(waslaPublicId: string, placeId: string, usedAt: string): Promise<void>;

  // --- order requests ---
  findOrderRequest(
    waslaPublicId: string,
    orderRequestId: string,
  ): Promise<CustomerOrderRequest | null>;
  findOrderRequestByIdempotencyKey(
    waslaPublicId: string,
    idempotencyKey: string,
  ): Promise<CustomerOrderRequest | null>;
  /** Requests of a customer, newest first. */
  listOrderRequests(
    waslaPublicId: string,
    options?: { readonly status?: OrderRequestStatus; readonly limit?: number },
  ): Promise<CustomerOrderRequest[]>;
  insertOrderRequest(input: InsertOrderRequestInput): Promise<CustomerOrderRequest>;
  /** Apply a handover outcome to a stored request (retry updates in place). */
  updateOrderRequestOutcome(
    orderRequestId: string,
    outcome: OrderRequestOutcome,
  ): Promise<CustomerOrderRequest>;
}

// ---------------------------------------------------------------------------
// Cross-service read ports
// ---------------------------------------------------------------------------

/**
 * Identity existence check. The profile stores `wasla_public_id` as an opaque
 * reference with no FK (ADR-001 · ADR-009 §2); this port answers whether the
 * identity exists without coupling to identity internals.
 */
export interface IdentityLookupPort {
  identityExists(waslaPublicId: string): Promise<boolean>;
}

/**
 * Geography read port. A zone is the anchor of every stop, so the service needs
 * to know that a zone exists and is active — nothing more. It deliberately does
 * not expose coordinates, distances or coverage: none of those exist in the
 * system yet (§28).
 */
export interface GeographyPort {
  findZone(zoneId: string): Promise<ZoneReference | null>;
}

// ---------------------------------------------------------------------------
// Order handover port
// ---------------------------------------------------------------------------

/** The payload handed to the order engine (mirrors OrderIntakeRequest). */
export interface OrderIntakeRequestInput {
  readonly orderRequestId: string;
  readonly customerPublicId: string;
  readonly orderType: OrderType;
  readonly vehicleClass: VehicleClass;
  readonly priceMode: PriceMode;
  readonly offeredPrice: Money | null;
  readonly stops: readonly Stop[];
  readonly shipment: ShipmentDetails | null;
  readonly notes: string | null;
  readonly requestedAt: string;
  readonly idempotencyKey: string;
}

/** What the engine returns. It owns `orderPublicId` — this service never mints it. */
export interface OrderIntakeResultOutput {
  readonly orderPublicId: string;
  readonly acceptedAt: string;
}

/**
 * The single boundary to the order engine (ADR-009 §3).
 *
 * This is the whole contract: hand over a validated intent, receive the engine's
 * reference. There is no method to update, cancel or read an order, because this
 * service does not own the order lifecycle. Adapters must throw
 * `OrderIntakeFailure` (with a reason code) rather than returning a partial
 * result, so the fail-closed path stays explicit.
 *
 * `context` was added in Phase 06 (MR 5/6) and is **optional**, so the in-memory
 * adapters and the exit-gate double keep working unchanged. It exists because a
 * handover that cannot be correlated is a handover nobody can investigate: the
 * trace id lives in `UseCaseDeps`, not in the payload, and the payload is a
 * published contract that must not grow a transport field.
 */
export interface OrderIntakeCallContext {
  /** Correlation id of the customer's request; becomes the engine's `trace_id`. */
  readonly traceId?: string;
}

export interface OrderIntakePort {
  submitOrderRequest(
    request: OrderIntakeRequestInput,
    context?: OrderIntakeCallContext,
  ): Promise<OrderIntakeResultOutput>;
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

/**
 * Domain event outbox. Use cases append within the same logical operation; a
 * relay publishes later. Kept separate from the repository so the domain owns
 * event ordering without knowing about a broker.
 */
export interface Outbox {
  append(event: CustomerEvent): Promise<void>;
  /** Appended (unpublished) events — used by tests and the future relay. */
  unread(): Promise<CustomerEvent[]>;
}
