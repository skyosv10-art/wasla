/**
 * مُهيئاتُ الذاكرة — تفرض **كلَّ** قيدٍ مُسمّى في `schema.sql` بنفس الأسماء.
 *
 * الغرضُ ليس «مخزناً للاختبارات». الغرضُ أن تكون حزمةُ اختبارات المجال كلُّها قابلةً
 * للتشغيل على جهازٍ لا شيءَ مُثبّتٌ فيه، وأن يكون ما تُثبته صحيحاً على Postgres أيضاً —
 * ولذلك ترفض هذه المخازن ما ترفضه القاعدة، **باسم القيد** (انظر `constraints.ts`).
 *
 * ## ثلاثةُ أشياء لا تفعلها هذه المخازن
 *
 * **لا تسأل الساعة.** كلُّ لحظةٍ تدخل وسيطاً.
 * **لا تُصلح مدخلاً.** لا تشذيبَ نصٍّ ولا تعويضَ حقلٍ غائبٍ بقيمةٍ افتراضية.
 * **لا تُرتّب عشوائياً.** كلُّ قراءةٍ تُعيد ترتيباً حتميّاً مُصرَّحاً به.
 */

import { supportErrors } from "../domain/errors.js";
import type {
  SupportTicket,
  SupportTicketDraft,
  SupportEvidence,
  SupportEvidenceDraft,
  SupportResolutionDraft,
  SupportEscalationLevel,
} from "../domain/model.js";
import { canTransition } from "../domain/model.js";
import type { SupportTicketStore, SupportEventPublisher } from "../ports.js";

// ---------------------------------------------------------------------------
// مستودعُ التذاكر في الذاكرة
// ---------------------------------------------------------------------------

export class InMemorySupportTicketStore implements SupportTicketStore {
  private readonly tickets = new Map<string, SupportTicket>();
  private readonly evidence = new Map<string, SupportEvidence>();
  private readonly events: Array<{
    event_type: string;
    aggregate_id: string;
    payload: Record<string, unknown>;
  }> = [];
  private readonly clock: () => Date;

  constructor(clock?: () => Date) {
    this.clock = clock ?? (() => new Date());
  }

  async createTicket(draft: SupportTicketDraft): Promise<SupportTicket> {
    const now = this.clock().toISOString();
    const ticket: SupportTicket = {
      ticket_id: crypto.randomUUID(),
      ticket_type: draft.ticket_type,
      state: "open",
      escalation_level: null,
      reporter_public_id: draft.reporter_public_id,
      subject_public_id: draft.subject_public_id ?? null,
      order_public_id: draft.order_public_id ?? null,
      resolution_reason: null,
      evidence_id: null,
      opened_at: now,
      investigating_at: null,
      escalated_at: null,
      resolved_at: null,
      closed_at: null,
    };

    this.tickets.set(ticket.ticket_id, ticket);

    this.events.push({
      event_type: "support.ticket_opened",
      aggregate_id: ticket.ticket_id,
      payload: {
        ticket_id: ticket.ticket_id,
        ticket_type: ticket.ticket_type,
        reporter_public_id: ticket.reporter_public_id,
      },
    });

    return { ...ticket };
  }

  async getTicket(ticketId: string): Promise<SupportTicket | null> {
    const ticket = this.tickets.get(ticketId);
    return ticket ? { ...ticket } : null;
  }

  async updateState(
    ticketId: string,
    state: SupportTicket["state"],
    patch: Partial<SupportTicket>,
  ): Promise<SupportTicket> {
    const existing = this.tickets.get(ticketId);
    if (!existing) {
      throw supportErrors.ticketNotFound(ticketId);
    }

    if (!canTransition(existing.state, state)) {
      throw supportErrors.invalidTransition(existing.state, state);
    }

    // Evidence gate: cannot enter investigating without evidence
    if (state !== "open" && !existing.evidence_id && !patch.evidence_id) {
      throw supportErrors.evidenceRequired(ticketId);
    }

    const now = this.clock().toISOString();
    const updated: SupportTicket = {
      ...existing,
      state,
      escalation_level: patch.escalation_level ?? existing.escalation_level,
      evidence_id: patch.evidence_id ?? existing.evidence_id,
      resolution_reason: patch.resolution_reason ?? existing.resolution_reason,
      investigating_at: state === "investigating" ? now : existing.investigating_at,
      escalated_at: state === "escalated" ? now : existing.escalated_at,
      resolved_at: state === "resolved" ? now : existing.resolved_at,
      closed_at: state === "closed" ? now : existing.closed_at,
    };

    this.tickets.set(ticketId, updated);
    return { ...updated };
  }

  async attachEvidence(draft: SupportEvidenceDraft): Promise<SupportEvidence> {
    const ticket = this.tickets.get(draft.ticket_id);
    if (!ticket) {
      throw supportErrors.ticketNotFound(draft.ticket_id);
    }

    const evidence: SupportEvidence = {
      evidence_id: crypto.randomUUID(),
      ticket_id: draft.ticket_id,
      evidence_type: draft.evidence_type,
      content_hash: draft.content_hash,
      storage_ref: draft.storage_ref,
      attached_at: this.clock().toISOString(),
    };

    this.evidence.set(evidence.evidence_id, evidence);

    // Link evidence to ticket
    const updated: SupportTicket = {
      ...ticket,
      evidence_id: evidence.evidence_id,
    };
    this.tickets.set(ticket.ticket_id, updated);

    return { ...evidence };
  }

  async getEvidence(evidenceId: string): Promise<SupportEvidence | null> {
    const evidence = this.evidence.get(evidenceId);
    return evidence ? { ...evidence } : null;
  }

  async resolve(draft: SupportResolutionDraft): Promise<SupportTicket> {
    const existing = this.tickets.get(draft.ticket_id);
    if (!existing) {
      throw supportErrors.ticketNotFound(draft.ticket_id);
    }

    // Evidence gate: cannot resolve without evidence
    if (!existing.evidence_id && !draft.evidence_id) {
      throw supportErrors.evidenceRequired(draft.ticket_id);
    }

    if (!canTransition(existing.state, "resolved")) {
      throw supportErrors.invalidTransition(existing.state, "resolved");
    }

    const now = this.clock().toISOString();
    const updated: SupportTicket = {
      ...existing,
      state: "resolved",
      resolution_reason: draft.resolution_reason,
      resolved_at: now,
    };

    this.tickets.set(draft.ticket_id, updated);

    this.events.push({
      event_type: "support.ticket_resolved",
      aggregate_id: draft.ticket_id,
      payload: {
        ticket_id: draft.ticket_id,
        resolution_reason: draft.resolution_reason,
        evidence_id: draft.evidence_id ?? existing.evidence_id,
      },
    });

    return { ...updated };
  }

  // -----------------------------------------------------------------------
  // أدواتُ الاختبار
  // -----------------------------------------------------------------------

  /** كلُّ الأحداثِ المُسجَّلة — للتحقّق من النشر. */
  getEvents(): ReadonlyArray<{
    event_type: string;
    aggregate_id: string;
    payload: Record<string, unknown>;
  }> {
    return [...this.events];
  }

  /** كلُّ التذاكر — للتحقّق من الحالة. */
  getAllTickets(): ReadonlyArray<SupportTicket> {
    return [...this.tickets.values()];
  }
}

// ---------------------------------------------------------------------------
// ناشرُ أحداثٍ في الذاكرة — للأسفار
// ---------------------------------------------------------------------------

export class InMemorySupportEventPublisher implements SupportEventPublisher {
  private readonly events: Array<{
    event_type: string;
    aggregate_id: string;
    payload: Record<string, unknown>;
  }> = [];

  async publishTicketOpened(
    ticketId: string,
    ticketType: SupportTicket["ticket_type"],
    reporterPublicId: string,
  ): Promise<void> {
    this.events.push({
      event_type: "support.ticket_opened",
      aggregate_id: ticketId,
      payload: { ticket_id: ticketId, ticket_type: ticketType, reporter_public_id: reporterPublicId },
    });
  }

  async publishTicketEscalated(
    ticketId: string,
    level: SupportEscalationLevel,
  ): Promise<void> {
    this.events.push({
      event_type: "support.ticket_escalated",
      aggregate_id: ticketId,
      payload: { ticket_id: ticketId, escalation_level: level },
    });
  }

  async publishTicketResolved(
    ticketId: string,
    reason: SupportTicket["resolution_reason"],
    evidenceId: string,
  ): Promise<void> {
    this.events.push({
      event_type: "support.ticket_resolved",
      aggregate_id: ticketId,
      payload: { ticket_id: ticketId, resolution_reason: reason, evidence_id: evidenceId },
    });
  }

  getEvents(): ReadonlyArray<{
    event_type: string;
    aggregate_id: string;
    payload: Record<string, unknown>;
  }> {
    return [...this.events];
  }
}
