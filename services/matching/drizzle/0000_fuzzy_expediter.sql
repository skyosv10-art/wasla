CREATE TABLE "driver_candidacy" (
	"driver_public_id" text PRIMARY KEY NOT NULL,
	"availability_state" text DEFAULT 'offline' NOT NULL,
	"eligibility_state" text DEFAULT 'unknown' NOT NULL,
	"eligibility_source" text DEFAULT 'claimed' NOT NULL,
	"service_kinds" text[] DEFAULT '{}' NOT NULL,
	"vehicle_class" text,
	"zone_ids" uuid[] DEFAULT '{}' NOT NULL,
	"last_offered_at" timestamp with time zone,
	"last_assigned_at" timestamp with time zone,
	"offers_received" integer DEFAULT 0 NOT NULL,
	"offers_accepted" integer DEFAULT 0 NOT NULL,
	"orders_completed" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT 'unknown' NOT NULL,
	CONSTRAINT "driver_candidacy_driver_public_id_check" CHECK ("driver_candidacy"."driver_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "driver_candidacy_availability_state_check" CHECK ("driver_candidacy"."availability_state" IN ('available','busy','offline')),
	CONSTRAINT "driver_candidacy_eligibility_state_check" CHECK ("driver_candidacy"."eligibility_state" IN ('eligible','ineligible','suspended','unknown')),
	CONSTRAINT "driver_candidacy_eligibility_source_check" CHECK ("driver_candidacy"."eligibility_source" IN ('claimed','driver_core')),
	CONSTRAINT "driver_candidacy_service_kinds_check" CHECK (array_length("driver_candidacy"."service_kinds", 1) IS NULL OR "driver_candidacy"."service_kinds" <@ ARRAY['ride','delivery']::TEXT[]),
	CONSTRAINT "driver_candidacy_vehicle_class_check" CHECK ("driver_candidacy"."vehicle_class" IS NULL OR "driver_candidacy"."vehicle_class" IN ('sedan','suv','van','pickup','motorcycle','truck_small')),
	CONSTRAINT "driver_candidacy_offers_received_check" CHECK ("driver_candidacy"."offers_received" >= 0),
	CONSTRAINT "driver_candidacy_offers_accepted_check" CHECK ("driver_candidacy"."offers_accepted" >= 0),
	CONSTRAINT "driver_candidacy_orders_completed_check" CHECK ("driver_candidacy"."orders_completed" >= 0),
	CONSTRAINT "ck_candidacy_accepted_lte_received" CHECK ("driver_candidacy"."offers_accepted" <= "driver_candidacy"."offers_received"),
	CONSTRAINT "driver_candidacy_updated_by_check" CHECK ("driver_candidacy"."updated_by" IN ('driver_bot','admin','driver_core','test','unknown'))
);
--> statement-breakpoint
CREATE TABLE "matching_decision_candidates" (
	"decision_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"driver_public_id" text NOT NULL,
	"score_bp" integer NOT NULL,
	"zone_proximity_bp" integer NOT NULL,
	"completion_bp" integer NOT NULL,
	"acceptance_bp" integer NOT NULL,
	"fairness_bp" integer NOT NULL,
	"tiebreak_by" text,
	CONSTRAINT "matching_decision_candidates_pkey" PRIMARY KEY("decision_id","driver_public_id"),
	CONSTRAINT "ux_decision_rank" UNIQUE("decision_id","rank"),
	CONSTRAINT "matching_decision_candidates_rank_check" CHECK ("matching_decision_candidates"."rank" >= 1),
	CONSTRAINT "matching_decision_candidates_driver_public_id_check" CHECK ("matching_decision_candidates"."driver_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "matching_decision_candidates_score_bp_check" CHECK ("matching_decision_candidates"."score_bp" BETWEEN 0 AND 10000),
	CONSTRAINT "matching_decision_candidates_zone_proximity_bp_check" CHECK ("matching_decision_candidates"."zone_proximity_bp" BETWEEN 0 AND 10000),
	CONSTRAINT "matching_decision_candidates_completion_bp_check" CHECK ("matching_decision_candidates"."completion_bp" BETWEEN 0 AND 10000),
	CONSTRAINT "matching_decision_candidates_acceptance_bp_check" CHECK ("matching_decision_candidates"."acceptance_bp" BETWEEN 0 AND 10000),
	CONSTRAINT "matching_decision_candidates_fairness_bp_check" CHECK ("matching_decision_candidates"."fairness_bp" BETWEEN 0 AND 10000),
	CONSTRAINT "matching_decision_candidates_tiebreak_by_check" CHECK ("matching_decision_candidates"."tiebreak_by" IS NULL OR "matching_decision_candidates"."tiebreak_by" IN ('score','last_offered_at','driver_public_id'))
);
--> statement-breakpoint
CREATE TABLE "matching_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"order_public_id" text NOT NULL,
	"dispatch_job_id" uuid,
	"ruleset_version" integer NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"order_type" text NOT NULL,
	"vehicle_class" text NOT NULL,
	"pickup_zone_id" uuid NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"considered_count" integer NOT NULL,
	"eligible_count" integer NOT NULL,
	"returned_count" integer NOT NULL,
	"empty_reason_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matching_decisions_order_public_id_check" CHECK ("matching_decisions"."order_public_id" ~ '^ORD-[0-9]{10}$'),
	CONSTRAINT "matching_decisions_order_type_check" CHECK ("matching_decisions"."order_type" IN ('ride','delivery')),
	CONSTRAINT "matching_decisions_excluded_count_check" CHECK ("matching_decisions"."excluded_count" >= 0),
	CONSTRAINT "matching_decisions_considered_count_check" CHECK ("matching_decisions"."considered_count" >= 0),
	CONSTRAINT "matching_decisions_eligible_count_check" CHECK ("matching_decisions"."eligible_count" >= 0),
	CONSTRAINT "matching_decisions_returned_count_check" CHECK ("matching_decisions"."returned_count" >= 0),
	CONSTRAINT "ck_decision_counts_monotonic" CHECK ("matching_decisions"."returned_count" <= "matching_decisions"."eligible_count" AND "matching_decisions"."eligible_count" <= "matching_decisions"."considered_count"),
	CONSTRAINT "matching_decisions_empty_reason_code_check" CHECK ("matching_decisions"."empty_reason_code" IS NULL OR char_length("matching_decisions"."empty_reason_code") BETWEEN 3 AND 64),
	CONSTRAINT "ck_decision_empty_has_reason" CHECK ("matching_decisions"."returned_count" > 0 OR "matching_decisions"."empty_reason_code" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "matching_idempotency" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"payload_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matching_idempotency_idempotency_key_check" CHECK (char_length("matching_idempotency"."idempotency_key") BETWEEN 8 AND 128),
	CONSTRAINT "matching_idempotency_payload_fingerprint_check" CHECK (char_length("matching_idempotency"."payload_fingerprint") BETWEEN 1 AND 4096)
);
--> statement-breakpoint
CREATE TABLE "matching_outbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"event_version" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"trace_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "matching_outbox_event_version_check" CHECK ("matching_outbox"."event_version" ~ '^v[0-9]+$'),
	CONSTRAINT "matching_outbox_aggregate_type_check" CHECK ("matching_outbox"."aggregate_type" IN ('driver_candidacy','matching_decision')),
	CONSTRAINT "matching_outbox_trace_id_check" CHECK ("matching_outbox"."trace_id" IS NULL OR char_length("matching_outbox"."trace_id") <= 128)
);
--> statement-breakpoint
CREATE TABLE "matching_rulesets" (
	"version" integer PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"w_eta" integer DEFAULT 0 NOT NULL,
	"w_distance" integer DEFAULT 0 NOT NULL,
	"w_zone_proximity" integer DEFAULT 40 NOT NULL,
	"w_completion" integer DEFAULT 20 NOT NULL,
	"w_rating" integer DEFAULT 0 NOT NULL,
	"w_acceptance" integer DEFAULT 20 NOT NULL,
	"w_fairness" integer DEFAULT 20 NOT NULL,
	"candidacy_freshness_seconds" integer DEFAULT 120 NOT NULL,
	"max_candidates" integer DEFAULT 20 NOT NULL,
	"fairness_horizon_seconds" integer DEFAULT 3600 NOT NULL,
	"is_frozen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_at" timestamp with time zone,
	CONSTRAINT "matching_rulesets_version_check" CHECK ("matching_rulesets"."version" >= 1),
	CONSTRAINT "matching_rulesets_label_check" CHECK (char_length("matching_rulesets"."label") BETWEEN 3 AND 64),
	CONSTRAINT "matching_rulesets_w_eta_check" CHECK ("matching_rulesets"."w_eta" BETWEEN 0 AND 100),
	CONSTRAINT "matching_rulesets_w_distance_check" CHECK ("matching_rulesets"."w_distance" BETWEEN 0 AND 100),
	CONSTRAINT "matching_rulesets_w_zone_proximity_check" CHECK ("matching_rulesets"."w_zone_proximity" BETWEEN 0 AND 100),
	CONSTRAINT "matching_rulesets_w_completion_check" CHECK ("matching_rulesets"."w_completion" BETWEEN 0 AND 100),
	CONSTRAINT "matching_rulesets_w_rating_check" CHECK ("matching_rulesets"."w_rating" BETWEEN 0 AND 100),
	CONSTRAINT "matching_rulesets_w_acceptance_check" CHECK ("matching_rulesets"."w_acceptance" BETWEEN 0 AND 100),
	CONSTRAINT "matching_rulesets_w_fairness_check" CHECK ("matching_rulesets"."w_fairness" BETWEEN 0 AND 100),
	CONSTRAINT "ck_ruleset_weights_sum_100" CHECK ("matching_rulesets"."w_eta" + "matching_rulesets"."w_distance" + "matching_rulesets"."w_zone_proximity" + "matching_rulesets"."w_completion" + "matching_rulesets"."w_rating" + "matching_rulesets"."w_acceptance" + "matching_rulesets"."w_fairness" = 100),
	CONSTRAINT "matching_rulesets_candidacy_freshness_seconds_check" CHECK ("matching_rulesets"."candidacy_freshness_seconds" BETWEEN 15 AND 3600),
	CONSTRAINT "matching_rulesets_max_candidates_check" CHECK ("matching_rulesets"."max_candidates" BETWEEN 1 AND 200),
	CONSTRAINT "matching_rulesets_fairness_horizon_seconds_check" CHECK ("matching_rulesets"."fairness_horizon_seconds" BETWEEN 60 AND 86400),
	CONSTRAINT "ck_ruleset_frozen_at" CHECK (("matching_rulesets"."is_frozen" = FALSE AND "matching_rulesets"."frozen_at" IS NULL) OR ("matching_rulesets"."is_frozen" = TRUE AND "matching_rulesets"."frozen_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "matching_decision_candidates" ADD CONSTRAINT "matching_decision_candidates_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "public"."matching_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_decisions" ADD CONSTRAINT "matching_decisions_ruleset_version_fkey" FOREIGN KEY ("ruleset_version") REFERENCES "public"."matching_rulesets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_candidacy_ready" ON "driver_candidacy" USING btree ("updated_at" DESC) WHERE "driver_candidacy"."availability_state" = 'available' AND "driver_candidacy"."eligibility_state" = 'eligible';--> statement-breakpoint
CREATE INDEX "ix_candidacy_zones" ON "driver_candidacy" USING gin ("zone_ids");--> statement-breakpoint
CREATE INDEX "ix_candidacy_services" ON "driver_candidacy" USING gin ("service_kinds");--> statement-breakpoint
CREATE INDEX "ix_decisions_order" ON "matching_decisions" USING btree ("order_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "ix_matching_outbox_unpublished" ON "matching_outbox" USING btree ("occurred_at") WHERE "matching_outbox"."published_at" IS NULL;--> statement-breakpoint
-- ═════════════════════════════════════════════════════════════════════
-- إلحاقٌ مُراجَعٌ — خارجَ نطاقِ التوليدِ (ADR-024 §2.1)
--
-- seed النسخة 1 من matching_rulesets في العقدِ (contracts/schema.sql) خارجَ نطاقِ
-- تعبيرِ الإسقاطِ (schema.ts)، فلا يولِّدُهُ drizzle-kit. يُلحَقُ هنا بيدٍ
-- **مُعلَمةٍ صريحاً** فلا يُدَّعى أنّهُ مولَّدٌ وهو مُلحَقٌ، ويقيسُ اختبارُ
-- الدورةِ الكاملةِ (migrations.integration.test.ts) بقاءَهُ مطابقاً للعقدِ حرفاً.
-- النسخةُ 1 هي الانحرافُ المُعلَنُ عن §30.2 (ADR-011 القرار 6): لا ETA ولا مسافة
-- ولا تقييم، فلا خدمةُ مسارٍ ولا إحداثياتٌ ولا محرّكُ سمعةٍ في المستودع.
-- ═════════════════════════════════════════════════════════════════════
INSERT INTO "matching_rulesets" (
    "version", "label",
    "w_eta", "w_distance", "w_zone_proximity", "w_completion",
    "w_rating", "w_acceptance", "w_fairness",
    "is_frozen", "frozen_at"
) VALUES (
    1, 'phase07-mvp-zone-and-fairness',
    0, 0, 40, 20,
    0, 20, 20,
    TRUE, now()
) ON CONFLICT ("version") DO NOTHING;--> statement-breakpoint
