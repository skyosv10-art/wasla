/**
 * Drizzle schema for the Geography service — mirrors the canonical data
 * contract (services/geography/contracts/schema.sql) so queries are type-safe.
 *
 * Source of truth = schema.sql (ADR-004/006). This Drizzle schema is the
 * type-safe projection used by the Postgres repository adapter. Column types,
 * CHECK constraints, UNIQUE constraints and FKs match schema.sql.
 *
 * Key invariant (ADR-006): geo_user_locations.wasla_public_id is an opaque
 * reference with NO FK to identity_users — service decoupling.
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  bigserial,
  timestamp,
  jsonb,
  check,
  uniqueIndex,
  index,
  foreignKey,
  primaryKey,
} from "drizzle-orm/pg-core";

import type { GeographyEvent } from "@wasla/contracts-geography";

// ---------------------------------------------------------------------------
// Hierarchy (Country → Region → City → District → Zone)
// ---------------------------------------------------------------------------

export const geoCountries = pgTable(
  "geo_countries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    code: text("code").notNull(),
    iso3: text("iso3").notNull(),
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
      "geo_countries_status_check",
      sql`${table.status} IN ('active','inactive')`,
    ),
  ],
);

export const geoRegions = pgTable(
  "geo_regions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    countryId: uuid("country_id").notNull(),
    code: text("code").notNull(),
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
    check("geo_regions_status_check", sql`${table.status} IN ('active','inactive')`),
    uniqueIndex("uq_geo_regions_country_code").on(table.countryId, table.code),
    foreignKey({ columns: [table.countryId], foreignColumns: [geoCountries.id] }).onDelete("restrict"),
  ],
);

export const geoCities = pgTable(
  "geo_cities",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    regionId: uuid("region_id").notNull(),
    code: text("code").notNull(),
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
    check("geo_cities_status_check", sql`${table.status} IN ('active','inactive')`),
    uniqueIndex("uq_geo_cities_region_code").on(table.regionId, table.code),
    foreignKey({ columns: [table.regionId], foreignColumns: [geoRegions.id] }).onDelete("restrict"),
  ],
);

export const geoDistricts = pgTable(
  "geo_districts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    cityId: uuid("city_id").notNull(),
    code: text("code").notNull(),
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
    check("geo_districts_status_check", sql`${table.status} IN ('active','inactive')`),
    uniqueIndex("uq_geo_districts_city_code").on(table.cityId, table.code),
    foreignKey({ columns: [table.cityId], foreignColumns: [geoCities.id] }).onDelete("restrict"),
  ],
);

export const geoZones = pgTable(
  "geo_zones",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    districtId: uuid("district_id").notNull(),
    code: text("code").notNull(),
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
    check("geo_zones_status_check", sql`${table.status} IN ('active','inactive')`),
    uniqueIndex("uq_geo_zones_district_code").on(table.districtId, table.code),
    foreignKey({ columns: [table.districtId], foreignColumns: [geoDistricts.id] }).onDelete("restrict"),
  ],
);

// ---------------------------------------------------------------------------
// Localized names (one name per (entity, locale); ar = fallback)
// ---------------------------------------------------------------------------

export const geoCountryNames = pgTable(
  "geo_country_names",
  {
    countryId: uuid("country_id").notNull(),
    locale: text("locale").notNull(),
    name: text("name").notNull(),
  },
  (table) => [
    check("geo_country_names_locale_check", sql`${table.locale} IN ('ar','en','ur')`),
    primaryKey({ columns: [table.countryId, table.locale] }),
    foreignKey({ columns: [table.countryId], foreignColumns: [geoCountries.id] }).onDelete("cascade"),
  ],
);

export const geoRegionNames = pgTable(
  "geo_region_names",
  {
    regionId: uuid("region_id").notNull(),
    locale: text("locale").notNull(),
    name: text("name").notNull(),
  },
  (table) => [
    check("geo_region_names_locale_check", sql`${table.locale} IN ('ar','en','ur')`),
    primaryKey({ columns: [table.regionId, table.locale] }),
    foreignKey({ columns: [table.regionId], foreignColumns: [geoRegions.id] }).onDelete("cascade"),
  ],
);

export const geoCityNames = pgTable(
  "geo_city_names",
  {
    cityId: uuid("city_id").notNull(),
    locale: text("locale").notNull(),
    name: text("name").notNull(),
  },
  (table) => [
    check("geo_city_names_locale_check", sql`${table.locale} IN ('ar','en','ur')`),
    primaryKey({ columns: [table.cityId, table.locale] }),
    foreignKey({ columns: [table.cityId], foreignColumns: [geoCities.id] }).onDelete("cascade"),
  ],
);

export const geoDistrictNames = pgTable(
  "geo_district_names",
  {
    districtId: uuid("district_id").notNull(),
    locale: text("locale").notNull(),
    name: text("name").notNull(),
  },
  (table) => [
    check("geo_district_names_locale_check", sql`${table.locale} IN ('ar','en','ur')`),
    primaryKey({ columns: [table.districtId, table.locale] }),
    foreignKey({ columns: [table.districtId], foreignColumns: [geoDistricts.id] }).onDelete("cascade"),
  ],
);

export const geoZoneNames = pgTable(
  "geo_zone_names",
  {
    zoneId: uuid("zone_id").notNull(),
    locale: text("locale").notNull(),
    name: text("name").notNull(),
  },
  (table) => [
    check("geo_zone_names_locale_check", sql`${table.locale} IN ('ar','en','ur')`),
    primaryKey({ columns: [table.zoneId, table.locale] }),
    foreignKey({ columns: [table.zoneId], foreignColumns: [geoZones.id] }).onDelete("cascade"),
  ],
);

// ---------------------------------------------------------------------------
// User location (opaque wasla_public_id reference — NO FK to identity)
// ---------------------------------------------------------------------------

export const geoUserLocations = pgTable(
  "geo_user_locations",
  {
    waslaPublicId: text("wasla_public_id").primaryKey(),
    zoneId: uuid("zone_id").notNull(),
    source: text("source").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check(
      "geo_user_locations_wasla_public_id_check",
      sql`${table.waslaPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "geo_user_locations_source_check",
      sql`${table.source} IN ('customer_bot','driver_bot','partner_bot','admin','system')`,
    ),
    index("ix_geo_user_locations_zone").on(table.zoneId),
    foreignKey({ columns: [table.zoneId], foreignColumns: [geoZones.id] }).onDelete("restrict"),
  ],
);

export const geoUserLocationHistory = pgTable(
  "geo_user_location_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    waslaPublicId: text("wasla_public_id").notNull(),
    oldZoneId: uuid("old_zone_id"),
    newZoneId: uuid("new_zone_id").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().default(sql`now()`),
    source: text("source").notNull(),
  },
  (table) => [
    check(
      "geo_user_location_history_wasla_public_id_check",
      sql`${table.waslaPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "geo_user_location_history_source_check",
      sql`${table.source} IN ('customer_bot','driver_bot','partner_bot','admin','system')`,
    ),
    index("ix_geo_user_location_history_user").on(table.waslaPublicId, table.changedAt),
    foreignKey({ columns: [table.newZoneId], foreignColumns: [geoZones.id] }).onDelete("restrict"),
  ],
);

// ---------------------------------------------------------------------------
// Outbox (Domain Events)
// ---------------------------------------------------------------------------

export const geoOutbox = pgTable(
  "geo_outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventId: uuid("event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    eventVersion: text("event_version").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().default(sql`now()`),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    index("ix_geo_outbox_unpublished").on(table.occurredAt),
  ],
);

// Re-export the event type so the repository can reference it.
export type { GeographyEvent };
