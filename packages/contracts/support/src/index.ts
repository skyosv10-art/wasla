/**
 * @wasla/contracts-support
 *
 * تبرير الحزمة (§7): تضع العقود الكنسية للدعم والتصعيد في سطح TypeScript واحد
 * كي لا ينسخ المستهلكون الحقيقة أو يبتكروا عقداً موازياً.
 *
 * These are Contract First artifacts (ADR-004), NOT a runtime implementation;
 * implementation lands in later MRs of Phase 16. ADR-049 binds this service to a
 * single shape: tickets have a 5-state lifecycle with no skipping (decision 2),
 * evidence is required before investigation (decision 4 — the dispute evidence
 * gate), escalation is 3-tier (decision 5), the service NEVER punishes (decision 1
 * — same boundary as ADR-014 §7), time moves by tick not by timer (sub-decision 3),
 * and no personal data or channel id ever enters a contract (decision 8).
 * Regenerate API types: pnpm --filter @wasla/contracts-support generate
 */

export const SUPPORT_SERVICE_PORT = 8095 as const;

export const SUPPORT_TICKET_STATES = [
  "open",
  "investigating",
  "escalated",
  "resolved",
  "closed",
] as const;

export const SUPPORT_TICKET_TYPES = [
  "order_issue",
  "behavior_complaint",
  "payment_dispute",
  "service_quality",
] as const;

export const SUPPORT_RESOLUTION_REASONS = [
  "refund_issued",
  "warning_sent",
  "no_action_needed",
  "escalated_to_admin",
] as const;

export const SUPPORT_EVIDENCE_TYPES = [
  "photo",
  "message",
  "order_log",
] as const;

export const SUPPORT_ESCALATION_LEVELS = [
  "support_agent",
  "support_supervisor",
  "admin",
] as const;

export const SUPPORT_EVENT_TYPES = [
  "support.ticket_opened",
  "support.ticket_escalated",
  "support.ticket_resolved",
] as const;

export const SUPPORT_FORBIDDEN_EVENT_TYPES = [
  "support.ticket_closed",
  "support.ticket_punished",
  "support.subject_suspended",
  "support.subject_blocked",
] as const;

export const SUPPORT_EVENT_FORBIDDEN_FIELDS = [
  "chat_id",
  "telegram",
  "whatsapp",
  "phone",
  "name",
  "coordinates",
  "free_text",
  "message_body",
] as const;

export const SUPPORT_ERROR_CODES = [
  "SUPPORT_VALIDATION_FAILED",
  "SUPPORT_TICKET_NOT_FOUND",
  "SUPPORT_EVIDENCE_REQUIRED",
  "SUPPORT_RESOLUTION_REASON_REQUIRED",
  "SUPPORT_INVALID_STATE_TRANSITION",
  "SUPPORT_TICKET_ALREADY_CLOSED",
  "SUPPORT_EVIDENCE_NOT_FOUND",
] as const;

export type SupportTicketState = (typeof SUPPORT_TICKET_STATES)[number];
export type SupportTicketType = (typeof SUPPORT_TICKET_TYPES)[number];
export type SupportResolutionReason = (typeof SUPPORT_RESOLUTION_REASONS)[number];
export type SupportEvidenceType = (typeof SUPPORT_EVIDENCE_TYPES)[number];
export type SupportEscalationLevel = (typeof SUPPORT_ESCALATION_LEVELS)[number];
export type SupportEventType = (typeof SUPPORT_EVENT_TYPES)[number];
export type SupportErrorCode = (typeof SUPPORT_ERROR_CODES)[number];

/** HTTP status mapping for error codes (ADR-049 §errors). */
export function httpStatusForSupportError(code: SupportErrorCode): number {
  switch (code) {
    case "SUPPORT_VALIDATION_FAILED":
    case "SUPPORT_RESOLUTION_REASON_REQUIRED":
      return 422;
    case "SUPPORT_TICKET_NOT_FOUND":
    case "SUPPORT_EVIDENCE_NOT_FOUND":
      return 404;
    case "SUPPORT_EVIDENCE_REQUIRED":
    case "SUPPORT_INVALID_STATE_TRANSITION":
    case "SUPPORT_TICKET_ALREADY_CLOSED":
      return 409;
    default:
      return 500;
  }
}
