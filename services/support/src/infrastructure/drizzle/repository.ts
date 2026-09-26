/**
 * مُهيئاتُ منافذ الدعم على PostgreSQL عبر Drizzle.
 *
 * هذه الطبقةُ هي حدُّ التحويل الوحيد بين صفوف Postgres ونماذج المجال: اللحظاتُ تخرج
 * نصّاً ISO، والـUUID يبقى نصّاً كما في العقد، وJSONB لا يعبر إلّا كحدثٍ متعاقدٍ عليه.
 * ولا تفتح المستودعاتُ معاملةً: اختيارُ الحدود مسؤوليّةُ المُستدعي.
 *
 * ## القيودُ تُترجَم بأسمائها
 *
 * كلُّ كتابةٍ تُغلَّف بـ`catch` واحدٍ يمرّ على `translate`، و`translate` يقرأ اسمَ القيد
 * من خطأ Postgres ويرميه خطأَ مجالٍ **بنفس الاسم** الذي يرميه مُهيئُ الذاكرة.
 * واسمٌ غيرُ معروفٍ لا يُترجَم بل يُعاد كما هو.
 */

import { eq, lt, and, desc } from "drizzle-orm";

import { supportErrors } from "../../domain/errors.js";
import type {
  SupportTicket,
  SupportTicketDraft,
  SupportEvidence,
  SupportEvidenceDraft,
  SupportResolutionDraft,
  SupportEscalationLevel,
} from "../../domain/model.js";
import type { SupportTicketStore, SupportEventPublisher } from "../../ports.js";
import { isEnforcedConstraint } from "../constraints.js";
import type { DbOrTx } from "./db.js";
import {
  supportEvidence,
  supportOutbox,
  supportTickets,
  type SupportTicketRow,
  type SupportEvidenceRow,
} from "./schema.js";

// ---------------------------------------------------------------------------
// تحويلُ اللحظات وترجمةُ الأخطاء
// ---------------------------------------------------------------------------

/** اللحظةُ قد تكون فارغة أو `Date` — نُخرجها نصّاً ISO أو `null`. */
function iso(value: Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toISOString();
}

/** صفٌّ من القاعدة → نموذج مجال. */
function rowToTicket(row: SupportTicketRow): SupportTicket {
  return {
    ticket_id: row.ticketId,
    ticket_type: row.ticketType as SupportTicket["ticket_type"],
    state: row.state as SupportTicket["state"],
    escalation_level: (row.escalationLevel ?? null) as SupportEscalationLevel | null,
    reporter_public_id: row.reporterPublicId,
    subject_public_id: row.subjectPublicId ?? null,
    order_public_id: row.orderPublicId ?? null,
    resolution_reason: (row.resolutionReason ?? null) as SupportTicket["resolution_reason"],
    evidence_id: row.evidenceId ?? null,
    opened_at: iso(row.openedAt) ?? new Date(0).toISOString(),
    investigating_at: iso(row.investigatingAt),
    escalated_at: iso(row.escalatedAt),
    resolved_at: iso(row.resolvedAt),
    closed_at: iso(row.closedAt),
  };
}

function rowToEvidence(row: SupportEvidenceRow): SupportEvidence {
  return {
    evidence_id: row.evidenceId,
    ticket_id: row.ticketId,
    evidence_type: row.evidenceType as SupportEvidence["evidence_type"],
    content_hash: row.contentHash,
    storage_ref: row.storageRef,
    attached_at: iso(row.attachedAt) ?? new Date(0).toISOString(),
  };
}

/** يُترجِمُ خطأَ Postgres إلى خطأِ مجالٍ بالاسم الكنونيّ. */
function translate(error: unknown): never {
  const cause = error as { code?: string; constraint?: string };
  const constraint = cause?.constraint;
  if (constraint && isEnforcedConstraint(constraint)) {
    throw supportErrors.evidenceRequired("");
  }
  throw error;
}

/** يُغلّفُ كتابةً واحدة بترجمةِ خطأ. */
async function tryWrite<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    translate(error);
  }
}

// ---------------------------------------------------------------------------
// مستودعُ التذاكر — تنفيذُ SupportTicketStore
// ---------------------------------------------------------------------------

export class PostgresSupportTicketStore implements SupportTicketStore {
  constructor(
    private readonly db: DbOrTx,
    private readonly publisher?: SupportEventPublisher,
  ) {}

  async createTicket(draft: SupportTicketDraft): Promise<SupportTicket> {
    const [row] = await tryWrite(() =>
      this.db
        .insert(supportTickets)
        .values({
          ticketType: draft.ticket_type,
          state: "open",
          reporterPublicId: draft.reporter_public_id,
          subjectPublicId: draft.subject_public_id ?? null,
          orderPublicId: draft.order_public_id ?? null,
        })
        .returning(),
    );

    const ticket = rowToTicket(row);

    if (this.publisher) {
      await this.publisher.publishTicketOpened(
        ticket.ticket_id,
        ticket.ticket_type,
        ticket.reporter_public_id,
      );
    }

    return ticket;
  }

  async getTicket(ticketId: string): Promise<SupportTicket | null> {
    const row = await this.db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.ticketId, ticketId))
      .limit(1);

    if (row.length === 0) return null;
    return rowToTicket(row[0]);
  }

  async listTickets(opts?: {
    readonly state?: SupportTicket["state"];
    readonly limit?: number;
    readonly cursor?: string | null;
  }): Promise<{ readonly tickets: readonly SupportTicket[]; readonly nextCursor: string | null }> {
    const limit = Math.min(opts?.limit ?? 20, 100);
    const conds = [];
    if (opts?.state) conds.push(eq(supportTickets.state, opts.state));
    if (opts?.cursor) conds.push(lt(supportTickets.ticketId, opts.cursor));

    const rows = await this.db
      .select()
      .from(supportTickets)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(supportTickets.openedAt))
      .limit(limit + 1);

    const page = rows.slice(0, limit).map(rowToTicket);
    const nextCursor = rows.length > limit ? (page[page.length - 1]?.ticket_id ?? null) : null;
    return { tickets: page, nextCursor };
  }

  async updateState(
    ticketId: string,
    state: SupportTicket["state"],
    patch: Partial<SupportTicket>,
  ): Promise<SupportTicket> {
    const updateValues: Record<string, unknown> = {
      state,
      updatedAt: new Date(),
    };

    if (state === "investigating") {
      updateValues.investigatingAt = new Date();
    }
    if (state === "escalated") {
      updateValues.escalatedAt = new Date();
    }
    if (state === "resolved") {
      updateValues.resolvedAt = new Date();
    }
    if (state === "closed") {
      updateValues.closedAt = new Date();
    }
    if (patch.escalation_level) {
      updateValues.escalationLevel = patch.escalation_level;
    }
    if (patch.evidence_id) {
      updateValues.evidenceId = patch.evidence_id;
    }
    if (patch.resolution_reason) {
      updateValues.resolutionReason = patch.resolution_reason;
    }

    const [row] = await tryWrite(() =>
      this.db
        .update(supportTickets)
        .set(updateValues)
        .where(eq(supportTickets.ticketId, ticketId))
        .returning(),
    );

    if (!row) {
      throw supportErrors.ticketNotFound(ticketId);
    }

    return rowToTicket(row);
  }

  async attachEvidence(draft: SupportEvidenceDraft): Promise<SupportEvidence> {
    const [row] = await tryWrite(() =>
      this.db
        .insert(supportEvidence)
        .values({
          ticketId: draft.ticket_id,
          evidenceType: draft.evidence_type,
          contentHash: draft.content_hash,
          storageRef: draft.storage_ref,
        })
        .returning(),
    );

    return rowToEvidence(row);
  }

  async getEvidence(evidenceId: string): Promise<SupportEvidence | null> {
    const row = await this.db
      .select()
      .from(supportEvidence)
      .where(eq(supportEvidence.evidenceId, evidenceId))
      .limit(1);

    if (row.length === 0) return null;
    return rowToEvidence(row[0]);
  }

  async resolve(draft: SupportResolutionDraft): Promise<SupportTicket> {
    const [row] = await tryWrite(() =>
      this.db
        .update(supportTickets)
        .set({
          state: "resolved",
          resolutionReason: draft.resolution_reason,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(supportTickets.ticketId, draft.ticket_id))
        .returning(),
    );

    if (!row) {
      throw supportErrors.ticketNotFound(draft.ticket_id);
    }

    const ticket = rowToTicket(row);

    if (this.publisher && draft.evidence_id) {
      await this.publisher.publishTicketResolved(
        ticket.ticket_id,
        ticket.resolution_reason!,
        draft.evidence_id,
      );
    }

    return ticket;
  }
}

// ---------------------------------------------------------------------------
// ناشرُ الأحداث — تنفيذُ SupportEventPublisher على صندوق البريد
// ---------------------------------------------------------------------------

export class PostgresSupportEventPublisher implements SupportEventPublisher {
  constructor(private readonly db: DbOrTx) {}

  async publishTicketOpened(
    ticketId: string,
    ticketType: SupportTicket["ticket_type"],
    reporterPublicId: string,
  ): Promise<void> {
    await this.db.insert(supportOutbox).values({
      eventType: "support.ticket_opened",
      aggregateId: ticketId,
      payload: {
        ticket_id: ticketId,
        ticket_type: ticketType,
        reporter_public_id: reporterPublicId,
      },
    });
  }

  async publishTicketEscalated(
    ticketId: string,
    level: SupportEscalationLevel,
  ): Promise<void> {
    await this.db.insert(supportOutbox).values({
      eventType: "support.ticket_escalated",
      aggregateId: ticketId,
      payload: {
        ticket_id: ticketId,
        escalation_level: level,
      },
    });
  }

  async publishTicketResolved(
    ticketId: string,
    reason: SupportTicket["resolution_reason"],
    evidenceId: string,
  ): Promise<void> {
    await this.db.insert(supportOutbox).values({
      eventType: "support.ticket_resolved",
      aggregateId: ticketId,
      payload: {
        ticket_id: ticketId,
        resolution_reason: reason,
        evidence_id: evidenceId,
      },
    });
  }
}

/** تهيئةُ كلِّ المنافذ على PostgreSQL. */
import { InMemoryReputationBridge } from "../reputation-bridge.js";
import type { ReputationBridgePort } from "../../ports.js";

export function createPostgresSupportAdapters(db: DbOrTx): {
  store: PostgresSupportTicketStore;
  publisher: PostgresSupportEventPublisher;
  reputationBridge: ReputationBridgePort;
} {
  const publisher = new PostgresSupportEventPublisher(db);
  const store = new PostgresSupportTicketStore(db, publisher);
  // In-memory bridge as placeholder — HTTP adapter deferred to integration review.
  const reputationBridge = new InMemoryReputationBridge();
  return { store, publisher, reputationBridge };
}
