CREATE SEQUENCE "public"."order_public_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "order_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"driver_public_id" text NOT NULL,
	"sequence" smallint NOT NULL,
	"assignment_state" text DEFAULT 'offered' NOT NULL,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"reason_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_order_assignments_order_sequence" UNIQUE("order_id","sequence"),
	CONSTRAINT "ux_order_assignments_order_driver" UNIQUE("order_id","driver_public_id"),
	CONSTRAINT "order_assignments_driver_public_id_check" CHECK ("order_assignments"."driver_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "order_assignments_sequence_check" CHECK ("order_assignments"."sequence" >= 1),
	CONSTRAINT "order_assignments_assignment_state_check" CHECK ("order_assignments"."assignment_state" IN ('offered','accepted','rejected','expired','cancelled')),
	CONSTRAINT "order_assignments_reason_code_check" CHECK ("order_assignments"."reason_code" IS NULL OR char_length("order_assignments"."reason_code") BETWEEN 3 AND 64),
	CONSTRAINT "ck_order_assignments_state_timestamp" CHECK (("order_assignments"."assignment_state" = 'offered' AND "order_assignments"."accepted_at" IS NULL AND "order_assignments"."rejected_at" IS NULL AND "order_assignments"."expired_at" IS NULL AND "order_assignments"."cancelled_at" IS NULL) OR ("order_assignments"."assignment_state" = 'accepted' AND "order_assignments"."accepted_at" IS NOT NULL) OR ("order_assignments"."assignment_state" = 'rejected' AND "order_assignments"."rejected_at" IS NOT NULL) OR ("order_assignments"."assignment_state" = 'expired' AND "order_assignments"."expired_at" IS NOT NULL) OR ("order_assignments"."assignment_state" = 'cancelled' AND "order_assignments"."cancelled_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "order_outbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"event_version" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"trace_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "order_outbox_event_version_check" CHECK ("order_outbox"."event_version" ~ '^v[0-9]+$'),
	CONSTRAINT "order_outbox_aggregate_type_check" CHECK ("order_outbox"."aggregate_type" IN ('order','order_assignment')),
	CONSTRAINT "order_outbox_trace_id_check" CHECK ("order_outbox"."trace_id" IS NULL OR char_length("order_outbox"."trace_id") <= 128)
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason_code" text,
	"actor_type" text NOT NULL,
	"actor_ref" text,
	"trace_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_order_status_history_order_sequence" UNIQUE("order_id","sequence"),
	CONSTRAINT "order_status_history_sequence_check" CHECK ("order_status_history"."sequence" >= 1),
	CONSTRAINT "order_status_history_reason_code_check" CHECK ("order_status_history"."reason_code" IS NULL OR char_length("order_status_history"."reason_code") BETWEEN 3 AND 64),
	CONSTRAINT "order_status_history_actor_type_check" CHECK ("order_status_history"."actor_type" IN ('system','customer','driver','partner','admin')),
	CONSTRAINT "order_status_history_actor_ref_check" CHECK ("order_status_history"."actor_ref" IS NULL OR "order_status_history"."actor_ref" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "order_status_history_trace_id_check" CHECK ("order_status_history"."trace_id" IS NULL OR char_length("order_status_history"."trace_id") <= 128),
	CONSTRAINT "ck_order_status_history_progresses" CHECK ("order_status_history"."from_status" IS NULL OR "order_status_history"."from_status" <> "order_status_history"."to_status"),
	CONSTRAINT "ck_order_status_history_actor_ref" CHECK (("order_status_history"."actor_type" = 'system' AND "order_status_history"."actor_ref" IS NULL) OR ("order_status_history"."actor_type" <> 'system' AND "order_status_history"."actor_ref" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "order_stops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"sequence" smallint NOT NULL,
	"kind" text NOT NULL,
	"zone_id" uuid NOT NULL,
	"label" text,
	"source" text NOT NULL,
	"latitude" numeric(8, 6),
	"longitude" numeric(9, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_order_stops_order_sequence" UNIQUE("order_id","sequence"),
	CONSTRAINT "order_stops_sequence_check" CHECK ("order_stops"."sequence" >= 0),
	CONSTRAINT "order_stops_kind_check" CHECK ("order_stops"."kind" IN ('pickup','dropoff')),
	CONSTRAINT "order_stops_label_check" CHECK ("order_stops"."label" IS NULL OR char_length("order_stops"."label") <= 60),
	CONSTRAINT "order_stops_source_check" CHECK ("order_stops"."source" IN ('map','telegram_location','link','text_search','saved_place','manual_zone')),
	CONSTRAINT "order_stops_latitude_check" CHECK ("order_stops"."latitude" IS NULL OR "order_stops"."latitude" BETWEEN -90 AND 90),
	CONSTRAINT "order_stops_longitude_check" CHECK ("order_stops"."longitude" IS NULL OR "order_stops"."longitude" BETWEEN -180 AND 180),
	CONSTRAINT "ck_order_stops_coordinates_complete" CHECK (("order_stops"."latitude" IS NULL) = ("order_stops"."longitude" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_public_id" text NOT NULL,
	"order_request_id" uuid NOT NULL,
	"customer_public_id" text NOT NULL,
	"order_type" text NOT NULL,
	"vehicle_class" text NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"status_reason_code" text,
	"price_mode" text NOT NULL,
	"offered_amount_minor" bigint,
	"offered_currency" text,
	"agreed_amount_minor" bigint,
	"agreed_currency" text,
	"agreed_at" timestamp with time zone,
	"agreed_negotiation_id" uuid,
	"shipment_description" text,
	"shipment_type" text,
	"shipment_weight_kg" numeric(7, 2),
	"notes" text,
	"active_assignment_id" uuid,
	"idempotency_key" text NOT NULL,
	"payload_fingerprint" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_public_id_key" UNIQUE("order_public_id"),
	CONSTRAINT "orders_order_request_id_key" UNIQUE("order_request_id"),
	CONSTRAINT "orders_order_public_id_check" CHECK ("orders"."order_public_id" ~ '^ORD-[0-9]{10}$'),
	CONSTRAINT "orders_customer_public_id_check" CHECK ("orders"."customer_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "orders_order_type_check" CHECK ("orders"."order_type" IN ('ride','delivery')),
	CONSTRAINT "orders_vehicle_class_check" CHECK ("orders"."vehicle_class" IN ('sedan','suv','van','pickup','motorcycle','truck_small')),
	CONSTRAINT "orders_status_check" CHECK ("orders"."status" IN ('published','searching','offered','negotiating','accepted','assigned','driver_en_route','arrived','in_progress','completed','driver_rejected','driver_timeout','expired','no_driver_found','customer_cancelled','driver_cancelled','partner_cancelled','blocked','failed','payment_disputed','under_review')),
	CONSTRAINT "orders_status_reason_code_check" CHECK ("orders"."status_reason_code" IS NULL OR char_length("orders"."status_reason_code") BETWEEN 3 AND 64),
	CONSTRAINT "orders_price_mode_check" CHECK ("orders"."price_mode" IN ('customer_offer','negotiable')),
	CONSTRAINT "orders_offered_amount_minor_check" CHECK ("orders"."offered_amount_minor" IS NULL OR "orders"."offered_amount_minor" > 0),
	CONSTRAINT "orders_offered_currency_check" CHECK ("orders"."offered_currency" IS NULL OR "orders"."offered_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "orders_agreed_amount_minor_check" CHECK ("orders"."agreed_amount_minor" IS NULL OR "orders"."agreed_amount_minor" > 0),
	CONSTRAINT "orders_agreed_currency_check" CHECK ("orders"."agreed_currency" IS NULL OR "orders"."agreed_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "orders_shipment_description_check" CHECK ("orders"."shipment_description" IS NULL OR char_length("orders"."shipment_description") <= 300),
	CONSTRAINT "orders_shipment_type_check" CHECK ("orders"."shipment_type" IS NULL OR "orders"."shipment_type" IN ('parcel','documents','food','goods','other')),
	CONSTRAINT "orders_shipment_weight_kg_check" CHECK ("orders"."shipment_weight_kg" IS NULL OR ("orders"."shipment_weight_kg" >= 0 AND "orders"."shipment_weight_kg" <= 3000)),
	CONSTRAINT "orders_notes_check" CHECK ("orders"."notes" IS NULL OR char_length("orders"."notes") <= 300),
	CONSTRAINT "orders_idempotency_key_check" CHECK (char_length("orders"."idempotency_key") BETWEEN 8 AND 128),
	CONSTRAINT "orders_payload_fingerprint_check" CHECK (char_length("orders"."payload_fingerprint") = 64),
	CONSTRAINT "ck_orders_price_mode_amount" CHECK (("orders"."price_mode" = 'customer_offer' AND "orders"."offered_amount_minor" IS NOT NULL AND "orders"."offered_currency" IS NOT NULL) OR ("orders"."price_mode" = 'negotiable' AND "orders"."offered_amount_minor" IS NULL AND "orders"."offered_currency" IS NULL)),
	CONSTRAINT "ck_orders_money_complete" CHECK (("orders"."offered_amount_minor" IS NULL) = ("orders"."offered_currency" IS NULL)),
	CONSTRAINT "ck_orders_agreed_price_complete" CHECK (("orders"."agreed_amount_minor" IS NULL) = ("orders"."agreed_currency" IS NULL) AND ("orders"."agreed_amount_minor" IS NULL) = ("orders"."agreed_at" IS NULL) AND ("orders"."agreed_amount_minor" IS NULL) = ("orders"."agreed_negotiation_id" IS NULL)),
	CONSTRAINT "ck_orders_agreed_price_only_negotiable" CHECK ("orders"."agreed_amount_minor" IS NULL OR "orders"."price_mode" = 'negotiable'),
	CONSTRAINT "ck_orders_shipment_only_delivery" CHECK ("orders"."order_type" = 'delivery' OR ("orders"."shipment_description" IS NULL AND "orders"."shipment_type" IS NULL AND "orders"."shipment_weight_kg" IS NULL)),
	CONSTRAINT "ck_orders_terminal_needs_reason" CHECK ("orders"."status" NOT IN ('expired','no_driver_found','customer_cancelled','driver_cancelled','partner_cancelled','blocked','failed') OR "orders"."status_reason_code" IS NOT NULL),
	CONSTRAINT "ck_orders_assignment_matches_status" CHECK (("orders"."status" IN ('accepted','assigned','driver_en_route','arrived','in_progress','completed') AND "orders"."active_assignment_id" IS NOT NULL) OR ("orders"."status" IN ('published','searching','offered','negotiating') AND "orders"."active_assignment_id" IS NULL) OR "orders"."status" IN ('driver_rejected','driver_timeout','expired','no_driver_found','customer_cancelled','driver_cancelled','partner_cancelled','blocked','failed','payment_disputed','under_review'))
);
--> statement-breakpoint
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_stops" ADD CONSTRAINT "order_stops_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_order_assignments_order" ON "order_assignments" USING btree ("order_id","sequence");--> statement-breakpoint
CREATE INDEX "ix_order_assignments_driver" ON "order_assignments" USING btree ("driver_public_id","offered_at" DESC);--> statement-breakpoint
CREATE INDEX "ix_order_outbox_unpublished" ON "order_outbox" USING btree ("occurred_at") WHERE "order_outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_order_outbox_aggregate" ON "order_outbox" USING btree ("aggregate_type","aggregate_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_order_status_history_order" ON "order_status_history" USING btree ("order_id","sequence");--> statement-breakpoint
CREATE INDEX "ix_order_stops_order" ON "order_stops" USING btree ("order_id","sequence");--> statement-breakpoint
CREATE INDEX "ix_order_stops_zone" ON "order_stops" USING btree ("zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_orders_idempotency_key" ON "orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_orders_agreed_negotiation" ON "orders" USING btree ("agreed_negotiation_id") WHERE "orders"."agreed_negotiation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_orders_customer" ON "orders" USING btree ("customer_public_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "ix_orders_status" ON "orders" USING btree ("status","created_at" DESC);
-- ═════════════════════════════════════════════════════════════════════
-- إلحاقٌ مُراجَعٌ — خارجَ نطاقِ التوليدِ (ADR-024 §2.1)
--
-- الدالةُّ والمُطلِقانِ وFK النشطُ في العقدِ (contracts/schema.sql) خارجَ نطاقِ تعبيرِ
-- الإسقاطِ (schema.ts): fk_orders_active_assignment مرجعٌ متبادلٌ بينَ orders و
-- order_assignments لا يستطيعُ drizzle التعبيرَ عنه باسمٍ مخصّصٍ لمرجعٍ أماميٍّ،
-- والدالةُّ والمُطلِقاتُ خارجَ نطاقِ التوليدِ أصلاً. تُلحَقُ هنا بيدٍ **مُعلَمةٍ صريحاً**
-- فلا يُدَّعى أنّها مولَّدةٌ وهي مُلحَقةٌ، ويقيسُ اختبارُ التكافؤِ بقائَها مطابقةً للعقدِ حرفاً.
-- ═════════════════════════════════════════════════════════════════════
CREATE FUNCTION order_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION order_set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_order_assignments_updated_at BEFORE UPDATE ON order_assignments
    FOR EACH ROW EXECUTE FUNCTION order_set_updated_at();--> statement-breakpoint
ALTER TABLE orders DROP CONSTRAINT IF EXISTS fk_orders_active_assignment;--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT fk_orders_active_assignment
    FOREIGN KEY (active_assignment_id) REFERENCES order_assignments(id) ON DELETE SET NULL;