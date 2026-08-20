/**
 * Drizzle schema for the Identity service — mirrors the canonical data
 * contract (services/identity/contracts/schema.sql) so queries are type-safe.
 *
 * Source of truth = schema.sql (ADR-004). This Drizzle schema is the
 * type-safe projection used by the Postgres repository adapter. Column
 * types, CHECK constraints, UNIQUE constraints and FKs match schema.sql.
 *
 * The wasla_public_id sequence + the updated_at trigger are implementation
 * details (schema.sql notes generation is left to the implementation); they
 * are created by the db setup (db.ts), not modeled here.
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  bigserial,
  boolean,
  timestamp,
  jsonb,
  check,
  uniqueIndex,
  index,
  foreignKey,
  unique,
} from "drizzle-orm/pg-core";

import type { IdentityEvent } from "@wasla/contracts-identity";

/** identity_users — the core Wasla user (Wasla identity). */
export const identityUsers = pgTable(
  "identity_users",
  {
    internalUuid: uuid("internal_uuid")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    waslaPublicId: text("wasla_public_id").notNull().unique(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check(
      "identity_users_status_check",
      sql`${table.status} IN ('active','suspended','deleted','recovery_in_progress')`,
    ),
  ],
);

/** identity_links — external identity links (telegram/phone/email/...). */
export const identityLinks = pgTable(
  "identity_links",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userInternalUuid: uuid("user_internal_uuid").notNull(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    verified: boolean("verified").notNull().default(false),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique("identity_links_provider_external_id_key").on(
      table.provider,
      table.externalId,
    ),
    index("ix_identity_links_user").on(table.userInternalUuid, table.provider),
    foreignKey({
      columns: [table.userInternalUuid],
      foreignColumns: [identityUsers.internalUuid],
    }).onDelete("restrict"),
    check(
      "identity_links_provider_check",
      sql`${table.provider} IN ('telegram','phone','email','web','mobile')`,
    ),
  ],
);

/** identity_history — username / link change log (no new user on username change). */
export const identityHistory = pgTable(
  "identity_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userInternalUuid: uuid("user_internal_uuid").notNull(),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    source: text("source").notNull(),
  },
  (table) => [
    index("ix_identity_history_user_field").on(
      table.userInternalUuid,
      table.field,
    ),
    foreignKey({
      columns: [table.userInternalUuid],
      foreignColumns: [identityUsers.internalUuid],
    }).onDelete("restrict"),
    check(
      "identity_history_field_check",
      sql`${table.field} IN ('telegram_username','phone','link','status')`,
    ),
    check(
      "identity_history_source_check",
      sql`${table.source} IN ('customer_bot','driver_bot','partner_bot','recovery','admin','system')`,
    ),
  ],
);

/** identity_recovery_requests — account recovery requests. */
export const identityRecoveryRequests = pgTable(
  "identity_recovery_requests",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userInternalUuid: uuid("user_internal_uuid").notNull(),
    verificationMethod: text("verification_method").notNull(),
    status: text("status").notNull().default("verification_pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.userInternalUuid],
      foreignColumns: [identityUsers.internalUuid],
    }).onDelete("restrict"),
    check(
      "identity_recovery_requests_verification_method_check",
      sql`${table.verificationMethod} IN ('phone_otp','email_otp','admin_assisted')`,
    ),
    check(
      "identity_recovery_requests_status_check",
      sql`${table.status} IN ('verification_pending','completed','rejected')`,
    ),
  ],
);

/** identity_outbox — Domain Events outbox (published to Kafka later). */
export const identityOutbox = pgTable(
  "identity_outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventId: uuid("event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    eventVersion: text("event_version").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    payload: jsonb("payload").notNull().$type<IdentityEvent>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("ix_identity_outbox_unpublished").on(table.occurredAt),
  ],
);
