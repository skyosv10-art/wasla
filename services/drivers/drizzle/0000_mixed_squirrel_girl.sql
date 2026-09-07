CREATE TABLE "driver_candidacy_publications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"wasla_public_id" text NOT NULL,
	"eligibility_state" text NOT NULL,
	"availability_state" text NOT NULL,
	"service_kinds" text[] DEFAULT '{}' NOT NULL,
	"zone_ids" uuid[] DEFAULT '{}' NOT NULL,
	"vehicle_class" text,
	"outcome" text NOT NULL,
	"failure_code" text,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_candidacy_publications_eligibility_state_check" CHECK ("driver_candidacy_publications"."eligibility_state" IN ('eligible','ineligible','suspended','unknown')),
	CONSTRAINT "driver_candidacy_publications_availability_state_check" CHECK ("driver_candidacy_publications"."availability_state" IN ('available','busy','offline')),
	CONSTRAINT "driver_candidacy_publications_vehicle_class_check" CHECK ("driver_candidacy_publications"."vehicle_class" IS NULL OR "driver_candidacy_publications"."vehicle_class" IN ('sedan','suv','van','pickup','motorcycle','truck_small')),
	CONSTRAINT "driver_candidacy_publications_outcome_check" CHECK ("driver_candidacy_publications"."outcome" IN ('published','rejected','unavailable')),
	CONSTRAINT "driver_candidacy_publications_failure_code_check" CHECK ("driver_candidacy_publications"."failure_code" IS NULL OR char_length("driver_candidacy_publications"."failure_code") BETWEEN 3 AND 64),
	CONSTRAINT "ck_candidacy_publication_outcome" CHECK (("driver_candidacy_publications"."outcome" = 'published' AND "driver_candidacy_publications"."failure_code" IS NULL) OR ("driver_candidacy_publications"."outcome" <> 'published' AND "driver_candidacy_publications"."failure_code" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "driver_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wasla_public_id" text NOT NULL,
	"document_type" text NOT NULL,
	"storage_ref" text NOT NULL,
	"vehicle_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"issued_at" date,
	"expires_at" date,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"rejection_reason_code" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_documents_document_type_check" CHECK ("driver_documents"."document_type" IN ('national_id','driving_license','vehicle_registration','vehicle_insurance','vehicle_photo')),
	CONSTRAINT "driver_documents_storage_ref_check" CHECK (char_length("driver_documents"."storage_ref") BETWEEN 8 AND 200),
	CONSTRAINT "driver_documents_status_check" CHECK ("driver_documents"."status" IN ('pending','verified','rejected','superseded')),
	CONSTRAINT "driver_documents_reviewed_by_check" CHECK ("driver_documents"."reviewed_by" IS NULL OR char_length("driver_documents"."reviewed_by") BETWEEN 2 AND 64),
	CONSTRAINT "driver_documents_rejection_reason_code_check" CHECK ("driver_documents"."rejection_reason_code" IS NULL OR char_length("driver_documents"."rejection_reason_code") BETWEEN 3 AND 64),
	CONSTRAINT "driver_documents_idempotency_key_check" CHECK (char_length("driver_documents"."idempotency_key") BETWEEN 8 AND 128),
	CONSTRAINT "ck_driver_documents_review_coherence" CHECK (("driver_documents"."status" = 'pending' AND "driver_documents"."reviewed_at" IS NULL AND "driver_documents"."reviewed_by" IS NULL AND "driver_documents"."rejection_reason_code" IS NULL) OR ("driver_documents"."status" = 'verified' AND "driver_documents"."reviewed_at" IS NOT NULL AND "driver_documents"."reviewed_by" IS NOT NULL AND "driver_documents"."rejection_reason_code" IS NULL) OR ("driver_documents"."status" = 'rejected' AND "driver_documents"."reviewed_at" IS NOT NULL AND "driver_documents"."reviewed_by" IS NOT NULL AND "driver_documents"."rejection_reason_code" IS NOT NULL) OR ("driver_documents"."status" = 'superseded')),
	CONSTRAINT "ck_driver_documents_dates" CHECK ("driver_documents"."issued_at" IS NULL OR "driver_documents"."expires_at" IS NULL OR "driver_documents"."expires_at" > "driver_documents"."issued_at"),
	CONSTRAINT "ck_driver_documents_vehicle_scope" CHECK (("driver_documents"."document_type" IN ('vehicle_registration','vehicle_insurance','vehicle_photo') AND "driver_documents"."vehicle_id" IS NOT NULL) OR ("driver_documents"."document_type" IN ('national_id','driving_license') AND "driver_documents"."vehicle_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "driver_eligibility_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"wasla_public_id" text NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"reasons" text[] DEFAULT '{}' NOT NULL,
	"policy_version" integer NOT NULL,
	"trigger" text NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_eligibility_log_from_state_check" CHECK ("driver_eligibility_log"."from_state" IS NULL OR "driver_eligibility_log"."from_state" IN ('eligible','ineligible','suspended','unknown')),
	CONSTRAINT "driver_eligibility_log_to_state_check" CHECK ("driver_eligibility_log"."to_state" IN ('eligible','ineligible','suspended','unknown')),
	CONSTRAINT "driver_eligibility_log_policy_version_check" CHECK ("driver_eligibility_log"."policy_version" >= 1),
	CONSTRAINT "driver_eligibility_log_trigger_check" CHECK ("driver_eligibility_log"."trigger" IN ('profile_changed','document_reviewed','document_submitted','vehicle_changed','zones_changed','availability_declared','suspended','reinstated','expiry_tick','recompute')),
	CONSTRAINT "ck_eligibility_log_reasons" CHECK ("driver_eligibility_log"."to_state" = 'eligible' OR cardinality("driver_eligibility_log"."reasons") >= 1)
);
--> statement-breakpoint
CREATE TABLE "driver_eligibility_policies" (
	"version" integer PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"required_documents_ride" text[] DEFAULT ARRAY['national_id','driving_license','vehicle_registration']::TEXT[] NOT NULL,
	"required_documents_delivery" text[] DEFAULT ARRAY['national_id','driving_license','vehicle_registration']::TEXT[] NOT NULL,
	"require_primary_vehicle" boolean DEFAULT true NOT NULL,
	"require_service_zone" boolean DEFAULT true NOT NULL,
	"document_grace_days" integer DEFAULT 0 NOT NULL,
	"is_frozen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_eligibility_policies_version_check" CHECK ("driver_eligibility_policies"."version" >= 1),
	CONSTRAINT "driver_eligibility_policies_label_check" CHECK (char_length("driver_eligibility_policies"."label") BETWEEN 3 AND 64),
	CONSTRAINT "driver_eligibility_policies_document_grace_days_check" CHECK ("driver_eligibility_policies"."document_grace_days" BETWEEN 0 AND 60),
	CONSTRAINT "ck_policy_required_documents_known" CHECK ("driver_eligibility_policies"."required_documents_ride" <@ ARRAY['national_id','driving_license','vehicle_registration','vehicle_insurance','vehicle_photo']::TEXT[] AND "driver_eligibility_policies"."required_documents_delivery" <@ ARRAY['national_id','driving_license','vehicle_registration','vehicle_insurance','vehicle_photo']::TEXT[])
);
--> statement-breakpoint
CREATE TABLE "driver_idempotency" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"payload_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_idempotency_idempotency_key_check" CHECK (char_length("driver_idempotency"."idempotency_key") BETWEEN 8 AND 192),
	CONSTRAINT "driver_idempotency_payload_fingerprint_check" CHECK (char_length("driver_idempotency"."payload_fingerprint") BETWEEN 1 AND 4096)
);
--> statement-breakpoint
CREATE TABLE "driver_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_version" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "driver_outbox_event_id_key" UNIQUE("event_id"),
	CONSTRAINT "driver_outbox_aggregate_type_check" CHECK ("driver_outbox"."aggregate_type" IN ('driver','driver_document','driver_vehicle'))
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"wasla_public_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"preferred_locale" text DEFAULT 'ar' NOT NULL,
	"work_city_zone_id" uuid,
	"service_kinds" text[] DEFAULT '{}' NOT NULL,
	"declared_availability" text DEFAULT 'offline' NOT NULL,
	"verification_status" text DEFAULT 'unverified' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"suspension_reason_code" text,
	"eligibility_policy_version" integer DEFAULT 1 NOT NULL,
	"eligibility_recheck_at" timestamp with time zone,
	"last_published_state" text,
	"last_published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_profiles_wasla_public_id_check" CHECK ("driver_profiles"."wasla_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "driver_profiles_display_name_check" CHECK ("driver_profiles"."display_name" IS NULL OR char_length("driver_profiles"."display_name") BETWEEN 1 AND 80),
	CONSTRAINT "driver_profiles_preferred_locale_check" CHECK ("driver_profiles"."preferred_locale" IN ('ar','en','ur')),
	CONSTRAINT "driver_profiles_service_kinds_check" CHECK (array_length("driver_profiles"."service_kinds", 1) IS NULL OR "driver_profiles"."service_kinds" <@ ARRAY['ride','delivery']::TEXT[]),
	CONSTRAINT "driver_profiles_declared_availability_check" CHECK ("driver_profiles"."declared_availability" IN ('available','offline')),
	CONSTRAINT "driver_profiles_verification_status_check" CHECK ("driver_profiles"."verification_status" IN ('unverified','pending_review','verified','rejected')),
	CONSTRAINT "driver_profiles_status_check" CHECK ("driver_profiles"."status" IN ('active','suspended')),
	CONSTRAINT "driver_profiles_suspension_reason_code_check" CHECK ("driver_profiles"."suspension_reason_code" IS NULL OR char_length("driver_profiles"."suspension_reason_code") BETWEEN 3 AND 64),
	CONSTRAINT "driver_profiles_eligibility_policy_version_check" CHECK ("driver_profiles"."eligibility_policy_version" >= 1),
	CONSTRAINT "driver_profiles_last_published_state_check" CHECK ("driver_profiles"."last_published_state" IS NULL OR "driver_profiles"."last_published_state" IN ('eligible','ineligible','suspended','unknown')),
	CONSTRAINT "ck_driver_profiles_suspension_reason" CHECK (("driver_profiles"."status" = 'suspended' AND "driver_profiles"."suspension_reason_code" IS NOT NULL) OR ("driver_profiles"."status" = 'active' AND "driver_profiles"."suspension_reason_code" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "driver_service_zones" (
	"wasla_public_id" text NOT NULL,
	"zone_id" uuid NOT NULL,
	"preference_rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_service_zones_pkey" PRIMARY KEY("wasla_public_id","zone_id"),
	CONSTRAINT "driver_service_zones_preference_rank_check" CHECK ("driver_service_zones"."preference_rank" BETWEEN 1 AND 50)
);
--> statement-breakpoint
CREATE TABLE "driver_vehicles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wasla_public_id" text NOT NULL,
	"vehicle_class" text NOT NULL,
	"make" text,
	"model" text,
	"model_year" integer,
	"color" text,
	"plate_number" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_vehicles_vehicle_class_check" CHECK ("driver_vehicles"."vehicle_class" IN ('sedan','suv','van','pickup','motorcycle','truck_small')),
	CONSTRAINT "driver_vehicles_make_check" CHECK ("driver_vehicles"."make" IS NULL OR char_length("driver_vehicles"."make") BETWEEN 1 AND 40),
	CONSTRAINT "driver_vehicles_model_check" CHECK ("driver_vehicles"."model" IS NULL OR char_length("driver_vehicles"."model") BETWEEN 1 AND 40),
	CONSTRAINT "driver_vehicles_model_year_check" CHECK ("driver_vehicles"."model_year" IS NULL OR "driver_vehicles"."model_year" BETWEEN 1970 AND 2100),
	CONSTRAINT "driver_vehicles_color_check" CHECK ("driver_vehicles"."color" IS NULL OR char_length("driver_vehicles"."color") BETWEEN 1 AND 24),
	CONSTRAINT "driver_vehicles_plate_number_check" CHECK ("driver_vehicles"."plate_number" IS NULL OR char_length("driver_vehicles"."plate_number") BETWEEN 3 AND 16),
	CONSTRAINT "driver_vehicles_status_check" CHECK ("driver_vehicles"."status" IN ('active','retired')),
	CONSTRAINT "driver_vehicles_idempotency_key_check" CHECK (char_length("driver_vehicles"."idempotency_key") BETWEEN 8 AND 128),
	CONSTRAINT "ck_driver_vehicles_retired_not_primary" CHECK ("driver_vehicles"."status" = 'active' OR "driver_vehicles"."is_primary" = false)
);
--> statement-breakpoint
ALTER TABLE "driver_candidacy_publications" ADD CONSTRAINT "driver_candidacy_publications_wasla_public_id_fkey" FOREIGN KEY ("wasla_public_id") REFERENCES "public"."driver_profiles"("wasla_public_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_wasla_public_id_fkey" FOREIGN KEY ("wasla_public_id") REFERENCES "public"."driver_profiles"("wasla_public_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."driver_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_eligibility_log" ADD CONSTRAINT "driver_eligibility_log_wasla_public_id_fkey" FOREIGN KEY ("wasla_public_id") REFERENCES "public"."driver_profiles"("wasla_public_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_service_zones" ADD CONSTRAINT "driver_service_zones_wasla_public_id_fkey" FOREIGN KEY ("wasla_public_id") REFERENCES "public"."driver_profiles"("wasla_public_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_vehicles" ADD CONSTRAINT "driver_vehicles_wasla_public_id_fkey" FOREIGN KEY ("wasla_public_id") REFERENCES "public"."driver_profiles"("wasla_public_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_driver_candidacy_publications_driver" ON "driver_candidacy_publications" USING btree ("wasla_public_id","attempted_at" DESC);--> statement-breakpoint
CREATE INDEX "ix_driver_candidacy_publications_failed" ON "driver_candidacy_publications" USING btree ("attempted_at" DESC) WHERE "driver_candidacy_publications"."outcome" <> 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "ux_driver_documents_one_live_per_type" ON "driver_documents" USING btree ("wasla_public_id","document_type",COALESCE("vehicle_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "driver_documents"."status" IN ('pending','verified');--> statement-breakpoint
CREATE UNIQUE INDEX "ux_driver_documents_idempotency" ON "driver_documents" USING btree ("wasla_public_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_driver_documents_owner" ON "driver_documents" USING btree ("wasla_public_id","status");--> statement-breakpoint
CREATE INDEX "ix_driver_documents_expiry" ON "driver_documents" USING btree ("expires_at") WHERE "driver_documents"."status" = 'verified' AND "driver_documents"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_driver_eligibility_log_driver" ON "driver_eligibility_log" USING btree ("wasla_public_id","evaluated_at" DESC);--> statement-breakpoint
CREATE INDEX "ix_driver_outbox_unpublished" ON "driver_outbox" USING btree ("occurred_at") WHERE "driver_outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_driver_profiles_recheck" ON "driver_profiles" USING btree ("eligibility_recheck_at") WHERE "driver_profiles"."eligibility_recheck_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_driver_profiles_work_city" ON "driver_profiles" USING btree ("work_city_zone_id") WHERE "driver_profiles"."work_city_zone_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_driver_service_zones_rank" ON "driver_service_zones" USING btree ("wasla_public_id","preference_rank");--> statement-breakpoint
CREATE INDEX "ix_driver_service_zones_zone" ON "driver_service_zones" USING btree ("zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_driver_vehicles_one_primary" ON "driver_vehicles" USING btree ("wasla_public_id") WHERE "driver_vehicles"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "ux_driver_vehicles_idempotency" ON "driver_vehicles" USING btree ("wasla_public_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_driver_vehicles_owner" ON "driver_vehicles" USING btree ("wasla_public_id","status");--> statement-breakpoint
-- ═════════════════════════════════════════════════════════════════════
-- إلحاقٌ مُراجَعٌ — خارجَ نطاقِ التوليدِ (ADR-024 §2.1)
--
-- دالةُ `driver_set_updated_at()` ومُطلِقاتُها الثلاثةُ لا يعرفُها تعبيرُ
-- الإسقاطِ (schema.ts) فلا يولِّدُها drizzle-kit، وكذلك seed النسخةِ 1 من
-- driver_eligibility_policies في العقدِ (contracts/schema.sql). تُلحَقُ هنا
-- بيدٍ **مُعلَمةٍ صريحاً** فلا يُدَّعى أنّها مولَّدةٌ وهي مُلحَقةٌ، ويقيسُ
-- اختبارُ الدورةِ الكاملةِ (migrations.integration.test.ts) بقاءَ الكلِّ
-- مطابقاً للعقدِ حرفاً عبرَ مقارنةِ الفهرسِ على سبعةِ أبعادٍ.
-- النسخةُ 1 'saudi-launch-v1' مُجمَّدةٌ: قرارُ أهليّةٍ لا يُعادُ إنتاجُه
-- إن غابَ صفُّ سياساتِه.
-- ═════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION "driver_set_updated_at"() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "trg_driver_profiles_updated_at" BEFORE UPDATE ON "driver_profiles"
    FOR EACH ROW EXECUTE FUNCTION "driver_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "trg_driver_vehicles_updated_at" BEFORE UPDATE ON "driver_vehicles"
    FOR EACH ROW EXECUTE FUNCTION "driver_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "trg_driver_documents_updated_at" BEFORE UPDATE ON "driver_documents"
    FOR EACH ROW EXECUTE FUNCTION "driver_set_updated_at"();--> statement-breakpoint
INSERT INTO "driver_eligibility_policies" ("version", "label", "is_frozen")
VALUES (1, 'saudi-launch-v1', TRUE)
ON CONFLICT ("version") DO NOTHING;--> statement-breakpoint
