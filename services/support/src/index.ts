/**
 * @wasla/support-service — Support & Escalation (Phase 16 · ADR-049).
 *
 * Public surface: domain model, errors, ports.
 * HTTP layer, PostgreSQL adapters, and relay consumer are deferred to
 * later reviews.
 *
 * Regenerate API types: pnpm --filter @wasla/contracts-support generate
 */

export type {
  SupportTicket,
  SupportTicketDraft,
  SupportEvidence,
  SupportEvidenceDraft,
  SupportResolutionDraft,
  SupportTicketState,
  SupportTicketType,
  SupportResolutionReason,
  SupportEvidenceType,
  SupportEscalationLevel,
} from "./domain/model.js";

export {
  SUPPORT_TICKET_STATES,
  SUPPORT_TICKET_TYPES,
  SUPPORT_RESOLUTION_REASONS,
  SUPPORT_EVIDENCE_TYPES,
  SUPPORT_ESCALATION_LEVELS,
  SUPPORT_TICKET_TRANSITIONS,
  canTransition,
} from "./domain/model.js";

export {
  SupportError,
  isSupportError,
  supportErrors,
  SUPPORT_ERROR_CODES,
  httpStatusForSupportError,
} from "./domain/errors.js";

export type {
  SupportErrorCode,
} from "./domain/errors.js";

export type {
  SupportTicketStore,
  SupportEscalationPort,
  SupportEventPublisher,
  SupportTickPort,
} from "./ports.js";
