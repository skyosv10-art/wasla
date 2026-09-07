CREATE TABLE "customer_order_request_stops" (
	"order_request_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"zone_id" uuid NOT NULL,
	"label" text,
	"latitude" numeric(8, 6),
	"longitude" numeric(9, 6),
	"source" text NOT NULL,
	"saved_place_id" uuid,
	CONSTRAINT "customer_order_request_stops_pkey" PRIMARY KEY("order_request_id","sequence"),
	CONSTRAINT "customer_order_request_stops_sequence_check" CHECK ("customer_order_request_stops"."sequence" >= 1),
	CONSTRAINT "customer_order_request_stops_kind_check" CHECK ("customer_order_request_stops"."kind" IN ('pickup','dropoff')),
	CONSTRAINT "customer_order_request_stops_source_check" CHECK ("customer_order_request_stops"."source" IN ('map','telegram_location','link','text_search','saved_place','manual_zone')),
	CONSTRAINT "customer_order_request_stops_label_check" CHECK ("customer_order_request_stops"."label" IS NULL OR char_length("customer_order_request_stops"."label") <= 160),
	CONSTRAINT "customer_order_request_stops_latitude_check" CHECK ("customer_order_request_stops"."latitude" IS NULL OR "customer_order_request_stops"."latitude" BETWEEN -90 AND 90),
	CONSTRAINT "customer_order_request_stops_longitude_check" CHECK ("customer_order_request_stops"."longitude" IS NULL OR "customer_order_request_stops"."longitude" BETWEEN -180 AND 180),
	CONSTRAINT "ck_customer_order_request_stops_coordinates_complete" CHECK (("customer_order_request_stops"."latitude" IS NULL) = ("customer_order_request_stops"."longitude" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "customer_order_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wasla_public_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"order_type" text NOT NULL,
	"vehicle_class" text NOT NULL,
	"price_mode" text NOT NULL,
	"offered_amount_minor" bigint,
	"currency" text,
	"shipment_type" text,
	"shipment_description" text,
	"weight_kg" numeric(9, 3),
	"notes" text,
	"order_public_id" text,
	"submitted_at" timestamp with time zone,
	"failure_reason_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_order_requests_wasla_public_id_check" CHECK ("customer_order_requests"."wasla_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "customer_order_requests_idempotency_key_check" CHECK (char_length("customer_order_requests"."idempotency_key") BETWEEN 8 AND 128),
	CONSTRAINT "customer_order_requests_offered_amount_minor_check" CHECK ("customer_order_requests"."offered_amount_minor" IS NULL OR "customer_order_requests"."offered_amount_minor" > 0),
	CONSTRAINT "customer_order_requests_currency_check" CHECK ("customer_order_requests"."currency" IS NULL OR "customer_order_requests"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "customer_order_requests_shipment_type_check" CHECK ("customer_order_requests"."shipment_type" IS NULL OR "customer_order_requests"."shipment_type" IN ('parcel','documents','food','goods','other')),
	CONSTRAINT "customer_order_requests_shipment_description_check" CHECK ("customer_order_requests"."shipment_description" IS NULL OR char_length("customer_order_requests"."shipment_description") <= 300),
	CONSTRAINT "customer_order_requests_weight_kg_check" CHECK ("customer_order_requests"."weight_kg" IS NULL OR ("customer_order_requests"."weight_kg" >= 0 AND "customer_order_requests"."weight_kg" <= 3000)),
	CONSTRAINT "customer_order_requests_notes_check" CHECK ("customer_order_requests"."notes" IS NULL OR char_length("customer_order_requests"."notes") <= 500),
	CONSTRAINT "customer_order_requests_status_check" CHECK ("customer_order_requests"."status" IN ('submitted','submission_failed')),
	CONSTRAINT "customer_order_requests_order_type_check" CHECK ("customer_order_requests"."order_type" IN ('ride','delivery')),
	CONSTRAINT "customer_order_requests_vehicle_class_check" CHECK ("customer_order_requests"."vehicle_class" IN ('sedan','suv','van','pickup','motorcycle','truck_small')),
	CONSTRAINT "customer_order_requests_price_mode_check" CHECK ("customer_order_requests"."price_mode" IN ('customer_offer','negotiable')),
	CONSTRAINT "ck_customer_order_requests_price_mode" CHECK (("customer_order_requests"."price_mode" = 'customer_offer' AND "customer_order_requests"."offered_amount_minor" IS NOT NULL AND "customer_order_requests"."currency" IS NOT NULL) OR ("customer_order_requests"."price_mode" = 'negotiable' AND "customer_order_requests"."offered_amount_minor" IS NULL AND "customer_order_requests"."currency" IS NULL)),
	CONSTRAINT "ck_customer_order_requests_shipment_scope" CHECK ("customer_order_requests"."order_type" = 'delivery' OR ("customer_order_requests"."shipment_type" IS NULL AND "customer_order_requests"."shipment_description" IS NULL AND "customer_order_requests"."weight_kg" IS NULL)),
	CONSTRAINT "ck_customer_order_requests_status_coherence" CHECK (("customer_order_requests"."status" = 'submitted' AND "customer_order_requests"."submitted_at" IS NOT NULL AND "customer_order_requests"."failure_reason_code" IS NULL) OR ("customer_order_requests"."status" = 'submission_failed' AND "customer_order_requests"."failure_reason_code" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "customer_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_version" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "customer_outbox_event_id_key" UNIQUE("event_id"),
	CONSTRAINT "customer_outbox_aggregate_type_check" CHECK ("customer_outbox"."aggregate_type" IN ('customer','customer_order_request'))
);
--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"wasla_public_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"preferred_locale" text DEFAULT 'ar' NOT NULL,
	"default_zone_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_profiles_wasla_public_id_check" CHECK ("customer_profiles"."wasla_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "customer_profiles_preferred_locale_check" CHECK ("customer_profiles"."preferred_locale" IN ('ar','en','ur')),
	CONSTRAINT "customer_profiles_status_check" CHECK ("customer_profiles"."status" IN ('active','suspended')),
	CONSTRAINT "customer_profiles_display_name_check" CHECK ("customer_profiles"."display_name" IS NULL OR char_length("customer_profiles"."display_name") BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "customer_saved_places" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wasla_public_id" text NOT NULL,
	"label" text NOT NULL,
	"zone_id" uuid NOT NULL,
	"address_text" text,
	"latitude" numeric(8, 6),
	"longitude" numeric(9, 6),
	"idempotency_key" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_saved_places_wasla_public_id_check" CHECK ("customer_saved_places"."wasla_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "customer_saved_places_label_check" CHECK (char_length("customer_saved_places"."label") BETWEEN 1 AND 60),
	CONSTRAINT "customer_saved_places_address_text_check" CHECK ("customer_saved_places"."address_text" IS NULL OR char_length("customer_saved_places"."address_text") <= 160),
	CONSTRAINT "customer_saved_places_latitude_check" CHECK ("customer_saved_places"."latitude" IS NULL OR "customer_saved_places"."latitude" BETWEEN -90 AND 90),
	CONSTRAINT "customer_saved_places_longitude_check" CHECK ("customer_saved_places"."longitude" IS NULL OR "customer_saved_places"."longitude" BETWEEN -180 AND 180),
	CONSTRAINT "customer_saved_places_idempotency_key_check" CHECK (char_length("customer_saved_places"."idempotency_key") BETWEEN 8 AND 128),
	CONSTRAINT "ck_customer_saved_places_coordinates_complete" CHECK (("customer_saved_places"."latitude" IS NULL) = ("customer_saved_places"."longitude" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "customer_order_request_stops" ADD CONSTRAINT "customer_order_request_stops_order_request_id_fkey" FOREIGN KEY ("order_request_id") REFERENCES "public"."customer_order_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_customer_order_request_stops_zone" ON "customer_order_request_stops" USING btree ("zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_customer_order_requests_idempotency" ON "customer_order_requests" USING btree ("wasla_public_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_customer_order_requests_owner" ON "customer_order_requests" USING btree ("wasla_public_id","created_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "ux_customer_order_requests_order_public_id" ON "customer_order_requests" USING btree ("order_public_id") WHERE "customer_order_requests"."order_public_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_customer_outbox_unpublished" ON "customer_outbox" USING btree ("occurred_at") WHERE "customer_outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_customer_saved_places_label" ON "customer_saved_places" USING btree ("wasla_public_id",lower("label"));--> statement-breakpoint
CREATE UNIQUE INDEX "ux_customer_saved_places_idempotency" ON "customer_saved_places" USING btree ("wasla_public_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_customer_saved_places_owner" ON "customer_saved_places" USING btree ("wasla_public_id","last_used_at" DESC NULLS LAST,"created_at" DESC);--> statement-breakpoint
-- ═════════════════════════════════════════════════════════════════════
-- إلحاقٌ مُراجَعٌ — خارجَ نطاقِ التوليدِ (ADR-024 §2.1)
--
-- الدالةُّ والمُطلِقاتُ الثلاثةُ في العقدِ (contracts/schema.sql) خارجَ نطاقِ
-- تعبيرِ الإسقاطِ (schema.ts)، فلا يولِّدُها drizzle-kit. تُلحَقُ هنا بيدٍ
-- **مُعلَمةٍ صريحاً** فلا يُدَّعى أنّها مولَّدةٌ وهي مُلحَقةٌ، ويقيسُ اختبارُ
-- التكافؤِ (migrations.integration.test.ts) بقائَها مطابقةً للعقدِ حرفاً.
-- ═════════════════════════════════════════════════════════════════════
CREATE FUNCTION customer_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_customer_profiles_updated_at BEFORE UPDATE ON customer_profiles
    FOR EACH ROW EXECUTE FUNCTION customer_set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_customer_saved_places_updated_at BEFORE UPDATE ON customer_saved_places
    FOR EACH ROW EXECUTE FUNCTION customer_set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_customer_order_requests_updated_at BEFORE UPDATE ON customer_order_requests
    FOR EACH ROW EXECUTE FUNCTION customer_set_updated_at();
