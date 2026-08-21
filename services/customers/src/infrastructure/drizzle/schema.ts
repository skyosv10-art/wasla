/**
 * Drizzle projection of the Customer Core data contract.
 *
 * Source of truth = `services/customers/contracts/schema.sql` (ADR-004 · ADR-009).
 * Nothing here creates a table: the canonical DDL does that. This module exists
 * so queries are type-checked against the real column names, and it is kept
 * honest by `src/__tests__/schema-drift.test.ts`, which parses the DDL and
 * compares table and column sets. A projection that silently falls behind its
 * contract is the classic failure of this pattern — queries keep compiling and
 * then read the wrong column at runtime.
 *
 * Two invariants are visible in what is *absent* (ADR-009 §2 · §7):
 *  - `wasla_public_id` has no foreign key to identity: another service, another
 *    database, and a customer profile must not depend on identity's storage.
 *  - `zone_id` has no foreign key to geography: existence and activity are
 *    checked through `GeographyPort`, not by a database constraint.
 * The only foreign key in the contract is stops → order request, because a stop
 * has no meaning without its request and must die with it.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// 1) customer_profiles — the role profile
// ---------------------------------------------------------------------------

export const customerProfiles = pgTable(
  "customer_profiles",
  {
    waslaPublicId: text("wasla_public_id").primaryKey(),
    displayName: text("display_name"),
    preferredLocale: text("preferred_locale").notNull().default("ar"),
    defaultZoneId: uuid("default_zone_id"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check(
      "customer_profiles_wasla_public_id_check",
      sql`${table.waslaPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "customer_profiles_preferred_locale_check",
      sql`${table.preferredLocale} IN ('ar','en','ur')`,
    ),
    check(
      "customer_profiles_status_check",
      sql`${table.status} IN ('active','suspended')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 2) customer_saved_places — reusable shortcuts, unique label per customer
// ---------------------------------------------------------------------------

export const customerSavedPlaces = pgTable(
  "customer_saved_places",
  {
    id: uuid("id").primaryKey(),
    waslaPublicId: text("wasla_public_id").notNull(),
    label: text("label").notNull(),
    zoneId: uuid("zone_id").notNull(),
    addressText: text("address_text"),
    latitude: numeric("latitude", { precision: 8, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    idempotencyKey: text("idempotency_key").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check(
      "customer_saved_places_wasla_public_id_check",
      sql`${table.waslaPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    // Half a coordinate is worse than none: it would place a stop on the equator.
    check(
      "ck_customer_saved_places_coordinates_complete",
      sql`(${table.latitude} IS NULL) = (${table.longitude} IS NULL)`,
    ),
    // Case-insensitive: "Home" and "home" are one shortcut to a human.
    uniqueIndex("ux_customer_saved_places_label").on(
      table.waslaPublicId,
      sql`lower(${table.label})`,
    ),
    uniqueIndex("ux_customer_saved_places_idempotency").on(
      table.waslaPublicId,
      table.idempotencyKey,
    ),
    index("ix_customer_saved_places_owner").on(
      table.waslaPublicId,
      sql`${table.lastUsedAt} DESC NULLS LAST`,
      sql`${table.createdAt} DESC`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 3) customer_order_requests — the validated intent, not the order
// ---------------------------------------------------------------------------

export const customerOrderRequests = pgTable(
  "customer_order_requests",
  {
    id: uuid("id").primaryKey(),
    waslaPublicId: text("wasla_public_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    /** Handover status — **not** an order status (§15 belongs to Phase 06). */
    status: text("status").notNull(),
    orderType: text("order_type").notNull(),
    vehicleClass: text("vehicle_class").notNull(),
    priceMode: text("price_mode").notNull(),
    /** Integer minor units. Money is never a float. */
    offeredAmountMinor: bigint("offered_amount_minor", { mode: "number" }),
    currency: text("currency"),
    shipmentType: text("shipment_type"),
    shipmentDescription: text("shipment_description"),
    weightKg: numeric("weight_kg", { precision: 9, scale: 3 }),
    notes: text("notes"),
    /** Owned by the order engine; NULL until it accepts the handover. */
    orderPublicId: text("order_public_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    failureReasonCode: text("failure_reason_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check(
      "customer_order_requests_wasla_public_id_check",
      sql`${table.waslaPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "customer_order_requests_status_check",
      sql`${table.status} IN ('submitted','submission_failed')`,
    ),
    check(
      "customer_order_requests_order_type_check",
      sql`${table.orderType} IN ('ride','delivery')`,
    ),
    check(
      "customer_order_requests_vehicle_class_check",
      sql`${table.vehicleClass} IN ('sedan','suv','van','pickup','motorcycle','truck_small')`,
    ),
    check(
      "customer_order_requests_price_mode_check",
      sql`${table.priceMode} IN ('customer_offer','negotiable')`,
    ),
    // One price mode means one payload shape (ADR-009 §6).
    check(
      "ck_customer_order_requests_price_mode",
      sql`(${table.priceMode} = 'customer_offer' AND ${table.offeredAmountMinor} IS NOT NULL AND ${table.currency} IS NOT NULL) OR (${table.priceMode} = 'negotiable' AND ${table.offeredAmountMinor} IS NULL AND ${table.currency} IS NULL)`,
    ),
    // Shipment details belong to delivery: a ride carrying a shipment weight is
    // a broken model, not extra data.
    check(
      "ck_customer_order_requests_shipment_scope",
      sql`${table.orderType} = 'delivery' OR (${table.shipmentType} IS NULL AND ${table.shipmentDescription} IS NULL AND ${table.weightKg} IS NULL)`,
    ),
    // A successful handover carries its time, a failed one carries its reason.
    check(
      "ck_customer_order_requests_status_coherence",
      sql`(${table.status} = 'submitted' AND ${table.submittedAt} IS NOT NULL AND ${table.failureReasonCode} IS NULL) OR (${table.status} = 'submission_failed' AND ${table.failureReasonCode} IS NOT NULL)`,
    ),
    uniqueIndex("ux_customer_order_requests_idempotency").on(
      table.waslaPublicId,
      table.idempotencyKey,
    ),
    index("ix_customer_order_requests_owner").on(
      table.waslaPublicId,
      sql`${table.createdAt} DESC`,
    ),
    uniqueIndex("ux_customer_order_requests_order_public_id")
      .on(table.orderPublicId)
      .where(sql`${table.orderPublicId} IS NOT NULL`),
  ],
);

// ---------------------------------------------------------------------------
// 4) customer_order_request_stops — an ordered list, not two columns
// ---------------------------------------------------------------------------

export const customerOrderRequestStops = pgTable(
  "customer_order_request_stops",
  {
    orderRequestId: uuid("order_request_id").notNull(),
    /** Position in the ordered list — what makes Multi-stop a policy change. */
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull(),
    zoneId: uuid("zone_id").notNull(),
    label: text("label"),
    latitude: numeric("latitude", { precision: 8, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    source: text("source").notNull(),
    /** No FK on purpose: deleting a place must not invalidate a past request. */
    savedPlaceId: uuid("saved_place_id"),
  },
  (table) => [
    check("customer_order_request_stops_sequence_check", sql`${table.sequence} >= 1`),
    check(
      "customer_order_request_stops_kind_check",
      sql`${table.kind} IN ('pickup','dropoff')`,
    ),
    check(
      "customer_order_request_stops_source_check",
      sql`${table.source} IN ('map','telegram_location','link','text_search','saved_place','manual_zone')`,
    ),
    check(
      "ck_customer_order_request_stops_coordinates_complete",
      sql`(${table.latitude} IS NULL) = (${table.longitude} IS NULL)`,
    ),
    primaryKey({ columns: [table.orderRequestId, table.sequence] }),
    foreignKey({
      columns: [table.orderRequestId],
      foreignColumns: [customerOrderRequests.id],
    }).onDelete("cascade"),
    index("ix_customer_order_request_stops_zone").on(table.zoneId),
  ],
);

// ---------------------------------------------------------------------------
// 5) customer_outbox — domain events, written in the same transaction
// ---------------------------------------------------------------------------

export const customerOutbox = pgTable(
  "customer_outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventId: uuid("event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    eventVersion: text("event_version").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "customer_outbox_aggregate_type_check",
      sql`${table.aggregateType} IN ('customer','customer_order_request')`,
    ),
    index("ix_customer_outbox_unpublished")
      .on(table.occurredAt)
      .where(sql`${table.publishedAt} IS NULL`),
  ],
);
