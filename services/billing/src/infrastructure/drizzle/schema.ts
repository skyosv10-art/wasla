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
  primaryKey,
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

// ---------------------------------------------------------------------------
// billing_relay_checkpoint — نقطةُ تفتيشِ المُرحِّل (M5-17P · CLM-0375)
// ---------------------------------------------------------------------------

export const billingRelayCheckpoint = pgTable(
  "billing_relay_checkpoint",
  {
    consumerId: text("consumer_id").primaryKey(),
    lastOccurredAt: timestamptz("last_occurred_at").notNull(),
    lastEventId: uuid("last_event_id").notNull(),
    updatedAt: timestamptz("updated_at").notNull().default(sql`now()`),
  },
  (table) => [
    check("billing_relay_checkpoint_consumer_id_check", sql`char_length(${table.consumerId}) BETWEEN 1 AND 64`),
  ],
);

// ---------------------------------------------------------------------------
// billing_relay_consumed_events — دفترُ الاستهلاك (منعُ التسويةِ المكرَّرة)
// ---------------------------------------------------------------------------

export const billingRelayConsumedEvents = pgTable(
  "billing_relay_consumed_events",
  {
    consumerId: text("consumer_id").notNull(),
    eventId: uuid("event_id").notNull(),
    status: text("status").notNull(),
    reason: text("reason"),
    settlementId: uuid("settlement_id").references(() => billingSettlements.settlementId),
    consumedAt: timestamptz("consumed_at").notNull().default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.consumerId, table.eventId] }),
    check("billing_relay_consumed_events_consumer_id_check", sql`char_length(${table.consumerId}) BETWEEN 1 AND 64`),
    check(
      "billing_relay_consumed_events_status_check",
      sql`${table.status} IN ('settled', 'recorded', 'ignored', 'ignored_foreign', 'poisoned')`,
    ),
    check(
      "billing_relay_settled_has_settlement",
      sql`(${table.status} = 'settled') = (${table.settlementId} IS NOT NULL)`,
    ),
    index("idx_billing_relay_consumed_poisoned").on(table.consumerId, table.consumedAt).where(sql`${table.status} = 'poisoned'`),
  ],
);

// ---------------------------------------------------------------------------
// billing_store_order_snapshots — لقطةُ مالِ طلبِ المتجرِ من delivery_outbox (M5-17Q · CLM-0376)
// ---------------------------------------------------------------------------

export const billingStoreOrderSnapshots = pgTable(
  "billing_store_order_snapshots",
  {
    orderId: uuid("order_id").primaryKey(),
    orderPublicId: text("order_public_id").notNull(),
    storeId: uuid("store_id").notNull(),
    storeSlug: text("store_slug").notNull(),
    currencyCode: text("currency_code").notNull(),
    itemsTotalMinorUnits: bigint("items_total_minor_units", { mode: "number" }).notNull(),
    deliveryFeeMinorUnits: bigint("delivery_fee_minor_units", { mode: "number" }).notNull(),
    sourceEventId: uuid("source_event_id").notNull(),
    settlementId: uuid("settlement_id")
      .unique("billing_store_order_snapshots_settlement_id_unique")
      .references(() => billingSettlements.settlementId),
    createdAt: timestamptz("created_at").notNull().default(sql`now()`),
    updatedAt: timestamptz("updated_at").notNull().default(sql`now()`),
  },
  (table) => [
    check("billing_store_order_snapshots_currency_check", sql`${table.currencyCode} = 'SAR'`),
    check("billing_store_order_snapshots_items_total_check", sql`${table.itemsTotalMinorUnits} >= 0`),
    check("billing_store_order_snapshots_delivery_fee_check", sql`${table.deliveryFeeMinorUnits} >= 0`),
  ],
);
