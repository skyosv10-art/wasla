CREATE TABLE "geo_cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "geo_cities_status_check" CHECK ("geo_cities"."status" IN ('active','inactive'))
);
--> statement-breakpoint
CREATE TABLE "geo_city_names" (
	"city_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "geo_city_names_pkey" PRIMARY KEY("city_id","locale"),
	CONSTRAINT "geo_city_names_locale_check" CHECK ("geo_city_names"."locale" IN ('ar','en','ur'))
);
--> statement-breakpoint
CREATE TABLE "geo_countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"iso3" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "geo_countries_status_check" CHECK ("geo_countries"."status" IN ('active','inactive'))
);
--> statement-breakpoint
CREATE TABLE "geo_country_names" (
	"country_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "geo_country_names_pkey" PRIMARY KEY("country_id","locale"),
	CONSTRAINT "geo_country_names_locale_check" CHECK ("geo_country_names"."locale" IN ('ar','en','ur'))
);
--> statement-breakpoint
CREATE TABLE "geo_district_names" (
	"district_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "geo_district_names_pkey" PRIMARY KEY("district_id","locale"),
	CONSTRAINT "geo_district_names_locale_check" CHECK ("geo_district_names"."locale" IN ('ar','en','ur'))
);
--> statement-breakpoint
CREATE TABLE "geo_districts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "geo_districts_status_check" CHECK ("geo_districts"."status" IN ('active','inactive'))
);
--> statement-breakpoint
CREATE TABLE "geo_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_version" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "geo_outbox_event_id_key" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "geo_region_names" (
	"region_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "geo_region_names_pkey" PRIMARY KEY("region_id","locale"),
	CONSTRAINT "geo_region_names_locale_check" CHECK ("geo_region_names"."locale" IN ('ar','en','ur'))
);
--> statement-breakpoint
CREATE TABLE "geo_regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "geo_regions_status_check" CHECK ("geo_regions"."status" IN ('active','inactive'))
);
--> statement-breakpoint
CREATE TABLE "geo_user_location_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"wasla_public_id" text NOT NULL,
	"old_zone_id" uuid,
	"new_zone_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "geo_user_location_history_wasla_public_id_check" CHECK ("geo_user_location_history"."wasla_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "geo_user_location_history_source_check" CHECK ("geo_user_location_history"."source" IN ('customer_bot','driver_bot','partner_bot','admin','system'))
);
--> statement-breakpoint
CREATE TABLE "geo_user_locations" (
	"wasla_public_id" text PRIMARY KEY NOT NULL,
	"zone_id" uuid NOT NULL,
	"source" text NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "geo_user_locations_wasla_public_id_check" CHECK ("geo_user_locations"."wasla_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "geo_user_locations_source_check" CHECK ("geo_user_locations"."source" IN ('customer_bot','driver_bot','partner_bot','admin','system'))
);
--> statement-breakpoint
CREATE TABLE "geo_zone_names" (
	"zone_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "geo_zone_names_pkey" PRIMARY KEY("zone_id","locale"),
	CONSTRAINT "geo_zone_names_locale_check" CHECK ("geo_zone_names"."locale" IN ('ar','en','ur'))
);
--> statement-breakpoint
CREATE TABLE "geo_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"district_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "geo_zones_status_check" CHECK ("geo_zones"."status" IN ('active','inactive'))
);
--> statement-breakpoint
ALTER TABLE "geo_cities" ADD CONSTRAINT "geo_cities_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "public"."geo_regions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_city_names" ADD CONSTRAINT "geo_city_names_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."geo_cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_country_names" ADD CONSTRAINT "geo_country_names_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "public"."geo_countries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_district_names" ADD CONSTRAINT "geo_district_names_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "public"."geo_districts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_districts" ADD CONSTRAINT "geo_districts_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."geo_cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_region_names" ADD CONSTRAINT "geo_region_names_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "public"."geo_regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_regions" ADD CONSTRAINT "geo_regions_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "public"."geo_countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_user_location_history" ADD CONSTRAINT "geo_user_location_history_new_zone_id_fkey" FOREIGN KEY ("new_zone_id") REFERENCES "public"."geo_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_user_locations" ADD CONSTRAINT "geo_user_locations_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "public"."geo_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_zone_names" ADD CONSTRAINT "geo_zone_names_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "public"."geo_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_zones" ADD CONSTRAINT "geo_zones_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "public"."geo_districts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_geo_cities_region_code" ON "geo_cities" USING btree ("region_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_geo_countries_code" ON "geo_countries" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_geo_districts_city_code" ON "geo_districts" USING btree ("city_id","code");--> statement-breakpoint
CREATE INDEX "ix_geo_outbox_unpublished" ON "geo_outbox" USING btree ("occurred_at") WHERE "geo_outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_geo_regions_country_code" ON "geo_regions" USING btree ("country_id","code");--> statement-breakpoint
CREATE INDEX "ix_geo_user_location_history_user" ON "geo_user_location_history" USING btree ("wasla_public_id","changed_at" DESC);--> statement-breakpoint
CREATE INDEX "ix_geo_user_locations_zone" ON "geo_user_locations" USING btree ("zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_geo_zones_district_code" ON "geo_zones" USING btree ("district_id","code");
-- ═════════════════════════════════════════════════════════════════════
-- إلحاقٌ مُراجَعٌ — خارجَ نطاقِ التوليدِ (ADR-024 §2.1)
--
-- الدالةُّ والمُطلِقاتُ الستّةُ في العقدِ (contracts/schema.sql) خارجَ نطاقِ تعبيرِ
-- الإسقاطِ (schema.ts)، فلا يولِّدُها drizzle-kit. تُلحَقُ هنا بيدٍ **مُعلَمةٍ
-- صريحاً** فلا يُدَّعى أنّها مولَّدةٌ وهي مُلحَقةٌ، ويقيسُ اختبارُ التكافؤِ
-- (migrations.integration.test.ts) بقائَها مطابقةً للعقدِ حرفاً.
-- ═════════════════════════════════════════════════════════════════════
CREATE FUNCTION geo_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_geo_countries_updated_at BEFORE UPDATE ON geo_countries
    FOR EACH ROW EXECUTE FUNCTION geo_set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_geo_regions_updated_at BEFORE UPDATE ON geo_regions
    FOR EACH ROW EXECUTE FUNCTION geo_set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_geo_cities_updated_at BEFORE UPDATE ON geo_cities
    FOR EACH ROW EXECUTE FUNCTION geo_set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_geo_districts_updated_at BEFORE UPDATE ON geo_districts
    FOR EACH ROW EXECUTE FUNCTION geo_set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_geo_zones_updated_at BEFORE UPDATE ON geo_zones
    FOR EACH ROW EXECUTE FUNCTION geo_set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_geo_user_locations_updated_at BEFORE UPDATE ON geo_user_locations
    FOR EACH ROW EXECUTE FUNCTION geo_set_updated_at();