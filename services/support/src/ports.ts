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
import type {
  OrderOutboxRow,
  RelayCheckpoint,
} from "./domain/consumed-events.js";

/** Write port — persists tickets and evidence. */
export interface SupportTicketStore {
  createTicket(draft: SupportTicketDraft): Promise<SupportTicket>;
  getTicket(ticketId: string): Promise<SupportTicket | null>;
  listTickets(opts?: {
    readonly state?: SupportTicket["state"];
    readonly limit?: number;
    readonly cursor?: string | null;
  }): Promise<{ readonly tickets: readonly SupportTicket[]; readonly nextCursor: string | null }>;
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

/* ── Relay consumer ports (ADR-049 §6 — order.status_changed) ── */

/**
 * Reads `order_outbox` rows strictly after a checkpoint (or from zero).
 * Read-only: the relay NEVER writes to `order_outbox` (no `published_at`)
 * — progress is support-owned.
 */
export interface OrderEventSource {
  readAfter(checkpoint: RelayCheckpoint | null, limit: number): Promise<readonly OrderOutboxRow[]>;
}

/**
 * Stores the relay's checkpoint — (occurred_at, event_id) of the last
 * terminally-consumed row. Support-owned; one row per consumer.
 */
export interface RelayCheckpointStore {
  getCheckpoint(consumerId: string): Promise<RelayCheckpoint | null>;
  writeCheckpoint(consumerId: string, checkpoint: RelayCheckpoint): Promise<void>;
}

/**
 * Dead-letter store for poisoned events (invalid payload, unknown version,
 * unmappable outcome). A poison event never blocks the stream.
 */
export interface RelayDeadLetterStore {
  writeDeadLetter(
    consumerId: string,
    event: OrderOutboxRow,
    reason: string,
    attempts: number,
  ): Promise<void>;
}

/**
 * Consumer lock — prevents concurrent relay batches for the same consumer.
 * The lock is held for the duration of `fn` and released always.
 */
export interface RelayConsumerLock {
  withConsumerLock<T>(consumerId: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * Relay dependencies — all ports the relay needs to function.
 * The relay is a pure orchestrator: it reads events, classifies them,
 * suggests tickets, and writes the checkpoint. All I/O is through ports.
 */
export interface RelayDeps {
  readonly events: OrderEventSource;
  readonly tickets: SupportTicketStore;
  readonly checkpoint: RelayCheckpointStore;
  readonly deadLetter: RelayDeadLetterStore;
  readonly lock: RelayConsumerLock;
  readonly publisher: SupportEventPublisher;
}

/* ── Reputation bridge port (ADR-049 §7 — dispute_resolved fact) ── */

/**
 * Bridge to the reputation service: records a `dispute_resolved` fact
 * when a support ticket is resolved. The fact contains the subject_public_id
 * (the party whose reputation is affected), the order_public_id (context),
 * and the source event reference (ticket_id).
 *
 * This port is called from the HTTP resolve handler after the ticket is
 * resolved and the ticket_resolved event is published. It is a best-effort
 * call: if the reputation service is unavailable, the ticket is still
 * resolved (the fact can be backfilled later).
 */
export interface ReputationBridgePort {
  recordDisputeResolved(params: {
    readonly ticketId: string;
    readonly subjectPublicId: string;
    readonly orderPublicId: string | null;
    readonly resolutionReason: string;
  }): Promise<void>;
}
