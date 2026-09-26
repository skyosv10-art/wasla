/**
 * Support & Escalation Domain Events v1 — types derived from the frozen arrays.
 *
 * ADR-049 decision 8: no PII in events. The event carries ticket type,
 * resolution reason, and evidence reference — never free text or channel ids.
 */

import {
  SUPPORT_EVENT_TYPES,
  SUPPORT_EVENT_FORBIDDEN_FIELDS,
  SUPPORT_FORBIDDEN_EVENT_TYPES,
} from "./index.js";

export { SUPPORT_EVENT_TYPES, SUPPORT_EVENT_FORBIDDEN_FIELDS, SUPPORT_FORBIDDEN_EVENT_TYPES };

/** Event envelope — unified for all support events (ADR-049 §6). */
export interface SupportEventEnvelope {
  readonly event_id: string;
  readonly event_type: SupportEventType;
  readonly event_version: string;
  readonly occurred_at: string;
  readonly producer: "support-service";
  readonly aggregate: {
    readonly type: "support_ticket";
    readonly id: string;
  };
  readonly trace_id: string | null;
}

/** Payload for support.ticket_opened. */
export interface TicketOpenedPayload {
  readonly ticket_id: string;
  readonly ticket_type: SupportTicketType;
  readonly reporter_public_id: string;
  readonly subject_public_id: string | null;
  readonly order_public_id: string | null;
  readonly opened_at: string;
}

/** Payload for support.ticket_escalated. */
export interface TicketEscalatedPayload {
  readonly ticket_id: string;
  readonly escalation_level: SupportEscalationLevel;
  readonly escalated_at: string;
}

/** Payload for support.ticket_resolved. */
export interface TicketResolvedPayload {
  readonly ticket_id: string;
  readonly resolution_reason: SupportResolutionReason;
  readonly evidence_id: string;
  readonly resolved_at: string;
}

import type { SupportEventType, SupportTicketType, SupportEscalationLevel, SupportResolutionReason } from "./index.js";
