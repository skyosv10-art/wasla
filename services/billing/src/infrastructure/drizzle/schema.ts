/**
 * مرآةُ Drizzle لعقد PostgreSQL — ثلاثةُ جداولَ بنفس الأسماء والأنواع والقيود.
 *
 * ## هذا الملفُّ مرآةٌ لا مصدر
 *
 * الحقيقةُ في `services/billing/contracts/schema.sql` (مُجمَّد، المراجعة 3/N)، وهو
 * نفسُه **العقدُ القانونيُّ**: الكتالوجُ الذي يُقاسُ عليه كلُّ تمثيلٍ آخر. وهذا الملفُّ
 * يُسقِطُ العقدَ إلى TypeScript لتُكمِلَ الاستعلاماتُ الترجمةَ، ويُولِّدُ منهُ
 * `drizzle-kit generate` الترحيلاتِ العكوسةَ (ADR-024).
 *
 * ولذلك يحرسها اختبارُ `schema-drift.test.ts`: يقرأ الـDDL وقت التشغيل ويقارن
 * **الاتجاهين** — عمودٌ أو قيدٌ في العقد بلا مرآة، أو في المرآة بلا عقد، يُفشل البناء.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** عمودُ لحظةٍ بمنطقةٍ زمنيّة. التحويلُ إلى نصّ ISO مسؤوليّةُ المستودع لا المرآة. */
const timestamptz = (name: string) => timestamp(name, { mode: "date" });

// ---------------------------------------------------------------------------
// billing_invoices — دورة حياة الفاتورة (حالية الحالة)
// ---------------------------------------------------------------------------

export const billingInvoices = pgTable(
  "billing_invoices",
  {
    invoiceId: uuid("invoice_id").default(sql`gen_random_uuid()`).primaryKey(),
    storePublicId: text("store_public_id").notNull(),
    period: text("period").notNull(),
    state: text("state").notNull().default("draft"),
    feeType: text("fee_type").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    paidAmountCents: bigint("paid_amount_cents", { mode: "number" }).notNull().default(0),
    paymentRef: text("payment_ref"),
    settlementId: uuid("settlement_id"),
    createdAt: timestamptz("created_at").notNull().default(sql`now()`),
    updatedAt: timestamptz("updated_at").notNull().default(sql`now()`),
    issuedAt: timestamptz("issued_at"),
    paidAt: timestamptz("paid_at"),
    closedAt: timestamptz("closed_at"),
    voidedAt: timestamptz("voided_at"),
  },
  (table) => [
    check("billing_amount_cents_positive", sql`${table.amountCents} > 0`),
    check("billing_paid_amount_non_negative", sql`${table.paidAmountCents} >= 0`),
    check(
      "billing_state_valid",
      sql`${table.state} IN ('draft', 'issued', 'paid', 'partially_paid', 'closed', 'void')`,
    ),
    check(
      "billing_fee_type_valid",
      sql`${table.feeType} IN ('store_fixed', 'store_variable', 'subscription', 'payout')`,
    ),
    check(
      "billing_payment_gate",
      sql`(${table.state} NOT IN ('issued', 'partially_paid') OR ${table.paidAmountCents} <= ${table.amountCents})`,
    ),
    check(
      "billing_void_gate",
      sql`(${table.state} != 'void' OR ${table.voidedAt} IS NOT NULL)`,
    ),
    check(
      "billing_close_gate",
      sql`(${table.state} != 'closed' OR ${table.paidAt} IS NOT NULL)`,
    ),
    index("idx_billing_invoices_store").on(table.storePublicId, table.createdAt),
    index("idx_billing_invoices_state").on(table.state),
  ],
);

// ---------------------------------------------------------------------------
// billing_settlements — سجلات تسوية الرسوم
// ---------------------------------------------------------------------------

export const billingSettlements = pgTable(
  "billing_settlements",
  {
    settlementId: uuid("settlement_id").default(sql`gen_random_uuid()`).primaryKey(),
    invoiceId: uuid("invoice_id").notNull().references(() => billingInvoices.invoiceId),
    feeType: text("fee_type").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    period: text("period").notNull(),
    state: text("state").notNull().default("pending"),
    createdAt: timestamptz("created_at").notNull().default(sql`now()`),
    settledAt: timestamptz("settled_at"),
  },
  (table) => [
    check("billing_settlement_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "billing_settlement_fee_type_valid",
      sql`${table.feeType} IN ('store_fixed', 'store_variable', 'subscription', 'payout')`,
    ),
    check(
      "billing_settlement_state_valid",
      sql`${table.state} IN ('pending', 'settled', 'failed')`,
    ),
    index("idx_billing_settlements_invoice").on(table.invoiceId),
  ],
);

// ---------------------------------------------------------------------------
// billing_outbox — الناشرُ المعاملاتيُّ للأحداث
// ---------------------------------------------------------------------------

export const billingOutbox = pgTable(
  "billing_outbox",
  {
    eventId: uuid("event_id").default(sql`gen_random_uuid()`).primaryKey(),
    eventType: text("event_type").notNull(),
    eventVersion: text("event_version").notNull().default("v1"),
    aggregateId: uuid("aggregate_id").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamptz("occurred_at").notNull().default(sql`now()`),
    publishedAt: timestamptz("published_at"),
    publishAttempts: integer("publish_attempts").notNull().default(0),
  },
  (table) => [
    check(
      "billing_outbox_event_type_valid",
      sql`${table.eventType} IN ('billing.invoice_issued', 'billing.fee_settled', 'billing.payout_requested')`,
    ),
    index("idx_billing_outbox_unpublished").on(table.publishedAt),
  ],
);
