/**
 * مرآةُ Drizzle لعقد PostgreSQL — ثلاثةُ جداولَ بنفس الأسماء والأنواع والقيود.
 *
 * ## هذا الملفُّ مرآةٌ لا مصدر
 *
 * الحقيقةُ في `services/support/contracts/schema.sql` (مُجمَّد، المراجعة 2/N)، وهو
 * نفسُه **العقدُ القانونيُّ**: الكتالوجُ الذي يُقاسُ عليه كلُّ تمثيلٍ آخر. وهذا الملفُّ
 * يُسقِطُ العقدَ إلى TypeScript لتُكمِلَ الاستعلاماتُ الترجمةَ، ويُولِّدُ منهُ
 * `drizzle-kit generate` الترحيلاتِ العكوسةَ (ADR-024).
 *
 * ولذلك يحرسها اختبارُ `schema-drift.test.ts`: يقرأ الـDDL وقت التشغيل ويقارن
 * **الاتجاهين** — عمودٌ أو قيدٌ في العقد بلا مرآة، أو في المرآة بلا عقد، يُفشل البناء.
 */

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** عمودُ لحظةٍ بمنطقةٍ زمنيّة. التحويلُ إلى نصّ ISO مسؤوليّةُ المستودع لا المرآة. */
const timestamptz = (name: string) => timestamp(name, { mode: "date" }).notNull();

// ---------------------------------------------------------------------------
// support_tickets — دورة حياة التذكرة (حالية الحالة)
// ---------------------------------------------------------------------------

export const supportTickets = pgTable(
  "support_tickets",
  {
    ticketId: uuid("ticket_id").default(sql`gen_random_uuid()`).primaryKey(),
    ticketType: text("ticket_type").notNull(),
    state: text("state").notNull().default("open"),
    escalationLevel: text("escalation_level"),
    reporterPublicId: text("reporter_public_id").notNull(),
    subjectPublicId: text("subject_public_id"),
    orderPublicId: text("order_public_id"),
    resolutionReason: text("resolution_reason"),
    evidenceId: uuid("evidence_id"),
    openedAt: timestamptz("opened_at").default(sql`now()`),
    investigatingAt: timestamp("investigating_at", { mode: "date" }),
    escalatedAt: timestamp("escalated_at", { mode: "date" }),
    resolvedAt: timestamp("resolved_at", { mode: "date" }),
    closedAt: timestamp("closed_at", { mode: "date" }),
    createdAt: timestamptz("created_at").default(sql`now()`),
    updatedAt: timestamptz("updated_at").default(sql`now()`),
  },
  (t) => [
    check("support_evidence_gate", sql`${t.state} = 'open' OR ${t.evidenceId} IS NOT NULL`),
    check("support_resolution_gate", sql`${t.state} NOT IN ('resolved', 'closed') OR ${t.resolutionReason} IS NOT NULL`),
    check("support_no_skip_closed", sql`${t.state} != 'closed' OR ${t.resolvedAt} IS NOT NULL`),
  ],
);

// ---------------------------------------------------------------------------
// support_evidence — بيانات الأدلة (إضافية فقط، لا كائنات ثنائية)
// ---------------------------------------------------------------------------

export const supportEvidence = pgTable(
  "support_evidence",
  {
    evidenceId: uuid("evidence_id").default(sql`gen_random_uuid()`).primaryKey(),
    ticketId: uuid("ticket_id").notNull(),
    evidenceType: text("evidence_type").notNull(),
    contentHash: text("content_hash").notNull(),
    storageRef: text("storage_ref").notNull(),
    attachedAt: timestamptz("attached_at").default(sql`now()`),
  },
  (t) => [
    foreignKey({
      name: "support_evidence_ticket_id_fkey",
      columns: [t.ticketId],
      foreignColumns: [supportTickets.ticketId],
    }),
  ],
);

// ---------------------------------------------------------------------------
// support_outbox — صندوق البريد للنشر المعاملاتي للأحداث
// ---------------------------------------------------------------------------

export const supportOutbox = pgTable(
  "support_outbox",
  {
    eventId: uuid("event_id").default(sql`gen_random_uuid()`).primaryKey(),
    eventType: text("event_type").notNull(),
    eventVersion: text("event_version").notNull().default("v1"),
    aggregateId: uuid("aggregate_id").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamptz("occurred_at").default(sql`now()`),
    publishedAt: timestamp("published_at", { mode: "date" }),
    publishAttempts: integer("publish_attempts").notNull().default(0),
  },
  (t) => [
    index("idx_support_outbox_unpublished")
      .on(t.occurredAt)
      .where(sql`published_at IS NULL`),
  ],
);

export type SupportTicketRow = typeof supportTickets.$inferSelect;
export type SupportTicketInsert = typeof supportTickets.$inferInsert;
export type SupportEvidenceRow = typeof supportEvidence.$inferSelect;
export type SupportEvidenceInsert = typeof supportEvidence.$inferInsert;
export type SupportOutboxRow = typeof supportOutbox.$inferSelect;
export type SupportOutboxInsert = typeof supportOutbox.$inferInsert;
