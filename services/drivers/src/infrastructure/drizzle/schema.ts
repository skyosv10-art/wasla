/**
 * Drizzle projection of the Driver Core data contract.
 *
 * Source of truth = `services/drivers/contracts/schema.sql` (ADR-011, ADR-012).
 * Nothing here creates a table: the canonical DDL does that, and the integration
 * harness replays that file rather than deriving tables from this projection — a
 * suite that built its schema from here would agree with itself and prove nothing.
 * `src/__tests__/schema-drift.test.ts` parses the DDL from disk and compares table
 * and column sets in BOTH directions, because the classic failure of this pattern is
 * a projection that quietly falls behind: the queries keep compiling and then read a
 * column that no longer means what it did.
 *
 * Three boundary invariants are visible in what is *absent* (ADR-012 decision 1):
 *  - `wasla_public_id` has NO foreign key to identity. It is an opaque, CHECK-shaped
 *    id (`^WS-[0-9]{10}$`) living in another database. A driver whose file is under
 *    review must not be blocked by an identity service being down.
 *  - `zone_id` / `work_city_zone_id` have no foreign key to geography either;
 *    existence is checked through `ZoneCatalogPort`, fail-closed.
 *  - the outbox has no `trace_id` COLUMN — the trace id travels inside the JSONB
 *    envelope, where the event contract puts it.
 *
 * The only `REFERENCES` are the ones inside this service: everything → profiles, and
 * documents → vehicles, all `ON DELETE CASCADE`, because a vehicle's registration
 * paper without the vehicle is a row nobody can explain.
 *
 * Two constraints below are the entire reason this adapter cannot be careless about
 * write ORDER, and `repository.ts` is built around them:
 *  - `ux_driver_vehicles_one_primary` — partial unique on `(wasla_public_id) WHERE
 *    is_primary`. It tolerates zero primaries for an instant inside a transaction
 *    and never two, so a reassignment MUST demote before it promotes.
 *  - `ux_driver_documents_one_live_per_type` — partial unique over
 *    `(wasla_public_id, document_type, COALESCE(vehicle_id, <nil uuid>))` WHERE
 *    status IN ('pending','verified'). The old copy must leave the live set before
 *    the new one enters it.
 * Both are checked per statement by Postgres, not at commit: they are not advice.
 *
 * [ADR-024 reconciliation] Constraint names are **canonical**, not bespoke: every
 * column-level CHECK that the contract leaves inline (unnamed) is given the exact
 * name PostgreSQL would auto-generate from it (`<table>_<column>_check`), every
 * constraint the contract names explicitly (`ck_*` · `ux_*` · `ix_*`) keeps that
 * name verbatim, and the inline `UNIQUE` on `driver_outbox.event_id` becomes the
 * canonical constraint name `driver_outbox_event_id_key`. A projection with
 * bespoke (or missing) names would generate a migration whose catalog diverges
 * from the contract on every constraint name — exactly the drift that the
 * full-cycle equivalence test (migrations.integration.test.ts) is here to catch.
 * The composite primary key is named `driver_service_zones_pkey` to match
 * PostgreSQL's auto-generated name for the contract's unnamed
 * `PRIMARY KEY (wasla_public_id, zone_id)`.
 *
 * Deliberately NOT here — drizzle-kit cannot express them, so they travel as a
 * hand-reviewed appended section of `drizzle/0000_*.sql` instead:
 *  - the `driver_set_updated_at()` function and its three triggers
 *    (`trg_driver_profiles_updated_at` · `trg_driver_vehicles_updated_at` ·
 *    `trg_driver_documents_updated_at`),
 *  - the frozen seed row of `driver_eligibility_policies` v1 'saudi-launch-v1'.
 */

import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// --------------------------------------------------------------------------- //
// 1) driver_profiles — the driver's file                                     //
// --------------------------------------------------------------------------- //

export const driverProfiles = pgTable(
  "driver_profiles",
  {
    waslaPublicId: text("wasla_public_id").primaryKey(),
    displayName: text("display_name"),
    preferredLocale: text("preferred_locale").notNull().default("ar"),
    workCityZoneId: uuid("work_city_zone_id"),
    serviceKinds: text("service_kinds").array().notNull().default(sql`'{}'`),
    declaredAvailability: text("declared_availability").notNull().default("offline"),
    /** DERIVED from the documents by `deriveVerificationStatus`, one writer only. */
    verificationStatus: text("verification_status").notNull().default("unverified"),
    status: text("status").notNull().default("active"),
    suspensionReasonCode: text("suspension_reason_code"),
    eligibilityPolicyVersion: integer("eligibility_policy_version").notNull().default(1),
    /** The derived index the expiry tick reads; NULL = nothing scheduled to flip. */
    eligibilityRecheckAt: timestamp("eligibility_recheck_at", { withTimezone: true }),
    lastPublishedState: text("last_published_state"),
    lastPublishedAt: timestamp("last_published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check(
      "driver_profiles_wasla_public_id_check",
      sql`${table.waslaPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "driver_profiles_display_name_check",
      sql`${table.displayName} IS NULL OR char_length(${table.displayName}) BETWEEN 1 AND 80`,
    ),
    check(
      "driver_profiles_preferred_locale_check",
      sql`${table.preferredLocale} IN ('ar','en','ur')`,
    ),
    // The closed list is the same one locked in the order contract and in the
    // candidacy projection: a missing kind hides a valid driver, an extra kind
    // produces an offer that cannot be fulfilled.
    check(
      "driver_profiles_service_kinds_check",
      sql`array_length(${table.serviceKinds}, 1) IS NULL OR ${table.serviceKinds} <@ ARRAY['ride','delivery']::TEXT[]`,
    ),
    check(
      "driver_profiles_declared_availability_check",
      sql`${table.declaredAvailability} IN ('available','offline')`,
    ),
    check(
      "driver_profiles_verification_status_check",
      sql`${table.verificationStatus} IN ('unverified','pending_review','verified','rejected')`,
    ),
    check("driver_profiles_status_check", sql`${table.status} IN ('active','suspended')`),
    check(
      "driver_profiles_suspension_reason_code_check",
      sql`${table.suspensionReasonCode} IS NULL OR char_length(${table.suspensionReasonCode}) BETWEEN 3 AND 64`,
    ),
    check(
      "driver_profiles_eligibility_policy_version_check",
      sql`${table.eligibilityPolicyVersion} >= 1`,
    ),
    check(
      "driver_profiles_last_published_state_check",
      sql`${table.lastPublishedState} IS NULL OR ${table.lastPublishedState} IN ('eligible','ineligible','suspended','unknown')`,
    ),
    // A suspension with no reason is a suspension nobody can explain to the driver,
    // and an active profile carrying a stale reason reads as still suspended.
    check(
      "ck_driver_profiles_suspension_reason",
      sql`(${table.status} = 'suspended' AND ${table.suspensionReasonCode} IS NOT NULL) OR (${table.status} = 'active' AND ${table.suspensionReasonCode} IS NULL)`,
    ),
    index("ix_driver_profiles_recheck")
      .on(table.eligibilityRecheckAt)
      .where(sql`${table.eligibilityRecheckAt} IS NOT NULL`),
    index("ix_driver_profiles_work_city")
      .on(table.workCityZoneId)
      .where(sql`${table.workCityZoneId} IS NOT NULL`),
  ],
);

// --------------------------------------------------------------------------- //
// 2) driver_service_zones — where he agrees to work                          //
// --------------------------------------------------------------------------- //

export const driverServiceZones = pgTable(
  "driver_service_zones",
  {
    waslaPublicId: text("wasla_public_id").notNull(),
    zoneId: uuid("zone_id").notNull(),
    preferenceRank: integer("preference_rank").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      columns: [table.waslaPublicId],
      foreignColumns: [driverProfiles.waslaPublicId],
      name: "driver_service_zones_wasla_public_id_fkey",
    }).onDelete("cascade"),
    // Composite primary key, as in the DDL: one row per (driver, zone). Named
    // canonically — PostgreSQL would auto-name the contract's unnamed
    // `PRIMARY KEY (wasla_public_id, zone_id)` exactly this way.
    primaryKey({
      columns: [table.waslaPublicId, table.zoneId],
      name: "driver_service_zones_pkey",
    }),
    check(
      "driver_service_zones_preference_rank_check",
      sql`${table.preferenceRank} BETWEEN 1 AND 50`,
    ),
    // Two zones ranked "1" is not a preference, it is a tie the matcher must break
    // arbitrarily — so the database refuses it.
    uniqueIndex("ux_driver_service_zones_rank").on(table.waslaPublicId, table.preferenceRank),
    index("ix_driver_service_zones_zone").on(table.zoneId),
  ],
);

// --------------------------------------------------------------------------- //
// 3) driver_vehicles — the fleet                                             //
// --------------------------------------------------------------------------- //

export const driverVehicles = pgTable(
  "driver_vehicles",
  {
    id: uuid("id").primaryKey(),
    waslaPublicId: text("wasla_public_id").notNull(),
    vehicleClass: text("vehicle_class").notNull(),
    make: text("make"),
    model: text("model"),
    modelYear: integer("model_year"),
    color: text("color"),
    plateNumber: text("plate_number"),
    isPrimary: boolean("is_primary").notNull().default(false),
    status: text("status").notNull().default("active"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      columns: [table.waslaPublicId],
      foreignColumns: [driverProfiles.waslaPublicId],
      name: "driver_vehicles_wasla_public_id_fkey",
    }).onDelete("cascade"),
    check(
      "driver_vehicles_vehicle_class_check",
      sql`${table.vehicleClass} IN ('sedan','suv','van','pickup','motorcycle','truck_small')`,
    ),
    check(
      "driver_vehicles_make_check",
      sql`${table.make} IS NULL OR char_length(${table.make}) BETWEEN 1 AND 40`,
    ),
    check(
      "driver_vehicles_model_check",
      sql`${table.model} IS NULL OR char_length(${table.model}) BETWEEN 1 AND 40`,
    ),
    check(
      "driver_vehicles_model_year_check",
      sql`${table.modelYear} IS NULL OR ${table.modelYear} BETWEEN 1970 AND 2100`,
    ),
    check(
      "driver_vehicles_color_check",
      sql`${table.color} IS NULL OR char_length(${table.color}) BETWEEN 1 AND 24`,
    ),
    check(
      "driver_vehicles_plate_number_check",
      sql`${table.plateNumber} IS NULL OR char_length(${table.plateNumber}) BETWEEN 3 AND 16`,
    ),
    check("driver_vehicles_status_check", sql`${table.status} IN ('active','retired')`),
    check(
      "driver_vehicles_idempotency_key_check",
      sql`char_length(${table.idempotencyKey}) BETWEEN 8 AND 128`,
    ),
    // A retired car cannot be the one we offer orders on.
    check(
      "ck_driver_vehicles_retired_not_primary",
      sql`${table.status} = 'active' OR ${table.isPrimary} = false`,
    ),
    // Partial unique: zero primaries is legal for an instant, two never is. This is
    // why `saveAll` writes demotions before promotions.
    uniqueIndex("ux_driver_vehicles_one_primary").on(table.waslaPublicId).where(sql`${table.isPrimary}`),
    uniqueIndex("ux_driver_vehicles_idempotency").on(table.waslaPublicId, table.idempotencyKey),
    index("ix_driver_vehicles_owner").on(table.waslaPublicId, table.status),
  ],
);

// --------------------------------------------------------------------------- //
// 4) driver_documents — the papers and the review decision                   //
// --------------------------------------------------------------------------- //

export const driverDocuments = pgTable(
  "driver_documents",
  {
    id: uuid("id").primaryKey(),
    waslaPublicId: text("wasla_public_id").notNull(),
    documentType: text("document_type").notNull(),
    /** A pointer into the file store. Never logged, never published, never returned. */
    storageRef: text("storage_ref").notNull(),
    vehicleId: uuid("vehicle_id"),
    status: text("status").notNull().default("pending"),
    // DATE, read and written as "YYYY-MM-DD" strings so no `Date` object — and with
    // it no local timezone — ever reaches the expiry arithmetic (domain/documents.ts
    // reads an expiry as `T00:00:00Z`).
    issuedAt: date("issued_at"),
    expiresAt: date("expires_at"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    rejectionReasonCode: text("rejection_reason_code"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      columns: [table.waslaPublicId],
      foreignColumns: [driverProfiles.waslaPublicId],
      name: "driver_documents_wasla_public_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.vehicleId],
      foreignColumns: [driverVehicles.id],
      name: "driver_documents_vehicle_id_fkey",
    }).onDelete("cascade"),
    check(
      "driver_documents_document_type_check",
      sql`${table.documentType} IN ('national_id','driving_license','vehicle_registration','vehicle_insurance','vehicle_photo')`,
    ),
    check(
      "driver_documents_storage_ref_check",
      sql`char_length(${table.storageRef}) BETWEEN 8 AND 200`,
    ),
    check(
      "driver_documents_status_check",
      sql`${table.status} IN ('pending','verified','rejected','superseded')`,
    ),
    check(
      "driver_documents_reviewed_by_check",
      sql`${table.reviewedBy} IS NULL OR char_length(${table.reviewedBy}) BETWEEN 2 AND 64`,
    ),
    check(
      "driver_documents_rejection_reason_code_check",
      sql`${table.rejectionReasonCode} IS NULL OR char_length(${table.rejectionReasonCode}) BETWEEN 3 AND 64`,
    ),
    check(
      "driver_documents_idempotency_key_check",
      sql`char_length(${table.idempotencyKey}) BETWEEN 8 AND 128`,
    ),
    // Who decided, when, and — if refused — why. The audit question a month later is
    // "what did the reviewer see", and a row missing these cannot answer it.
    check(
      "ck_driver_documents_review_coherence",
      sql`(${table.status} = 'pending' AND ${table.reviewedAt} IS NULL AND ${table.reviewedBy} IS NULL AND ${table.rejectionReasonCode} IS NULL) OR (${table.status} = 'verified' AND ${table.reviewedAt} IS NOT NULL AND ${table.reviewedBy} IS NOT NULL AND ${table.rejectionReasonCode} IS NULL) OR (${table.status} = 'rejected' AND ${table.reviewedAt} IS NOT NULL AND ${table.reviewedBy} IS NOT NULL AND ${table.rejectionReasonCode} IS NOT NULL) OR (${table.status} = 'superseded')`,
    ),
    check(
      "ck_driver_documents_dates",
      sql`${table.issuedAt} IS NULL OR ${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.issuedAt}`,
    ),
    check(
      "ck_driver_documents_vehicle_scope",
      sql`(${table.documentType} IN ('vehicle_registration','vehicle_insurance','vehicle_photo') AND ${table.vehicleId} IS NOT NULL) OR (${table.documentType} IN ('national_id','driving_license') AND ${table.vehicleId} IS NULL)`,
    ),
    // COALESCE, not a plain column list: NULL vehicle_id would make every personal
    // document distinct from every other, and "one live national id" would silently
    // stop being true.
    uniqueIndex("ux_driver_documents_one_live_per_type")
      .on(
        table.waslaPublicId,
        table.documentType,
        sql`COALESCE(${table.vehicleId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${table.status} IN ('pending','verified')`),
    uniqueIndex("ux_driver_documents_idempotency").on(table.waslaPublicId, table.idempotencyKey),
    index("ix_driver_documents_owner").on(table.waslaPublicId, table.status),
    // Predicate order follows the contract text verbatim (`status = 'verified'
    // AND expires_at IS NOT NULL`): pg_get_indexdef reprints the stored tree, so a
    // reordered predicate would survive semantically and still fail the catalog
    // equivalence test on the indexdef string.
    index("ix_driver_documents_expiry")
      .on(table.expiresAt)
      .where(sql`${table.status} = 'verified' AND ${table.expiresAt} IS NOT NULL`),
  ],
);

// --------------------------------------------------------------------------- //
// 5) driver_eligibility_policies — the frozen rule set                       //
// --------------------------------------------------------------------------- //

export const driverEligibilityPolicies = pgTable(
  "driver_eligibility_policies",
  {
    version: integer("version").primaryKey(),
    label: text("label").notNull(),
    // القيمتان الافتراضيتان للوثائقِ المطلوبةِ مأخوذتان من العقدِ حرفاً (لا
    // `'{}'`): seed النسخةِ 1 يتركُ العمودَينِ للقيمةِ الافتراضيّةِ، فغيابُها من
    // الإسقاطِ كانَ سيُسقِطُ seed كاملًا عندَ التوليدِ.
    requiredDocumentsRide: text("required_documents_ride")
      .array()
      .notNull()
      .default(sql`ARRAY['national_id','driving_license','vehicle_registration']::TEXT[]`),
    requiredDocumentsDelivery: text("required_documents_delivery")
      .array()
      .notNull()
      .default(sql`ARRAY['national_id','driving_license','vehicle_registration']::TEXT[]`),
    requirePrimaryVehicle: boolean("require_primary_vehicle").notNull().default(true),
    requireServiceZone: boolean("require_service_zone").notNull().default(true),
    documentGraceDays: integer("document_grace_days").notNull().default(0),
    /** A frozen version is never edited: a decision must stay reproducible. */
    isFrozen: boolean("is_frozen").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check("driver_eligibility_policies_version_check", sql`${table.version} >= 1`),
    check(
      "driver_eligibility_policies_label_check",
      sql`char_length(${table.label}) BETWEEN 3 AND 64`,
    ),
    check(
      "driver_eligibility_policies_document_grace_days_check",
      sql`${table.documentGraceDays} BETWEEN 0 AND 60`,
    ),
    check(
      "ck_policy_required_documents_known",
      sql`${table.requiredDocumentsRide} <@ ARRAY['national_id','driving_license','vehicle_registration','vehicle_insurance','vehicle_photo']::TEXT[] AND ${table.requiredDocumentsDelivery} <@ ARRAY['national_id','driving_license','vehicle_registration','vehicle_insurance','vehicle_photo']::TEXT[]`,
    ),
  ],
);

// --------------------------------------------------------------------------- //
// 6) driver_eligibility_log — why the verdict is what it is                  //
// --------------------------------------------------------------------------- //

export const driverEligibilityLog = pgTable(
  "driver_eligibility_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    waslaPublicId: text("wasla_public_id").notNull(),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    /** ALL reasons, in the published order — the order is part of the contract. */
    reasons: text("reasons").array().notNull().default(sql`'{}'`),
    policyVersion: integer("policy_version").notNull(),
    trigger: text("trigger").notNull(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      columns: [table.waslaPublicId],
      foreignColumns: [driverProfiles.waslaPublicId],
      name: "driver_eligibility_log_wasla_public_id_fkey",
    }).onDelete("cascade"),
    check(
      "driver_eligibility_log_from_state_check",
      sql`${table.fromState} IS NULL OR ${table.fromState} IN ('eligible','ineligible','suspended','unknown')`,
    ),
    check(
      "driver_eligibility_log_to_state_check",
      sql`${table.toState} IN ('eligible','ineligible','suspended','unknown')`,
    ),
    check(
      "driver_eligibility_log_policy_version_check",
      sql`${table.policyVersion} >= 1`,
    ),
    check(
      "driver_eligibility_log_trigger_check",
      sql`${table.trigger} IN ('profile_changed','document_reviewed','document_submitted','vehicle_changed','zones_changed','availability_declared','suspended','reinstated','expiry_tick','recompute')`,
    ),
    // "ineligible, no reason given" is the one row this table must never contain:
    // it is exactly the row a driver would call support about.
    //
    // `cardinality`, not `array_length`: the latter returns NULL for an empty array
    // rather than 0, `NULL >= 1` is NULL, and Postgres treats a NULL CHECK result as
    // SATISFIED — so the constraint accepted the exact row it exists to forbid.
    // `cardinality` returns 0, making the comparison an explicit FALSE. Must stay
    // identical to contracts/schema.sql §7; contract-drift.test.ts is what notices.
    check(
      "ck_eligibility_log_reasons",
      sql`${table.toState} = 'eligible' OR cardinality(${table.reasons}) >= 1`,
    ),
    // `DESC` is a raw SQL expression (not `.desc()`): drizzle's `.desc()` renders
    // as `DESC NULLS LAST`, which diverges from the contract's plain `DESC`.
    index("ix_driver_eligibility_log_driver").on(table.waslaPublicId, sql`${table.evaluatedAt} DESC`),
  ],
);

// --------------------------------------------------------------------------- //
// 7) driver_candidacy_publications — every push to matching, success or not  //
// --------------------------------------------------------------------------- //

export const driverCandidacyPublications = pgTable(
  "driver_candidacy_publications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    waslaPublicId: text("wasla_public_id").notNull(),
    eligibilityState: text("eligibility_state").notNull(),
    availabilityState: text("availability_state").notNull(),
    serviceKinds: text("service_kinds").array().notNull().default(sql`'{}'`),
    zoneIds: uuid("zone_ids").array().notNull().default(sql`'{}'`),
    vehicleClass: text("vehicle_class"),
    outcome: text("outcome").notNull(),
    failureCode: text("failure_code"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      columns: [table.waslaPublicId],
      foreignColumns: [driverProfiles.waslaPublicId],
      name: "driver_candidacy_publications_wasla_public_id_fkey",
    }).onDelete("cascade"),
    check(
      "driver_candidacy_publications_eligibility_state_check",
      sql`${table.eligibilityState} IN ('eligible','ineligible','suspended','unknown')`,
    ),
    check(
      "driver_candidacy_publications_availability_state_check",
      sql`${table.availabilityState} IN ('available','busy','offline')`,
    ),
    check(
      "driver_candidacy_publications_vehicle_class_check",
      sql`${table.vehicleClass} IS NULL OR ${table.vehicleClass} IN ('sedan','suv','van','pickup','motorcycle','truck_small')`,
    ),
    check(
      "driver_candidacy_publications_outcome_check",
      sql`${table.outcome} IN ('published','rejected','unavailable')`,
    ),
    check(
      "driver_candidacy_publications_failure_code_check",
      sql`${table.failureCode} IS NULL OR char_length(${table.failureCode}) BETWEEN 3 AND 64`,
    ),
    // A failure with no code cannot be diagnosed; a success with one is a lie.
    check(
      "ck_candidacy_publication_outcome",
      sql`(${table.outcome} = 'published' AND ${table.failureCode} IS NULL) OR (${table.outcome} <> 'published' AND ${table.failureCode} IS NOT NULL)`,
    ),
    index("ix_driver_candidacy_publications_driver").on(
      table.waslaPublicId,
      sql`${table.attemptedAt} DESC`,
    ),
    index("ix_driver_candidacy_publications_failed")
      .on(sql`${table.attemptedAt} DESC`)
      .where(sql`${table.outcome} <> 'published'`),
  ],
);

// --------------------------------------------------------------------------- //
// 8) driver_outbox — the outbox                                              //
// --------------------------------------------------------------------------- //

export const driverOutbox = pgTable(
  "driver_outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventId: uuid("event_id").notNull(),
    eventType: text("event_type").notNull(),
    eventVersion: text("event_version").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    /** The whole event envelope, including `trace_id` — hence no trace column. */
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    /** NULL = not published yet. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    // Canonical name of the contract's inline `event_id UUID NOT NULL UNIQUE`.
    unique("driver_outbox_event_id_key").on(table.eventId),
    check(
      "driver_outbox_aggregate_type_check",
      sql`${table.aggregateType} IN ('driver','driver_document','driver_vehicle')`,
    ),
    index("ix_driver_outbox_unpublished")
      .on(table.id)
      .where(sql`${table.publishedAt} IS NULL`),
  ],
);

// --------------------------------------------------------------------------- //
// 9) driver_idempotency — key + payload fingerprint (added by MR 3/6)        //
// --------------------------------------------------------------------------- //

export const driverIdempotency = pgTable(
  "driver_idempotency",
  {
    /** NAMESPACED: `vehicle:<wasla_public_id>:<key>` — hence 192, not 128. */
    idempotencyKey: text("idempotency_key").primaryKey(),
    payloadFingerprint: text("payload_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check(
      "driver_idempotency_idempotency_key_check",
      sql`char_length(${table.idempotencyKey}) BETWEEN 8 AND 192`,
    ),
    check(
      "driver_idempotency_payload_fingerprint_check",
      sql`char_length(${table.payloadFingerprint}) BETWEEN 1 AND 4096`,
    ),
  ],
);
