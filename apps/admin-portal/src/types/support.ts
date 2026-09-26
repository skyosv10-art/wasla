/**
 * Support ticket types for admin portal.
 *
 * M5-16 review 7/N: Support admin screen — list, view, escalate, resolve, close.
 * Calls the support service via the admin API client.
 */

export type SupportTicketState = "open" | "investigating" | "escalated" | "resolved" | "closed";
export type SupportTicketType = "order_issue" | "behavior_complaint" | "payment_dispute" | "service_quality";
export type SupportEscalationLevel = "agent" | "supervisor" | "admin";
export type SupportResolutionReason = "resolved" | "unfounded" | "duplicate" | "wont_fix";

export interface SupportTicketResource {
  readonly ticket_id: string;
  readonly ticket_type: SupportTicketType;
  readonly state: SupportTicketState;
  readonly escalation_level: SupportEscalationLevel | null;
  readonly reporter_public_id: string;
  readonly subject_public_id: string | null;
  readonly order_public_id: string | null;
  readonly resolution_reason: SupportResolutionReason | null;
  readonly evidence_id: string | null;
  readonly opened_at: string;
  readonly investigating_at: string | null;
  readonly escalated_at: string | null;
  readonly resolved_at: string | null;
  readonly closed_at: string | null;
}

export interface TicketListResponse {
  readonly tickets: readonly SupportTicketResource[];
  readonly nextCursor: string | null;
}

export interface EscalateRequest {
  readonly level: SupportEscalationLevel;
}

export interface ResolveRequest {
  readonly resolution_reason: SupportResolutionReason;
  readonly evidence_id: string;
}
