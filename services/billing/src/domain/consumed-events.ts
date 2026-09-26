/**
 * services/billing/src/domain/consumed-events.ts
 *
 * Consumer-side typed views of the order outbox events the billing relay
 * reads (ADR-050 §3 — fees are calculated from completed delivery events,
 * not from active orders). These describe the shape of what is consumed;
 * they are NOT a second source of truth for orders.
 *
 * Reliability guarantees (same contract as support/delivery/search relays):
 *  - Idempotency: a consumed `event_id` with a terminal status is never
 *    re-processed. Duplicate delivery is a no-op (skipped_stale).
 *  - Ordering: per-stream watermark (occurred_at, event_id) — an older
 *    redelivered event is `skipped_stale` and cannot regress.
 *  - Foreign events: non-`order.status_changed` events are `ignored_foreign`.
 *  - Non-trigger states: order transitions to non-terminal states are `ignored`.
 *  - Poison: invalid payloads, unknown versions → dead-lettered.
 *  - Checkpoint: (occurred_at, event_id) of the last terminally-consumed
 *    row. Billing-owned; the relay never writes `order_outbox`.
 *  - Version: only `event_version === "v1"` is consumed.
 *
 * Referenced: ADR-050 §3 · ADR-025 §2.3 (relay pattern) · ADR-026 §2.4
 */

/** A row read from `order_outbox` by the relay's event source. */
export interface OrderOutboxRow {
  readonly event_id: string;
  readonly event_type: string;
  readonly event_version: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly occurred_at: string;
  readonly trace_id: string | null;
  /** Flat scalars only — enforced by the order events contract. */
  readonly data: Record<string, unknown>;
}

/**
 * Terminal order states that trigger fee settlement.
 * ADR-050 §3: "fees are calculated from completed delivery events
 * (`order_completed`) not from active orders." Only `completed` triggers
 * fee settlement — cancelled/failed orders do not incur fees.
 */
export const SETTLEMENT_TRIGGER_STATES: readonly string[] = [
  "completed",
];

export function isSettlementTrigger(toStatus: string): boolean {
  return SETTLEMENT_TRIGGER_STATES.includes(toStatus);
}

/**
 * The checkpoint offset the relay owns (same decision as ADR-025 §2.3 GAP-3):
 * progress is (occurred_at, event_id) of the last terminally-consumed row.
 * The relay NEVER writes `order_outbox.published_at`.
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

/** Terminal/non-terminal status of a consumed order outbox event. */
export type ConsumedStatus =
  | "pending" // retryable failure — checkpoint does NOT advance
  | "settled" // a fee settlement was created for the completed order — terminal
  | "skipped_stale" // older than the checkpoint — terminal
  | "ignored" // non-trigger order state — terminal
  | "ignored_foreign" // not an order.status_changed event — terminal
  | "poisoned"; // dead-letter: bad payload/version — terminal

export function isTerminal(status: ConsumedStatus): boolean {
  return status !== "pending";
}

/* ── Payload views (validated by `validateData`, flat scalars only) ── */

export interface OrderStatusChangedData {
  readonly order_public_id: string;
  readonly store_public_id: string;
  readonly customer_public_id: string;
  readonly to_status: string;
  readonly from_status: string;
  readonly order_total_cents: number;
}

/** Classification result for a single outbox event. */
export type Classification =
  | { readonly kind: "settle"; readonly event: OrderStatusChangedData }
  | { readonly kind: "ignored"; readonly reason: string };

/**
 * Validates and classifies an order outbox event.
 * - `order.status_changed` with `to_status: "completed"` → settle
 * - `order.status_changed` with other `to_status` → ignored (non-trigger)
 * - Any other event type → ignored_foreign
 *
 * Throws on invalid payload shape (missing required fields, wrong types).
 */
export function classifyOrderEvent(row: OrderOutboxRow): Classification {
  if (row.event_type !== "order.status_changed") {
    return {
      kind: "ignored",
      reason: `foreign event type: ${row.event_type} (expected order.status_changed)`,
    };
  }

  const data = row.data;

  const order_public_id = data["order_public_id"];
  if (typeof order_public_id !== "string" || !order_public_id) {
    throw new Error("missing or invalid order_public_id");
  }

  const store_public_id = data["store_public_id"];
  if (typeof store_public_id !== "string" || !store_public_id) {
    throw new Error("missing or invalid store_public_id");
  }

  const customer_public_id = data["customer_public_id"];
  if (typeof customer_public_id !== "string" || !customer_public_id) {
    throw new Error("missing or invalid customer_public_id");
  }

  const to_status = data["to_status"];
  if (typeof to_status !== "string" || !to_status) {
    throw new Error("missing or invalid to_status");
  }

  const from_status = data["from_status"];
  if (typeof from_status !== "string" || !from_status) {
    throw new Error("missing or invalid from_status");
  }

  const order_total_cents = data["order_total_cents"];
  if (typeof order_total_cents !== "number" || !Number.isFinite(order_total_cents)) {
    throw new Error("missing or invalid order_total_cents");
  }

  const event: OrderStatusChangedData = {
    order_public_id,
    store_public_id,
    customer_public_id,
    to_status,
    from_status,
    order_total_cents,
  };

  if (!isSettlementTrigger(to_status)) {
    return {
      kind: "ignored",
      reason: `non-trigger order state: ${to_status} (only ${SETTLEMENT_TRIGGER_STATES.join(", ")} triggers settlement)`,
    };
  }

  return { kind: "settle", event };
}
