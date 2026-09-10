/**
 * Consumer-side typed views of the marketplace inventory events the delivery
 * inventory relay reads (ADR-026 §2.3 — "inventory is read via the agreed
 * boundary, no writing to marketplace tables, delivery stores snapshots not
 * balances"). These describe the shape of what is consumed; they are NOT a
 * second source of truth for marketplace inventory.
 *
 * The marketplace_outbox table uses `outbox_id` as the event_id (UUID PK).
 * The payload column contains the data fields directly (NOT wrapped in an
 * envelope). The relay maps outbox_id → event_id and payload → data.
 *
 * Drift is guarded at test time: the classifier below is the ONLY path from
 * a raw outbox row to a projectable event. An invalid payload throws
 * MarketplacePayloadError — the relay treats this as poison, never a silent
 * skip.
 */

/** A row read from `marketplace_outbox` by the inventory relay's event source. */
export interface MarketplaceOutboxRow {
  readonly event_id: string;
  readonly event_type: MarketplaceInventoryEventType;
  readonly event_version: string;
  readonly aggregate_type: "store" | "product" | "inventory";
  readonly aggregate_id: string;
  readonly occurred_at: string;
  readonly trace_id: string | null;
  /** Flat scalars only — enforced by the marketplace events contract. */
  readonly data: Record<string, unknown>;
}

/** Every inventory event type declared by the marketplace contracts. */
export type MarketplaceInventoryEventType = "marketplace.inventory_adjusted";

export const MARKETPLACE_INVENTORY_EVENT_TYPES: readonly MarketplaceInventoryEventType[] = [
  "marketplace.inventory_adjusted",
];

/**
 * The checkpoint offset the inventory relay owns (same decision as ADR-025
 * §2.3 GAP-3 and the dispatch relay): progress is (occurred_at, event_id) of
 * the last terminally-consumed row. The relay NEVER writes
 * `marketplace_outbox.published_at`.
 */
export interface InventoryRelayCheckpoint {
  readonly last_occurred_at: string;
  readonly last_event_id: string;
}

export const ZERO_INVENTORY_CHECKPOINT: InventoryRelayCheckpoint = {
  last_occurred_at: new Date(0).toISOString(),
  last_event_id: "00000000-0000-0000-0000-000000000000",
};

/** Terminal/non-terminal status of a consumed marketplace inventory event. */
export type InventoryConsumedStatus =
  | "pending" // retryable failure — checkpoint does NOT advance
  | "applied" // observed into delivery_inventory_observations — terminal
  | "skipped_stale" // older adjustment_sequence than the current observation — terminal
  | "ignored" // classified as not affecting the inventory snapshot — terminal
  | "poisoned"; // dead-letter: bad payload/version — terminal

export function isInventoryTerminal(status: InventoryConsumedStatus): boolean {
  return status !== "pending";
}

/* ── Payload views (validated by the classifier, flat scalars only) ── */

export interface InventoryAdjustedData {
  readonly kind: "inventory_adjusted";
  readonly adjustment_id: string;
  readonly product_id: string;
  readonly store_id: string;
  readonly quantity_delta: number;
  readonly quantity_after: number;
  readonly reason_code: string;
  readonly adjustment_sequence: number;
  readonly actor_public_id: string;
  readonly occurred_for: string;
}

export type MarketplaceInventoryClassification =
  | { readonly kind: "projectable"; event: InventoryAdjustedData }
  | { readonly kind: "ignored"; reason: string };

export class MarketplacePayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketplacePayloadError";
  }
}

/* ── validators ── */

function reqString(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new MarketplacePayloadError(`payload.${key} must be a non-empty string`);
  }
  return v;
}

function reqUuid(data: Record<string, unknown>, key: string): string {
  const v = reqString(data, key);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new MarketplacePayloadError(`payload.${key} must be a UUID`);
  }
  return v;
}

function reqInteger(data: Record<string, unknown>, key: string): number {
  const v = data[key];
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new MarketplacePayloadError(`payload.${key} must be an integer`);
  }
  return v;
}

function reqIsoDate(data: Record<string, unknown>, key: string): string {
  const v = reqString(data, key);
  if (Number.isNaN(Date.parse(v))) {
    throw new MarketplacePayloadError(`payload.${key} must be an ISO date-time`);
  }
  return v;
}

function reqWaslaPublicId(data: Record<string, unknown>, key: string): string {
  const v = reqString(data, key);
  if (!/^WS-[0-9]{10}$/.test(v)) {
    throw new MarketplacePayloadError(`payload.${key} must match ^WS-[0-9]{10}$`);
  }
  return v;
}

/**
 * Classify a raw marketplace outbox row. Payload shape is validated here: an
 * invalid payload throws MarketplacePayloadError, which the relay treats as
 * poison — never as a silent skip. Unknown event types are classified as
 * ignored (the event source filters by event_type, but the classifier is
 * defensive). Unknown event VERSIONS are not classified here; the relay
 * poisons them (version compatibility).
 */
export function classifyMarketplaceInventoryEvent(
  row: MarketplaceOutboxRow,
): MarketplaceInventoryClassification {
  if (row.event_type !== "marketplace.inventory_adjusted") {
    return {
      kind: "ignored",
      reason: `not an inventory event: ${row.event_type}`,
    };
  }

  const quantity_delta = reqInteger(row.data, "quantity_delta");
  if (quantity_delta === 0) {
    throw new MarketplacePayloadError("payload.quantity_delta must be non-zero (schema: not const 0)");
  }

  const quantity_after = reqInteger(row.data, "quantity_after");
  if (quantity_after < 0) {
    throw new MarketplacePayloadError("payload.quantity_after must be >= 0 (schema: minimum 0)");
  }

  const adjustment_sequence = reqInteger(row.data, "adjustment_sequence");
  if (adjustment_sequence < 1) {
    throw new MarketplacePayloadError("payload.adjustment_sequence must be >= 1 (schema: minimum 1)");
  }

  return {
    kind: "projectable",
    event: {
      kind: "inventory_adjusted",
      adjustment_id: reqUuid(row.data, "adjustment_id"),
      product_id: reqUuid(row.data, "product_id"),
      store_id: reqUuid(row.data, "store_id"),
      quantity_delta,
      quantity_after,
      reason_code: reqString(row.data, "reason_code"),
      adjustment_sequence,
      actor_public_id: reqWaslaPublicId(row.data, "actor_public_id"),
      occurred_for: reqIsoDate(row.data, "occurred_for"),
    },
  };
}
