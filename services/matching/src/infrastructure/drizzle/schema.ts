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
 *
 * [ADR-024 reconciliation] Constraint names are **canonical**, not bespoke:
 * every column-level CHECK that the contract leaves inline (unnamed) is given the
 * exact name PostgreSQL would auto-generate from it (`<table>_<column>_check`),
 * and every constraint the contract names explicitly (`ck_*` · `ux_*`) keeps that
 * name verbatim. A projection with bespoke names would generate a migration
 * whose catalog diverges from the contract on every constraint name — exactly
 * the drift that the full-cycle equivalence test (migrations.integration.test.ts)
 * is here to catch. The composite primary key is named
 * `matching_decision_candidates_pkey` to match PostgreSQL's auto-generated name
 * for the contract's unnamed `PRIMARY KEY (...)`.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  bigint,
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
      "driver_candidacy_driver_public_id_check",
      sql`${table.driverPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "driver_candidacy_availability_state_check",
      sql`${table.availabilityState} IN ('available','busy','offline')`,
    ),
    check(
      "driver_candidacy_eligibility_state_check",
      sql`${table.eligibilityState} IN ('eligible','ineligible','suspended','unknown')`,
    ),
    check(
      "driver_candidacy_eligibility_source_check",
      sql`${table.eligibilitySource} IN ('claimed','driver_core')`,
    ),
    check(
      "driver_candidacy_service_kinds_check",
      sql`array_length(${table.serviceKinds}, 1) IS NULL OR ${table.serviceKinds} <@ ARRAY['ride','delivery']::TEXT[]`,
    ),
    check(
      "driver_candidacy_vehicle_class_check",
      sql`${table.vehicleClass} IS NULL OR ${table.vehicleClass} IN ('sedan','suv','van','pickup','motorcycle','truck_small')`,
    ),
    check(
      "driver_candidacy_offers_received_check",
      sql`${table.offersReceived} >= 0`,
    ),
    check(
      "driver_candidacy_offers_accepted_check",
      sql`${table.offersAccepted} >= 0`,
    ),
    check(
      "driver_candidacy_orders_completed_check",
      sql`${table.ordersCompleted} >= 0`,
    ),
    check(
      "ck_candidacy_accepted_lte_received",
      sql`${table.offersAccepted} <= ${table.offersReceived}`,
    ),
    check(
      "driver_candidacy_updated_by_check",
      sql`${table.updatedBy} IN ('driver_bot','admin','driver_core','test','unknown')`,
    ),
    // The partial index of the contract: only a POSSIBLE candidate is indexed, so
    // its size follows the number of available drivers, not the number of people
    // who ever registered. `DESC` is a raw SQL expression (not `.desc()`) so the
    // generated index matches the contract verbatim — `.desc()` would emit
    // `DESC NULLS LAST`, which diverges from the contract's plain `DESC`.
    index("ix_candidacy_ready")
      .on(sql`${table.updatedAt} DESC`)
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
    check("matching_rulesets_version_check", sql`${table.version} >= 1`),
    check(
      "matching_rulesets_label_check",
      sql`char_length(${table.label}) BETWEEN 3 AND 64`,
    ),
    check("matching_rulesets_w_eta_check", sql`${table.wEta} BETWEEN 0 AND 100`),
    check(
      "matching_rulesets_w_distance_check",
      sql`${table.wDistance} BETWEEN 0 AND 100`,
    ),
    check(
      "matching_rulesets_w_zone_proximity_check",
      sql`${table.wZoneProximity} BETWEEN 0 AND 100`,
    ),
    check(
      "matching_rulesets_w_completion_check",
      sql`${table.wCompletion} BETWEEN 0 AND 100`,
    ),
    check(
      "matching_rulesets_w_rating_check",
      sql`${table.wRating} BETWEEN 0 AND 100`,
    ),
    check(
      "matching_rulesets_w_acceptance_check",
      sql`${table.wAcceptance} BETWEEN 0 AND 100`,
    ),
    check(
      "matching_rulesets_w_fairness_check",
      sql`${table.wFairness} BETWEEN 0 AND 100`,
    ),
    // The two constraints that a wrong ruleset would otherwise express as a
    // silent reordering of every driver in the country.
    check(
      "ck_ruleset_weights_sum_100",
      sql`${table.wEta} + ${table.wDistance} + ${table.wZoneProximity} + ${table.wCompletion} + ${table.wRating} + ${table.wAcceptance} + ${table.wFairness} = 100`,
    ),
    check(
      "matching_rulesets_candidacy_freshness_seconds_check",
      sql`${table.candidacyFreshnessSeconds} BETWEEN 15 AND 3600`,
    ),
    check(
      "matching_rulesets_max_candidates_check",
      sql`${table.maxCandidates} BETWEEN 1 AND 200`,
    ),
    check(
      "matching_rulesets_fairness_horizon_seconds_check",
      sql`${table.fairnessHorizonSeconds} BETWEEN 60 AND 86400`,
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
      "matching_decisions_order_public_id_check",
      sql`${table.orderPublicId} ~ '^ORD-[0-9]{10}$'`,
    ),
    check(
      "matching_decisions_order_type_check",
      sql`${table.orderType} IN ('ride','delivery')`,
    ),
    check(
      "matching_decisions_excluded_count_check",
      sql`${table.excludedCount} >= 0`,
    ),
    check(
      "matching_decisions_considered_count_check",
      sql`${table.consideredCount} >= 0`,
    ),
    check(
      "matching_decisions_eligible_count_check",
      sql`${table.eligibleCount} >= 0`,
    ),
    check(
      "matching_decisions_returned_count_check",
      sql`${table.returnedCount} >= 0`,
    ),
    check(
      "ck_decision_counts_monotonic",
      sql`${table.returnedCount} <= ${table.eligibleCount} AND ${table.eligibleCount} <= ${table.consideredCount}`,
    ),
    // "Zero candidates" without a reason is worse than an error: it sends an
    // operator looking for a cause the row does not record.
    check(
      "matching_decisions_empty_reason_code_check",
      sql`${table.emptyReasonCode} IS NULL OR char_length(${table.emptyReasonCode}) BETWEEN 3 AND 64`,
    ),
    check(
      "ck_decision_empty_has_reason",
      sql`${table.returnedCount} > 0 OR ${table.emptyReasonCode} IS NOT NULL`,
    ),
    index("ix_decisions_order").on(table.orderId, sql`${table.createdAt} DESC`),
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
    primaryKey({
      columns: [table.decisionId, table.driverPublicId],
      name: "matching_decision_candidates_pkey",
    }),
    foreignKey({
      columns: [table.decisionId],
      foreignColumns: [matchingDecisions.id],
      name: "matching_decision_candidates_decision_id_fkey",
    }).onDelete("cascade"),
    // A repeated rank inside one decision means a non-deterministic ordering.
    unique("ux_decision_rank").on(table.decisionId, table.rank),
    check(
      "matching_decision_candidates_rank_check",
      sql`${table.rank} >= 1`,
    ),
    check(
      "matching_decision_candidates_driver_public_id_check",
      sql`${table.driverPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "matching_decision_candidates_score_bp_check",
      sql`${table.scoreBp} BETWEEN 0 AND 10000`,
    ),
    check(
      "matching_decision_candidates_zone_proximity_bp_check",
      sql`${table.zoneProximityBp} BETWEEN 0 AND 10000`,
    ),
    check(
      "matching_decision_candidates_completion_bp_check",
      sql`${table.completionBp} BETWEEN 0 AND 10000`,
    ),
    check(
      "matching_decision_candidates_acceptance_bp_check",
      sql`${table.acceptanceBp} BETWEEN 0 AND 10000`,
    ),
    check(
      "matching_decision_candidates_fairness_bp_check",
      sql`${table.fairnessBp} BETWEEN 0 AND 10000`,
    ),
    check(
      "matching_decision_candidates_tiebreak_by_check",
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
    sequenceNumber: bigint("sequence_number", { mode: "number" }).notNull(),
  },
  (table) => [
    check(
      "matching_outbox_event_version_check",
      sql`${table.eventVersion} ~ '^v[0-9]+$'`,
    ),
    check(
      "matching_outbox_aggregate_type_check",
      sql`${table.aggregateType} IN ('driver_candidacy','matching_decision')`,
    ),
    check(
      "matching_outbox_trace_id_check",
      sql`${table.traceId} IS NULL OR char_length(${table.traceId}) <= 128`,
    ),
    index("ix_matching_outbox_unpublished")
      .on(table.sequenceNumber)
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
      "matching_idempotency_idempotency_key_check",
      sql`char_length(${table.idempotencyKey}) BETWEEN 8 AND 128`,
    ),
    check(
      "matching_idempotency_payload_fingerprint_check",
      sql`char_length(${table.payloadFingerprint}) BETWEEN 1 AND 4096`,
    ),
  ],
);
