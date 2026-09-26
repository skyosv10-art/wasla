/**
 * Consumer-side typed views of the order outbox events the support relay
 * reads (ADR-049 §6 — order.status_changed suggests a ticket on terminal
 * states). These describe the shape of what is consumed; they are NOT a
 * second source of truth for orders.
 *
 * Reliability guarantees (same contract as delivery/search relays):
 *  - Idempotency: a consumed `event_id` with a terminal status is never
 *    re-processed. Duplicate delivery is a no-op.
 *  - Ordering: per-stream watermark (occurred_at, event_id) — an older
 *    redelivered event is `skipped_stale` and cannot regress.
 *  - Foreign events: events whose type is not `order.status_changed` are
 *    terminally `ignored_foreign`.
 *  - Non-terminal states: order transitions to non-terminal states (e.g.
 *    `published`, `searching`, `assigned`) are terminally `ignored` — the
 *    relay only acts on terminal states.
 *  - Retry + failure: a retryable failure leaves the row `pending` (the
 *    checkpoint does NOT advance) so the next poll retries. After
 *    `maxAttempts` the row is `poisoned` and the checkpoint advances past
 *    it — a poison event never blocks the stream.
 *  - Poison: unknown event versions, invalid payloads (bad routing key or
 *    OrderPayloadError), and unmappable states are dead-lettered.
 *  - Checkpoint: (occurred_at, event_id) of the last terminally-consumed
 *    row. Support-owned; the relay never writes `order_outbox`.
 *  - Version compatibility: only `event_version === "v1"` is consumed.
 *  - Observability: every event emits a structured log line.
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
 * Terminal order states that trigger a support ticket suggestion.
 * ADR-049 §6: "at completion or cancellation" — expanded to include
 * `failed` and `payment_disputed` as they represent service failures.
 */
export const SUGGESTION_TRIGGER_STATES: readonly string[] = [
  "completed",
  "customer_cancelled",
  "driver_cancelled",
  "partner_cancelled",
  "failed",
  "payment_disputed",
];

export function isSuggestionTrigger(toStatus: string): boolean {
  return SUGGESTION_TRIGGER_STATES.includes(toStatus);
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
  | "suggested" // a support ticket was suggested for the terminal order — terminal
  | "skipped_stale" // older than the checkpoint — terminal
  | "ignored" // non-terminal order state — terminal
  | "ignored_foreign" // not an order.status_changed event — terminal
  | "poisoned"; // dead-letter: bad payload/version — terminal

export function isTerminal(status: ConsumedStatus): boolean {
  return status !== "pending";
}

/* ── Payload views (validated by `validateData`, flat scalars only) ── */

export interface OrderStatusChangedData {
  readonly order_public_id: string;
  readonly customer_public_id: string;
  readonly to_status: string;
  readonly from_status: string | null;
  readonly sequence: number;
  readonly actor_type: string;
  readonly is_terminal: boolean;
}

/** Discriminated union of the classification result. */
export type OrderEventClassification =
  | { readonly kind: "suggest"; event: OrderStatusChangedData }
  | { readonly kind: "ignored"; reason: string };

export class OrderPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderPayloadError";
  }
}

/* ── validators ── */

function reqString(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new OrderPayloadError(`payload.${key} must be a non-empty string`);
  }
  return v;
}

function reqWaslaPublicId(data: Record<string, unknown>, key: string): string {
  const v = reqString(data, key);
  if (!/^WS-[0-9]{10}$/.test(v)) {
    throw new OrderPayloadError(`payload.${key} must match ^WS-[0-9]{10}$`);
  }
  return v;
}

function reqOrderPublicId(data: Record<string, unknown>, key: string): string {
  const v = reqString(data, key);
  if (!/^ORD-[0-9]{10}$/.test(v)) {
    throw new OrderPayloadError(`payload.${key} must match ^ORD-[0-9]{10}$`);
  }
  return v;
}

function reqPositiveInt(data: Record<string, unknown>, key: string): number {
  const v = data[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    throw new OrderPayloadError(`payload.${key} must be a positive integer`);
  }
  return v;
}

function reqBoolean(data: Record<string, unknown>, key: string): boolean {
  const v = data[key];
  if (typeof v !== "boolean") {
    throw new OrderPayloadError(`payload.${key} must be a boolean`);
  }
  return v;
}

/**
 * Validate and extract the payload data from an order.status_changed event.
 * Throws OrderPayloadError on invalid payloads — the relay treats this as
 * poison (never as a silent skip).
 */
export function validateOrderStatusChangedData(
  data: Record<string, unknown>,
): OrderStatusChangedData {
  return {
    order_public_id: reqOrderPublicId(data, "order_public_id"),
    customer_public_id: reqWaslaPublicId(data, "customer_public_id"),
    to_status: reqString(data, "to_status"),
    from_status: data["from_status"] === null ? null : reqString(data, "from_status"),
    sequence: reqPositiveInt(data, "sequence"),
    actor_type: reqString(data, "actor_type"),
    is_terminal: reqBoolean(data, "is_terminal"),
  };
}

/**
 * Classify a raw outbox row. Payload shape is validated here: an invalid
 * payload throws OrderPayloadError, which the relay treats as poison —
 * never as a silent skip. Unknown event versions are not classified here;
 * the relay poisons them (version compatibility).
 *
 * Only `order.status_changed` events with a terminal `to_status` that is
 * in SUGGESTION_TRIGGER_STATES are classified as `suggest`. Non-terminal
 * states are `ignored` (the relay only acts on terminal states per ADR-049
 * §6: "at completion or cancellation").
 */
export function classifyOrderEvent(row: OrderOutboxRow): OrderEventClassification {
  if (row.event_type !== "order.status_changed") {
    return {
      kind: "ignored",
      reason: `foreign event type: ${row.event_type} — relay consumes order.status_changed only (ADR-049 §6)`,
    };
  }

  const event = validateOrderStatusChangedData(row.data);

  if (!isSuggestionTrigger(event.to_status)) {
    return {
      kind: "ignored",
      reason: `non-trigger terminal state: ${event.to_status} — relay suggests on ${SUGGESTION_TRIGGER_STATES.join(", ")} only (ADR-049 §6)`,
    };
  }

  return { kind: "suggest", event };
}
