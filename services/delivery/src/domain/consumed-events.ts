/**
 * Consumer-side typed views of the dispatch outbox events the delivery relay
 * reads (ADR-026 §2.4 — the coarse mirror). These describe the shape of what
 * is consumed; they are NOT a second source of truth for dispatch.
 *
 * Drift is guarded at test time: `event-coverage.test.ts` reads the canonical
 * dispatch `events.json` and proves every event type is explicitly classified
 * by `classifyDispatchEvent` below. A new dispatch event type the relay does
 * not classify fails the test — it is never silently dropped.
 *
 * Referential mismatch (review 2/N finding, declared): dispatch jobs are
 * keyed by an ORD-########## order_public_id owned by `services/orders`
 * (dispatch_jobs CHECK constraint). Store orders are WS-##########. So a
 * delivery task CANNOT be matched to a dispatch event by order id — the only
 * link is `delivery_tasks.dispatch_job_ref`, bound at delegation time by the
 * (deferred) delivery→dispatch wire. Ordering invariant that wire MUST hold:
 * bind the job ref BEFORE any projectable outcome can be emitted, or the
 * relay will terminally consume the outcome as `ignored_foreign`.
 */

/** A row read from `dispatch_outbox` by the relay's event source. */
export interface DispatchOutboxRow {
  readonly event_id: string;
  readonly event_type: DispatchEventType;
  readonly event_version: string;
  readonly aggregate_type: "dispatch_job" | "dispatch_offer";
  readonly aggregate_id: string;
  readonly occurred_at: string;
  readonly trace_id: string | null;
  /** Flat scalars only — enforced by the dispatch events contract. */
  readonly data: Record<string, unknown>;
}

/** Every event type declared by the dispatch contracts (drift-guarded). */
export type DispatchEventType =
  | "dispatch.job_created"
  | "dispatch.wave_opened"
  | "dispatch.offer_sent"
  | "dispatch.offer_timed_out"
  | "dispatch.offer_accepted"
  | "dispatch.offer_rejected"
  | "dispatch.escalated"
  | "dispatch.job_exhausted"
  | "dispatch.job_cancelled";

export const DISPATCH_EVENT_TYPES: readonly DispatchEventType[] = [
  "dispatch.job_created",
  "dispatch.wave_opened",
  "dispatch.offer_sent",
  "dispatch.offer_timed_out",
  "dispatch.offer_accepted",
  "dispatch.offer_rejected",
  "dispatch.escalated",
  "dispatch.job_exhausted",
  "dispatch.job_cancelled",
];

/**
 * The checkpoint offset the relay owns (same decision as ADR-025 §2.3 GAP-3):
 * progress is (occurred_at, event_id) of the last terminally-consumed row.
 * The relay NEVER writes `dispatch_outbox.published_at`.
 */
export interface RelayCheckpoint {
  readonly last_occurred_at: string;
  readonly last_event_id: string;
}

export const ZERO_CHECKPOINT: RelayCheckpoint = {
  last_occurred_at: new Date(0).toISOString(),
  last_event_id: "00000000-0000-0000-0000-000000000000",
};

/** Terminal/non-terminal status of a consumed dispatch outbox event. */
export type ConsumedStatus =
  | "pending" // retryable failure — checkpoint does NOT advance
  | "applied" // mirrored into a delivery task state change — terminal
  | "skipped_stale" // older than the task's dispatch watermark, or task terminal — terminal
  | "ignored" // classified as not affecting the coarse mirror — terminal
  | "ignored_foreign" // job not bound to any delivery task — terminal
  | "poisoned"; // dead-letter: bad payload/version, or unmappable outcome — terminal

export function isTerminal(status: ConsumedStatus): boolean {
  return status !== "pending";
}

/* ── Payload views (validated by `validateData`, flat scalars only) ── */

export interface JobCreatedData {
  readonly kind: "job_created";
  readonly job_id: string;
}
export interface WaveOpenedData {
  readonly kind: "wave_opened";
  readonly job_id: string;
  readonly wave_number: number;
}
export interface OfferAcceptedData {
  readonly kind: "offer_accepted";
  readonly job_id: string;
  readonly driver_public_id: string;
  readonly accepted_at: string;
}
export interface OfferTimedOutData {
  readonly kind: "offer_timed_out";
  readonly job_id: string;
  readonly driver_public_id: string;
  readonly timed_out_at: string;
}
export interface JobExhaustedData {
  readonly kind: "job_exhausted";
  readonly job_id: string;
  readonly exhausted_at: string;
}
export interface JobCancelledData {
  readonly kind: "job_cancelled";
  readonly job_id: string;
  readonly reason_code: string;
  readonly cancelled_at: string;
}

/**
 * Discriminated union of the events that can affect the coarse mirror.
 * `wave_opened` is projectable ONLY from `timed_out` (the reassignment
 * cycle, ADR-026 §3.3); the mirror decides per current task state.
 */
export type ProjectableDispatchEvent =
  | JobCreatedData
  | WaveOpenedData
  | OfferAcceptedData
  | OfferTimedOutData
  | JobExhaustedData
  | JobCancelledData;

export type DispatchEventClassification =
  | { readonly kind: "projectable"; event: ProjectableDispatchEvent }
  | { readonly kind: "ignored"; reason: string };

export class DispatchPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchPayloadError";
  }
}

/* ── validators ── */

function reqString(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new DispatchPayloadError(`payload.${key} must be a non-empty string`);
  }
  return v;
}

function reqWaslaPublicId(data: Record<string, unknown>, key: string): string {
  const v = reqString(data, key);
  if (!/^WS-[0-9]{10}$/.test(v)) {
    throw new DispatchPayloadError(`payload.${key} must match ^WS-[0-9]{10}$`);
  }
  return v;
}

function reqIsoDate(data: Record<string, unknown>, key: string): string {
  const v = reqString(data, key);
  if (Number.isNaN(Date.parse(v))) {
    throw new DispatchPayloadError(`payload.${key} must be an ISO date-time`);
  }
  return v;
}

function reqPositiveInt(data: Record<string, unknown>, key: string): number {
  const v = data[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    throw new DispatchPayloadError(`payload.${key} must be a positive integer`);
  }
  return v;
}

/**
 * Classify a raw outbox row. Payload shape is validated here: an invalid
 * payload throws DispatchPayloadError, which the relay treats as poison —
 * never as a silent skip. Unknown event VERSIONS are not classified here;
 * the relay poisons them (version compatibility).
 */
export function classifyDispatchEvent(row: DispatchOutboxRow): DispatchEventClassification {
  switch (row.event_type) {
    case "dispatch.job_created":
      return { kind: "projectable", event: { kind: "job_created", job_id: reqString(row.data, "job_id") } };
    case "dispatch.wave_opened":
      return {
        kind: "projectable",
        event: {
          kind: "wave_opened",
          job_id: reqString(row.data, "job_id"),
          wave_number: reqPositiveInt(row.data, "wave_number"),
        },
      };
    case "dispatch.offer_accepted":
      return {
        kind: "projectable",
        event: {
          kind: "offer_accepted",
          job_id: reqString(row.data, "job_id"),
          driver_public_id: reqWaslaPublicId(row.data, "driver_public_id"),
          accepted_at: reqIsoDate(row.data, "accepted_at"),
        },
      };
    case "dispatch.offer_timed_out":
      return {
        kind: "projectable",
        event: {
          kind: "offer_timed_out",
          job_id: reqString(row.data, "job_id"),
          driver_public_id: reqWaslaPublicId(row.data, "driver_public_id"),
          timed_out_at: reqIsoDate(row.data, "timed_out_at"),
        },
      };
    case "dispatch.job_exhausted":
      return {
        kind: "projectable",
        event: {
          kind: "job_exhausted",
          job_id: reqString(row.data, "job_id"),
          exhausted_at: reqIsoDate(row.data, "exhausted_at"),
        },
      };
    case "dispatch.job_cancelled":
      return {
        kind: "projectable",
        event: {
          kind: "job_cancelled",
          job_id: reqString(row.data, "job_id"),
          reason_code: reqString(row.data, "reason_code"),
          cancelled_at: reqIsoDate(row.data, "cancelled_at"),
        },
      };
    case "dispatch.offer_sent":
      return { kind: "ignored", reason: "a single sent offer is wave mechanics — the coarse mirror does not rebuild them (ADR-026 §2.4)" };
    case "dispatch.offer_rejected":
      return { kind: "ignored", reason: "rejection does not end the job; the pulse decides the next wave (ADR-026 §2.4)" };
    case "dispatch.escalated":
      return { kind: "ignored", reason: "escalation is dispatch-internal standing, not a coarse outcome (ADR-026 §2.4)" };
    default:
      // Exhaustiveness guard: a new dispatch event type that this switch does
      // not handle is a compile error here AND a test failure in
      // event-coverage.test.ts.
      return { kind: "ignored", reason: `unhandled event type: ${row.event_type satisfies never}` };
  }
}

/**
 * Which event kinds are "outcomes" — a bound result that MUST land somewhere.
 * If such an outcome has no legal transition from the current task state, the
 * relay poisons it (a wrong mirror must never advance quietly).
 */
export function isOutcomeKind(kind: ProjectableDispatchEvent["kind"]): boolean {
  return kind === "offer_accepted" || kind === "offer_timed_out" || kind === "job_exhausted" || kind === "job_cancelled";
}
