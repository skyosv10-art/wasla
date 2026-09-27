/**
 * services/billing/src/domain/consumed-events.ts
 *
 * Consumer-side typed views of the DELIVERY outbox events the billing relay
 * reads (M5-17Q · CLM-0376 · ADR-050 §3 — fees are calculated from completed
 * delivery events, not from active orders).
 *
 * Source decision (owner, 2026-09-27): billing consumes `store_order.*` from
 * `delivery_outbox` — the real producer of the store-order money snapshot
 * (ADR-026 §2.6). `OrderStatusChangedV1` in `services/orders` is NOT extended
 * and gains no financial field (ADR-050 Consequence 3). These views describe
 * the shape of what is consumed; they are NOT a second source of truth.
 *
 *   store_order.created                  → record the order's money snapshot
 *   store_order.item_substituted         → adjust the snapshot's items total
 *   store_order.fulfillment_state_changed
 *        with to_state = "delivered"     → settle the store_variable fee ONCE
 *        any other to_state              → ignored (non-trigger)
 *   other store_order.* events           → ignored
 *   delivery_task aggregate (delivery.*) → ignored_foreign
 *
 * Reliability guarantees (same contract as support/delivery/search relays):
 *  - Idempotency: a consumed `event_id` with a terminal status is never
 *    re-processed; the snapshot row additionally makes settlement once PER
 *    ORDER, not only once per event.
 *  - Ordering: per-stream watermark (occurred_at, event_id).
 *  - Poison: invalid payloads, unknown versions → dead-lettered in the ledger.
 *  - Version: only `event_version === "v1"` is consumed.
 *
 * Referenced: ADR-050 §3 · ADR-026 §2.4/§2.6 · services/delivery/contracts/events.json
 */

/** A row read from `delivery_outbox` by the relay's event source. */
export interface DeliveryOutboxRow {
  readonly event_id: string;
  readonly event_type: string;
  readonly event_version: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly occurred_at: string;
  readonly trace_id: string | null;
  /** The event `payload` exactly as delivery wrote it (JSONB). */
  readonly payload: Record<string, unknown>;
}

export const STORE_ORDER_CREATED = "store_order.created";
export const STORE_ORDER_ITEM_SUBSTITUTED = "store_order.item_substituted";
export const STORE_ORDER_FULFILLMENT_STATE_CHANGED = "store_order.fulfillment_state_changed";

/**
 * Fulfillment states that trigger fee settlement. `delivered` is the only
 * completed terminal state of a store order (FulfillmentState in the delivery
 * contract); cancelled / rejected / failed orders incur no fee.
 */
export const SETTLEMENT_TRIGGER_STATES: readonly string[] = ["delivered"];

export function isSettlementTrigger(toState: string): boolean {
  return SETTLEMENT_TRIGGER_STATES.includes(toState);
}

/**
 * The checkpoint offset the relay owns (same decision as ADR-025 §2.3 GAP-3):
 * progress is (occurred_at, event_id) of the last terminally-consumed row.
 * The relay NEVER writes `delivery_outbox`.
 */
export interface RelayCheckpoint {
  readonly last_occurred_at: string;
  readonly last_event_id: string;
}

export const ZERO_CHECKPOINT: RelayCheckpoint = {
  last_occurred_at: new Date(0).toISOString(),
  last_event_id: "00000000-0000-0000-0000-000000000000",
};

/** Lexicographic (occurred_at, event_id) comparison — the stream's order. */
export function isBefore(a: RelayCheckpoint, b: RelayCheckpoint): boolean {
  if (a.last_occurred_at < b.last_occurred_at) return true;
  if (a.last_occurred_at > b.last_occurred_at) return false;
  return a.last_event_id < b.last_event_id;
}

/** Terminal/non-terminal status of a consumed delivery outbox event. */
export type ConsumedStatus =
  | "pending" // retryable failure — checkpoint does NOT advance
  | "settled" // a fee settlement was created for the delivered order — terminal
  | "recorded" // the order's money snapshot was recorded/adjusted — terminal
  | "skipped_stale" // older than the checkpoint / already in the ledger — terminal
  | "ignored" // non-trigger store_order event — terminal
  | "ignored_foreign" // not a store_order aggregate — terminal
  | "poisoned"; // dead-letter: bad payload/version/missing snapshot — terminal

export function isTerminal(status: ConsumedStatus): boolean {
  return status !== "pending";
}

/* ── Payload views (validated here; the delivery contract is the shape) ── */

/** The money snapshot of a store order, taken from `store_order.created`. */
export interface StoreOrderSnapshot {
  /** `aggregate.id` — the delivery store order UUID (storage key). */
  readonly order_id: string;
  readonly order_public_id: string;
  /** Marketplace store UUID — the billing store reference on invoices. */
  readonly store_id: string;
  readonly store_slug: string;
  readonly currency_code: "SAR";
  readonly items_total_minor_units: number;
  readonly delivery_fee_minor_units: number;
}

export type Classification =
  | { readonly kind: "snapshot"; readonly snapshot: StoreOrderSnapshot }
  | { readonly kind: "adjust"; readonly order_id: string; readonly price_delta_minor_units: number }
  | { readonly kind: "settle"; readonly order_id: string; readonly order_public_id: string }
  | { readonly kind: "ignored"; readonly reason: string }
  | { readonly kind: "ignored_foreign"; readonly reason: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireString(data: Record<string, unknown>, field: string): string {
  const v = data[field];
  if (typeof v !== "string" || v.length === 0) throw new Error(`missing or invalid ${field}`);
  return v;
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new Error(`missing or invalid ${field} (uuid)`);
  return value.toLowerCase();
}

function requireInteger(data: Record<string, unknown>, field: string, min: number | null): number {
  const v = data[field];
  if (typeof v !== "number" || !Number.isSafeInteger(v) || (min !== null && v < min)) {
    throw new Error(`missing or invalid ${field}`);
  }
  return v;
}

/**
 * Validates and classifies a delivery outbox event.
 * Throws on an invalid payload shape → the relay dead-letters it (poisoned).
 */
export function classifyDeliveryEvent(row: DeliveryOutboxRow): Classification {
  if (row.aggregate_type !== "store_order") {
    return {
      kind: "ignored_foreign",
      reason: `foreign aggregate: ${row.aggregate_type} (${row.event_type}); billing consumes store_order only`,
    };
  }

  const data = row.payload;
  if (data === null || typeof data !== "object") throw new Error("missing payload");

  switch (row.event_type) {
    case STORE_ORDER_CREATED: {
      const order_id = requireUuid(row.aggregate_id, "aggregate.id");
      const order_public_id = requireString(data, "public_id");
      const store_id = requireUuid(data["store_id"], "store_id");
      const store_slug = requireString(data, "store_slug");
      const totals = data["totals"];
      if (totals === null || typeof totals !== "object") throw new Error("missing or invalid totals");
      const t = totals as Record<string, unknown>;
      if (t["currency_code"] !== "SAR") throw new Error("missing or invalid totals.currency_code (SAR)");
      const items = requireInteger(t, "items_total_minor_units", 0);
      const fee = requireInteger(t, "delivery_fee_minor_units", 0);
      const total = requireInteger(t, "total_minor_units", 0);
      if (items + fee !== total) {
        throw new Error("inconsistent totals: items_total + delivery_fee != total");
      }
      return {
        kind: "snapshot",
        snapshot: {
          order_id,
          order_public_id,
          store_id,
          store_slug,
          currency_code: "SAR",
          items_total_minor_units: items,
          delivery_fee_minor_units: fee,
        },
      };
    }
    case STORE_ORDER_ITEM_SUBSTITUTED: {
      const order_id = requireUuid(row.aggregate_id, "aggregate.id");
      requireString(data, "public_id");
      const delta = requireInteger(data, "price_delta_minor_units", null);
      return { kind: "adjust", order_id, price_delta_minor_units: delta };
    }
    case STORE_ORDER_FULFILLMENT_STATE_CHANGED: {
      const order_id = requireUuid(row.aggregate_id, "aggregate.id");
      const order_public_id = requireString(data, "public_id");
      const to_state = requireString(data, "to_state");
      requireString(data, "from_state");
      if (!isSettlementTrigger(to_state)) {
        return {
          kind: "ignored",
          reason: `non-trigger fulfillment state: ${to_state} (only ${SETTLEMENT_TRIGGER_STATES.join(", ")} triggers settlement)`,
        };
      }
      return { kind: "settle", order_id, order_public_id };
    }
    default:
      return { kind: "ignored", reason: `non-billing store_order event: ${row.event_type}` };
  }
}
