/**
 * Dispatch Domain Event types — hand-derived from
 * services/dispatch/contracts/events.json (JSON Schema 2020-12).
 *
 * Drift guards read the canonical schema at test time. ADR-011 makes time an
 * explicit tick and stored deadlines, never a hidden in-process timer.
 */
export type DispatchAggregateType = "dispatch_job" | "dispatch_offer";
export type DispatchEventReasonCode = string;

export interface DispatchEventEnvelope {
  event_id: string;
  event_type: string;
  event_version: string;
  occurred_at: string;
  producer: "dispatch-service";
  aggregate: { type: DispatchAggregateType; id: string };
  trace_id?: string | null;
}

export interface DispatchJobCreatedV1 extends DispatchEventEnvelope {
  event_type: "dispatch.job_created"; event_version: "v1";
  data: { job_id: string; order_id: string; order_public_id: string; zone_id: string; ruleset_version: number; status: "pending"; expires_at: string; escalation_expires_at: string };
}
export interface DispatchWaveOpenedV1 extends DispatchEventEnvelope {
  event_type: "dispatch.wave_opened"; event_version: "v1";
  data: { job_id: string; wave_id: string; wave_number: number; offer_count: number; expires_at: string };
}
export interface DispatchOfferSentV1 extends DispatchEventEnvelope {
  event_type: "dispatch.offer_sent"; event_version: "v1";
  data: { job_id: string; offer_id: string; wave_id: string; driver_public_id: string; expires_at: string };
}
export interface DispatchOfferAcceptedV1 extends DispatchEventEnvelope {
  event_type: "dispatch.offer_accepted"; event_version: "v1";
  data: { job_id: string; offer_id: string; driver_public_id: string; reason_code: "OFFER_ACCEPTED"; accepted_at: string };
}
export interface DispatchOfferRejectedV1 extends DispatchEventEnvelope {
  event_type: "dispatch.offer_rejected"; event_version: "v1";
  data: { job_id: string; offer_id: string; driver_public_id: string; reason_code: DispatchEventReasonCode; rejected_at: string };
}
export interface DispatchOfferTimedOutV1 extends DispatchEventEnvelope {
  event_type: "dispatch.offer_timed_out"; event_version: "v1";
  data: { job_id: string; offer_id: string; driver_public_id: string; reason_code: "OFFER_TIMED_OUT"; timed_out_at: string };
}
export interface DispatchEscalatedV1 extends DispatchEventEnvelope {
  event_type: "dispatch.escalated"; event_version: "v1";
  data: { job_id: string; order_public_id: string; zone_id: string; reason_code: "ALL_WAVES_EXHAUSTED"; escalation_expires_at: string };
}
export interface DispatchJobExhaustedV1 extends DispatchEventEnvelope {
  event_type: "dispatch.job_exhausted"; event_version: "v1";
  data: { job_id: string; order_public_id: string; reason_code: "NO_DRIVER_AVAILABLE"; exhausted_at: string };
}
export interface DispatchJobCancelledV1 extends DispatchEventEnvelope {
  event_type: "dispatch.job_cancelled"; event_version: "v1";
  data: { job_id: string; order_public_id: string; reason_code: DispatchEventReasonCode; cancelled_at: string };
}

export type DispatchDomainEvent =
  | DispatchJobCreatedV1 | DispatchWaveOpenedV1 | DispatchOfferSentV1
  | DispatchOfferAcceptedV1 | DispatchOfferRejectedV1 | DispatchOfferTimedOutV1
  | DispatchEscalatedV1 | DispatchJobExhaustedV1 | DispatchJobCancelledV1;

export const DISPATCH_EVENT_TYPES = {
  DISPATCH_JOB_CREATED: "dispatch.job_created",
  DISPATCH_WAVE_OPENED: "dispatch.wave_opened",
  DISPATCH_OFFER_SENT: "dispatch.offer_sent",
  DISPATCH_OFFER_ACCEPTED: "dispatch.offer_accepted",
  DISPATCH_OFFER_REJECTED: "dispatch.offer_rejected",
  DISPATCH_OFFER_TIMED_OUT: "dispatch.offer_timed_out",
  DISPATCH_ESCALATED: "dispatch.escalated",
  DISPATCH_JOB_EXHAUSTED: "dispatch.job_exhausted",
  DISPATCH_JOB_CANCELLED: "dispatch.job_cancelled",
} as const;

export type DispatchEventType = (typeof DISPATCH_EVENT_TYPES)[keyof typeof DISPATCH_EVENT_TYPES];
