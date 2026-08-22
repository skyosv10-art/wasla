/**
 * Drizzle projection of the dispatch data contract.
 *
 * Source of truth = `services/dispatch/contracts/schema.sql` (ADR-011, ADR-004).
 * Nothing here creates a table: the canonical DDL does that, and the integration
 * harness replays that file rather than deriving tables from this projection — a
 * suite that built its schema from here would agree with itself and prove nothing.
 * `src/__tests__/schema-drift.test.ts` parses the DDL from disk and compares table
 * and column sets in both directions, because the classic failure of this pattern
 * is a projection that quietly falls behind: the queries keep compiling and then
 * read a column that no longer means what it did.
 *
 * Three boundary invariants are visible in what is *absent* (ADR-011, ADR-006):
 *  - `order_id` / `order_public_id` have no foreign key to the orders service: the
 *    order lives in another database, and dispatch must not be able to block on it.
 *  - `zone_id` has no foreign key to geography: existence is checked through a port.
 *  - `driver_public_id` has no foreign key either — it is an opaque, CHECK-shaped
 *    id, and the driver table does not exist yet (Phase 05).
 *
 * The only `REFERENCES` are waves → jobs and offers → jobs/waves, `ON DELETE
 * CASCADE`, because a wave without its job and an offer without its wave are rows
 * nobody can explain.
 *
 * The rules snapshot is FLAT here (`ruleset_version`, `wave_size`, …) exactly as in
 * the DDL, not a `jsonb` blob: these five numbers decide how long a customer waits,
 * and a CHECK on `wave_size >= 1` is reachable on a column and not on a JSON key.
 * `repository.ts` folds them back into the domain's `rules` object.
 */

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// --------------------------------------------------------------------------- //
// 1) dispatch_jobs — one order being dispatched                              //
// --------------------------------------------------------------------------- //

export const dispatchJobs = pgTable(
  "dispatch_jobs",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id").notNull().unique(),
    orderPublicId: text("order_public_id").notNull().unique(),
    zoneId: uuid("zone_id").notNull(),
    orderType: text("order_type").notNull(),
    vehicleClass: text("vehicle_class").notNull(),
    status: text("status").notNull().default("pending"),
    statusReasonCode: text("status_reason_code"),
    rulesetVersion: integer("ruleset_version").notNull(),
    waveSize: smallint("wave_size").notNull(),
    offerTimeoutSeconds: integer("offer_timeout_seconds").notNull(),
    maxWaves: smallint("max_waves").notNull(),
    escalationTimeoutSeconds: integer("escalation_timeout_seconds").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    escalationExpiresAt: timestamp("escalation_expires_at", {
      withTimezone: true,
    }).notNull(),
    createdIdempotencyKey: text("created_idempotency_key").notNull(),
    payloadFingerprint: text("payload_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique("ux_dispatch_jobs_idempotency_key").on(table.createdIdempotencyKey),
    check("ck_dispatch_jobs_order_public_id_shape", sql`${table.orderPublicId} ~ '^ORD-[0-9]{10}$'`),
    check(
      "ck_dispatch_jobs_status_domain",
      sql`${table.status} IN ('pending','dispatching','escalated_community','assigned','exhausted','cancelled')`,
    ),
    // A terminal row without a reason is unexplainable to the operator who opens it.
    check(
      "ck_dispatch_jobs_terminal_needs_reason",
      sql`${table.status} NOT IN ('assigned','exhausted','cancelled') OR ${table.statusReasonCode} IS NOT NULL`,
    ),
    // Escalation cannot end before the automatic window it follows.
    check(
      "ck_dispatch_jobs_deadline_order",
      sql`${table.escalationExpiresAt} >= ${table.expiresAt}`,
    ),
    index("ix_dispatch_jobs_status_due").on(table.status, table.expiresAt),
    index("ix_dispatch_jobs_escalation_due")
      .on(table.escalationExpiresAt)
      .where(sql`${table.status} = 'escalated_community'`),
  ],
);

// --------------------------------------------------------------------------- //
// 2) dispatch_waves — one round of simultaneous offers                       //
// --------------------------------------------------------------------------- //

export const dispatchWaves = pgTable(
  "dispatch_waves",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id").notNull(),
    waveNumber: smallint("wave_number").notNull(),
    status: text("status").notNull().default("open"),
    reasonCode: text("reason_code"),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      columns: [table.jobId],
      foreignColumns: [dispatchJobs.id],
      name: "dispatch_waves_job_id_fkey",
    }).onDelete("cascade"),
    unique("ux_dispatch_waves_job_number").on(table.jobId, table.waveNumber),
    check("ck_dispatch_waves_status_domain", sql`${table.status} IN ('open','completed','cancelled')`),
    check(
      "ck_dispatch_waves_terminal_needs_reason",
      sql`${table.status} = 'open' OR ${table.reasonCode} IS NOT NULL`,
    ),
    check(
      "ck_dispatch_waves_state_timestamp",
      sql`(${table.status} = 'open' AND ${table.completedAt} IS NULL) OR (${table.status} <> 'open' AND ${table.completedAt} IS NOT NULL)`,
    ),
    // The partial unique index that makes "one open wave per job" true under two
    // concurrent ticks, instead of true-if-nobody-races.
    uniqueIndex("ux_dispatch_waves_one_open_job")
      .on(table.jobId)
      .where(sql`${table.status} = 'open'`),
    index("ix_dispatch_waves_open_due")
      .on(table.expiresAt)
      .where(sql`${table.status} = 'open'`),
  ],
);

// --------------------------------------------------------------------------- //
// 3) dispatch_offers — one driver's turn to answer                           //
// --------------------------------------------------------------------------- //

export const dispatchOffers = pgTable(
  "dispatch_offers",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id").notNull(),
    waveId: uuid("wave_id").notNull(),
    orderAssignmentId: uuid("order_assignment_id"),
    driverPublicId: text("driver_public_id").notNull(),
    status: text("status").notNull().default("offered"),
    reasonCode: text("reason_code"),
    offeredAt: timestamp("offered_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      columns: [table.jobId],
      foreignColumns: [dispatchJobs.id],
      name: "dispatch_offers_job_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.waveId],
      foreignColumns: [dispatchWaves.id],
      name: "dispatch_offers_wave_id_fkey",
    }).onDelete("cascade"),
    // Includes rejected and timed-out offers on purpose: this is what stops wave 3
    // from re-asking the driver who declined in wave 1, even if the exclusion list
    // sent to matching was wrong.
    unique("ux_dispatch_offers_job_driver").on(table.jobId, table.driverPublicId),
    check("ck_dispatch_offers_driver_public_id_shape", sql`${table.driverPublicId} ~ '^WS-[0-9]{10}$'`),
    check(
      "ck_dispatch_offers_status_domain",
      sql`${table.status} IN ('offered','accepted','rejected','timed_out','superseded','cancelled')`,
    ),
    check(
      "ck_dispatch_offers_terminal_needs_reason",
      sql`${table.status} = 'offered' OR ${table.reasonCode} IS NOT NULL`,
    ),
    // The timestamp matrix: `responded_at` is set exactly when a person answered,
    // which is what makes "how many drivers actually answered" a countable number.
    check(
      "ck_dispatch_offers_state_timestamp",
      sql`(${table.status} = 'offered' AND ${table.respondedAt} IS NULL AND ${table.resolvedAt} IS NULL) OR (${table.status} = 'accepted' AND ${table.respondedAt} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL) OR (${table.status} = 'rejected' AND ${table.respondedAt} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL) OR (${table.status} IN ('timed_out','superseded','cancelled') AND ${table.resolvedAt} IS NOT NULL)`,
    ),
    index("ix_dispatch_offers_wave").on(table.waveId, table.offeredAt),
    index("ix_dispatch_offers_open_due")
      .on(table.expiresAt)
      .where(sql`${table.status} = 'offered'`),
    // The first acceptance wins; the guard is a database rule, not an `if` that two
    // processes can both pass.
    uniqueIndex("ux_dispatch_offers_one_accepted_job")
      .on(table.jobId)
      .where(sql`${table.status} = 'accepted'`),
  ],
);

// --------------------------------------------------------------------------- //
// 4) dispatch_outbox — the outbox                                            //
// --------------------------------------------------------------------------- //

export const dispatchOutbox = pgTable(
  "dispatch_outbox",
  {
    eventId: uuid("event_id").primaryKey(),
    eventType: text("event_type").notNull(),
    eventVersion: text("event_version").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    payload: jsonb("payload").notNull(),
    traceId: text("trace_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    /** NULL = not published yet. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    check("ck_dispatch_outbox_event_version_shape", sql`${table.eventVersion} ~ '^v[0-9]+$'`),
    check(
      "ck_dispatch_outbox_aggregate_type_domain",
      sql`${table.aggregateType} IN ('dispatch_job','dispatch_offer')`,
    ),
    index("ix_dispatch_outbox_unpublished")
      .on(table.occurredAt)
      .where(sql`${table.publishedAt} IS NULL`),
    index("ix_dispatch_outbox_aggregate").on(
      table.aggregateType,
      table.aggregateId,
      table.occurredAt,
    ),
  ],
);

// --------------------------------------------------------------------------- //
// 5) dispatch_idempotency — key memory (added by MR 5a/6)                    //
// --------------------------------------------------------------------------- //

export const dispatchIdempotency = pgTable(
  "dispatch_idempotency",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    payloadFingerprint: text("payload_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check(
      "ck_dispatch_idempotency_key_length",
      sql`char_length(${table.idempotencyKey}) BETWEEN 8 AND 128`,
    ),
  ],
);
