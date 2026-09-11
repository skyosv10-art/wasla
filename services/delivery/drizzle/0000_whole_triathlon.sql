-- الترحيلُ الأوّلُ لخدمةِ التوصيلِ — مولَّدٌ بـ`drizzle-kit generate` من مرآةِ
-- `src/db/schema.ts`، ثمّ **مُعدَّلٌ يدويّاً في موضعٍ واحدٍ** مُعلَنٍ بتعليقِه أدناه
-- (`DEFERRABLE` في `delivery_inventory_reservations`). المرجعُ الكنونيُّ يبقى
-- `contracts/schema.sql`، وتكافؤُ هذا الملفِّ معهُ مقيسٌ في سبعةِ أبعادِ كتالوجٍ
-- (جداولٌ · أعمدةٌ · قيودٌ · فهارسُ · مُطلِقاتٌ · دوالُّ · متتابعاتٌ) في
-- `src/__tests__/migrations.integration.test.ts` — لا مُدَّعىً في تعليقٍ.
--
-- ورفيقُ الترجعِ `0000_whole_triathlon.down.sql` مُراجَعٌ يدويّاً (ADR-024 §2.2).

CREATE SEQUENCE "public"."store_order_public_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 5000000001 CACHE 1;--> statement-breakpoint
CREATE TABLE "delivery_idempotency_keys" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"route" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"response_status" smallint NOT NULL,
	"response_body" jsonb NOT NULL,
	"order_id" uuid NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_idempotency_keys_idempotency_key_check" CHECK ("delivery_idempotency_keys"."idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$'),
	CONSTRAINT "delivery_idempotency_keys_route_check" CHECK ("delivery_idempotency_keys"."route" IN ('POST /store-orders','POST /store-orders/{orderPublicId}/cancellation','PUT /store-orders/{orderPublicId}/payment-mirror','POST /store-orders/{orderPublicId}/confirmation','POST /store-orders/{orderPublicId}/fulfillment-transition')),
	CONSTRAINT "delivery_idempotency_keys_request_fingerprint_check" CHECK ("delivery_idempotency_keys"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "delivery_idempotency_keys_response_status_check" CHECK ("delivery_idempotency_keys"."response_status" IN (200, 201)),
	CONSTRAINT "delivery_idempotency_keys_trace_id_check" CHECK ("delivery_idempotency_keys"."trace_id" IS NULL OR char_length("delivery_idempotency_keys"."trace_id") <= 128)
);
--> statement-breakpoint
CREATE TABLE "delivery_inventory_observations" (
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"last_adjustment_id" uuid NOT NULL,
	"last_marketplace_event_id" uuid NOT NULL,
	"last_adjustment_sequence" integer NOT NULL,
	"observed_quantity_after" integer NOT NULL,
	"last_quantity_delta" integer NOT NULL,
	"last_reason_code" text NOT NULL,
	"occurred_for" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trace_id" text,
	CONSTRAINT "delivery_inventory_observations_pkey" PRIMARY KEY("store_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_inventory_relay_checkpoint" (
	"consumer_id" text PRIMARY KEY NOT NULL,
	"last_occurred_at" timestamp with time zone NOT NULL,
	"last_event_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_inventory_relay_checkpoint_consumer_id_check" CHECK (char_length("delivery_inventory_relay_checkpoint"."consumer_id") BETWEEN 3 AND 96)
);
--> statement-breakpoint
CREATE TABLE "delivery_inventory_relay_consumed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"consumed_status" text NOT NULL,
	"attempt_count" integer NOT NULL,
	"last_error" text,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_inventory_relay_consumed_events_event_type_check" CHECK (char_length("delivery_inventory_relay_consumed_events"."event_type") BETWEEN 3 AND 96),
	CONSTRAINT "delivery_inventory_relay_consumed_events_aggregate_type_check" CHECK ("delivery_inventory_relay_consumed_events"."aggregate_type" IN ('store','product','inventory')),
	CONSTRAINT "delivery_inventory_relay_consumed_events_aggregate_id_check" CHECK (char_length("delivery_inventory_relay_consumed_events"."aggregate_id") BETWEEN 1 AND 64),
	CONSTRAINT "delivery_inventory_relay_consumed_events_consumed_status_check" CHECK ("delivery_inventory_relay_consumed_events"."consumed_status" IN ('pending','applied','skipped_stale','ignored','poisoned')),
	CONSTRAINT "delivery_inventory_relay_consumed_events_attempt_count_check" CHECK ("delivery_inventory_relay_consumed_events"."attempt_count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "delivery_inventory_reservations" (
	"reservation_id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"store_slug" text NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"quantity_reserved" integer NOT NULL,
	"unit_price_minor_units" integer NOT NULL,
	"marketplace_reservation_ref" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"trace_id" text,
	-- [تعديلٌ يدويٌّ · ADR-024] `DEFERRABLE INITIALLY DEFERRED` مكتوبٌ في العقدِ ولا
	-- تُعبِّرُ عنهُ مرآةُ Drizzle، فيُولّدُ المولّدُ القيدَ فوريَّ الفحصِ. والتأجيلُ شرطُ
	-- إعادةِ بناءِ حجوزاتِ طلبٍ في معاملةٍ واحدةٍ، فيُرفَعُ الفرقُ هنا يداً. ولا يُمَسُّ
	-- `meta/0000_snapshot.json` كي لا يُنتِجَ `db:generate` التاليَ فرقاً وهميّاً؛ والتكافؤُ
	-- يقيسُهُ `__tests__/migrations.integration.test.ts` من `pg_get_constraintdef`.
	CONSTRAINT "delivery_inventory_reservations_order_id_product_id_key" UNIQUE("order_id","product_id") DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "delivery_inventory_reservations_marketplace_reservation_ref_key" UNIQUE("marketplace_reservation_ref"),
	CONSTRAINT "delivery_inventory_reservations_store_slug_check" CHECK ("delivery_inventory_reservations"."store_slug" ~ '^[a-z][a-z0-9-]{2,47}$'),
	CONSTRAINT "delivery_inventory_reservations_sku_check" CHECK (char_length("delivery_inventory_reservations"."sku") BETWEEN 1 AND 64),
	CONSTRAINT "delivery_inventory_reservations_quantity_reserved_check" CHECK ("delivery_inventory_reservations"."quantity_reserved" >= 1),
	CONSTRAINT "delivery_inventory_reservations_unit_price_minor_units_check" CHECK ("delivery_inventory_reservations"."unit_price_minor_units" >= 0),
	CONSTRAINT "delivery_inventory_reservatio_marketplace_reservation_ref_check" CHECK (char_length("delivery_inventory_reservations"."marketplace_reservation_ref") BETWEEN 1 AND 128),
	CONSTRAINT "delivery_inventory_reservations_status_check" CHECK ("delivery_inventory_reservations"."status" IN ('active','released','consumed'))
);
--> statement-breakpoint
CREATE TABLE "delivery_outbox" (
	"outbox_id" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_version" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"trace_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "delivery_outbox_event_id_key" UNIQUE("event_id"),
	CONSTRAINT "delivery_outbox_event_type_check" CHECK (char_length("delivery_outbox"."event_type") BETWEEN 3 AND 96),
	CONSTRAINT "delivery_outbox_event_version_check" CHECK ("delivery_outbox"."event_version" ~ '^v[0-9]+$'),
	CONSTRAINT "delivery_outbox_aggregate_type_check" CHECK ("delivery_outbox"."aggregate_type" IN ('store_order','delivery_task')),
	CONSTRAINT "delivery_outbox_aggregate_id_check" CHECK (char_length("delivery_outbox"."aggregate_id") BETWEEN 1 AND 64)
);
--> statement-breakpoint
CREATE TABLE "delivery_relay_checkpoint" (
	"consumer_id" text PRIMARY KEY NOT NULL,
	"last_occurred_at" timestamp with time zone NOT NULL,
	"last_event_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_relay_checkpoint_consumer_id_check" CHECK (char_length("delivery_relay_checkpoint"."consumer_id") BETWEEN 3 AND 96)
);
--> statement-breakpoint
CREATE TABLE "delivery_relay_consumed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"consumed_status" text NOT NULL,
	"attempt_count" integer NOT NULL,
	"last_error" text,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_relay_consumed_events_event_type_check" CHECK (char_length("delivery_relay_consumed_events"."event_type") BETWEEN 3 AND 96),
	CONSTRAINT "delivery_relay_consumed_events_aggregate_type_check" CHECK ("delivery_relay_consumed_events"."aggregate_type" IN ('dispatch_job','dispatch_offer')),
	CONSTRAINT "delivery_relay_consumed_events_aggregate_id_check" CHECK (char_length("delivery_relay_consumed_events"."aggregate_id") BETWEEN 1 AND 64),
	CONSTRAINT "delivery_relay_consumed_events_consumed_status_check" CHECK ("delivery_relay_consumed_events"."consumed_status" IN ('pending','applied','skipped_stale','ignored','ignored_foreign','poisoned')),
	CONSTRAINT "delivery_relay_consumed_events_attempt_count_check" CHECK ("delivery_relay_consumed_events"."attempt_count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "delivery_task_transitions" (
	"transition_id" bigserial PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"reason_code" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_ref" text,
	"trace_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_task_transitions_check" CHECK ("delivery_task_transitions"."to_state" <> "delivery_task_transitions"."from_state"),
	CONSTRAINT "delivery_task_transitions_reason_code_check" CHECK (char_length("delivery_task_transitions"."reason_code") BETWEEN 3 AND 64),
	CONSTRAINT "delivery_task_transitions_actor_type_check" CHECK ("delivery_task_transitions"."actor_type" IN ('system','customer','store','courier','admin','dispatch')),
	CONSTRAINT "delivery_task_transitions_actor_ref_check" CHECK ("delivery_task_transitions"."actor_ref" IS NULL OR "delivery_task_transitions"."actor_ref" ~ '^WS-[0-9]{10}$')
);
--> statement-breakpoint
CREATE TABLE "delivery_tasks" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"state" text NOT NULL,
	"ineligibility_reason" text,
	"dispatch_job_ref" text,
	"dispatch_last_occurred_at" timestamp with time zone,
	"dispatch_last_event_id" uuid,
	"courier_ref" text,
	"proof_type" text,
	"proof_ref" text,
	"assigned_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_tasks_order_id_key" UNIQUE("order_id"),
	CONSTRAINT "delivery_tasks_state_check" CHECK ("delivery_tasks"."state" IN ('pending_eligibility','eligible','dispatch_requested','driver_assigned','timed_out','reassigned','exhausted','picked_up','in_transit','arrived','delivered','ineligible','failed','cancelled')),
	CONSTRAINT "delivery_tasks_ineligibility_reason_check" CHECK ("delivery_tasks"."ineligibility_reason" IS NULL OR "delivery_tasks"."ineligibility_reason" IN ('outside_coverage','store_not_orderable','no_courier_service')),
	CONSTRAINT "delivery_tasks_dispatch_job_ref_check" CHECK ("delivery_tasks"."dispatch_job_ref" IS NULL OR char_length("delivery_tasks"."dispatch_job_ref") BETWEEN 1 AND 128),
	CONSTRAINT "delivery_tasks_courier_ref_check" CHECK ("delivery_tasks"."courier_ref" IS NULL OR "delivery_tasks"."courier_ref" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "delivery_tasks_proof_type_check" CHECK ("delivery_tasks"."proof_type" IS NULL OR "delivery_tasks"."proof_type" IN ('otp','photo','signature','pin_code')),
	CONSTRAINT "delivery_tasks_proof_ref_check" CHECK ("delivery_tasks"."proof_ref" IS NULL OR char_length("delivery_tasks"."proof_ref") BETWEEN 1 AND 256),
	CONSTRAINT "delivery_tasks_version_check" CHECK ("delivery_tasks"."version" >= 1),
	CONSTRAINT "ck_delivery_proof" CHECK (("delivery_tasks"."state" = 'delivered') = ("delivery_tasks"."proof_type" IS NOT NULL AND "delivery_tasks"."proof_ref" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "store_order_items" (
	"order_item_id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor_units" integer NOT NULL,
	"line_total_minor_units" integer NOT NULL,
	"substituted_product_id" uuid,
	"substitution_reason" text,
	"substitution_price_delta_minor_units" integer,
	CONSTRAINT "store_order_items_order_id_line_no_key" UNIQUE("order_id","line_no"),
	CONSTRAINT "store_order_items_line_no_check" CHECK ("store_order_items"."line_no" >= 1),
	CONSTRAINT "store_order_items_sku_check" CHECK (char_length("store_order_items"."sku") BETWEEN 1 AND 64),
	CONSTRAINT "store_order_items_quantity_check" CHECK ("store_order_items"."quantity" >= 1),
	CONSTRAINT "store_order_items_unit_price_minor_units_check" CHECK ("store_order_items"."unit_price_minor_units" >= 0),
	CONSTRAINT "store_order_items_check" CHECK ("store_order_items"."line_total_minor_units" = "store_order_items"."quantity" * "store_order_items"."unit_price_minor_units"),
	CONSTRAINT "store_order_items_substitution_reason_check" CHECK ("store_order_items"."substitution_reason" IS NULL OR "store_order_items"."substitution_reason" IN ('out_of_stock','customer_approved_alternative','store_policy')),
	CONSTRAINT "store_order_items_check1" CHECK ("store_order_items"."substitution_price_delta_minor_units" IS NOT NULL OR "store_order_items"."substituted_product_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "store_order_transitions" (
	"transition_id" bigserial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"state_kind" text NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"reason_code" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_ref" text,
	"trace_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_order_transitions_state_kind_check" CHECK ("store_order_transitions"."state_kind" IN ('fulfillment','payment','inventory')),
	CONSTRAINT "store_order_transitions_check" CHECK ("store_order_transitions"."to_state" <> "store_order_transitions"."from_state"),
	CONSTRAINT "store_order_transitions_reason_code_check" CHECK (char_length("store_order_transitions"."reason_code") BETWEEN 3 AND 64),
	CONSTRAINT "store_order_transitions_actor_type_check" CHECK ("store_order_transitions"."actor_type" IN ('system','customer','store','courier','admin')),
	CONSTRAINT "store_order_transitions_actor_ref_check" CHECK ("store_order_transitions"."actor_ref" IS NULL OR "store_order_transitions"."actor_ref" ~ '^WS-[0-9]{10}$')
);
--> statement-breakpoint
CREATE TABLE "store_orders" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"customer_ref" text NOT NULL,
	"store_id" uuid NOT NULL,
	"store_slug" text NOT NULL,
	"fulfillment_state" text NOT NULL,
	"payment_state" text NOT NULL,
	"payment_ref" text,
	"inventory_state" text DEFAULT 'none' NOT NULL,
	"inventory_ref" text,
	"currency_code" text NOT NULL,
	"items_total_minor_units" integer NOT NULL,
	"delivery_fee_minor_units" integer NOT NULL,
	"total_minor_units" integer NOT NULL,
	"placed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_orders_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "store_orders_public_id_check" CHECK ("store_orders"."public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "store_orders_customer_ref_check" CHECK ("store_orders"."customer_ref" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "store_orders_store_slug_check" CHECK ("store_orders"."store_slug" ~ '^[a-z][a-z0-9-]{2,47}$'),
	CONSTRAINT "store_orders_fulfillment_state_check" CHECK ("store_orders"."fulfillment_state" IN ('draft','placed','confirmed','picking','picked','ready_for_delivery','handed_to_courier','delivered','cancelled','rejected','failed')),
	CONSTRAINT "store_orders_payment_state_check" CHECK ("store_orders"."payment_state" IN ('pending','authorized','captured','failed','refunding','partially_refunded','refunded')),
	CONSTRAINT "store_orders_payment_ref_check" CHECK ("store_orders"."payment_ref" IS NULL OR char_length("store_orders"."payment_ref") BETWEEN 1 AND 128),
	CONSTRAINT "store_orders_inventory_state_check" CHECK ("store_orders"."inventory_state" IN ('none','reserving','reserved','released','consumed')),
	CONSTRAINT "store_orders_inventory_ref_check" CHECK ("store_orders"."inventory_ref" IS NULL OR char_length("store_orders"."inventory_ref") BETWEEN 1 AND 128),
	CONSTRAINT "store_orders_currency_code_check" CHECK ("store_orders"."currency_code" = 'SAR'),
	CONSTRAINT "store_orders_items_total_minor_units_check" CHECK ("store_orders"."items_total_minor_units" >= 0),
	CONSTRAINT "store_orders_delivery_fee_minor_units_check" CHECK ("store_orders"."delivery_fee_minor_units" >= 0),
	CONSTRAINT "store_orders_check" CHECK ("store_orders"."total_minor_units" = "store_orders"."items_total_minor_units" + "store_orders"."delivery_fee_minor_units"),
	CONSTRAINT "store_orders_version_check" CHECK ("store_orders"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "delivery_idempotency_keys" ADD CONSTRAINT "delivery_idempotency_keys_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_inventory_reservations" ADD CONSTRAINT "delivery_inventory_reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_task_transitions" ADD CONSTRAINT "delivery_task_transitions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."delivery_tasks"("task_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_order_items" ADD CONSTRAINT "store_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_order_transitions" ADD CONSTRAINT "store_order_transitions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_delivery_inventory_reservations_order" ON "delivery_inventory_reservations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ix_delivery_inventory_reservations_active" ON "delivery_inventory_reservations" USING btree ("store_slug","product_id") WHERE "delivery_inventory_reservations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "ix_delivery_outbox_unpublished" ON "delivery_outbox" USING btree ("outbox_id") WHERE "delivery_outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_delivery_task_transitions_task" ON "delivery_task_transitions" USING btree ("task_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_delivery_tasks_active" ON "delivery_tasks" USING btree ("state") WHERE "delivery_tasks"."state" IN ('eligible','dispatch_requested','driver_assigned','timed_out','reassigned','picked_up','in_transit','arrived');--> statement-breakpoint
CREATE INDEX "ix_store_order_items_order" ON "store_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ix_store_order_transitions_order" ON "store_order_transitions" USING btree ("order_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_store_orders_customer" ON "store_orders" USING btree ("customer_ref","created_at" DESC);--> statement-breakpoint
CREATE INDEX "ix_store_orders_store_active" ON "store_orders" USING btree ("store_id","fulfillment_state") WHERE "store_orders"."fulfillment_state" IN ('placed','confirmed','picking','picked','ready_for_delivery');