// Orders API types — matching @wasla/contracts-orders OpenAPI contract.
// These are the wire shapes returned by the orders service (port 8087).

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
  | "customer_cancelled";

export type ActorType = "system" | "customer" | "driver" | "partner" | "admin";

export interface TransitionRequest {
  to_status: OrderStatus;
  reason_code?: string;
  actor_type: ActorType;
  actor_ref?: string;
}

export interface OrderLineItem {
  sku: string;
  name: string;
  quantity: number;
  unit_price?: number;
}

export interface Order {
  id: string;
  public_id: string;
  customer_public_id: string;
  status: OrderStatus;
  order_type: "ride" | "delivery" | "marketplace";
  origin_address?: string;
  origin_lat?: number;
  origin_lng?: number;
  destination_address?: string;
  destination_lat?: number;
  destination_lng?: number;
  pickup_note?: string;
  delivery_note?: string;
  vehicle_class?: string;
  items?: OrderLineItem[];
  offered_price?: number;
  agreed_price?: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface OrderTransition {
  id: string;
  order_id: string;
  from_status: OrderStatus;
  to_status: OrderStatus;
  reason_code: string | null;
  actor_type: ActorType;
  actor_ref: string | null;
  created_at: string;
}
