/**
 * Customer Core domain model (Phase 04).
 *
 * These are the in-service shapes: camelCase, no transport concerns, no SQL
 * concerns. They mirror the published contracts one-to-one in meaning:
 *  - the API DTOs live in @wasla/contracts-customer (generated from OpenAPI),
 *  - the storage columns live in services/customers/contracts/schema.sql,
 *  - the mappers in ../use-cases/mappers.ts translate between them.
 *
 * Boundary reminder (ADR-009): nothing here models an order. `orderPublicId`
 * is a reference the Order Engine (Phase 06) owns and this service only stores
 * after a successful handover; there is deliberately no order state machine,
 * no matching, and no pricing in this model.
 */

/** Supported locales for customer-facing copy (ADR-006; `ar` is the default). */
export type Locale = "ar" | "en" | "ur";

/** Profile status. Suspension blocks creating requests, not reading data. */
export type CustomerStatus = "active" | "suspended";

/** Ride or delivery. */
export type OrderType = "ride" | "delivery";

/**
 * Closed vehicle-class enum (ADR-009 §7). Phase 05 advertises driver
 * capabilities with the same vocabulary, so a free-text value would produce a
 * request nobody can match.
 */
export type VehicleClass =
  | "sedan"
  | "suv"
  | "van"
  | "pickup"
  | "motorcycle"
  | "truck_small";

/** Explicit customer offer or negotiable — never an implicit estimate. */
export type PriceMode = "customer_offer" | "negotiable";

/** Delivery-only shipment kinds. */
export type ShipmentType = "parcel" | "documents" | "food" | "goods" | "other";

/** Pickup or dropoff. */
export type StopKind = "pickup" | "dropoff";

/** How the customer produced a stop. Recorded because it explains data quality. */
export type StopSource =
  | "map"
  | "telegram_location"
  | "link"
  | "text_search"
  | "saved_place"
  | "manual_zone";

/**
 * Handover status toward the order engine — **not** an order state.
 * `submitted` = the engine accepted it · `submission_failed` = it never landed.
 */
export type OrderRequestStatus = "submitted" | "submission_failed";

/** Operational reasons a handover failed (finer than the customer-facing 503). */
export type IntakeFailureReason =
  | "CUSTOMER_ORDER_INTAKE_UNAVAILABLE"
  | "CUSTOMER_ORDER_INTAKE_REJECTED"
  | "CUSTOMER_ORDER_INTAKE_TIMEOUT";

/** Non-blocking observations about a request, surfaced by the preview. */
export type OrderRequestWarning =
  | "same_zone_pickup_and_dropoff"
  | "no_price_offered";

/** Money is integer minor units + an ISO-4217 code. Never a float. */
export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

/** A latitude/longitude pair. Both halves or neither (schema CHECK). */
export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/** The customer role profile. Keyed by an opaque identity reference, no FK. */
export interface CustomerProfile {
  readonly waslaPublicId: string;
  readonly displayName: string | null;
  readonly preferredLocale: Locale;
  readonly defaultZoneId: string | null;
  readonly status: CustomerStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Fields a caller may set on a profile. Absent fields are left untouched. */
export interface CustomerProfilePatch {
  readonly displayName?: string | null;
  readonly preferredLocale?: Locale;
  readonly defaultZoneId?: string | null;
}

/** Profile fields whose change is announced in `customer.profile.updated`. */
export type CustomerProfileField =
  | "display_name"
  | "preferred_locale"
  | "default_zone_id";

/** A place the customer saved to reuse as a stop. */
export interface SavedPlace {
  readonly id: string;
  readonly waslaPublicId: string;
  readonly label: string;
  readonly zoneId: string;
  readonly addressText: string | null;
  readonly coordinates: Coordinates | null;
  readonly idempotencyKey: string;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
}

/** What a caller supplies to save a place. */
export interface SavedPlaceDraft {
  readonly label: string;
  readonly zoneId: string;
  readonly addressText?: string | null;
  readonly coordinates?: Coordinates | null;
}

/**
 * A stop as supplied by the customer.
 *
 * `zoneId` is the anchor and is required; `coordinates` are optional and decide
 * nothing (no reverse geocoding, no distance in this system — §28), they exist
 * for display and for handing to the driver.
 */
export interface StopDraft {
  readonly kind: StopKind;
  readonly zoneId: string;
  readonly label?: string | null;
  readonly coordinates?: Coordinates | null;
  readonly source: StopSource;
  readonly savedPlaceId?: string | null;
}

/** A persisted stop: a draft plus its position in the ordered list. */
export interface Stop {
  readonly kind: StopKind;
  readonly sequence: number;
  readonly zoneId: string;
  readonly label: string | null;
  readonly coordinates: Coordinates | null;
  readonly source: StopSource;
  readonly savedPlaceId: string | null;
}

/**
 * Delivery-only shipment details, as exposed by the API contract.
 *
 * `description` is free text the customer writes (≤300 chars — the same bound as
 * `ShipmentDetails.description` in api.openapi.yml and `shipment_description` in
 * schema.sql). It was missing here until MR 3/6: the contract published it, the
 * schema had a column for it, and the domain silently dropped it — a published
 * field the service accepted and threw away. It is carried to the order engine
 * with the rest of the request and is deliberately **absent from every event**
 * (events carry no user-written text — test-enforced in events-privacy).
 */
export interface ShipmentDetails {
  readonly shipmentType?: ShipmentType;
  readonly description?: string | null;
  readonly weightKg?: number | null;
}

/** What a caller supplies to preview or submit an order request. */
export interface OrderRequestDraft {
  readonly orderType: OrderType;
  readonly vehicleClass: VehicleClass;
  readonly priceMode: PriceMode;
  readonly offeredPrice?: Money | null;
  readonly stops: readonly StopDraft[];
  readonly shipment?: ShipmentDetails | null;
  readonly notes?: string | null;
}

/** A stored customer order request — the intent, not the order. */
export interface CustomerOrderRequest {
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
  /** Owned by the order engine. Null until (and unless) it accepts. */
  readonly orderPublicId: string | null;
  readonly submittedAt: string | null;
  readonly failureReasonCode: IntakeFailureReason | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A zone as seen from this service: an opaque reference plus its status. */
export interface ZoneReference {
  readonly zoneId: string;
  readonly status: "active" | "inactive";
  /** Human-readable path (country › region › city › district › zone), if known. */
  readonly path?: string | null;
}

/** The pickup stop of a request (sequence 1 in Phase 04). */
export function pickupStop(stops: readonly Stop[]): Stop | undefined {
  return stops.find((stop) => stop.kind === "pickup");
}

/** The dropoff stop of a request (sequence 2 in Phase 04). */
export function dropoffStop(stops: readonly Stop[]): Stop | undefined {
  return stops.find((stop) => stop.kind === "dropoff");
}
