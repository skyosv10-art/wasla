CREATE TABLE "fraud_signals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_public_id" text NOT NULL,
	"rule_code" text NOT NULL,
	"severity" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"window_ended_at" timestamp with time zone NOT NULL,
	"observed_count" integer NOT NULL,
	"threshold_count" integer NOT NULL,
	"ruleset_version" integer NOT NULL,
	"raised_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trace_id" text,
	CONSTRAINT "ux_fraud_signals_rule_window" UNIQUE("subject_type","subject_public_id","rule_code","window_ended_at"),
	CONSTRAINT "fraud_signals_subject_type_check" CHECK ("fraud_signals"."subject_type" IN ('customer','driver')),
	CONSTRAINT "fraud_signals_subject_public_id_check" CHECK ("fraud_signals"."subject_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "fraud_signals_rule_code_check" CHECK ("fraud_signals"."rule_code" IN ('repeated_customer_cancellation','repeated_driver_cancellation','accept_then_abandon','offer_timeout_streak','rating_extremity_burst')),
	CONSTRAINT "fraud_signals_severity_check" CHECK ("fraud_signals"."severity" IN ('low','medium','high')),
	CONSTRAINT "fraud_signals_observed_count_check" CHECK ("fraud_signals"."observed_count" >= 0),
	CONSTRAINT "fraud_signals_threshold_count_check" CHECK ("fraud_signals"."threshold_count" >= 2),
	CONSTRAINT "ck_fraud_signals_window_order" CHECK ("fraud_signals"."window_ended_at" > "fraud_signals"."window_started_at"),
	CONSTRAINT "ck_fraud_signals_over_threshold" CHECK ("fraud_signals"."observed_count" >= "fraud_signals"."threshold_count")
);
--> statement-breakpoint
CREATE TABLE "reputation_facts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_public_id" text NOT NULL,
	"fact_kind" text NOT NULL,
	"order_public_id" text NOT NULL,
	"source_event_type" text NOT NULL,
	"source_event_id" uuid NOT NULL,
	"source_sequence" integer NOT NULL,
	"actor_type" text NOT NULL,
	"reason_code" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trace_id" text,
	CONSTRAINT "ux_reputation_facts_source" UNIQUE("subject_type","subject_public_id","fact_kind","order_public_id","source_sequence"),
	CONSTRAINT "reputation_facts_subject_type_check" CHECK ("reputation_facts"."subject_type" IN ('customer','driver')),
	CONSTRAINT "reputation_facts_subject_public_id_check" CHECK ("reputation_facts"."subject_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "reputation_facts_fact_kind_check" CHECK ("reputation_facts"."fact_kind" IN ('order_completed','order_cancelled_by_customer','order_cancelled_by_driver','assignment_accepted','assignment_rejected','assignment_timed_out','rating_received')),
	CONSTRAINT "reputation_facts_order_public_id_check" CHECK ("reputation_facts"."order_public_id" ~ '^ORD-[0-9]{10}$'),
	CONSTRAINT "reputation_facts_source_event_type_check" CHECK (char_length("reputation_facts"."source_event_type") >= 3),
	CONSTRAINT "reputation_facts_source_sequence_check" CHECK ("reputation_facts"."source_sequence" >= 1),
	CONSTRAINT "reputation_facts_actor_type_check" CHECK ("reputation_facts"."actor_type" IN ('system','customer','driver','partner','admin')),
	CONSTRAINT "reputation_facts_reason_code_check" CHECK ("reputation_facts"."reason_code" IS NULL OR char_length("reputation_facts"."reason_code") BETWEEN 2 AND 64)
);
--> statement-breakpoint
CREATE TABLE "reputation_fraud_thresholds" (
	"ruleset_version" integer NOT NULL,
	"rule_code" text NOT NULL,
	"subject_type" text NOT NULL,
	"threshold_count" integer NOT NULL,
	"severity" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_reputation_fraud_thresholds" PRIMARY KEY("ruleset_version","rule_code"),
	CONSTRAINT "reputation_fraud_thresholds_rule_code_check" CHECK ("reputation_fraud_thresholds"."rule_code" IN ('repeated_customer_cancellation','repeated_driver_cancellation','accept_then_abandon','offer_timeout_streak','rating_extremity_burst')),
	CONSTRAINT "reputation_fraud_thresholds_subject_type_check" CHECK ("reputation_fraud_thresholds"."subject_type" IN ('customer','driver')),
	CONSTRAINT "reputation_fraud_thresholds_threshold_count_check" CHECK ("reputation_fraud_thresholds"."threshold_count" BETWEEN 2 AND 100),
	CONSTRAINT "reputation_fraud_thresholds_severity_check" CHECK ("reputation_fraud_thresholds"."severity" IN ('low','medium','high'))
);
--> statement-breakpoint
CREATE TABLE "reputation_idempotency" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"subject_public_id" text,
	"payload_fingerprint" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reputation_idempotency_idempotency_key_check" CHECK (char_length("reputation_idempotency"."idempotency_key") BETWEEN 8 AND 128),
	CONSTRAINT "reputation_idempotency_scope_check" CHECK ("reputation_idempotency"."scope" IN ('record_fact','submit_rating','recompute_score','tick')),
	CONSTRAINT "reputation_idempotency_subject_public_id_check" CHECK ("reputation_idempotency"."subject_public_id" IS NULL OR "reputation_idempotency"."subject_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "reputation_idempotency_payload_fingerprint_check" CHECK (char_length("reputation_idempotency"."payload_fingerprint") = 64),
	CONSTRAINT "reputation_idempotency_response_status_check" CHECK ("reputation_idempotency"."response_status" BETWEEN 100 AND 599)
);
--> statement-breakpoint
CREATE TABLE "reputation_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"event_version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reputation_outbox_aggregate_type_check" CHECK ("reputation_outbox"."aggregate_type" IN ('reputation_fact','reputation_score','reputation_rating','fraud_signal')),
	CONSTRAINT "reputation_outbox_event_type_check" CHECK (char_length("reputation_outbox"."event_type") >= 3),
	CONSTRAINT "reputation_outbox_event_version_check" CHECK ("reputation_outbox"."event_version" ~ '^v[0-9]+$'),
	CONSTRAINT "reputation_outbox_attempts_check" CHECK ("reputation_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reputation_ratings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_public_id" text NOT NULL,
	"rater_type" text NOT NULL,
	"rater_public_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_public_id" text NOT NULL,
	"stars" smallint NOT NULL,
	"reason_code" text,
	"ruleset_version" integer NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trace_id" text,
	CONSTRAINT "ux_reputation_ratings_order_pair" UNIQUE("order_public_id","rater_public_id","subject_public_id"),
	CONSTRAINT "reputation_ratings_order_public_id_check" CHECK ("reputation_ratings"."order_public_id" ~ '^ORD-[0-9]{10}$'),
	CONSTRAINT "reputation_ratings_rater_type_check" CHECK ("reputation_ratings"."rater_type" IN ('customer','driver')),
	CONSTRAINT "reputation_ratings_rater_public_id_check" CHECK ("reputation_ratings"."rater_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "reputation_ratings_subject_type_check" CHECK ("reputation_ratings"."subject_type" IN ('customer','driver')),
	CONSTRAINT "reputation_ratings_subject_public_id_check" CHECK ("reputation_ratings"."subject_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "reputation_ratings_stars_check" CHECK ("reputation_ratings"."stars" BETWEEN 1 AND 5),
	CONSTRAINT "reputation_ratings_reason_code_check" CHECK ("reputation_ratings"."reason_code" IS NULL OR "reputation_ratings"."reason_code" IN ('on_time','late_arrival','courteous','poor_conduct','unsafe_driving','vehicle_condition','route_deviation','no_show')),
	CONSTRAINT "ck_reputation_ratings_no_self" CHECK ("reputation_ratings"."rater_public_id" <> "reputation_ratings"."subject_public_id"),
	CONSTRAINT "ck_reputation_ratings_cross_side" CHECK ("reputation_ratings"."rater_type" <> "reputation_ratings"."subject_type")
);
--> statement-breakpoint
CREATE TABLE "reputation_rule_weights" (
	"ruleset_version" integer NOT NULL,
	"subject_type" text NOT NULL,
	"fact_kind" text NOT NULL,
	"weight_points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_reputation_rule_weights" PRIMARY KEY("ruleset_version","subject_type","fact_kind"),
	CONSTRAINT "reputation_rule_weights_subject_type_check" CHECK ("reputation_rule_weights"."subject_type" IN ('customer','driver')),
	CONSTRAINT "reputation_rule_weights_fact_kind_check" CHECK ("reputation_rule_weights"."fact_kind" IN ('order_completed','order_cancelled_by_customer','order_cancelled_by_driver','assignment_accepted','assignment_rejected','assignment_timed_out','rating_received')),
	CONSTRAINT "reputation_rule_weights_weight_points_check" CHECK ("reputation_rule_weights"."weight_points" BETWEEN -50 AND 50)
);
--> statement-breakpoint
CREATE TABLE "reputation_rulesets" (
	"ruleset_version" integer PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"score_floor" integer NOT NULL,
	"score_ceiling" integer NOT NULL,
	"starting_score" integer NOT NULL,
	"min_facts_for_score" integer NOT NULL,
	"decay_half_life_days" integer NOT NULL,
	"tier_standard_at" integer NOT NULL,
	"tier_trusted_at" integer NOT NULL,
	"tier_under_watch_below" integer NOT NULL,
	"rating_window_hours" integer NOT NULL,
	"fraud_window_days" integer NOT NULL,
	"recompute_interval_hours" integer NOT NULL,
	"is_frozen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reputation_rulesets_ruleset_version_check" CHECK ("reputation_rulesets"."ruleset_version" >= 1),
	CONSTRAINT "reputation_rulesets_label_check" CHECK (char_length("reputation_rulesets"."label") BETWEEN 3 AND 64),
	CONSTRAINT "reputation_rulesets_score_floor_check" CHECK ("reputation_rulesets"."score_floor" >= 0),
	CONSTRAINT "reputation_rulesets_score_ceiling_check" CHECK ("reputation_rulesets"."score_ceiling" > 0),
	CONSTRAINT "reputation_rulesets_starting_score_check" CHECK ("reputation_rulesets"."starting_score" >= 0),
	CONSTRAINT "reputation_rulesets_min_facts_for_score_check" CHECK ("reputation_rulesets"."min_facts_for_score" BETWEEN 1 AND 100),
	CONSTRAINT "reputation_rulesets_decay_half_life_days_check" CHECK ("reputation_rulesets"."decay_half_life_days" BETWEEN 7 AND 720),
	CONSTRAINT "reputation_rulesets_tier_standard_at_check" CHECK ("reputation_rulesets"."tier_standard_at" >= 0),
	CONSTRAINT "reputation_rulesets_tier_trusted_at_check" CHECK ("reputation_rulesets"."tier_trusted_at" >= 0),
	CONSTRAINT "reputation_rulesets_tier_under_watch_below_check" CHECK ("reputation_rulesets"."tier_under_watch_below" >= 0),
	CONSTRAINT "reputation_rulesets_rating_window_hours_check" CHECK ("reputation_rulesets"."rating_window_hours" BETWEEN 1 AND 720),
	CONSTRAINT "reputation_rulesets_fraud_window_days_check" CHECK ("reputation_rulesets"."fraud_window_days" BETWEEN 1 AND 90),
	CONSTRAINT "reputation_rulesets_recompute_interval_hours_check" CHECK ("reputation_rulesets"."recompute_interval_hours" BETWEEN 1 AND 168),
	CONSTRAINT "ck_reputation_rulesets_score_bounds" CHECK ("reputation_rulesets"."score_ceiling" > "reputation_rulesets"."score_floor"),
	CONSTRAINT "ck_reputation_rulesets_start_in_bounds" CHECK ("reputation_rulesets"."starting_score" >= "reputation_rulesets"."score_floor" AND "reputation_rulesets"."starting_score" <= "reputation_rulesets"."score_ceiling"),
	CONSTRAINT "ck_reputation_rulesets_tier_order" CHECK ("reputation_rulesets"."tier_trusted_at" > "reputation_rulesets"."tier_standard_at" AND "reputation_rulesets"."tier_under_watch_below" <= "reputation_rulesets"."tier_standard_at")
);
--> statement-breakpoint
CREATE TABLE "reputation_scores" (
	"subject_type" text NOT NULL,
	"subject_public_id" text NOT NULL,
	"ruleset_version" integer NOT NULL,
	"score_points" integer NOT NULL,
	"tier" text NOT NULL,
	"fact_count" integer NOT NULL,
	"computed_through_fact_id" uuid,
	"computed_at" timestamp with time zone NOT NULL,
	"next_recompute_at" timestamp with time zone NOT NULL,
	"trace_id" text,
	CONSTRAINT "pk_reputation_scores" PRIMARY KEY("subject_type","subject_public_id"),
	CONSTRAINT "reputation_scores_subject_type_check" CHECK ("reputation_scores"."subject_type" IN ('customer','driver')),
	CONSTRAINT "reputation_scores_subject_public_id_check" CHECK ("reputation_scores"."subject_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "reputation_scores_tier_check" CHECK ("reputation_scores"."tier" IN ('new','standard','trusted','under_watch')),
	CONSTRAINT "reputation_scores_fact_count_check" CHECK ("reputation_scores"."fact_count" >= 0),
	CONSTRAINT "ck_reputation_scores_non_negative" CHECK ("reputation_scores"."score_points" >= 0),
	CONSTRAINT "ck_reputation_scores_new_has_no_history" CHECK ("reputation_scores"."tier" <> 'new' OR "reputation_scores"."fact_count" = 0 OR "reputation_scores"."computed_through_fact_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "fraud_signals" ADD CONSTRAINT "fraud_signals_ruleset_version_fkey" FOREIGN KEY ("ruleset_version") REFERENCES "public"."reputation_rulesets"("ruleset_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_fraud_thresholds" ADD CONSTRAINT "reputation_fraud_thresholds_ruleset_version_fkey" FOREIGN KEY ("ruleset_version") REFERENCES "public"."reputation_rulesets"("ruleset_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_ratings" ADD CONSTRAINT "reputation_ratings_ruleset_version_fkey" FOREIGN KEY ("ruleset_version") REFERENCES "public"."reputation_rulesets"("ruleset_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_rule_weights" ADD CONSTRAINT "reputation_rule_weights_ruleset_version_fkey" FOREIGN KEY ("ruleset_version") REFERENCES "public"."reputation_rulesets"("ruleset_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_scores" ADD CONSTRAINT "reputation_scores_ruleset_version_fkey" FOREIGN KEY ("ruleset_version") REFERENCES "public"."reputation_rulesets"("ruleset_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_fraud_signals_subject" ON "fraud_signals" USING btree ("subject_type","subject_public_id","raised_at" DESC);--> statement-breakpoint
CREATE INDEX "ix_fraud_signals_rule" ON "fraud_signals" USING btree ("rule_code","raised_at" DESC);--> statement-breakpoint
CREATE INDEX "ix_reputation_facts_subject" ON "reputation_facts" USING btree ("subject_type","subject_public_id","occurred_at" DESC);--> statement-breakpoint
CREATE INDEX "ix_reputation_facts_order" ON "reputation_facts" USING btree ("order_public_id");--> statement-breakpoint
CREATE INDEX "ix_reputation_facts_kind_window" ON "reputation_facts" USING btree ("subject_type","subject_public_id","fact_kind","occurred_at" DESC);--> statement-breakpoint
CREATE INDEX "ix_reputation_idempotency_subject" ON "reputation_idempotency" USING btree ("subject_public_id");--> statement-breakpoint
CREATE INDEX "ix_reputation_outbox_unpublished" ON "reputation_outbox" USING btree ("occurred_at") WHERE "reputation_outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_reputation_ratings_subject" ON "reputation_ratings" USING btree ("subject_type","subject_public_id","submitted_at" DESC);--> statement-breakpoint
CREATE INDEX "ix_reputation_ratings_order" ON "reputation_ratings" USING btree ("order_public_id");--> statement-breakpoint
CREATE INDEX "ix_reputation_scores_tier" ON "reputation_scores" USING btree ("subject_type","tier","score_points" DESC);--> statement-breakpoint
CREATE INDEX "ix_reputation_scores_recompute_due" ON "reputation_scores" USING btree ("next_recompute_at");
-- ═══════════════════════════════════════════════════════════════════════
-- إلحاقٌ مُراجَعٌ — خارجَ نطاقِ التوليدِ (ADR-024 §2.1)
--
-- drizzle-kit لا يُولِّدُ `INSERT` من `pgTable`، والبذورُ جزءٌ من العقدِ
-- (`contracts/schema.sql`): من دونها القاعدةُ تعملُ لكنّ التفسيرَ يستحيل — كلُّ
-- واقعةٍ ونقطةٍ وإشارةٍ تُفسَّرُ بجدولِ الأوزانِ والعتباتِ والحدودِ التي حكمتها.
-- النصُّ أدناه **حرفيّاً** كما في العقدِ (المراجعة 1/6)، والمصدرُ القانونيُّ يبقى
-- العقدَ: هذا الإلحاقُ ترحيلٌ لا مصدرَ ثانياً.
-- ═══════════════════════════════════════════════════════════════════════

-- النسخة 1: أرقامٌ مُعلَنة لا إغفال. من يريد غيرها يُصدر نسخة 2 ويُبرّرها في ADR.
INSERT INTO reputation_rulesets (
    ruleset_version, label,
    score_floor, score_ceiling, starting_score,
    min_facts_for_score, decay_half_life_days,
    tier_standard_at, tier_trusted_at, tier_under_watch_below,
    rating_window_hours, fraud_window_days, recompute_interval_hours,
    is_frozen
)
VALUES (1, 'saudi-launch-v1', 0, 100, 60, 5, 180, 50, 80, 35, 72, 30, 24, true)
ON CONFLICT (ruleset_version) DO NOTHING;

-- أوزان النسخة 1. الاكتمال يبني، والإلغاء يخصم، والتخلّي بعد القبول أثقلُ خصمٍ للسائق.
INSERT INTO reputation_rule_weights (ruleset_version, subject_type, fact_kind, weight_points)
VALUES
    (1, 'customer', 'order_completed',              3),
    (1, 'customer', 'order_cancelled_by_customer', -6),
    (1, 'customer', 'rating_received',              2),
    (1, 'driver',   'order_completed',              4),
    (1, 'driver',   'order_cancelled_by_driver',   -9),
    (1, 'driver',   'assignment_accepted',          1),
    (1, 'driver',   'assignment_rejected',          0),
    (1, 'driver',   'assignment_timed_out',        -2),
    (1, 'driver',   'rating_received',              2)
ON CONFLICT (ruleset_version, subject_type, fact_kind) DO NOTHING;

-- عتبات قواعد الاحتيال، مفصولةً عن الأوزان لأنّها تُقاس بالعدد لا بالنقاط.
INSERT INTO reputation_fraud_thresholds (ruleset_version, rule_code, subject_type, threshold_count, severity)
VALUES
    (1, 'repeated_customer_cancellation', 'customer',  5, 'medium'),
    (1, 'repeated_driver_cancellation',   'driver',    4, 'medium'),
    (1, 'accept_then_abandon',            'driver',    3, 'high'),
    (1, 'offer_timeout_streak',           'driver',   10, 'low'),
    (1, 'rating_extremity_burst',         'customer',  8, 'low')
ON CONFLICT (ruleset_version, rule_code) DO NOTHING;
