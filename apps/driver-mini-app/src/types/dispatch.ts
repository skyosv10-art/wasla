// Dispatch API types — matching @wasla/contracts-dispatch OpenAPI contract.
// These are the wire shapes returned by the dispatch service (port 8084).

export type DispatchJobStatus =
  | "open"
  | "escalated"
  | "assigned"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "exhausted";

export type DispatchOfferStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "expired"
  | "timed_out";

export type OrderType = "ride" | "delivery" | "marketplace";
export type VehicleClass = "car" | "motorcycle" | "bicycle" | "van" | "truck";

export interface DispatchRulesSnapshot {
  ruleset_version: string;
  wave_size: number;
  offer_timeout_seconds: number;
  max_waves: number;
  escalation_timeout_seconds: number;
}

export interface DispatchJob {
  id: string;
  order_id: string;
  order_public_id: string;
  zone_id: string;
  order_type: OrderType;
  vehicle_class: VehicleClass;
  status: DispatchJobStatus;
  status_reason_code: string | null;
  rules: DispatchRulesSnapshot;
  expires_at: string;
  escalation_expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface DispatchOffer {
  id: string;
  job_id: string;
  wave_id: string;
  driver_public_id: string;
  status: DispatchOfferStatus;
  reason_code: string | null;
  offered_at: string;
  expires_at: string;
  responded_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface DispatchOfferDetail extends DispatchOffer {
  order_public_id: string;
  order_id: string;
  order_type: OrderType;
  vehicle_class: VehicleClass;
  job_status: DispatchJobStatus;
  standing: "active" | "superseded" | "expired";
}

export interface DispatchOfferList {
  items: DispatchOffer[];
}
