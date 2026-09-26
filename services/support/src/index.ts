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

export {
  InMemorySupportTicketStore,
  InMemorySupportEventPublisher,
} from "./infrastructure/in-memory.js";

export {
  PostgresSupportTicketStore,
  PostgresSupportEventPublisher,
  createPostgresSupportAdapters,
} from "./infrastructure/drizzle/repository.js";

export {
  createSupportDb,
  type SupportDbConfig,
  type Db,
  type DbOrTx,
} from "./infrastructure/drizzle/db.js";

export {
  supportTickets,
  supportEvidence,
  supportOutbox,
  type SupportTicketRow,
  type SupportTicketInsert,
  type SupportEvidenceRow,
  type SupportEvidenceInsert,
  type SupportOutboxRow,
  type SupportOutboxInsert,
} from "./infrastructure/drizzle/schema.js";

export {
  ENFORCED_CONSTRAINTS,
  isEnforcedConstraint,
} from "./infrastructure/constraints.js";

export {
  applySupportSchema,
  readSchemaContract,
  SCHEMA_CONTRACT_PATH,
} from "./db/migrate.js";
