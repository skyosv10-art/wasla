/**
 * Support & Escalation — Ports (Phase 16 · ADR-049).
 *
 * Pure interfaces — no implementation. Adapters land in later reviews
 * (PostgreSQL, HTTP, relay consumer).
 */

import type {
  SupportTicket,
  SupportTicketDraft,
  SupportEvidence,
  SupportEvidenceDraft,
  SupportResolutionDraft,
  SupportEscalationLevel,
} from "./domain/model.js";

/** Write port — persists tickets and evidence. */
export interface SupportTicketStore {
  createTicket(draft: SupportTicketDraft): Promise<SupportTicket>;
  getTicket(ticketId: string): Promise<SupportTicket | null>;
  updateState(
    ticketId: string,
    state: SupportTicket["state"],
    patch: Partial<SupportTicket>,
  ): Promise<SupportTicket>;
  attachEvidence(draft: SupportEvidenceDraft): Promise<SupportEvidence>;
  getEvidence(evidenceId: string): Promise<SupportEvidence | null>;
  resolve(draft: SupportResolutionDraft): Promise<SupportTicket>;
}

/** Escalation port — assigns escalation level. */
export interface SupportEscalationPort {
  escalate(ticketId: string, level: SupportEscalationLevel): Promise<SupportTicket>;
}

/** Event publisher port — publishes domain events to outbox. */
export interface SupportEventPublisher {
  publishTicketOpened(ticketId: string, ticketType: SupportTicket["ticket_type"], reporterPublicId: string): Promise<void>;
  publishTicketEscalated(ticketId: string, level: SupportEscalationLevel): Promise<void>;
  publishTicketResolved(ticketId: string, reason: SupportTicket["resolution_reason"], evidenceId: string): Promise<void>;
}

/** Tick port — time moves by tick not by timer (ADR-049 sub-decision 3). */
export interface SupportTickPort {
  processExpiredTickets(): Promise<{ processed: number }>;
}
