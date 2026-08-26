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
 * Named CHECKs are projected; the DDL's INLINE (unnamed) checks are not, because
 * naming a constraint here that Postgres named `driver_profiles_status_check` would
 * put a fiction in the drift guard's vocabulary. The guard asserts the reverse
 * direction instead: every `ck_/ux_/ix_/trg_` name this service mentions anywhere
 * must exist in the DDL.
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
    // Composite primary key, as in the DDL: one row per (driver, zone).
    primaryKey({ columns: [table.waslaPublicId, table.zoneId] }),
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
    index("ix_driver_documents_expiry")
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} IS NOT NULL AND ${table.status} = 'verified'`),
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
    requiredDocumentsRide: text("required_documents_ride").array().notNull(),
    requiredDocumentsDelivery: text("required_documents_delivery").array().notNull(),
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
    index("ix_driver_eligibility_log_driver").on(table.waslaPublicId, table.evaluatedAt.desc()),
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
    // A failure with no code cannot be diagnosed; a success with one is a lie.
    check(
      "ck_candidacy_publication_outcome",
      sql`(${table.outcome} = 'published' AND ${table.failureCode} IS NULL) OR (${table.outcome} <> 'published' AND ${table.failureCode} IS NOT NULL)`,
    ),
    index("ix_driver_candidacy_publications_driver").on(table.waslaPublicId, table.attemptedAt.desc()),
    index("ix_driver_candidacy_publications_failed")
      .on(table.attemptedAt.desc())
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
    eventId: uuid("event_id").notNull().unique(),
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
    index("ix_driver_outbox_unpublished")
      .on(table.occurredAt)
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
);
