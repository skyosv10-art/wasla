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
  unique,
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
    agreedAmountMinor: bigint("agreed_amount_minor", { mode: "number" }),
    agreedCurrency: text("agreed_currency"),
    agreedAt: timestamp("agreed_at", { withTimezone: true }),
    agreedNegotiationId: uuid("agreed_negotiation_id"),
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
    // ── قيودُ CHECK العموديّةُ (أسماءُ PG الافتراضيّةُ المطابقةُ للعقدِ) ──
    check(
      "orders_order_public_id_check",
      sql`${table.orderPublicId} ~ '^ORD-[0-9]{10}$'`,
    ),
    check(
      "orders_customer_public_id_check",
      sql`${table.customerPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "orders_order_type_check",
      sql`${table.orderType} IN ('ride','delivery')`,
    ),
    check(
      "orders_vehicle_class_check",
      sql`${table.vehicleClass} IN ('sedan','suv','van','pickup','motorcycle','truck_small')`,
    ),
    check(
      "orders_status_check",
      sql`${table.status} IN ('published','searching','offered','negotiating','accepted','assigned','driver_en_route','arrived','in_progress','completed','driver_rejected','driver_timeout','expired','no_driver_found','customer_cancelled','driver_cancelled','partner_cancelled','blocked','failed','payment_disputed','under_review')`,
    ),
    check(
      "orders_status_reason_code_check",
      sql`${table.statusReasonCode} IS NULL OR char_length(${table.statusReasonCode}) BETWEEN 3 AND 64`,
    ),
    check(
      "orders_price_mode_check",
      sql`${table.priceMode} IN ('customer_offer','negotiable')`,
    ),
    check(
      "orders_offered_amount_minor_check",
      sql`${table.offeredAmountMinor} IS NULL OR ${table.offeredAmountMinor} > 0`,
    ),
    check(
      "orders_offered_currency_check",
      sql`${table.offeredCurrency} IS NULL OR ${table.offeredCurrency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "orders_agreed_amount_minor_check",
      sql`${table.agreedAmountMinor} IS NULL OR ${table.agreedAmountMinor} > 0`,
    ),
    check(
      "orders_agreed_currency_check",
      sql`${table.agreedCurrency} IS NULL OR ${table.agreedCurrency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "orders_shipment_description_check",
      sql`${table.shipmentDescription} IS NULL OR char_length(${table.shipmentDescription}) <= 300`,
    ),
    check(
      "orders_shipment_type_check",
      sql`${table.shipmentType} IS NULL OR ${table.shipmentType} IN ('parcel','documents','food','goods','other')`,
    ),
    check(
      "orders_shipment_weight_kg_check",
      sql`${table.shipmentWeightKg} IS NULL OR (${table.shipmentWeightKg} >= 0 AND ${table.shipmentWeightKg} <= 3000)`,
    ),
    check(
      "orders_notes_check",
      sql`${table.notes} IS NULL OR char_length(${table.notes}) <= 300`,
    ),
    check(
      "orders_idempotency_key_check",
      sql`char_length(${table.idempotencyKey}) BETWEEN 8 AND 128`,
    ),
    check(
      "orders_payload_fingerprint_check",
      sql`char_length(${table.payloadFingerprint}) = 64`,
    ),
    // ── قيودُ CHECK الجدوليّةُ (متطابقةٌ بالاسمِ مع العقدِ) ──
    check(
      "ck_orders_price_mode_amount",
      sql`(${table.priceMode} = 'customer_offer' AND ${table.offeredAmountMinor} IS NOT NULL AND ${table.offeredCurrency} IS NOT NULL) OR (${table.priceMode} = 'negotiable' AND ${table.offeredAmountMinor} IS NULL AND ${table.offeredCurrency} IS NULL)`,
    ),
    check(
      "ck_orders_money_complete",
      sql`(${table.offeredAmountMinor} IS NULL) = (${table.offeredCurrency} IS NULL)`,
    ),
    check(
      "ck_orders_agreed_price_complete",
      sql`(${table.agreedAmountMinor} IS NULL) = (${table.agreedCurrency} IS NULL) AND (${table.agreedAmountMinor} IS NULL) = (${table.agreedAt} IS NULL) AND (${table.agreedAmountMinor} IS NULL) = (${table.agreedNegotiationId} IS NULL)`,
    ),
    check(
      "ck_orders_agreed_price_only_negotiable",
      sql`${table.agreedAmountMinor} IS NULL OR ${table.priceMode} = 'negotiable'`,
    ),
    check(
      "ck_orders_shipment_only_delivery",
      sql`${table.orderType} = 'delivery' OR (${table.shipmentDescription} IS NULL AND ${table.shipmentType} IS NULL AND ${table.shipmentWeightKg} IS NULL)`,
    ),
    check(
      "ck_orders_terminal_needs_reason",
      sql`${table.status} NOT IN ('expired','no_driver_found','customer_cancelled','driver_cancelled','partner_cancelled','blocked','failed') OR ${table.statusReasonCode} IS NOT NULL`,
    ),
    check(
      "ck_orders_assignment_matches_status",
      sql`(${table.status} IN ('accepted','assigned','driver_en_route','arrived','in_progress','completed') AND ${table.activeAssignmentId} IS NOT NULL) OR (${table.status} IN ('published','searching','offered','negotiating') AND ${table.activeAssignmentId} IS NULL) OR ${table.status} IN ('driver_rejected','driver_timeout','expired','no_driver_found','customer_cancelled','driver_cancelled','partner_cancelled','blocked','failed','payment_disputed','under_review')`,
    ),
    // ── قيودُ UNIQUE (لا فهارسُ فريدةٌ) — inline UNIQUE في العقدِ ──
    unique("orders_order_public_id_key").on(table.orderPublicId),
    unique("orders_order_request_id_key").on(table.orderRequestId),
    // ── فهارسُ فريدةٌ (CREATE UNIQUE INDEX في العقدِ) ──
    uniqueIndex("ux_orders_idempotency_key").on(table.idempotencyKey),
    uniqueIndex("ux_orders_agreed_negotiation")
      .on(table.agreedNegotiationId)
      .where(sql`${table.agreedNegotiationId} IS NOT NULL`),
    // ── فهارسُ عاديّةٌ (DESC بلا NULLS LAST — raw SQL يطابقُ العقدَ) ──
    index("ix_orders_customer").on(table.customerPublicId, sql`${table.createdAt} DESC`),
    index("ix_orders_status").on(table.status, sql`${table.createdAt} DESC`),
    // fk_orders_active_assignment يُضافُ في قسمِ الإلحاقِ المُراجَعِ (ALTER TABLE)
    // كمرجعٍ متبادلٍ مع order_assignments — مطابقاً للعقدِ (خارجَ نطاقِ التوليدِ الآليِّ).
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
    check("order_stops_sequence_check", sql`${table.sequence} >= 0`),
    check(
      "order_stops_kind_check",
      sql`${table.kind} IN ('pickup','dropoff')`,
    ),
    check(
      "order_stops_label_check",
      sql`${table.label} IS NULL OR char_length(${table.label}) <= 60`,
    ),
    check(
      "order_stops_source_check",
      sql`${table.source} IN ('map','telegram_location','link','text_search','saved_place','manual_zone')`,
    ),
    check(
      "order_stops_latitude_check",
      sql`${table.latitude} IS NULL OR ${table.latitude} BETWEEN -90 AND 90`,
    ),
    check(
      "order_stops_longitude_check",
      sql`${table.longitude} IS NULL OR ${table.longitude} BETWEEN -180 AND 180`,
    ),
    check(
      "ck_order_stops_coordinates_complete",
      sql`(${table.latitude} IS NULL) = (${table.longitude} IS NULL)`,
    ),
    unique("ux_order_stops_order_sequence").on(table.orderId, table.sequence),
    foreignKey({
      name: "order_stops_order_id_fkey",
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
    check("order_status_history_sequence_check", sql`${table.sequence} >= 1`),
    check(
      "order_status_history_reason_code_check",
      sql`${table.reasonCode} IS NULL OR char_length(${table.reasonCode}) BETWEEN 3 AND 64`,
    ),
    check(
      "order_status_history_actor_type_check",
      sql`${table.actorType} IN ('system','customer','driver','partner','admin')`,
    ),
    check(
      "order_status_history_actor_ref_check",
      sql`${table.actorRef} IS NULL OR ${table.actorRef} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "order_status_history_trace_id_check",
      sql`${table.traceId} IS NULL OR char_length(${table.traceId}) <= 128`,
    ),
    check(
      "ck_order_status_history_progresses",
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} <> ${table.toStatus}`,
    ),
    check(
      "ck_order_status_history_actor_ref",
      sql`(${table.actorType} = 'system' AND ${table.actorRef} IS NULL) OR (${table.actorType} <> 'system' AND ${table.actorRef} IS NOT NULL)`,
    ),
    unique("ux_order_status_history_order_sequence").on(
      table.orderId,
      table.sequence,
    ),
    foreignKey({
      name: "order_status_history_order_id_fkey",
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
      "order_assignments_driver_public_id_check",
      sql`${table.driverPublicId} ~ '^WS-[0-9]{10}$'`,
    ),
    check("order_assignments_sequence_check", sql`${table.sequence} >= 1`),
    check(
      "order_assignments_assignment_state_check",
      sql`${table.assignmentState} IN ('offered','accepted','rejected','expired','cancelled')`,
    ),
    check(
      "order_assignments_reason_code_check",
      sql`${table.reasonCode} IS NULL OR char_length(${table.reasonCode}) BETWEEN 3 AND 64`,
    ),
    check(
      "ck_order_assignments_state_timestamp",
      sql`(${table.assignmentState} = 'offered' AND ${table.acceptedAt} IS NULL AND ${table.rejectedAt} IS NULL AND ${table.expiredAt} IS NULL AND ${table.cancelledAt} IS NULL) OR (${table.assignmentState} = 'accepted' AND ${table.acceptedAt} IS NOT NULL) OR (${table.assignmentState} = 'rejected' AND ${table.rejectedAt} IS NOT NULL) OR (${table.assignmentState} = 'expired' AND ${table.expiredAt} IS NOT NULL) OR (${table.assignmentState} = 'cancelled' AND ${table.cancelledAt} IS NOT NULL)`,
    ),
    unique("ux_order_assignments_order_sequence").on(
      table.orderId,
      table.sequence,
    ),
    unique("ux_order_assignments_order_driver").on(
      table.orderId,
      table.driverPublicId,
    ),
    foreignKey({
      name: "order_assignments_order_id_fkey",
      columns: [table.orderId],
      foreignColumns: [orders.id],
    }).onDelete("cascade"),
    index("ix_order_assignments_order").on(table.orderId, table.sequence),
    index("ix_order_assignments_driver").on(table.driverPublicId, sql`${table.offeredAt} DESC`),
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
      "order_outbox_event_version_check",
      sql`${table.eventVersion} ~ '^v[0-9]+$'`,
    ),
    check(
      "order_outbox_aggregate_type_check",
      sql`${table.aggregateType} IN ('order','order_assignment')`,
    ),
    check(
      "order_outbox_trace_id_check",
      sql`${table.traceId} IS NULL OR char_length(${table.traceId}) <= 128`,
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
