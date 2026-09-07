CREATE TABLE "dispatch_idempotency" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"payload_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_idempotency_idempotency_key_check" CHECK (char_length("dispatch_idempotency"."idempotency_key") BETWEEN 8 AND 128),
	CONSTRAINT "dispatch_idempotency_payload_fingerprint_check" CHECK (char_length("dispatch_idempotency"."payload_fingerprint") BETWEEN 1 AND 4096)
);
--> statement-breakpoint
CREATE TABLE "dispatch_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"order_public_id" text NOT NULL,
	"zone_id" uuid NOT NULL,
	"order_type" text NOT NULL,
	"vehicle_class" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_reason_code" text,
	"ruleset_version" integer NOT NULL,
	"wave_size" smallint NOT NULL,
	"offer_timeout_seconds" integer NOT NULL,
	"max_waves" smallint NOT NULL,
	"escalation_timeout_seconds" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"escalation_expires_at" timestamp with time zone NOT NULL,
	"created_idempotency_key" text NOT NULL,
	"payload_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_jobs_order_id_key" UNIQUE("order_id"),
	CONSTRAINT "dispatch_jobs_order_public_id_key" UNIQUE("order_public_id"),
	CONSTRAINT "ux_dispatch_jobs_idempotency_key" UNIQUE("created_idempotency_key"),
	CONSTRAINT "dispatch_jobs_order_public_id_check" CHECK ("dispatch_jobs"."order_public_id" ~ '^ORD-[0-9]{10}$'),
	CONSTRAINT "dispatch_jobs_order_type_check" CHECK ("dispatch_jobs"."order_type" IN ('ride','delivery')),
	CONSTRAINT "dispatch_jobs_vehicle_class_check" CHECK ("dispatch_jobs"."vehicle_class" IN ('sedan','suv','van','pickup','motorcycle','truck_small')),
	CONSTRAINT "dispatch_jobs_status_check" CHECK ("dispatch_jobs"."status" IN ('pending','dispatching','escalated_community','assigned','exhausted','cancelled')),
	CONSTRAINT "dispatch_jobs_status_reason_code_check" CHECK ("dispatch_jobs"."status_reason_code" IS NULL OR char_length("dispatch_jobs"."status_reason_code") BETWEEN 3 AND 64),
	CONSTRAINT "dispatch_jobs_ruleset_version_check" CHECK ("dispatch_jobs"."ruleset_version" >= 1),
	CONSTRAINT "dispatch_jobs_wave_size_check" CHECK ("dispatch_jobs"."wave_size" >= 1),
	CONSTRAINT "dispatch_jobs_offer_timeout_seconds_check" CHECK ("dispatch_jobs"."offer_timeout_seconds" >= 1),
	CONSTRAINT "dispatch_jobs_max_waves_check" CHECK ("dispatch_jobs"."max_waves" >= 1),
	CONSTRAINT "dispatch_jobs_escalation_timeout_seconds_check" CHECK ("dispatch_jobs"."escalation_timeout_seconds" >= 1),
	CONSTRAINT "dispatch_jobs_created_idempotency_key_check" CHECK (char_length("dispatch_jobs"."created_idempotency_key") BETWEEN 8 AND 128),
	CONSTRAINT "dispatch_jobs_payload_fingerprint_check" CHECK (char_length("dispatch_jobs"."payload_fingerprint") = 64),
	CONSTRAINT "ck_dispatch_jobs_terminal_needs_reason" CHECK ("dispatch_jobs"."status" NOT IN ('assigned','exhausted','cancelled') OR "dispatch_jobs"."status_reason_code" IS NOT NULL),
	CONSTRAINT "ck_dispatch_jobs_deadline_order" CHECK ("dispatch_jobs"."escalation_expires_at" >= "dispatch_jobs"."expires_at")
);
--> statement-breakpoint
CREATE TABLE "dispatch_offers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"wave_id" uuid NOT NULL,
	"order_assignment_id" uuid,
	"driver_public_id" text NOT NULL,
	"status" text DEFAULT 'offered' NOT NULL,
	"reason_code" text,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_dispatch_offers_job_driver" UNIQUE("job_id","driver_public_id"),
	CONSTRAINT "dispatch_offers_driver_public_id_check" CHECK ("dispatch_offers"."driver_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "dispatch_offers_status_check" CHECK ("dispatch_offers"."status" IN ('offered','accepted','rejected','timed_out','superseded','cancelled')),
	CONSTRAINT "dispatch_offers_reason_code_check" CHECK ("dispatch_offers"."reason_code" IS NULL OR char_length("dispatch_offers"."reason_code") BETWEEN 3 AND 64),
	CONSTRAINT "ck_dispatch_offers_terminal_needs_reason" CHECK ("dispatch_offers"."status" = 'offered' OR "dispatch_offers"."reason_code" IS NOT NULL),
	CONSTRAINT "ck_dispatch_offers_state_timestamp" CHECK (("dispatch_offers"."status" = 'offered' AND "dispatch_offers"."responded_at" IS NULL AND "dispatch_offers"."resolved_at" IS NULL) OR ("dispatch_offers"."status" = 'accepted' AND "dispatch_offers"."responded_at" IS NOT NULL AND "dispatch_offers"."resolved_at" IS NOT NULL) OR ("dispatch_offers"."status" = 'rejected' AND "dispatch_offers"."responded_at" IS NOT NULL AND "dispatch_offers"."resolved_at" IS NOT NULL) OR ("dispatch_offers"."status" IN ('timed_out','superseded','cancelled') AND "dispatch_offers"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "dispatch_outbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"event_version" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"trace_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "dispatch_outbox_event_version_check" CHECK ("dispatch_outbox"."event_version" ~ '^v[0-9]+$'),
	CONSTRAINT "dispatch_outbox_aggregate_type_check" CHECK ("dispatch_outbox"."aggregate_type" IN ('dispatch_job','dispatch_offer')),
	CONSTRAINT "dispatch_outbox_trace_id_check" CHECK ("dispatch_outbox"."trace_id" IS NULL OR char_length("dispatch_outbox"."trace_id") <= 128)
);
--> statement-breakpoint
CREATE TABLE "dispatch_waves" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"wave_number" smallint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reason_code" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_dispatch_waves_job_number" UNIQUE("job_id","wave_number"),
	CONSTRAINT "dispatch_waves_wave_number_check" CHECK ("dispatch_waves"."wave_number" >= 1),
	CONSTRAINT "dispatch_waves_status_check" CHECK ("dispatch_waves"."status" IN ('open','completed','cancelled')),
	CONSTRAINT "dispatch_waves_reason_code_check" CHECK ("dispatch_waves"."reason_code" IS NULL OR char_length("dispatch_waves"."reason_code") BETWEEN 3 AND 64),
	CONSTRAINT "ck_dispatch_waves_terminal_needs_reason" CHECK ("dispatch_waves"."status" = 'open' OR "dispatch_waves"."reason_code" IS NOT NULL),
	CONSTRAINT "ck_dispatch_waves_state_timestamp" CHECK (("dispatch_waves"."status" = 'open' AND "dispatch_waves"."completed_at" IS NULL) OR ("dispatch_waves"."status" <> 'open' AND "dispatch_waves"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "dispatch_offers" ADD CONSTRAINT "dispatch_offers_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."dispatch_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_offers" ADD CONSTRAINT "dispatch_offers_wave_id_fkey" FOREIGN KEY ("wave_id") REFERENCES "public"."dispatch_waves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_waves" ADD CONSTRAINT "dispatch_waves_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."dispatch_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_dispatch_jobs_status_due" ON "dispatch_jobs" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "ix_dispatch_jobs_escalation_due" ON "dispatch_jobs" USING btree ("escalation_expires_at") WHERE "dispatch_jobs"."status" = 'escalated_community';--> statement-breakpoint
CREATE INDEX "ix_dispatch_offers_wave" ON "dispatch_offers" USING btree ("wave_id","offered_at");--> statement-breakpoint
CREATE INDEX "ix_dispatch_offers_open_due" ON "dispatch_offers" USING btree ("expires_at") WHERE "dispatch_offers"."status" = 'offered';--> statement-breakpoint
CREATE UNIQUE INDEX "ux_dispatch_offers_one_accepted_job" ON "dispatch_offers" USING btree ("job_id") WHERE "dispatch_offers"."status" = 'accepted';--> statement-breakpoint
CREATE INDEX "ix_dispatch_outbox_unpublished" ON "dispatch_outbox" USING btree ("occurred_at") WHERE "dispatch_outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_dispatch_outbox_aggregate" ON "dispatch_outbox" USING btree ("aggregate_type","aggregate_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_dispatch_waves_one_open_job" ON "dispatch_waves" USING btree ("job_id") WHERE "dispatch_waves"."status" = 'open';--> statement-breakpoint
CREATE INDEX "ix_dispatch_waves_open_due" ON "dispatch_waves" USING btree ("expires_at") WHERE "dispatch_waves"."status" = 'open';--> statement-breakpoint
-- ═════════════════════════════════════════════════════════════════════
-- إلحاقٌ مُراجَعٌ — خارجَ نطاقِ التوليدِ (ADR-024 §2.1)
--
-- الدالةُّ والمُطلِقاتُ الثلاثةُ في العقدِ (contracts/schema.sql) خارجَ نطاقِ
-- تعبيرِ الإسقاطِ (schema.ts)، فلا يولِّدُها drizzle-kit. تُلحَقُ هنا بيدٍ
-- **مُعلَمةٍ صريحاً** فلا يُدَّعى أنّها مولَّدةٌ وهي مُلحَقةٌ، ويقيسُ اختبارُ
-- التكافؤِ (migrations.integration.test.ts) بقائَها مطابقةً للعقدِ حرفاً.
-- ═════════════════════════════════════════════════════════════════════
CREATE FUNCTION dispatch_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_dispatch_jobs_updated_at BEFORE UPDATE ON dispatch_jobs
    FOR EACH ROW EXECUTE FUNCTION dispatch_set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_dispatch_waves_updated_at BEFORE UPDATE ON dispatch_waves
    FOR EACH ROW EXECUTE FUNCTION dispatch_set_updated_at();--> statement-breakpoint
CREATE TRIGGER trg_dispatch_offers_updated_at BEFORE UPDATE ON dispatch_offers
    FOR EACH ROW EXECUTE FUNCTION dispatch_set_updated_at();
