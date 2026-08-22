/**
 * Drizzle projection of the matching data contract.
 *
 * Source of truth = `services/matching/contracts/schema.sql` (ADR-011). Nothing
 * here creates a table: the canonical DDL does that. This module exists so the
 * queries are type-checked against the real column names, and it is kept honest
 * by `src/__tests__/schema-drift.test.ts`, which parses the DDL from disk and
 * compares table and column sets. A projection that silently falls behind its
 * contract is the classic failure of this pattern — the queries keep compiling
 * and then read the wrong column at runtime, returning a plausible answer.
 *
 * Four boundary invariants are visible in what is *absent* (ADR-011 decisions
 * 1 · 2 · 4):
 *  - `driver_public_id` has no foreign key to identity or to a driver table: the
 *    table does not exist yet (Phase 05) and the reference is an opaque,
 *    CHECK-shaped id.
 *  - `zone_ids` / `pickup_zone_id` have no foreign key to geography (ADR-006):
 *    existence is verified through `ZoneHierarchyPort`, not by a constraint.
 *  - `order_id` / `dispatch_job_id` have no foreign key either: they name rows in
 *    other services' databases, and matching must not be able to block on them.
 *  - the only `REFERENCES` are decision-candidates → decisions and decisions →
 *    rulesets, because a score row has no meaning without its decision and a
 *    decision is unexplainable without the ruleset that produced it.
 *
 * Scores are integer basis points (`INTEGER`), never floats: `0.1 + 0.2` is not
 * `0.3`, and the order of drivers is not a place for that.
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
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// --------------------------------------------------------------------------- //
// 1) driver_candidacy — the candidacy projection                             //
// --------------------------------------------------------------------------- //

export const driverCandidacy = pgTable(
  "driver_candidacy",
  {
    driverPublicId: text("driver_public_id").primaryKey(),
    availabilityState: text("availability_state").notNull().default("offline"),
    eligibilityState: text("eligibility_state").notNull().default("unknown"),
    eligibilitySource: text("eligibility_source").notNull().default("claimed"),
    serviceKinds: text("service_kinds").array().notNull().default(sql`'{}'`),
    vehicleClass: text("vehicle_class"),
    zoneIds: uuid("zone_ids").array().notNull().default(sql`'{}'`),
    lastOfferedAt: timestamp("last_offered_at", { withTimezone: true }),
    lastAssignedAt: timestamp("last_assigned_at", { withTimezone: true }),
    offersReceived: integer("offers_received").notNull().default(0),
    offersAccepted: integer("offers_accepted").notNull().default(0),
    ordersCompleted: integer("orders_completed").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedBy: text("updated_by").notNull().default("unknown"),
  },
  (table) => [
    check(
      "ck_candidacy_driver_public_id_shape",
      sql`${table.driverPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "ck_candidacy_availability_domain",
      sql`${table.availabilityState} IN ('available','busy','offline')`,
    ),
    check(
      "ck_candidacy_eligibility_domain",
      sql`${table.eligibilityState} IN ('eligible','ineligible','suspended','unknown')`,
    ),
    check(
      "ck_candidacy_eligibility_source_domain",
      sql`${table.eligibilitySource} IN ('claimed','driver_core')`,
    ),
    check(
      "ck_candidacy_accepted_lte_received",
      sql`${table.offersAccepted} <= ${table.offersReceived}`,
    ),
    // The partial index of the contract: only a POSSIBLE candidate is indexed, so
    // its size follows the number of available drivers, not the number of people
    // who ever registered.
    index("ix_candidacy_ready")
      .on(table.updatedAt.desc())
      .where(
        sql`${table.availabilityState} = 'available' AND ${table.eligibilityState} = 'eligible'`,
      ),
    index("ix_candidacy_zones").using("gin", table.zoneIds),
    index("ix_candidacy_services").using("gin", table.serviceKinds),
  ],
);

// --------------------------------------------------------------------------- //
// 2) matching_rulesets — weights as data, per version                        //
// --------------------------------------------------------------------------- //

export const matchingRulesets = pgTable(
  "matching_rulesets",
  {
    version: integer("version").primaryKey(),
    label: text("label").notNull(),
    wEta: integer("w_eta").notNull().default(0),
    wDistance: integer("w_distance").notNull().default(0),
    wZoneProximity: integer("w_zone_proximity").notNull().default(40),
    wCompletion: integer("w_completion").notNull().default(20),
    wRating: integer("w_rating").notNull().default(0),
    wAcceptance: integer("w_acceptance").notNull().default(20),
    wFairness: integer("w_fairness").notNull().default(20),
    candidacyFreshnessSeconds: integer("candidacy_freshness_seconds")
      .notNull()
      .default(120),
    maxCandidates: integer("max_candidates").notNull().default(20),
    fairnessHorizonSeconds: integer("fairness_horizon_seconds")
      .notNull()
      .default(3600),
    isFrozen: boolean("is_frozen").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
  },
  (table) => [
    check("ck_ruleset_version_positive", sql`${table.version} >= 1`),
    // The two constraints that a wrong ruleset would otherwise express as a
    // silent reordering of every driver in the country.
    check(
      "ck_ruleset_weights_sum_100",
      sql`${table.wEta} + ${table.wDistance} + ${table.wZoneProximity} + ${table.wCompletion} + ${table.wRating} + ${table.wAcceptance} + ${table.wFairness} = 100`,
    ),
    check(
      "ck_ruleset_frozen_at",
      sql`(${table.isFrozen} = FALSE AND ${table.frozenAt} IS NULL) OR (${table.isFrozen} = TRUE AND ${table.frozenAt} IS NOT NULL)`,
    ),
  ],
);

// --------------------------------------------------------------------------- //
// 3) matching_decisions — the append-only audit row                          //
// --------------------------------------------------------------------------- //

export const matchingDecisions = pgTable(
  "matching_decisions",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id").notNull(),
    orderPublicId: text("order_public_id").notNull(),
    dispatchJobId: uuid("dispatch_job_id"),
    rulesetVersion: integer("ruleset_version").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull(),
    orderType: text("order_type").notNull(),
    vehicleClass: text("vehicle_class").notNull(),
    pickupZoneId: uuid("pickup_zone_id").notNull(),
    excludedCount: integer("excluded_count").notNull().default(0),
    consideredCount: integer("considered_count").notNull(),
    eligibleCount: integer("eligible_count").notNull(),
    returnedCount: integer("returned_count").notNull(),
    emptyReasonCode: text("empty_reason_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      columns: [table.rulesetVersion],
      foreignColumns: [matchingRulesets.version],
      name: "matching_decisions_ruleset_version_fkey",
    }),
    check(
      "ck_decision_order_public_id_shape",
      sql`${table.orderPublicId} ~ '^ORD-[0-9]{10}$'`,
    ),
    check(
      "ck_decision_counts_monotonic",
      sql`${table.returnedCount} <= ${table.eligibleCount} AND ${table.eligibleCount} <= ${table.consideredCount}`,
    ),
    // "Zero candidates" without a reason is worse than an error: it sends an
    // operator looking for a cause the row does not record.
    check(
      "ck_decision_empty_has_reason",
      sql`${table.returnedCount} > 0 OR ${table.emptyReasonCode} IS NOT NULL`,
    ),
    index("ix_decisions_order").on(table.orderId, table.createdAt.desc()),
  ],
);

// --------------------------------------------------------------------------- //
// 4) matching_decision_candidates — the score rows                           //
// --------------------------------------------------------------------------- //

export const matchingDecisionCandidates = pgTable(
  "matching_decision_candidates",
  {
    decisionId: uuid("decision_id").notNull(),
    rank: integer("rank").notNull(),
    driverPublicId: text("driver_public_id").notNull(),
    scoreBp: integer("score_bp").notNull(),
    zoneProximityBp: integer("zone_proximity_bp").notNull(),
    completionBp: integer("completion_bp").notNull(),
    acceptanceBp: integer("acceptance_bp").notNull(),
    fairnessBp: integer("fairness_bp").notNull(),
    tiebreakBy: text("tiebreak_by"),
  },
  (table) => [
    primaryKey({ columns: [table.decisionId, table.driverPublicId] }),
    foreignKey({
      columns: [table.decisionId],
      foreignColumns: [matchingDecisions.id],
      name: "matching_decision_candidates_decision_id_fkey",
    }).onDelete("cascade"),
    // A repeated rank inside one decision means a non-deterministic ordering.
    unique("ux_decision_rank").on(table.decisionId, table.rank),
    check("ck_candidate_rank_positive", sql`${table.rank} >= 1`),
    check(
      "ck_candidate_score_bp_range",
      sql`${table.scoreBp} BETWEEN 0 AND 10000`,
    ),
    check(
      "ck_candidate_tiebreak_domain",
      sql`${table.tiebreakBy} IS NULL OR ${table.tiebreakBy} IN ('score','last_offered_at','driver_public_id')`,
    ),
  ],
);

// --------------------------------------------------------------------------- //
// 5) matching_outbox — the outbox                                            //
// --------------------------------------------------------------------------- //

export const matchingOutbox = pgTable(
  "matching_outbox",
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
    check("ck_outbox_event_version_shape", sql`${table.eventVersion} ~ '^v[0-9]+$'`),
    check(
      "ck_outbox_aggregate_type_domain",
      sql`${table.aggregateType} IN ('driver_candidacy','matching_decision')`,
    ),
    index("ix_matching_outbox_unpublished")
      .on(table.occurredAt)
      .where(sql`${table.publishedAt} IS NULL`),
  ],
);

// --------------------------------------------------------------------------- //
// 6) matching_idempotency — key memory (added by MR 3/6)                     //
// --------------------------------------------------------------------------- //

export const matchingIdempotency = pgTable(
  "matching_idempotency",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    payloadFingerprint: text("payload_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check(
      "ck_idempotency_key_length",
      sql`char_length(${table.idempotencyKey}) BETWEEN 8 AND 128`,
    ),
  ],
);
