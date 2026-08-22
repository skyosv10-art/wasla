/**
 * مرآة Drizzle لعقد بيانات خدمة التفاوض.
 *
 * مصدر الحقيقة هو `services/negotiations/contracts/schema.sql`. لا تنشئ هذه المرآة أي جدول:
 * مهيئ التكامل يعيد تطبيق العقد الرسمي، و`schema-drift.test.ts` يقارن الاتجاهين كي لا تخفي
 * المرآة المتأخرة تغيّراً في قاعدة البيانات. تمثل الجداول فقط علاقات هذه الخدمة الداخلية؛
 * معرفات الطلب والسائق والعميل مراجع opaque لخدمات أخرى ولا تتحول إلى مفاتيح أجنبية هنا.
 *
 * تظهر القيود المسماة والفهارس هنا عمداً. ليست نصائح للتطبيق: فهي الطبقة الثانية التي تحرس
 * الاتساق عند تزامن الطلبات أو عند كتابة أداة تشغيل مباشرة إلى القاعدة.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// 1) negotiation_policies — نسخة السياسة التي تفسر الخيط لاحقاً
// ---------------------------------------------------------------------------

export const negotiationPolicies = pgTable(
  "negotiation_policies",
  {
    policyVersion: integer("policy_version").primaryKey(),
    label: text("label").notNull(),
    currency: text("currency").notNull(),
    minAmountMinor: bigint("min_amount_minor", { mode: "number" }).notNull(),
    maxAmountMinor: bigint("max_amount_minor", { mode: "number" }).notNull(),
    maxRounds: integer("max_rounds").notNull(),
    roundTtlSeconds: integer("round_ttl_seconds").notNull(),
    threadTtlSeconds: integer("thread_ttl_seconds").notNull(),
    maxMessageLength: integer("max_message_length").notNull(),
    maxMessagesPerThread: integer("max_messages_per_thread").notNull(),
    isFrozen: boolean("is_frozen").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    check(
      "ck_negotiation_policies_amount_bounds",
      sql`${t.maxAmountMinor} > ${t.minAmountMinor}`,
    ),
    check(
      "ck_negotiation_policies_ttl_order",
      sql`${t.threadTtlSeconds} >= ${t.roundTtlSeconds}`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 2) negotiation_threads — خيط واحد للطلب والسائق وعرض التوزيع
// ---------------------------------------------------------------------------

export const negotiationThreads = pgTable(
  "negotiation_threads",
  {
    id: uuid("id").primaryKey(),
    orderPublicId: text("order_public_id").notNull(),
    customerPublicId: text("customer_public_id").notNull(),
    driverPublicId: text("driver_public_id").notNull(),
    dispatchOfferId: uuid("dispatch_offer_id").notNull(),
    serviceKind: text("service_kind").notNull(),
    state: text("state").notNull().default("open"),
    closeReasonCode: text("close_reason_code"),
    policyVersion: integer("policy_version").notNull(),
    currency: text("currency").notNull(),
    openingAmountMinor: bigint("opening_amount_minor", {
      mode: "number",
    }).notNull(),
    openedBy: text("opened_by").notNull(),
    roundCount: integer("round_count").notNull().default(0),
    currentRoundNo: integer("current_round_no").notNull().default(0),
    agreedRoundNo: integer("agreed_round_no"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    nextTickAt: timestamp("next_tick_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    foreignKey({
      columns: [t.policyVersion],
      foreignColumns: [negotiationPolicies.policyVersion],
    }),
    unique("ux_negotiation_threads_order_driver").on(
      t.orderPublicId,
      t.driverPublicId,
    ),
    unique("ux_negotiation_threads_dispatch_offer").on(t.dispatchOfferId),
    check(
      "ck_negotiation_threads_open_is_clean",
      sql`${t.state} <> 'open' OR (
        ${t.closedAt} IS NULL AND
        ${t.agreedRoundNo} IS NULL AND
        ${t.closeReasonCode} IS NULL
      )`,
    ),
    check(
      "ck_negotiation_threads_closed_has_reason",
      sql`${t.state} = 'open' OR (
        ${t.closedAt} IS NOT NULL AND
        ${t.closeReasonCode} IS NOT NULL AND
        ${t.nextTickAt} IS NULL
      )`,
    ),
    check(
      "ck_negotiation_threads_agreed_names_round",
      sql`(
        ${t.state} = 'agreed' AND
        ${t.agreedRoundNo} IS NOT NULL AND
        ${t.closeReasonCode} = 'agreed'
      ) OR (
        ${t.state} <> 'agreed' AND
        ${t.agreedRoundNo} IS NULL AND
        ${t.closeReasonCode} <> 'agreed'
      ) OR ${t.state} = 'open'`,
    ),
    check(
      "ck_negotiation_threads_round_counters",
      sql`${t.currentRoundNo} <= ${t.roundCount}`,
    ),
    check(
      "ck_negotiation_threads_agreed_round_exists",
      sql`${t.agreedRoundNo} IS NULL OR ${t.agreedRoundNo} <= ${t.currentRoundNo}`,
    ),
    index("ix_negotiation_threads_order").on(
      t.orderPublicId,
      t.createdAt.desc(),
    ),
    index("ix_negotiation_threads_driver").on(
      t.driverPublicId,
      t.createdAt.desc(),
    ),
    index("ix_negotiation_threads_state").on(t.state, t.createdAt.desc()),
    index("ix_negotiation_threads_tick_due")
      .on(t.nextTickAt)
      .where(sql`${t.state} = 'open'`),
  ],
);

// ---------------------------------------------------------------------------
// 3) negotiation_rounds — العرض المرقم وحالته
// ---------------------------------------------------------------------------

export const negotiationRounds = pgTable(
  "negotiation_rounds",
  {
    id: uuid("id").primaryKey(),
    threadId: uuid("thread_id").notNull(),
    roundNo: integer("round_no").notNull(),
    proposedBy: text("proposed_by").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    state: text("state").notNull().default("pending"),
    resolvedBy: text("resolved_by"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    foreignKey({
      columns: [t.threadId],
      foreignColumns: [negotiationThreads.id],
    }).onDelete("cascade"),
    unique("ux_negotiation_rounds_thread_no").on(t.threadId, t.roundNo),
    check(
      "ck_negotiation_rounds_state_timestamp",
      sql`(
        ${t.state} = 'pending' AND
        ${t.respondedAt} IS NULL AND
        ${t.resolvedBy} IS NULL
      ) OR (
        ${t.state} IN ('accepted', 'rejected') AND
        ${t.respondedAt} IS NOT NULL AND
        ${t.resolvedBy} IS NOT NULL
      ) OR (
        ${t.state} IN ('superseded', 'expired') AND
        ${t.resolvedBy} IS NULL
      )`,
    ),
    check(
      "ck_negotiation_rounds_no_self_resolution",
      sql`${t.resolvedBy} IS NULL OR ${t.resolvedBy} <> ${t.proposedBy}`,
    ),
    index("ix_negotiation_rounds_thread").on(t.threadId, t.roundNo.desc()),
    uniqueIndex("ux_negotiation_rounds_one_pending")
      .on(t.threadId)
      .where(sql`${t.state} = 'pending'`),
    uniqueIndex("ux_negotiation_rounds_one_accepted")
      .on(t.threadId)
      .where(sql`${t.state} = 'accepted'`),
    index("ix_negotiation_rounds_pending_due")
      .on(t.expiresAt)
      .where(sql`${t.state} = 'pending'`),
  ],
);

// ---------------------------------------------------------------------------
// 4) negotiation_messages — محتوى المحادثة وتسلسلها
// ---------------------------------------------------------------------------

export const negotiationMessages = pgTable(
  "negotiation_messages",
  {
    id: uuid("id").primaryKey(),
    threadId: uuid("thread_id").notNull(),
    sequenceNo: integer("sequence_no").notNull(),
    authorRole: text("author_role").notNull(),
    body: text("body"),
    sourceLocale: text("source_locale").notNull().default("ar"),
    systemCode: text("system_code"),
    roundNo: integer("round_no"),
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
    redactionReasonCode: text("redaction_reason_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    foreignKey({
      columns: [t.threadId],
      foreignColumns: [negotiationThreads.id],
    }).onDelete("cascade"),
    unique("ux_negotiation_messages_thread_seq").on(t.threadId, t.sequenceNo),
    check(
      "ck_negotiation_messages_body_or_code",
      sql`(
        ${t.authorRole} IN ('customer', 'driver') AND
        ${t.systemCode} IS NULL AND
        (${t.body} IS NOT NULL OR ${t.redactedAt} IS NOT NULL)
      ) OR (
        ${t.authorRole} = 'system' AND
        ${t.systemCode} IS NOT NULL AND
        ${t.body} IS NULL
      )`,
    ),
    check(
      "ck_negotiation_messages_redaction",
      sql`(
        ${t.redactedAt} IS NULL AND
        ${t.redactionReasonCode} IS NULL
      ) OR (
        ${t.redactedAt} IS NOT NULL AND
        ${t.redactionReasonCode} IS NOT NULL AND
        ${t.body} IS NULL
      )`,
    ),
    index("ix_negotiation_messages_thread").on(t.threadId, t.sequenceNo),
  ],
);

// ---------------------------------------------------------------------------
// 5) negotiation_agreements — الاتفاق ودورة تسليم السعر
// ---------------------------------------------------------------------------

export const negotiationAgreements = pgTable(
  "negotiation_agreements",
  {
    threadId: uuid("thread_id").primaryKey(),
    orderPublicId: text("order_public_id").notNull(),
    driverPublicId: text("driver_public_id").notNull(),
    roundNo: integer("round_no").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    acceptedBy: text("accepted_by").notNull(),
    policyVersion: integer("policy_version").notNull(),
    agreedAt: timestamp("agreed_at", { withTimezone: true }).notNull(),
    handoffState: text("handoff_state").notNull().default("pending"),
    handoffAttempts: integer("handoff_attempts").notNull().default(0),
    handedOffAt: timestamp("handed_off_at", { withTimezone: true }),
    nextHandoffAt: timestamp("next_handoff_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    foreignKey({
      columns: [t.threadId],
      foreignColumns: [negotiationThreads.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.policyVersion],
      foreignColumns: [negotiationPolicies.policyVersion],
    }),
    unique("ux_negotiation_agreements_order_driver").on(
      t.orderPublicId,
      t.driverPublicId,
    ),
    check(
      "ck_negotiation_agreements_handed_off_at",
      sql`(
        ${t.handoffState} = 'handed_off' AND
        ${t.handedOffAt} IS NOT NULL AND
        ${t.nextHandoffAt} IS NULL
      ) OR (
        ${t.handoffState} <> 'handed_off' AND
        ${t.handedOffAt} IS NULL
      )`,
    ),
    check(
      "ck_negotiation_agreements_terminal_no_retry",
      sql`${t.handoffState} NOT IN ('rejected','abandoned') OR ${t.nextHandoffAt} IS NULL`,
    ),
    check(
      "ck_negotiation_agreements_failure_named",
      sql`${t.handoffState} NOT IN ('rejected','abandoned') OR ${t.lastErrorCode} IS NOT NULL`,
    ),
    index("ix_negotiation_agreements_order").on(t.orderPublicId),
    index("ix_negotiation_agreements_handoff_due")
      .on(t.nextHandoffAt)
      .where(sql`${t.handoffState} = 'pending'`),
  ],
);

// ---------------------------------------------------------------------------
// 6) negotiation_price_handoffs — سجل المحاولات قبل النتيجة وبعدها
// ---------------------------------------------------------------------------

export const negotiationPriceHandoffs = pgTable(
  "negotiation_price_handoffs",
  {
    id: uuid("id").primaryKey(),
    threadId: uuid("thread_id").notNull(),
    attemptNo: integer("attempt_no").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    outcome: text("outcome"),
    responseStatus: integer("response_status"),
    errorCode: text("error_code"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.threadId],
      foreignColumns: [negotiationAgreements.threadId],
    }).onDelete("cascade"),
    unique("ux_negotiation_price_handoffs_attempt").on(t.threadId, t.attemptNo),
    check(
      "ck_negotiation_price_handoffs_completion",
      sql`(
        ${t.outcome} IS NULL AND
        ${t.completedAt} IS NULL
      ) OR (
        ${t.outcome} IS NOT NULL AND
        ${t.completedAt} IS NOT NULL
      )`,
    ),
    check(
      "ck_negotiation_price_handoffs_failure_named",
      sql`${t.outcome} IS NULL OR ${t.outcome} = 'accepted' OR ${t.errorCode} IS NOT NULL`,
    ),
    index("ix_negotiation_price_handoffs_thread").on(
      t.threadId,
      t.attemptNo.desc(),
    ),
  ],
);

// ---------------------------------------------------------------------------
// 7) negotiation_idempotency — مفتاح الإعادة وبصمة الحمولة
// ---------------------------------------------------------------------------

export const negotiationIdempotency = pgTable(
  "negotiation_idempotency",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    scope: text("scope").notNull(),
    threadId: uuid("thread_id"),
    payloadFingerprint: text("payload_fingerprint").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    foreignKey({
      columns: [t.threadId],
      foreignColumns: [negotiationThreads.id],
    }).onDelete("cascade"),
    index("ix_negotiation_idempotency_thread").on(t.threadId),
  ],
);
// ---------------------------------------------------------------------------
// 8) negotiation_outbox — الحدث الذري الذي يقرأه الناشر لاحقاً
// ---------------------------------------------------------------------------

export const negotiationOutbox = pgTable(
  "negotiation_outbox",
  {
    id: uuid("id").primaryKey(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    eventVersion: text("event_version").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    traceId: text("trace_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("ix_negotiation_outbox_unpublished")
      .on(t.occurredAt)
      .where(sql`${t.publishedAt} IS NULL`),
  ],
);
