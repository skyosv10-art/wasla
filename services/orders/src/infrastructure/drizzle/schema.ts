/**
 * Drizzle projection of the Order Engine data contract.
 *
 * Source of truth = `services/orders/contracts/schema.sql` (ADR-010). Nothing
 * here creates a table: the canonical DDL does that. This module exists so queries
 * are type-checked against the real column names, and it is kept honest by
 * `src/__tests__/schema-drift.test.ts`, which parses the DDL and compares table and
 * column sets. A projection that silently falls behind its contract is the classic
 * failure of this pattern — queries keep compiling and then read the wrong column
 * at runtime.
 *
 * Four boundary invariants are visible in what is *absent* (ADR-010 §1 · §4):
 *  - `customer_public_id` has no foreign key to customers: another service, another
 *    database, and the order must not depend on customers' storage.
 *  - `zone_id` has no foreign key to geography: existence is checked through the
 *    GeographyPort, not by a database constraint.
 *  - `driver_public_id` has no foreign key to identity: the engine never inspects a
 *    driver (Phase 05 not started). It is an opaque CHECK-shaped reference.
 *  - `order_public_id` is minted from `order_public_id_seq`, never random.
 * The only foreign keys are stops/history/assignments → orders (and
 * orders.active_assignment_id → order_assignments), because a row that names an
 * order has no meaning without it.
 *
 * Money is integer minor units (`bigint`), never a float. Coordinates are NUMERIC.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSequence,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// --------------------------------------------------------------------------- //
// 0) order_public_id_seq — the only source of order public ids                //
// --------------------------------------------------------------------------- //

export const orderPublicIdSeq = pgSequence("order_public_id_seq", {
  startWith: 1,
  increment: 1,
});

// --------------------------------------------------------------------------- //
// 1) orders — the order record                                              //
// --------------------------------------------------------------------------- //

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey(),
    orderPublicId: text("order_public_id").notNull(),
    orderRequestId: uuid("order_request_id").notNull(),
    customerPublicId: text("customer_public_id").notNull(),
    orderType: text("order_type").notNull(),
    vehicleClass: text("vehicle_class").notNull(),
    status: text("status").notNull().default("published"),
    statusReasonCode: text("status_reason_code"),
    priceMode: text("price_mode").notNull(),
    offeredAmountMinor: bigint("offered_amount_minor", { mode: "number" }),
    offeredCurrency: text("offered_currency"),
    shipmentDescription: text("shipment_description"),
    shipmentType: text("shipment_type"),
    shipmentWeightKg: numeric("shipment_weight_kg", { precision: 7, scale: 2 }),
    notes: text("notes"),
    activeAssignmentId: uuid("active_assignment_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadFingerprint: text("payload_fingerprint").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check(
      "ck_orders_public_id_shape",
      sql`${table.orderPublicId} ~ '^ORD-[0-9]{10}$'`,
    ),
    check(
      "ck_orders_customer_public_id_shape",
      sql`${table.customerPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "ck_orders_order_type_domain",
      sql`${table.orderType} IN ('ride','delivery')`,
    ),
    check(
      "ck_orders_vehicle_class_domain",
      sql`${table.vehicleClass} IN ('sedan','suv','van','pickup','motorcycle','truck_small')`,
    ),
    check(
      "ck_orders_status_domain",
      sql`${table.status} IN ('published','searching','offered','negotiating','accepted','assigned','driver_en_route','arrived','in_progress','completed','driver_rejected','driver_timeout','expired','no_driver_found','customer_cancelled','driver_cancelled','partner_cancelled','blocked','failed','payment_disputed','under_review')`,
    ),
    check(
      "ck_orders_price_mode_domain",
      sql`${table.priceMode} IN ('customer_offer','negotiable')`,
    ),
    check(
      "ck_orders_price_mode_amount",
      sql`(${table.priceMode} = 'customer_offer' AND ${table.offeredAmountMinor} IS NOT NULL AND ${table.offeredCurrency} IS NOT NULL) OR (${table.priceMode} = 'negotiable' AND ${table.offeredAmountMinor} IS NULL AND ${table.offeredCurrency} IS NULL)`,
    ),
    check(
      "ck_orders_money_complete",
      sql`(${table.offeredAmountMinor} IS NULL) = (${table.offeredCurrency} IS NULL)`,
    ),
    check(
      "ck_orders_shipment_only_delivery",
      sql`${table.orderType} = 'delivery' OR (${table.shipmentDescription} IS NULL AND ${table.shipmentType} IS NULL AND ${table.shipmentWeightKg} IS NULL)`,
    ),
    check(
      "ck_orders_assignment_matches_status",
      sql`(${table.status} IN ('accepted','assigned','driver_en_route','arrived','in_progress','completed') AND ${table.activeAssignmentId} IS NOT NULL) OR (${table.status} IN ('published','searching','offered','negotiating') AND ${table.activeAssignmentId} IS NULL) OR ${table.status} IN ('driver_rejected','driver_timeout','expired','no_driver_found','customer_cancelled','driver_cancelled','partner_cancelled','blocked','failed','payment_disputed','under_review')`,
    ),
    uniqueIndex("ux_orders_public_id").on(table.orderPublicId),
    uniqueIndex("ux_orders_idempotency_key").on(table.idempotencyKey),
    uniqueIndex("ux_orders_request_id").on(table.orderRequestId),
    index("ix_orders_customer").on(table.customerPublicId, table.createdAt),
    index("ix_orders_status").on(table.status, table.createdAt),
    // fk_orders_active_assignment is added by the canonical DDL via ALTER TABLE
    // (mutual dependency with order_assignments). Drizzle mirrors the same
    // ordering: the FK is enforced at the SQL level, not in this projection.
  ],
);

// --------------------------------------------------------------------------- //
// 2) order_stops — an ordered list, not two columns                         //
// --------------------------------------------------------------------------- //

export const orderStops = pgTable(
  "order_stops",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id").notNull(),
    sequence: smallint("sequence").notNull(),
    kind: text("kind").notNull(),
    zoneId: uuid("zone_id").notNull(),
    label: text("label"),
    source: text("source").notNull(),
    latitude: numeric("latitude", { precision: 8, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check("ck_order_stops_sequence_positive", sql`${table.sequence} >= 0`),
    check(
      "ck_order_stops_kind_domain",
      sql`${table.kind} IN ('pickup','dropoff')`,
    ),
    check(
      "ck_order_stops_source_domain",
      sql`${table.source} IN ('map','telegram_location','link','text_search','saved_place','manual_zone')`,
    ),
    check(
      "ck_order_stops_coordinates_complete",
      sql`(${table.latitude} IS NULL) = (${table.longitude} IS NULL)`,
    ),
    uniqueIndex("ux_order_stops_order_sequence").on(table.orderId, table.sequence),
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [orders.id],
    }).onDelete("cascade"),
    index("ix_order_stops_order").on(table.orderId, table.sequence),
    index("ix_order_stops_zone").on(table.zoneId),
  ],
);

// --------------------------------------------------------------------------- //
// 3) order_status_history — the append-only audit trail                     //
// --------------------------------------------------------------------------- //

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id").notNull(),
    sequence: integer("sequence").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reasonCode: text("reason_code"),
    actorType: text("actor_type").notNull(),
    actorRef: text("actor_ref"),
    traceId: text("trace_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check("ck_order_status_history_sequence_positive", sql`${table.sequence} >= 1`),
    check(
      "ck_order_status_history_actor_type_domain",
      sql`${table.actorType} IN ('system','customer','driver','partner','admin')`,
    ),
    check(
      "ck_order_status_history_progresses",
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} <> ${table.toStatus}`,
    ),
    check(
      "ck_order_status_history_actor_ref",
      sql`(${table.actorType} = 'system' AND ${table.actorRef} IS NULL) OR (${table.actorType} <> 'system' AND ${table.actorRef} IS NOT NULL)`,
    ),
    uniqueIndex("ux_order_status_history_order_sequence").on(
      table.orderId,
      table.sequence,
    ),
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [orders.id],
    }).onDelete("cascade"),
    index("ix_order_status_history_order").on(table.orderId, table.sequence),
  ],
);

// --------------------------------------------------------------------------- //
// 4) order_assignments — offer records, one per driver per round             //
// --------------------------------------------------------------------------- //

export const orderAssignments = pgTable(
  "order_assignments",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id").notNull(),
    driverPublicId: text("driver_public_id").notNull(),
    sequence: smallint("sequence").notNull(),
    assignmentState: text("assignment_state").notNull().default("offered"),
    offeredAt: timestamp("offered_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    reasonCode: text("reason_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check(
      "ck_order_assignments_driver_public_id_shape",
      sql`${table.driverPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check("ck_order_assignments_sequence_positive", sql`${table.sequence} >= 1`),
    check(
      "ck_order_assignments_state_domain",
      sql`${table.assignmentState} IN ('offered','accepted','rejected','expired','cancelled')`,
    ),
    check(
      "ck_order_assignments_state_timestamp",
      sql`(${table.assignmentState} = 'offered' AND ${table.acceptedAt} IS NULL AND ${table.rejectedAt} IS NULL AND ${table.expiredAt} IS NULL AND ${table.cancelledAt} IS NULL) OR (${table.assignmentState} = 'accepted' AND ${table.acceptedAt} IS NOT NULL) OR (${table.assignmentState} = 'rejected' AND ${table.rejectedAt} IS NOT NULL) OR (${table.assignmentState} = 'expired' AND ${table.expiredAt} IS NOT NULL) OR (${table.assignmentState} = 'cancelled' AND ${table.cancelledAt} IS NOT NULL)`,
    ),
    uniqueIndex("ux_order_assignments_order_sequence").on(
      table.orderId,
      table.sequence,
    ),
    uniqueIndex("ux_order_assignments_order_driver").on(
      table.orderId,
      table.driverPublicId,
    ),
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [orders.id],
    }).onDelete("cascade"),
    index("ix_order_assignments_order").on(table.orderId, table.sequence),
    index("ix_order_assignments_driver").on(table.driverPublicId, table.offeredAt),
  ],
);

// --------------------------------------------------------------------------- //
// 5) order_outbox — domain events, written in the same transaction           //
// --------------------------------------------------------------------------- //

export const orderOutbox = pgTable(
  "order_outbox",
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
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "ck_order_outbox_aggregate_type_domain",
      sql`${table.aggregateType} IN ('order','order_assignment')`,
    ),
    index("ix_order_outbox_unpublished")
      .on(table.occurredAt)
      .where(sql`${table.publishedAt} IS NULL`),
    index("ix_order_outbox_aggregate").on(
      table.aggregateType,
      table.aggregateId,
      table.occurredAt,
    ),
  ],
);
