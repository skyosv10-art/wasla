/**
 * Order types for admin portal.
 *
 * Mirrors the API contract from the orders-service.
 * Wire format is snake_case; domain types use camelCase.
 * Admin list endpoint (GET /orders) is planned for orders-service —
 * frontend built ahead per ADR-047 Wave 3 pattern.
 */

export const ORDER_STATUSES = [
  "pending_acceptance",
  "searching",
  "assigned",
  "driver_en_route",
  "arrived",
  "in_progress",
  "completed",
  "cancelled",
  "expired",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TYPES = ["ride", "delivery"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const PRICE_MODES = ["fixed", "negotiated"] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

export const VEHICLE_CLASSES = [
  "sedan",
  "suv",
  "van",
  "truck",
  "motorcycle",
] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export const ACTOR_TYPES = ["customer", "driver", "system", "operator"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** Price as returned in order wire format */
export interface PriceWire {
  amount_minor: number;
  currency: string;
}

/** Stop as returned in order wire format */
export interface StopWire {
  sequence: number;
  kind: "pickup" | "dropoff";
  latitude: number;
  longitude: number;
  short_address: string | null;
  full_address: string | null;
}

/** Shipment details for delivery orders */
export interface ShipmentWire {
  shipment_type: string;
  description: string | null;
  weight_kg: number | null;
}

/** Assignment as returned in order wire format */
export interface AssignmentWire {
  assignment_id: number;
  driver_public_id: string;
  state: string;
  offered_at: string;
  accepted_at: string | null;
  expired_at: string | null;
  cancelled_at: string | null;
}

/** Order summary as returned by GET /orders/lookup */
export interface OrderSummary {
  order_public_id: string;
  order_id: number;
  status: OrderStatus;
  price_mode: PriceMode;
  order_type: OrderType;
  vehicle_class: VehicleClass;
  agreed_price: PriceWire | null;
  agreed_at: string | null;
  agreed_negotiation_id: string | null;
}

/** Order detail as returned by GET /orders/:orderId */
export interface OrderDetail {
  id: number;
  order_public_id: string;
  order_request_id: string;
  customer_public_id: string;
  order_type: OrderType;
  vehicle_class: VehicleClass;
  status: OrderStatus;
  status_reason_code: string | null;
  price_mode: PriceMode;
  offered_price: PriceWire | null;
  agreed_price: PriceWire | null;
  agreed_at: string | null;
  agreed_negotiation_id: string | null;
  stops: StopWire[];
  shipment: ShipmentWire | null;
  notes: string | null;
  active_assignment: AssignmentWire | null;
  requested_at: string;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Status history entry as returned by GET /orders/:orderId/history */
export interface StatusHistoryEntry {
  sequence: number;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  reason_code: string | null;
  actor_type: ActorType;
  actor_ref: string;
  occurred_at: string;
  trace_id: string;
}

/** Wire response from GET /orders/:orderId/history */
export interface StatusHistoryResponse {
  items: StatusHistoryEntry[];
}
