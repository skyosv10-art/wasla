/**
 * The nine dispatch events, built here and nowhere else.
 *
 * Factories rather than object literals at the call sites, for two reasons. The
 * envelope must be identical across all nine — a consumer that has to special-case
 * one producer field will eventually special-case a payload field too. And the
 * privacy boundary is a *contract*, not a habit: `events.json` and ADR-011 decision
 * 8 forbid coordinates, channel ids, driver names, candidate lists and match
 * scores in any dispatch event. Concentrating construction in one file makes that
 * boundary reviewable in one place, and the payload types below make a stray field
 * a compile error rather than a leak discovered in a consumer's logs.
 *
 * The zone id is deliberately present: it is the coarsest useful location, and it
 * is what a community channel needs in order to be the right channel.
 */
import type { DispatchReasonCode } from "./model.js";

export const DISPATCH_EVENT_PRODUCER = "dispatch-service" as const;
export const DISPATCH_EVENT_VERSION = "v1" as const;

export type DispatchAggregateType = "dispatch_job" | "dispatch_offer";

export interface DispatchEventEnvelope {
  readonly event_id: string;
  readonly event_type: string;
  readonly event_version: typeof DISPATCH_EVENT_VERSION;
  readonly occurred_at: string;
  readonly producer: typeof DISPATCH_EVENT_PRODUCER;
  readonly aggregate: { readonly type: DispatchAggregateType; readonly id: string };
  readonly trace_id?: string | null;
}

export interface DispatchEvent<TType extends string, TData> extends DispatchEventEnvelope {
  readonly event_type: TType;
  readonly data: TData;
}

/** What every factory needs: an id for the event and the instant it happened. */
export interface EventMeta {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly traceId?: string | null;
}

function envelope(
  eventType: string,
  aggregateType: DispatchAggregateType,
  aggregateId: string,
  meta: EventMeta,
): DispatchEventEnvelope {
  return {
    event_id: meta.eventId,
    event_type: eventType,
    event_version: DISPATCH_EVENT_VERSION,
    occurred_at: meta.occurredAt,
    producer: DISPATCH_EVENT_PRODUCER,
    aggregate: { type: aggregateType, id: aggregateId },
    trace_id: meta.traceId ?? null,
  };
}

export type DispatchJobCreatedEvent = DispatchEvent<
  "dispatch.job_created",
  {
    readonly job_id: string;
    readonly order_id: string;
    readonly order_public_id: string;
    readonly zone_id: string;
    readonly ruleset_version: number;
    readonly status: "pending";
    readonly expires_at: string;
    readonly escalation_expires_at: string;
  }
>;

export function jobCreatedEvent(
  data: DispatchJobCreatedEvent["data"],
  meta: EventMeta,
): DispatchJobCreatedEvent {
  return {
    ...envelope("dispatch.job_created", "dispatch_job", data.job_id, meta),
    event_type: "dispatch.job_created",
    data,
  };
}

export type DispatchWaveOpenedEvent = DispatchEvent<
  "dispatch.wave_opened",
  {
    readonly job_id: string;
    readonly wave_id: string;
    readonly wave_number: number;
    /** A count, never the candidate list: batch size is operational, identities are not. */
    readonly offer_count: number;
    readonly expires_at: string;
  }
>;

export function waveOpenedEvent(
  data: DispatchWaveOpenedEvent["data"],
  meta: EventMeta,
): DispatchWaveOpenedEvent {
  return {
    ...envelope("dispatch.wave_opened", "dispatch_job", data.job_id, meta),
    event_type: "dispatch.wave_opened",
    data,
  };
}

export type DispatchOfferSentEvent = DispatchEvent<
  "dispatch.offer_sent",
  {
    readonly job_id: string;
    readonly offer_id: string;
    readonly wave_id: string;
    readonly driver_public_id: string;
    readonly expires_at: string;
  }
>;

export function offerSentEvent(
  data: DispatchOfferSentEvent["data"],
  meta: EventMeta,
): DispatchOfferSentEvent {
  return {
    ...envelope("dispatch.offer_sent", "dispatch_offer", data.offer_id, meta),
    event_type: "dispatch.offer_sent",
    data,
  };
}

export type DispatchOfferAcceptedEvent = DispatchEvent<
  "dispatch.offer_accepted",
  {
    readonly job_id: string;
    readonly offer_id: string;
    readonly driver_public_id: string;
    readonly reason_code: "OFFER_ACCEPTED";
    readonly accepted_at: string;
  }
>;

export function offerAcceptedEvent(
  data: DispatchOfferAcceptedEvent["data"],
  meta: EventMeta,
): DispatchOfferAcceptedEvent {
  return {
    ...envelope("dispatch.offer_accepted", "dispatch_offer", data.offer_id, meta),
    event_type: "dispatch.offer_accepted",
    data,
  };
}

export type DispatchOfferRejectedEvent = DispatchEvent<
  "dispatch.offer_rejected",
  {
    readonly job_id: string;
    readonly offer_id: string;
    readonly driver_public_id: string;
    readonly reason_code: DispatchReasonCode;
    readonly rejected_at: string;
  }
>;

export function offerRejectedEvent(
  data: DispatchOfferRejectedEvent["data"],
  meta: EventMeta,
): DispatchOfferRejectedEvent {
  return {
    ...envelope("dispatch.offer_rejected", "dispatch_offer", data.offer_id, meta),
    event_type: "dispatch.offer_rejected",
    data,
  };
}

export type DispatchOfferTimedOutEvent = DispatchEvent<
  "dispatch.offer_timed_out",
  {
    readonly job_id: string;
    readonly offer_id: string;
    readonly driver_public_id: string;
    readonly reason_code: "OFFER_TIMED_OUT";
    readonly timed_out_at: string;
  }
>;

export function offerTimedOutEvent(
  data: DispatchOfferTimedOutEvent["data"],
  meta: EventMeta,
): DispatchOfferTimedOutEvent {
  return {
    ...envelope("dispatch.offer_timed_out", "dispatch_offer", data.offer_id, meta),
    event_type: "dispatch.offer_timed_out",
    data,
  };
}

export type DispatchEscalatedEvent = DispatchEvent<
  "dispatch.escalated",
  {
    readonly job_id: string;
    readonly order_public_id: string;
    readonly zone_id: string;
    readonly reason_code: "ALL_WAVES_EXHAUSTED";
    readonly escalation_expires_at: string;
  }
>;

export function escalatedEvent(
  data: DispatchEscalatedEvent["data"],
  meta: EventMeta,
): DispatchEscalatedEvent {
  return {
    ...envelope("dispatch.escalated", "dispatch_job", data.job_id, meta),
    event_type: "dispatch.escalated",
    data,
  };
}

export type DispatchJobExhaustedEvent = DispatchEvent<
  "dispatch.job_exhausted",
  {
    readonly job_id: string;
    readonly order_public_id: string;
    readonly reason_code: "NO_DRIVER_AVAILABLE";
    readonly exhausted_at: string;
  }
>;

export function jobExhaustedEvent(
  data: DispatchJobExhaustedEvent["data"],
  meta: EventMeta,
): DispatchJobExhaustedEvent {
  return {
    ...envelope("dispatch.job_exhausted", "dispatch_job", data.job_id, meta),
    event_type: "dispatch.job_exhausted",
    data,
  };
}

export type DispatchJobCancelledEvent = DispatchEvent<
  "dispatch.job_cancelled",
  {
    readonly job_id: string;
    readonly order_public_id: string;
    readonly reason_code: DispatchReasonCode;
    readonly cancelled_at: string;
  }
>;

export function jobCancelledEvent(
  data: DispatchJobCancelledEvent["data"],
  meta: EventMeta,
): DispatchJobCancelledEvent {
  return {
    ...envelope("dispatch.job_cancelled", "dispatch_job", data.job_id, meta),
    event_type: "dispatch.job_cancelled",
    data,
  };
}

/** Any dispatch event. The outbox stores this union and nothing else. */
export type AnyDispatchEvent =
  | DispatchJobCreatedEvent
  | DispatchWaveOpenedEvent
  | DispatchOfferSentEvent
  | DispatchOfferAcceptedEvent
  | DispatchOfferRejectedEvent
  | DispatchOfferTimedOutEvent
  | DispatchEscalatedEvent
  | DispatchJobExhaustedEvent
  | DispatchJobCancelledEvent;

/**
 * Field names that must never appear in a dispatch event payload.
 *
 * Enforced by a test that walks every event this service can build. A denylist is
 * weaker than a type, and the types above are the real guard — this exists because
 * the next person to add an event will copy an existing factory, and a failing test
 * naming the forbidden field teaches the rule faster than a review comment.
 */
export const FORBIDDEN_EVENT_FIELDS: readonly string[] = [
  "lat",
  "lng",
  "latitude",
  "longitude",
  "coordinates",
  "point",
  "chat_id",
  "channel_id",
  "message_id",
  "driver_name",
  "phone",
  "score",
  "total_score",
  "candidates",
  "candidate_ids",
];
