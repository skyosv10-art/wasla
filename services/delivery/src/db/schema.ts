/**
 * مرآةُ Drizzle لعقدِ PostgreSQL في خدمةِ التوصيلِ — **الجداولُ الثلاثةَ عشرَ كلُّها**،
 * بأسمائِها وأنواعِها وإلزامِها وقيودِها وفهارسِها، ومعها المتتالُ المستقلُّ
 * (`store_order_public_id_seq`).
 *
 * ## هذا الملفُّ مرآةٌ لا مصدر
 *
 * الحقيقةُ في `services/delivery/contracts/schema.sql`، وهو نفسُهُ ما يُطبَّقُ على القاعدةِ
 * (`applyDeliverySchema` في `migrate.ts`). ولا يُنشئُ هذا الملفُّ جدولاً في أيِّ مسارِ تشغيلٍ؛
 * وظيفتُهُ اثنتانِ لا ثالثةَ لهما:
 *
 *   1. **إسقاطٌ آمنٌ أنواعِيّاً** يُتيحُ `drizzle-kit generate` فيُنتجَ ترحيلاً عكوساً
 *      مُرقَّماً (ADR-024) بدلَ «طبِّقِ العقدَ كاملاً أو لا شيءَ».
 *   2. **حارسُ انحرافٍ بلا قاعدةٍ**: `__tests__/schema-drift.test.ts` يُقابلُ هذه المرآةَ
 *      بنصِّ العقدِ في الاتّجاهَينِ، فيفشلُ البناءُ لا النشرُ.
 *
 * ولو صارَ توليدُ Drizzle هو ما يُطبَّقُ لصارَ للمخطَّطِ مصدرانِ، ولاختلفا أوّلَ مرّةٍ يُضافُ
 * قيدٌ في أحدِهما بلا أن يفشلَ شيءٌ. ولذلك يبقى العقدُ هو المُطبَّقُ، ويُقاسُ **تكافؤُ**
 * الترحيلِ المولَّدِ معَهُ في سبعةِ أبعادِ كتالوجٍ في `__tests__/migrations.integration.test.ts`
 * (سابقةُ `services/marketplace`).
 *
 * ## والقيودُ المضمَّنةُ مُعلَنةٌ هنا بأسمائِها **المقيسةِ** لا المُفترضةِ
 *
 * يكتبُ العقدُ عشراتِ الفحوصِ بلا أسماءٍ (`CHECK (state IN (…))` · `CHECK (sku ~ '…')`)،
 * وPostgreSQLُ يُسمّيها عندَ التطبيقِ. والقاعدةُ الشائعةُ `<table>_<column>_check` **ليست**
 * القاعدةَ الكاملةَ، وثلاثةُ مواضعَ في هذا العقدِ تكسرُها — وقد قِيسَت من كتالوجٍ حقيقيٍّ لا
 * افتُرِضَت:
 *
 *   - **فحصٌ يمسُّ أكثرَ من عمودٍ لا يحملُ اسمَ عمودٍ**: يُسمّيهِ PostgreSQLُ `<table>_check`،
 *     والثاني في الجدولِ نفسِهِ `<table>_check1`. ولذلك:
 *       · `store_orders_check`            (total = items + fee)
 *       · `store_order_items_check`       (line_total = quantity × unit_price)
 *       · `store_order_items_check1`      (delta IS NOT NULL OR substituted IS NULL)
 *       · `store_order_transitions_check` (to_state <> from_state)
 *       · `delivery_task_transitions_check` (to_state <> from_state)
 *   - **الاسمُ يُقصَّرُ إلى 63 حرفاً بقطعِ اسمِ الجدولِ لا اسمِ العمودِ**: فحصُ
 *     `marketplace_reservation_ref` صارَ
 *     `delivery_inventory_reservatio_marketplace_reservation_ref_check`.
 *
 * وترحيلٌ مولَّدٌ من مرآةٍ تُخطئُ هذه الأسماءَ يُنشئُ قيوداً صحيحةَ المعنى **خاطئةَ الاسمِ**،
 * فيتكافأُ المخطَّطُ في المعنى ويختلفُ في الكتالوجِ — وهو بالضبطِ ما يُسقِطُهُ اختبارُ الدورةِ.
 *
 * ## و`DEFERRABLE` لا يُعبَّرُ عنهُ في Drizzle — والفرقُ مُوثَّقٌ في الترحيلِ لا مُهمَلٌ
 *
 * قيدُ `UNIQUE (order_id, product_id)` في `delivery_inventory_reservations` مُؤجَّلُ الفحصِ
 * (`DEFERRABLE INITIALLY DEFERRED`) كي تمرَّ إعادةُ بناءِ حجوزاتِ طلبٍ في معاملةٍ واحدةٍ.
 * ولا تُعبِّرُ مرآةُ Drizzle عن التأجيلِ، فيولّدُ المولّدُ القيدَ فوريَّ الفحصِ. والفرقُ
 * يُرفَعُ **يداً** في ملفِّ الترحيلِ المولَّدِ (`drizzle/0000_*.sql`) بتعليقٍ صريحٍ فوقَه، ولا
 * يُمَسُّ الإسقاطُ (`drizzle/meta/*_snapshot.json`) كي لا يُنتِجَ `db:generate` التاليَ فرقاً
 * وهميّاً. والتكافؤُ في الكتالوجِ يقيسُهُ اختبارُ الدورةِ (`condeferrable` من
 * `pg_get_constraintdef`) فلا يبقى التأجيلُ ادّعاءً.
 */

import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/** عمودُ لحظةٍ بمنطقةٍ زمنيّةٍ — نفسُ اصطلاحِ مرآةِ السوقِ. */
const instant = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------
// المتتالُ المستقلُّ: مرجعُ الطلبِ العامُّ يُولَّدُ من القاعدةِ لا من التطبيقِ.
// البدايةُ عاليةٌ (5000000001) كي لا تتصادمَ مع مراجعِ البذورِ في الاختبارات.
// ---------------------------------------------------------------------------

export const storeOrderPublicIdSeq = pgSequence("store_order_public_id_seq", {
  startWith: "5000000001",
});

// ---------------------------------------------------------------------------
// 1) store_orders — مجموعةُ طلبِ المتجرِ (حالاتٌ ثلاثٌ متعامدة)
// ---------------------------------------------------------------------------

export const storeOrders = pgTable(
  "store_orders",
  {
    orderId: uuid("order_id").primaryKey(),
    publicId: text("public_id").notNull().unique("store_orders_public_id_key"),
    customerRef: text("customer_ref").notNull(),
    storeId: uuid("store_id").notNull(),
    storeSlug: text("store_slug").notNull(),
    fulfillmentState: text("fulfillment_state").notNull(),
    paymentState: text("payment_state").notNull(),
    paymentRef: text("payment_ref"),
    inventoryState: text("inventory_state").notNull().default("none"),
    inventoryRef: text("inventory_ref"),
    currencyCode: text("currency_code").notNull(),
    itemsTotalMinorUnits: integer("items_total_minor_units").notNull(),
    deliveryFeeMinorUnits: integer("delivery_fee_minor_units").notNull(),
    totalMinorUnits: integer("total_minor_units").notNull(),
    placedAt: instant("placed_at"),
    deliveredAt: instant("delivered_at"),
    cancelledAt: instant("cancelled_at"),
    version: integer("version").notNull().default(1),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("store_orders_public_id_check", sql`${table.publicId} ~ '^WS-[0-9]{10}$'`),
    check("store_orders_customer_ref_check", sql`${table.customerRef} ~ '^WS-[0-9]{10}$'`),
    check("store_orders_store_slug_check", sql`${table.storeSlug} ~ '^[a-z][a-z0-9-]{2,47}$'`),
    check(
      "store_orders_fulfillment_state_check",
      sql`${table.fulfillmentState} IN ('draft','placed','confirmed','picking','picked','ready_for_delivery','handed_to_courier','delivered','cancelled','rejected','failed')`,
    ),
    check(
      "store_orders_payment_state_check",
      sql`${table.paymentState} IN ('pending','authorized','captured','failed','refunding','partially_refunded','refunded')`,
    ),
    check(
      "store_orders_payment_ref_check",
      sql`${table.paymentRef} IS NULL OR char_length(${table.paymentRef}) BETWEEN 1 AND 128`,
    ),
    check(
      "store_orders_inventory_state_check",
      sql`${table.inventoryState} IN ('none','reserving','reserved','released','consumed')`,
    ),
    check(
      "store_orders_inventory_ref_check",
      sql`${table.inventoryRef} IS NULL OR char_length(${table.inventoryRef}) BETWEEN 1 AND 128`,
    ),
    check("store_orders_currency_code_check", sql`${table.currencyCode} = 'SAR'`),
    check("store_orders_items_total_minor_units_check", sql`${table.itemsTotalMinorUnits} >= 0`),
    check("store_orders_delivery_fee_minor_units_check", sql`${table.deliveryFeeMinorUnits} >= 0`),
    // فحصٌ يمسُّ ثلاثةَ أعمدةٍ ⇒ اسمٌ بلا عمودٍ (مقيسٌ من الكتالوج).
    check(
      "store_orders_check",
      sql`${table.totalMinorUnits} = ${table.itemsTotalMinorUnits} + ${table.deliveryFeeMinorUnits}`,
    ),
    check("store_orders_version_check", sql`${table.version} >= 1`),
    // `created_at DESC` بتعبيرٍ خامٍ لا بـ`.desc()`: المُولّدُ يكتبُ للثانيةِ
    // `DESC NULLS LAST`، وPostgreSQLُ يعني بـ`DESC` المجرّدةِ `NULLS FIRST` — فرقٌ حقيقيٌّ
    // في `indexdef` يُسقِطُ تكافؤَ الكتالوجِ بلا فرقٍ في المعنى هنا (العمودُ NOT NULL).
    index("ix_store_orders_customer").on(table.customerRef, sql`${table.createdAt} DESC`),
    index("ix_store_orders_store_active")
      .on(table.storeId, table.fulfillmentState)
      .where(
        sql`${table.fulfillmentState} IN ('placed','confirmed','picking','picked','ready_for_delivery')`,
      ),
  ],
);

// ---------------------------------------------------------------------------
// 2) store_order_items — أصنافُ الطلبِ (لقطاتٌ لا أرصدةَ)
// ---------------------------------------------------------------------------

export const storeOrderItems = pgTable(
  "store_order_items",
  {
    orderItemId: uuid("order_item_id").primaryKey(),
    orderId: uuid("order_id").notNull(),
    lineNo: integer("line_no").notNull(),
    productId: uuid("product_id").notNull(),
    sku: text("sku").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMinorUnits: integer("unit_price_minor_units").notNull(),
    lineTotalMinorUnits: integer("line_total_minor_units").notNull(),
    substitutedProductId: uuid("substituted_product_id"),
    substitutionReason: text("substitution_reason"),
    substitutionPriceDeltaMinorUnits: integer("substitution_price_delta_minor_units"),
  },
  (table) => [
    foreignKey({
      name: "store_order_items_order_id_fkey",
      columns: [table.orderId],
      foreignColumns: [storeOrders.orderId],
    }),
    unique("store_order_items_order_id_line_no_key").on(table.orderId, table.lineNo),
    check("store_order_items_line_no_check", sql`${table.lineNo} >= 1`),
    check("store_order_items_sku_check", sql`char_length(${table.sku}) BETWEEN 1 AND 64`),
    check("store_order_items_quantity_check", sql`${table.quantity} >= 1`),
    check("store_order_items_unit_price_minor_units_check", sql`${table.unitPriceMinorUnits} >= 0`),
    // فحصٌ يمسُّ ثلاثةَ أعمدةٍ ⇒ أوّلُ فحصٍ بلا عمودٍ في هذا الجدول.
    check(
      "store_order_items_check",
      sql`${table.lineTotalMinorUnits} = ${table.quantity} * ${table.unitPriceMinorUnits}`,
    ),
    check(
      "store_order_items_substitution_reason_check",
      sql`${table.substitutionReason} IS NULL OR ${table.substitutionReason} IN ('out_of_stock','customer_approved_alternative','store_policy')`,
    ),
    // وثانيهما ⇒ لاحقةٌ رقميّةٌ يضعُها PostgreSQLُ عندَ التصادمِ.
    check(
      "store_order_items_check1",
      sql`${table.substitutionPriceDeltaMinorUnits} IS NOT NULL OR ${table.substitutedProductId} IS NULL`,
    ),
    index("ix_store_order_items_order").on(table.orderId),
  ],
);

// ---------------------------------------------------------------------------
// 3) store_order_transitions — سجلُّ الانتقالاتِ (append-only)
// ---------------------------------------------------------------------------

export const storeOrderTransitions = pgTable(
  "store_order_transitions",
  {
    transitionId: bigserial("transition_id", { mode: "bigint" }).primaryKey(),
    orderId: uuid("order_id").notNull(),
    stateKind: text("state_kind").notNull(),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    reasonCode: text("reason_code").notNull(),
    actorType: text("actor_type").notNull(),
    actorRef: text("actor_ref"),
    traceId: text("trace_id"),
    occurredAt: instant("occurred_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "store_order_transitions_order_id_fkey",
      columns: [table.orderId],
      foreignColumns: [storeOrders.orderId],
    }),
    check(
      "store_order_transitions_state_kind_check",
      sql`${table.stateKind} IN ('fulfillment','payment','inventory')`,
    ),
    // to_state <> from_state ⇒ عمودانِ ⇒ اسمٌ بلا عمود.
    check("store_order_transitions_check", sql`${table.toState} <> ${table.fromState}`),
    check(
      "store_order_transitions_reason_code_check",
      sql`char_length(${table.reasonCode}) BETWEEN 3 AND 64`,
    ),
    check(
      "store_order_transitions_actor_type_check",
      sql`${table.actorType} IN ('system','customer','store','courier','admin')`,
    ),
    check(
      "store_order_transitions_actor_ref_check",
      sql`${table.actorRef} IS NULL OR ${table.actorRef} ~ '^WS-[0-9]{10}$'`,
    ),
    index("ix_store_order_transitions_order").on(table.orderId, table.occurredAt),
  ],
);

// ---------------------------------------------------------------------------
// 4) delivery_tasks — مهمّةُ التوصيلِ (مرآةٌ خشنةٌ لساقِ التوصيلِ)
// ---------------------------------------------------------------------------

export const deliveryTasks = pgTable(
  "delivery_tasks",
  {
    taskId: uuid("task_id").primaryKey(),
    orderId: uuid("order_id").notNull().unique("delivery_tasks_order_id_key"),
    state: text("state").notNull(),
    ineligibilityReason: text("ineligibility_reason"),
    dispatchJobRef: text("dispatch_job_ref"),
    dispatchLastOccurredAt: instant("dispatch_last_occurred_at"),
    dispatchLastEventId: uuid("dispatch_last_event_id"),
    courierRef: text("courier_ref"),
    proofType: text("proof_type"),
    proofRef: text("proof_ref"),
    assignedAt: instant("assigned_at"),
    deliveredAt: instant("delivered_at"),
    version: integer("version").notNull().default(1),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "delivery_tasks_order_id_fkey",
      columns: [table.orderId],
      foreignColumns: [storeOrders.orderId],
    }),
    check(
      "delivery_tasks_state_check",
      sql`${table.state} IN ('pending_eligibility','eligible','dispatch_requested','driver_assigned','timed_out','reassigned','exhausted','picked_up','in_transit','arrived','delivered','ineligible','failed','cancelled')`,
    ),
    check(
      "delivery_tasks_ineligibility_reason_check",
      sql`${table.ineligibilityReason} IS NULL OR ${table.ineligibilityReason} IN ('outside_coverage','store_not_orderable','no_courier_service')`,
    ),
    check(
      "delivery_tasks_dispatch_job_ref_check",
      sql`${table.dispatchJobRef} IS NULL OR char_length(${table.dispatchJobRef}) BETWEEN 1 AND 128`,
    ),
    check(
      "delivery_tasks_courier_ref_check",
      sql`${table.courierRef} IS NULL OR ${table.courierRef} ~ '^WS-[0-9]{10}$'`,
    ),
    check(
      "delivery_tasks_proof_type_check",
      sql`${table.proofType} IS NULL OR ${table.proofType} IN ('otp','photo','signature','pin_code')`,
    ),
    check(
      "delivery_tasks_proof_ref_check",
      sql`${table.proofRef} IS NULL OR char_length(${table.proofRef}) BETWEEN 1 AND 256`,
    ),
    check("delivery_tasks_version_check", sql`${table.version} >= 1`),
    // لا تسليمَ بلا إثباتٍ ولا إثباتَ قبلَ التسليمِ — القيدُ الوحيدُ المُسمّى في العقدِ.
    check(
      "ck_delivery_proof",
      sql`(${table.state} = 'delivered') = (${table.proofType} IS NOT NULL AND ${table.proofRef} IS NOT NULL)`,
    ),
    index("ix_delivery_tasks_active")
      .on(table.state)
      .where(
        sql`${table.state} IN ('eligible','dispatch_requested','driver_assigned','timed_out','reassigned','picked_up','in_transit','arrived')`,
      ),
  ],
);

// ---------------------------------------------------------------------------
// 5) delivery_task_transitions — سجلُّ انتقالاتِ المهمّةِ (append-only)
// ---------------------------------------------------------------------------

export const deliveryTaskTransitions = pgTable(
  "delivery_task_transitions",
  {
    transitionId: bigserial("transition_id", { mode: "bigint" }).primaryKey(),
    taskId: uuid("task_id").notNull(),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    reasonCode: text("reason_code").notNull(),
    actorType: text("actor_type").notNull(),
    actorRef: text("actor_ref"),
    traceId: text("trace_id"),
    occurredAt: instant("occurred_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "delivery_task_transitions_task_id_fkey",
      columns: [table.taskId],
      foreignColumns: [deliveryTasks.taskId],
    }),
    // to_state <> from_state ⇒ عمودانِ ⇒ اسمٌ بلا عمود.
    check("delivery_task_transitions_check", sql`${table.toState} <> ${table.fromState}`),
    check(
      "delivery_task_transitions_reason_code_check",
      sql`char_length(${table.reasonCode}) BETWEEN 3 AND 64`,
    ),
    check(
      "delivery_task_transitions_actor_type_check",
      sql`${table.actorType} IN ('system','customer','store','courier','admin','dispatch')`,
    ),
    check(
      "delivery_task_transitions_actor_ref_check",
      sql`${table.actorRef} IS NULL OR ${table.actorRef} ~ '^WS-[0-9]{10}$'`,
    ),
    index("ix_delivery_task_transitions_task").on(table.taskId, table.occurredAt),
  ],
);

// ---------------------------------------------------------------------------
// 6) delivery_outbox — صندوقُ الصادرِ
// ---------------------------------------------------------------------------

export const deliveryOutbox = pgTable(
  "delivery_outbox",
  {
    outboxId: bigserial("outbox_id", { mode: "bigint" }).primaryKey(),
    eventId: uuid("event_id").notNull().unique("delivery_outbox_event_id_key"),
    eventType: text("event_type").notNull(),
    eventVersion: text("event_version").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    payload: jsonb("payload").notNull(),
    traceId: text("trace_id"),
    occurredAt: instant("occurred_at").notNull().defaultNow(),
    createdAt: instant("created_at").notNull().defaultNow(),
    publishedAt: instant("published_at"),
  },
  (table) => [
    check("delivery_outbox_event_type_check", sql`char_length(${table.eventType}) BETWEEN 3 AND 96`),
    check("delivery_outbox_event_version_check", sql`${table.eventVersion} ~ '^v[0-9]+$'`),
    check(
      "delivery_outbox_aggregate_type_check",
      sql`${table.aggregateType} IN ('store_order','delivery_task')`,
    ),
    check(
      "delivery_outbox_aggregate_id_check",
      sql`char_length(${table.aggregateId}) BETWEEN 1 AND 64`,
    ),
    index("ix_delivery_outbox_unpublished")
      .on(table.outboxId)
      .where(sql`${table.publishedAt} IS NULL`),
  ],
);

// ---------------------------------------------------------------------------
// 7) delivery_relay_consumed_events — دفترُ استهلاكِ أحداثِ dispatch
// ---------------------------------------------------------------------------

export const deliveryRelayConsumedEvents = pgTable(
  "delivery_relay_consumed_events",
  {
    eventId: uuid("event_id").primaryKey(),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    consumedStatus: text("consumed_status").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    lastError: text("last_error"),
    consumedAt: instant("consumed_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check(
      "delivery_relay_consumed_events_event_type_check",
      sql`char_length(${table.eventType}) BETWEEN 3 AND 96`,
    ),
    check(
      "delivery_relay_consumed_events_aggregate_type_check",
      sql`${table.aggregateType} IN ('dispatch_job','dispatch_offer')`,
    ),
    check(
      "delivery_relay_consumed_events_aggregate_id_check",
      sql`char_length(${table.aggregateId}) BETWEEN 1 AND 64`,
    ),
    check(
      "delivery_relay_consumed_events_consumed_status_check",
      sql`${table.consumedStatus} IN ('pending','applied','skipped_stale','ignored','ignored_foreign','poisoned')`,
    ),
    check("delivery_relay_consumed_events_attempt_count_check", sql`${table.attemptCount} >= 1`),
  ],
);

// ---------------------------------------------------------------------------
// 8) delivery_relay_checkpoint — نقطةُ تقدّمِ مستهلكِ dispatch
// ---------------------------------------------------------------------------

export const deliveryRelayCheckpoint = pgTable(
  "delivery_relay_checkpoint",
  {
    consumerId: text("consumer_id").primaryKey(),
    lastOccurredAt: instant("last_occurred_at").notNull(),
    lastEventId: uuid("last_event_id").notNull(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check(
      "delivery_relay_checkpoint_consumer_id_check",
      sql`char_length(${table.consumerId}) BETWEEN 3 AND 96`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 9) delivery_inventory_observations — لقطاتُ مخزونٍ من السوقِ
// ---------------------------------------------------------------------------

export const deliveryInventoryObservations = pgTable(
  "delivery_inventory_observations",
  {
    storeId: uuid("store_id").notNull(),
    productId: uuid("product_id").notNull(),
    lastAdjustmentId: uuid("last_adjustment_id").notNull(),
    lastMarketplaceEventId: uuid("last_marketplace_event_id").notNull(),
    lastAdjustmentSequence: integer("last_adjustment_sequence").notNull(),
    observedQuantityAfter: integer("observed_quantity_after").notNull(),
    lastQuantityDelta: integer("last_quantity_delta").notNull(),
    lastReasonCode: text("last_reason_code").notNull(),
    occurredFor: instant("occurred_for").notNull(),
    observedAt: instant("observed_at").notNull().defaultNow(),
    traceId: text("trace_id"),
  },
  (table) => [
    primaryKey({
      name: "delivery_inventory_observations_pkey",
      columns: [table.storeId, table.productId],
    }),
  ],
);

// ---------------------------------------------------------------------------
// 10) delivery_inventory_relay_consumed_events — دفترُ استهلاكِ أحداثِ السوقِ
// ---------------------------------------------------------------------------

export const deliveryInventoryRelayConsumedEvents = pgTable(
  "delivery_inventory_relay_consumed_events",
  {
    eventId: uuid("event_id").primaryKey(),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    consumedStatus: text("consumed_status").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    lastError: text("last_error"),
    consumedAt: instant("consumed_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check(
      "delivery_inventory_relay_consumed_events_event_type_check",
      sql`char_length(${table.eventType}) BETWEEN 3 AND 96`,
    ),
    check(
      "delivery_inventory_relay_consumed_events_aggregate_type_check",
      sql`${table.aggregateType} IN ('store','product','inventory')`,
    ),
    check(
      "delivery_inventory_relay_consumed_events_aggregate_id_check",
      sql`char_length(${table.aggregateId}) BETWEEN 1 AND 64`,
    ),
    check(
      "delivery_inventory_relay_consumed_events_consumed_status_check",
      sql`${table.consumedStatus} IN ('pending','applied','skipped_stale','ignored','poisoned')`,
    ),
    check(
      "delivery_inventory_relay_consumed_events_attempt_count_check",
      sql`${table.attemptCount} >= 1`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 11) delivery_inventory_relay_checkpoint — نقطةُ تقدّمِ مستهلكِ المخزونِ
// ---------------------------------------------------------------------------

export const deliveryInventoryRelayCheckpoint = pgTable(
  "delivery_inventory_relay_checkpoint",
  {
    consumerId: text("consumer_id").primaryKey(),
    lastOccurredAt: instant("last_occurred_at").notNull(),
    lastEventId: uuid("last_event_id").notNull(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check(
      "delivery_inventory_relay_checkpoint_consumer_id_check",
      sql`char_length(${table.consumerId}) BETWEEN 3 AND 96`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 12) delivery_idempotency_keys — مفاتيحُ التماثُلِ للمساراتِ الكاتبةِ
// ---------------------------------------------------------------------------

export const deliveryIdempotencyKeys = pgTable(
  "delivery_idempotency_keys",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    route: text("route").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    responseStatus: smallint("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    orderId: uuid("order_id").notNull(),
    traceId: text("trace_id"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "delivery_idempotency_keys_order_id_fkey",
      columns: [table.orderId],
      foreignColumns: [storeOrders.orderId],
    }).onDelete("cascade"),
    check(
      "delivery_idempotency_keys_idempotency_key_check",
      sql`${table.idempotencyKey} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$'`,
    ),
    // القائمةُ مغلقةٌ وتُطابقُ `IDEMPOTENT_ROUTES` حرفاً (يحرسُهُ `idempotency.test.ts`).
    check(
      "delivery_idempotency_keys_route_check",
      sql`${table.route} IN ('POST /store-orders','POST /store-orders/{orderPublicId}/cancellation','PUT /store-orders/{orderPublicId}/payment-mirror','POST /store-orders/{orderPublicId}/confirmation','POST /store-orders/{orderPublicId}/fulfillment-transition')`,
    ),
    check(
      "delivery_idempotency_keys_request_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "delivery_idempotency_keys_response_status_check",
      sql`${table.responseStatus} IN (200, 201)`,
    ),
    check(
      "delivery_idempotency_keys_trace_id_check",
      sql`${table.traceId} IS NULL OR char_length(${table.traceId}) <= 128`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 13) delivery_inventory_reservations — سجلُّ حجوزاتِ المخزونِ
// ---------------------------------------------------------------------------

export const deliveryInventoryReservations = pgTable(
  "delivery_inventory_reservations",
  {
    reservationId: uuid("reservation_id").primaryKey(),
    orderId: uuid("order_id").notNull(),
    storeSlug: text("store_slug").notNull(),
    productId: uuid("product_id").notNull(),
    sku: text("sku").notNull(),
    quantityReserved: integer("quantity_reserved").notNull(),
    unitPriceMinorUnits: integer("unit_price_minor_units").notNull(),
    marketplaceReservationRef: text("marketplace_reservation_ref").notNull(),
    status: text("status").notNull().default("active"),
    reservedAt: instant("reserved_at").notNull().defaultNow(),
    releasedAt: instant("released_at"),
    traceId: text("trace_id"),
  },
  (table) => [
    foreignKey({
      name: "delivery_inventory_reservations_order_id_fkey",
      columns: [table.orderId],
      foreignColumns: [storeOrders.orderId],
    }),
    // `DEFERRABLE INITIALLY DEFERRED` في العقدِ — ولا تُعبِّرُ عنهُ المرآةُ؛
    // الفرقُ يُرفَعُ يداً في `drizzle/0000_*.sql` (انظر رأسَ هذا الملفِّ).
    unique("delivery_inventory_reservations_order_id_product_id_key").on(
      table.orderId,
      table.productId,
    ),
    unique("delivery_inventory_reservations_marketplace_reservation_ref_key").on(
      table.marketplaceReservationRef,
    ),
    check(
      "delivery_inventory_reservations_store_slug_check",
      sql`${table.storeSlug} ~ '^[a-z][a-z0-9-]{2,47}$'`,
    ),
    check(
      "delivery_inventory_reservations_sku_check",
      sql`char_length(${table.sku}) BETWEEN 1 AND 64`,
    ),
    check("delivery_inventory_reservations_quantity_reserved_check", sql`${table.quantityReserved} >= 1`),
    check(
      "delivery_inventory_reservations_unit_price_minor_units_check",
      sql`${table.unitPriceMinorUnits} >= 0`,
    ),
    // الاسمُ مقطوعٌ إلى 63 حرفاً بقطعِ اسمِ الجدولِ — مقيسٌ من الكتالوجِ لا مُفترضٌ.
    check(
      "delivery_inventory_reservatio_marketplace_reservation_ref_check",
      sql`char_length(${table.marketplaceReservationRef}) BETWEEN 1 AND 128`,
    ),
    check(
      "delivery_inventory_reservations_status_check",
      sql`${table.status} IN ('active','released','consumed')`,
    ),
    index("ix_delivery_inventory_reservations_order").on(table.orderId),
    index("ix_delivery_inventory_reservations_active")
      .on(table.storeSlug, table.productId)
      .where(sql`${table.status} = 'active'`),
  ],
);

/**
 * جداولُ العقدِ بلا مرآةٍ — **فارغةٌ** لا محذوفةٌ: حارسُ الانحرافِ يُقابلُها بفرقِ
 * (جداولِ العقدِ − جداولِ المرآةِ) بالضبطِ، فبقاؤها فارغةً هو ما يُسقِطُ أوّلَ جدولٍ يُضافُ
 * غداً إلى العقدِ بلا مرآةٍ هنا.
 */
export const NOT_MIRRORED_TABLES: ReadonlyArray<string> = Object.freeze([]);
