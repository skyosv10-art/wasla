/**
 * Delivery service domain model (Phase 13) — the store-order aggregate.
 *
 * This aggregate is a STORE ORDER: a cart of item snapshots from ONE store
 * (ADR-026 §2.1). It is NOT the transport order of services/orders — that
 * lifecycle (21 states, ADR-010) models a single-driver transport journey;
 * this one models pick-pack-substitute-deliver with orthogonal payment
 * mirroring (§2.2).
 *
 * Two orthogonal state fields, never one mixed column:
 *  - `fulfillmentState` — THIS service's decision (§3.1).
 *  - `paymentState` — a mirror of an external payment intent referenced by
 *    `paymentRef`. No money is processed here; billing is M5-17 (§2.2).
 *
 * Items are SNAPSHOTS, not inventory balances (§2.3): quantity and price are
 * captured at order time and never re-read from the catalog. Live quantities
 * are read through the agreed marketplace port only — this model holds none.
 *
 * Privacy (§2.6 · ADR-001 · ADR-007): every human and store is an opaque
 * `WS-##########` ref. No names, phones, addresses or coordinates exist in
 * this model — live status is a state transition, not a location.
 */

import type {
  FulfillmentState,
  PaymentState,
  WaslaPublicId,
} from "@wasla/contracts-delivery";

/** An item snapshot line, immutable after creation except substitution (§2.5). */
export interface StoreOrderItem {
  readonly orderItemId: string;
  readonly lineNo: number;
  /** Logical marketplace product reference — no cross-service FK (§2.3). */
  readonly productId: string;
  readonly sku: string;
  readonly quantity: number;
  /** Snapshot taken at order time — never re-read from the catalog. */
  readonly unitPriceMinorUnits: number;
  readonly lineTotalMinorUnits: number;
  /** Substitution is a LINE decision, only during picking (§2.5). */
  readonly substitutedProductId?: string;
  readonly substitutionReason?: "out_of_stock" | "customer_approved_alternative" | "store_policy";
  readonly substitutionPriceDeltaMinorUnits?: number;
}

/** A store order, exactly as the ledger sees it. */
export interface StoreOrder {
  readonly orderId: string;
  readonly publicId: WaslaPublicId;
  readonly customerRef: WaslaPublicId;
  readonly storeId: string;
  readonly storePublicId: WaslaPublicId;
  readonly fulfillmentState: FulfillmentState;
  readonly paymentState: PaymentState;
  readonly paymentRef: string | null;
  readonly currencyCode: "SAR";
  readonly itemsTotalMinorUnits: number;
  readonly deliveryFeeMinorUnits: number;
  readonly totalMinorUnits: number;
  readonly items: readonly StoreOrderItem[];
  /** Optimistic concurrency — every transition bumps this. */
  readonly version: number;
}

/** Proof of delivery — REQUIRED for delivered, forbidden elsewhere (§2.4). */
export interface ProofOfDelivery {
  readonly proofType: "otp" | "photo" | "signature" | "pin_code";
  readonly proofRef: string;
}

/**
 * The delivery task — a COARSE MIRROR of dispatch results (§2.4).
 *
 * The precise logic (waves, offers, timeouts) belongs to services/dispatch;
 * this record only projects outcomes into coarse states. `dispatchJobRef`
 * delegates by reference, never by copying logic.
 */
export interface DeliveryTask {
  readonly taskId: string;
  readonly orderId: string;
  readonly state:
    | "pending_eligibility"
    | "eligible"
    | "dispatch_requested"
    | "driver_assigned"
    | "timed_out"
    | "reassigned"
    | "exhausted"
    | "picked_up"
    | "in_transit"
    | "arrived"
    | "delivered"
    | "ineligible"
    | "failed"
    | "cancelled";
  readonly ineligibilityReason: "outside_coverage" | "store_not_orderable" | "no_courier_service" | null;
  readonly dispatchJobRef: string | null;
  /** Opaque courier ref — no name, no phone (§2.6). */
  readonly courierRef: WaslaPublicId | null;
  readonly proof: ProofOfDelivery | null;
  readonly version: number;
}
