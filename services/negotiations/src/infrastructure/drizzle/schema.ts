/**
 * Drizzle projection of the Negotiation & Chat data contract.
 *
 * Source of truth = `services/negotiations/contracts/schema.sql` (ADR-013).
 * Nothing here creates a table: the canonical DDL does that, and the integration
 * harness replays that file rather than deriving tables from this projection — a
 * suite that built its schema from here would agree with itself and prove nothing.
 * `src/__tests__/schema-drift.test.ts` parses the DDL from disk and compares table
 * and column sets in BOTH directions, because the classic failure of this pattern is
 * a projection that quietly falls behind: the queries keep compiling and then read a
 * column that no longer means what it did.
 *
 * Boundary invariants visible in what is *absent* (ADR-013):
 *  - `order_public_id` / `customer_public_id` / `driver_public_id` are opaque
 *    CHECK-shaped ids (`^ORD-[0-9]{10}$` · `^WS-[0-9]{10}$`) living in other
 *    services' databases: no foreign keys cross the boundary (ADR-009 §1), and
 *    existence is verified through ports, not by the database.
 *  - negotiation never owns the order's price: the agreed amount leaves through
 *    one port (`AgreedPricePort`) and the order engine alone writes it.
 *  - the conversation body is content, not event: it never appears in any outbox
 *    payload (ADR-013 decision 6).
 *  - translation is display, not storage: only `source_locale` is persisted.
 *
 * The only `REFERENCES` are the ones inside this service: threads → policies,
 * rounds/messages/agreements/idempotency → threads, agreements → policies, and
 * price_handoffs → agreements, with `ON DELETE CASCADE` on the thread-owned rows.
 *
 * The single-round and single-agreement guards are the entire reason this adapter
 * cannot be careless about write ORDER:
 *  - `ux_negotiation_rounds_one_pending` — partial unique on `(thread_id) WHERE
 *    state = 'pending'`: two concurrent counter-proposals cannot both stand.
 *  - `ux_negotiation_rounds_one_accepted` — partial unique on `(thread_id) WHERE
 *    state = 'accepted'`: the agreement cannot happen twice.
 *
 * [ADR-024 reconciliation] Constraint names are **canonical**, not bespoke: every
 * column-level CHECK that the contract leaves inline (unnamed) is given the exact
 * name PostgreSQL would auto-generate from it (`<table>_<column>_check`) — all 59
 * of them, from the `^WS-[0-9]{10}$` shapes to the closed enums and length bounds;
 * every constraint the contract names explicitly (`ck_*` · `ux_*` · `ix_*`) keeps
 * that name verbatim; and every foreign key is named the way PostgreSQL would
 * auto-name the contract's inline `REFERENCES` (`<table>_<column>_fkey`). The
 * contract's `DESC` indexes are written as raw `sql\`... DESC\`` because drizzle's
 * `.desc()` renders `DESC NULLS LAST`, which is not what the catalog holds — the
 * full-cycle equivalence test (migrations.integration.test.ts) compares
 * `pg_get_indexdef` output verbatim and would catch even that. A projection with
 * bespoke (or missing) names would generate a migration whose catalog diverges
 * from the contract on every constraint name — exactly the drift that test is
 * here to catch.
 *
 * Deliberately NOT here — drizzle-kit cannot express it, so it travels as a
 * hand-reviewed appended section of `drizzle/0000_*.sql` instead:
 *  - the frozen seed row of `negotiation_policies` v1 'saudi-launch-v1'
 *    (SAR · 500..500000 · 5 rounds · 120s/900s · 1000/100).
 */

import { sql } from "drizzle-orm";
import {
  bigint,
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
    check("negotiation_policies_policy_version_check", sql`${t.policyVersion} >= 1`),
    check(
      "negotiation_policies_label_check",
      sql`char_length(${t.label}) BETWEEN 3 AND 64`,
    ),
    check(
      "negotiation_policies_currency_check",
      sql`${t.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "negotiation_policies_min_amount_minor_check",
      sql`${t.minAmountMinor} > 0`,
    ),
    check(
      "negotiation_policies_max_amount_minor_check",
      sql`${t.maxAmountMinor} > 0`,
    ),
    check(
      "negotiation_policies_max_rounds_check",
      sql`${t.maxRounds} BETWEEN 1 AND 20`,
    ),
    check(
      "negotiation_policies_round_ttl_seconds_check",
      sql`${t.roundTtlSeconds} BETWEEN 30 AND 3600`,
    ),
    check(
      "negotiation_policies_thread_ttl_seconds_check",
      sql`${t.threadTtlSeconds} BETWEEN 60 AND 86400`,
    ),
    check(
      "negotiation_policies_max_message_length_check",
      sql`${t.maxMessageLength} BETWEEN 1 AND 1000`,
    ),
    check(
      "negotiation_policies_max_messages_per_thread_check",
      sql`${t.maxMessagesPerThread} BETWEEN 1 AND 500`,
    ),
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
      name: "negotiation_threads_policy_version_fkey",
    }),
    check(
      "negotiation_threads_order_public_id_check",
      sql`${t.orderPublicId} ~ '^ORD-[0-9]{10}$'`,
    ),
    check(
      "negotiation_threads_customer_public_id_check",
      sql`${t.customerPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "negotiation_threads_driver_public_id_check",
      sql`${t.driverPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "negotiation_threads_service_kind_check",
      sql`${t.serviceKind} IN ('ride','delivery')`,
    ),
    check(
      "negotiation_threads_state_check",
      sql`${t.state} IN ('open','agreed','declined','expired','cancelled')`,
    ),
    check(
      "negotiation_threads_close_reason_code_check",
      sql`${t.closeReasonCode} IS NULL OR ${t.closeReasonCode} IN (
        'agreed',
        'declined_by_customer','declined_by_driver',
        'max_rounds_reached','thread_expired',
        'cancelled_by_dispatch','order_withdrawn'
      )`,
    ),
    check(
      "negotiation_threads_currency_check",
      sql`${t.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "negotiation_threads_opening_amount_minor_check",
      sql`${t.openingAmountMinor} > 0`,
    ),
    check(
      "negotiation_threads_opened_by_check",
      sql`${t.openedBy} IN ('customer','driver')`,
    ),
    check(
      "negotiation_threads_round_count_check",
      sql`${t.roundCount} >= 0`,
    ),
    check(
      "negotiation_threads_current_round_no_check",
      sql`${t.currentRoundNo} >= 0`,
    ),
    check(
      "negotiation_threads_agreed_round_no_check",
      sql`${t.agreedRoundNo} IS NULL OR ${t.agreedRoundNo} >= 1`,
    ),
    check(
      "negotiation_threads_version_check",
      sql`${t.version} >= 1`,
    ),
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
      sql`${t.createdAt} DESC`,
    ),
    index("ix_negotiation_threads_driver").on(
      t.driverPublicId,
      sql`${t.createdAt} DESC`,
    ),
    index("ix_negotiation_threads_state").on(t.state, sql`${t.createdAt} DESC`),
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
      name: "negotiation_rounds_thread_id_fkey",
    }).onDelete("cascade"),
    check("negotiation_rounds_round_no_check", sql`${t.roundNo} >= 1`),
    check(
      "negotiation_rounds_proposed_by_check",
      sql`${t.proposedBy} IN ('customer','driver')`,
    ),
    check("negotiation_rounds_amount_minor_check", sql`${t.amountMinor} > 0`),
    check(
      "negotiation_rounds_currency_check",
      sql`${t.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "negotiation_rounds_state_check",
      sql`${t.state} IN ('pending','accepted','rejected','superseded','expired')`,
    ),
    check(
      "negotiation_rounds_resolved_by_check",
      sql`${t.resolvedBy} IS NULL OR ${t.resolvedBy} IN ('customer','driver')`,
    ),
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
    index("ix_negotiation_rounds_thread").on(
      t.threadId,
      sql`${t.roundNo} DESC`,
    ),
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
      name: "negotiation_messages_thread_id_fkey",
    }).onDelete("cascade"),
    check(
      "negotiation_messages_sequence_no_check",
      sql`${t.sequenceNo} >= 1`,
    ),
    check(
      "negotiation_messages_author_role_check",
      sql`${t.authorRole} IN ('customer','driver','system')`,
    ),
    check(
      "negotiation_messages_body_check",
      sql`${t.body} IS NULL OR char_length(${t.body}) BETWEEN 1 AND 1000`,
    ),
    check(
      "negotiation_messages_source_locale_check",
      sql`${t.sourceLocale} IN ('ar','en','ur')`,
    ),
    check(
      "negotiation_messages_system_code_check",
      sql`${t.systemCode} IS NULL OR char_length(${t.systemCode}) BETWEEN 3 AND 64`,
    ),
    check(
      "negotiation_messages_round_no_check",
      sql`${t.roundNo} IS NULL OR ${t.roundNo} >= 1`,
    ),
    check(
      "negotiation_messages_redaction_reason_code_check",
      sql`${t.redactionReasonCode} IS NULL OR char_length(${t.redactionReasonCode}) BETWEEN 3 AND 64`,
    ),
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
      name: "negotiation_agreements_thread_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.policyVersion],
      foreignColumns: [negotiationPolicies.policyVersion],
      name: "negotiation_agreements_policy_version_fkey",
    }),
    check(
      "negotiation_agreements_order_public_id_check",
      sql`${t.orderPublicId} ~ '^ORD-[0-9]{10}$'`,
    ),
    check(
      "negotiation_agreements_driver_public_id_check",
      sql`${t.driverPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check("negotiation_agreements_round_no_check", sql`${t.roundNo} >= 1`),
    check("negotiation_agreements_amount_minor_check", sql`${t.amountMinor} > 0`),
    check(
      "negotiation_agreements_currency_check",
      sql`${t.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "negotiation_agreements_accepted_by_check",
      sql`${t.acceptedBy} IN ('customer','driver')`,
    ),
    check(
      "negotiation_agreements_handoff_state_check",
      sql`${t.handoffState} IN ('pending','handed_off','rejected','abandoned')`,
    ),
    check(
      "negotiation_agreements_handoff_attempts_check",
      sql`${t.handoffAttempts} >= 0`,
    ),
    check(
      "negotiation_agreements_last_error_code_check",
      sql`${t.lastErrorCode} IS NULL OR char_length(${t.lastErrorCode}) BETWEEN 3 AND 64`,
    ),
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
      name: "negotiation_price_handoffs_thread_id_fkey",
    }).onDelete("cascade"),
    check("negotiation_price_handoffs_attempt_no_check", sql`${t.attemptNo} >= 1`),
    check("negotiation_price_handoffs_amount_minor_check", sql`${t.amountMinor} > 0`),
    check(
      "negotiation_price_handoffs_currency_check",
      sql`${t.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "negotiation_price_handoffs_outcome_check",
      sql`${t.outcome} IS NULL OR ${t.outcome} IN ('accepted','rejected','unavailable')`,
    ),
    check(
      "negotiation_price_handoffs_response_status_check",
      sql`${t.responseStatus} IS NULL OR ${t.responseStatus} BETWEEN 100 AND 599`,
    ),
    check(
      "negotiation_price_handoffs_error_code_check",
      sql`${t.errorCode} IS NULL OR char_length(${t.errorCode}) BETWEEN 3 AND 64`,
    ),
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
      sql`${t.attemptNo} DESC`,
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
      name: "negotiation_idempotency_thread_id_fkey",
    }).onDelete("cascade"),
    check(
      "negotiation_idempotency_idempotency_key_check",
      sql`char_length(${t.idempotencyKey}) BETWEEN 8 AND 128`,
    ),
    check(
      "negotiation_idempotency_scope_check",
      sql`${t.scope} IN (
        'open_thread','propose_round','accept_round',
        'reject_round','post_message','cancel_thread'
      )`,
    ),
    check(
      "negotiation_idempotency_payload_fingerprint_check",
      sql`char_length(${t.payloadFingerprint}) = 64`,
    ),
    check(
      "negotiation_idempotency_response_status_check",
      sql`${t.responseStatus} BETWEEN 100 AND 599`,
    ),
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
    sequenceNumber: bigint("sequence_number", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
  },
  (t) => [
    check(
      "negotiation_outbox_aggregate_type_check",
      sql`${t.aggregateType} IN (
        'negotiation_thread','negotiation_round','negotiation_message'
      )`,
    ),
    check(
      "negotiation_outbox_event_type_check",
      sql`char_length(${t.eventType}) >= 3`,
    ),
    check(
      "negotiation_outbox_event_version_check",
      sql`${t.eventVersion} ~ '^v[0-9]+$'`,
    ),
    check("negotiation_outbox_attempts_check", sql`${t.attempts} >= 0`),
    index("ix_negotiation_outbox_unpublished")
      .on(t.sequenceNumber)
      .where(sql`${t.publishedAt} IS NULL`),
  ],
);
