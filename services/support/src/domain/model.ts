/**
 * Support & Escalation Domain Model (Phase 16 · ADR-049).
 *
 * Types are derived from the frozen arrays in @wasla/contracts-support
 * using `typeof` — no second hand-written list (ADR-014 domain model pattern).
 */

import {
  SUPPORT_TICKET_STATES,
  SUPPORT_TICKET_TYPES,
  SUPPORT_RESOLUTION_REASONS,
  SUPPORT_EVIDENCE_TYPES,
  SUPPORT_ESCALATION_LEVELS,
} from "@wasla/contracts-support";

export {
  SUPPORT_TICKET_STATES,
  SUPPORT_TICKET_TYPES,
  SUPPORT_RESOLUTION_REASONS,
  SUPPORT_EVIDENCE_TYPES,
  SUPPORT_ESCALATION_LEVELS,
  SUPPORT_SERVICE_PORT,
} from "@wasla/contracts-support";

export type SupportTicketState = (typeof SUPPORT_TICKET_STATES)[number];
export type SupportTicketType = (typeof SUPPORT_TICKET_TYPES)[number];
export type SupportResolutionReason = (typeof SUPPORT_RESOLUTION_REASONS)[number];
export type SupportEvidenceType = (typeof SUPPORT_EVIDENCE_TYPES)[number];
export type SupportEscalationLevel = (typeof SUPPORT_ESCALATION_LEVELS)[number];

/** Valid state transitions — no skipping (ADR-049 §2). */
export const SUPPORT_TICKET_TRANSITIONS: Readonly<Record<SupportTicketState, readonly SupportTicketState[]>> = {
  open: ["investigating"],
  investigating: ["escalated", "resolved"],
  escalated: ["resolved"],
  resolved: ["closed"],
  closed: [],
};

/** Check if a state transition is valid. */
export function canTransition(from: SupportTicketState, to: SupportTicketState): boolean {
  const allowed = SUPPORT_TICKET_TRANSITIONS[from];
  return allowed.includes(to);
}

/** Evidence metadata — stored as reference, not binary blob (ADR-049 §4). */
export interface SupportEvidence {
  readonly evidence_id: string;
  readonly ticket_id: string;
  readonly evidence_type: SupportEvidenceType;
  readonly content_hash: string;  // sha256
  readonly storage_ref: string;   // external storage reference
  readonly attached_at: string;   // ISO timestamp
}

/** Support ticket — the aggregate root. */
export interface SupportTicket {
  readonly ticket_id: string;
  readonly ticket_type: SupportTicketType;
  readonly state: SupportTicketState;
  readonly escalation_level: SupportEscalationLevel | null;
  readonly reporter_public_id: string;  // WS-##########
  readonly subject_public_id: string | null;  // WS-########## or null
  readonly order_public_id: string | null;  // ORD-########## or null
  readonly resolution_reason: SupportResolutionReason | null;
  readonly evidence_id: string | null;  // FK to support_evidence (same service)
  readonly opened_at: string;
  readonly investigating_at: string | null;
  readonly escalated_at: string | null;
  readonly resolved_at: string | null;
  readonly closed_at: string | null;
}

/** Draft for creating a new ticket. */
export interface SupportTicketDraft {
  readonly ticket_type: SupportTicketType;
  readonly reporter_public_id: string;
  readonly subject_public_id: string | null;
  readonly order_public_id: string | null;
}

/** Draft for attaching evidence. */
export interface SupportEvidenceDraft {
  readonly ticket_id: string;
  readonly evidence_type: SupportEvidenceType;
  readonly content_hash: string;
  readonly storage_ref: string;
}

/** Resolution request — requires reason and evidence (ADR-049 §4). */
export interface SupportResolutionDraft {
  readonly ticket_id: string;
  readonly resolution_reason: SupportResolutionReason;
  readonly evidence_id: string;  // evidence gate — must exist
}
