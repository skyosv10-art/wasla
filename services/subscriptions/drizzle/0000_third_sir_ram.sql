CREATE TABLE "referral_codes" (
	"referral_code" text PRIMARY KEY NOT NULL,
	"owner_public_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_referral_codes_owner" UNIQUE("owner_public_id"),
	CONSTRAINT "referral_codes_referral_code_check" CHECK ("referral_codes"."referral_code" ~ '^WR-[0-9A-Z]{8}$'),
	CONSTRAINT "referral_codes_owner_public_id_check" CHECK ("referral_codes"."owner_public_id" ~ '^WS-[0-9]{10}$')
);
--> statement-breakpoint
CREATE TABLE "referral_rewards" (
	"reward_id" uuid PRIMARY KEY NOT NULL,
	"referral_id" uuid NOT NULL,
	"granted_period_id" uuid NOT NULL,
	"beneficiary_public_id" text NOT NULL,
	"reward_days" integer NOT NULL,
	"plan_code" text NOT NULL,
	"plan_version" integer NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_referral_rewards_referral" UNIQUE("referral_id"),
	CONSTRAINT "ux_referral_rewards_period" UNIQUE("granted_period_id"),
	CONSTRAINT "referral_rewards_beneficiary_public_id_check" CHECK ("referral_rewards"."beneficiary_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "referral_rewards_reward_days_check" CHECK ("referral_rewards"."reward_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"referral_id" uuid PRIMARY KEY NOT NULL,
	"referral_code" text NOT NULL,
	"referrer_public_id" text NOT NULL,
	"referee_public_id" text NOT NULL,
	"state" text NOT NULL,
	"reason_code" text,
	"qualifying_fact_count" integer DEFAULT 0 NOT NULL,
	"plan_code" text NOT NULL,
	"plan_version" integer NOT NULL,
	"window_ends_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"state_changed_at" timestamp with time zone NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_referrals_referee" UNIQUE("referee_public_id"),
	CONSTRAINT "referrals_referrer_public_id_check" CHECK ("referrals"."referrer_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "referrals_referee_public_id_check" CHECK ("referrals"."referee_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "referrals_state_check" CHECK ("referrals"."state" IN ('pending', 'qualified', 'rewarded', 'rejected')),
	CONSTRAINT "referrals_reason_code_check" CHECK ("referrals"."reason_code" IS NULL OR "referrals"."reason_code" IN ('self_referral', 'referrer_not_active', 'referee_already_referred', 'referee_no_qualifying_facts', 'referral_window_expired', 'referee_subscription_never_activated')),
	CONSTRAINT "referrals_qualifying_fact_count_check" CHECK ("referrals"."qualifying_fact_count" >= 0),
	CONSTRAINT "ck_referrals_not_self" CHECK ("referrals"."referrer_public_id" <> "referrals"."referee_public_id"),
	CONSTRAINT "ck_referrals_reason_code" CHECK (("referrals"."state" = 'rejected' AND "referrals"."reason_code" IS NOT NULL) OR ("referrals"."state" <> 'rejected' AND "referrals"."reason_code" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "subscription_idempotency" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"route_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_idempotency_idempotency_key_check" CHECK (char_length("subscription_idempotency"."idempotency_key") BETWEEN 8 AND 128),
	CONSTRAINT "subscription_idempotency_route_key_check" CHECK (char_length("subscription_idempotency"."route_key") BETWEEN 3 AND 64),
	CONSTRAINT "subscription_idempotency_request_hash_check" CHECK (char_length("subscription_idempotency"."request_hash") = 64),
	CONSTRAINT "subscription_idempotency_response_status_check" CHECK ("subscription_idempotency"."response_status" BETWEEN 200 AND 499)
);
--> statement-breakpoint
CREATE TABLE "subscription_outbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_outbox_event_type_check" CHECK ("subscription_outbox"."event_type" ~ '^(subscription|referral)\.[a-z_]+$'),
	CONSTRAINT "subscription_outbox_aggregate_type_check" CHECK ("subscription_outbox"."aggregate_type" IN ('subscription', 'referral')),
	CONSTRAINT "subscription_outbox_attempts_check" CHECK ("subscription_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscription_periods" (
	"period_id" uuid PRIMARY KEY NOT NULL,
	"driver_public_id" text NOT NULL,
	"plan_code" text NOT NULL,
	"plan_version" integer NOT NULL,
	"source" text NOT NULL,
	"payment_reference" text,
	"granted_days" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"source_event_id" uuid,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_periods_driver_public_id_check" CHECK ("subscription_periods"."driver_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "subscription_periods_source_check" CHECK ("subscription_periods"."source" IN ('trial', 'payment', 'referral_reward')),
	CONSTRAINT "subscription_periods_payment_reference_check" CHECK ("subscription_periods"."payment_reference" IS NULL OR char_length("subscription_periods"."payment_reference") BETWEEN 4 AND 64),
	CONSTRAINT "subscription_periods_granted_days_check" CHECK ("subscription_periods"."granted_days" > 0),
	CONSTRAINT "ck_subscription_periods_window" CHECK ("subscription_periods"."ends_at" > "subscription_periods"."starts_at"),
	CONSTRAINT "ck_subscription_periods_payment_reference" CHECK (("subscription_periods"."source" = 'payment' AND "subscription_periods"."payment_reference" IS NOT NULL) OR ("subscription_periods"."source" <> 'payment' AND "subscription_periods"."payment_reference" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "subscription_plan_entitlements" (
	"plan_code" text NOT NULL,
	"plan_version" integer NOT NULL,
	"entitlement_code" text NOT NULL,
	"limit_value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plan_entitlements_pkey" PRIMARY KEY("plan_code","plan_version","entitlement_code"),
	CONSTRAINT "subscription_plan_entitlements_entitlement_code_check" CHECK ("subscription_plan_entitlements"."entitlement_code" IN ('accept_orders', 'daily_order_cap', 'priority_dispatch', 'zone_multi_select')),
	CONSTRAINT "subscription_plan_entitlements_limit_value_check" CHECK ("subscription_plan_entitlements"."limit_value" >= -1)
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"plan_code" text NOT NULL,
	"plan_version" integer NOT NULL,
	"label" text NOT NULL,
	"trial_days" integer NOT NULL,
	"duration_days" integer NOT NULL,
	"community_grace_days" integer NOT NULL,
	"community_daily_order_cap" integer NOT NULL,
	"referral_reward_days" integer NOT NULL,
	"referral_qualifying_facts" integer NOT NULL,
	"referral_window_days" integer NOT NULL,
	"is_frozen" boolean DEFAULT false NOT NULL,
	"frozen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plans_pkey" PRIMARY KEY("plan_code","plan_version"),
	CONSTRAINT "subscription_plans_plan_code_check" CHECK ("subscription_plans"."plan_code" ~ '^[a-z][a-z0-9-]{2,47}$'),
	CONSTRAINT "subscription_plans_plan_version_check" CHECK ("subscription_plans"."plan_version" >= 1),
	CONSTRAINT "subscription_plans_label_check" CHECK (char_length("subscription_plans"."label") BETWEEN 3 AND 64),
	CONSTRAINT "subscription_plans_trial_days_check" CHECK ("subscription_plans"."trial_days" BETWEEN 0 AND 90),
	CONSTRAINT "subscription_plans_duration_days_check" CHECK ("subscription_plans"."duration_days" BETWEEN 1 AND 730),
	CONSTRAINT "subscription_plans_community_grace_days_check" CHECK ("subscription_plans"."community_grace_days" BETWEEN 0 AND 90),
	CONSTRAINT "subscription_plans_community_daily_order_cap_check" CHECK ("subscription_plans"."community_daily_order_cap" BETWEEN 0 AND 1000),
	CONSTRAINT "subscription_plans_referral_reward_days_check" CHECK ("subscription_plans"."referral_reward_days" BETWEEN 0 AND 365),
	CONSTRAINT "subscription_plans_referral_qualifying_facts_check" CHECK ("subscription_plans"."referral_qualifying_facts" BETWEEN 1 AND 100),
	CONSTRAINT "subscription_plans_referral_window_days_check" CHECK ("subscription_plans"."referral_window_days" BETWEEN 1 AND 365),
	CONSTRAINT "ck_subscription_plans_frozen_at" CHECK (("subscription_plans"."is_frozen" AND "subscription_plans"."frozen_at" IS NOT NULL) OR (NOT "subscription_plans"."is_frozen" AND "subscription_plans"."frozen_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "subscription_transitions" (
	"transition_id" uuid PRIMARY KEY NOT NULL,
	"driver_public_id" text NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"reason_code" text NOT NULL,
	"period_id" uuid,
	"sequence" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_subscription_transitions_sequence" UNIQUE("driver_public_id","sequence"),
	CONSTRAINT "subscription_transitions_driver_public_id_check" CHECK ("subscription_transitions"."driver_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "subscription_transitions_from_state_check" CHECK ("subscription_transitions"."from_state" IS NULL OR "subscription_transitions"."from_state" IN ('trial', 'active', 'expired', 'community')),
	CONSTRAINT "subscription_transitions_to_state_check" CHECK ("subscription_transitions"."to_state" IN ('trial', 'active', 'expired', 'community')),
	CONSTRAINT "subscription_transitions_reason_code_check" CHECK ("subscription_transitions"."reason_code" IN ('trial_granted', 'payment_activated', 'referral_reward_applied', 'period_ended', 'community_grace_ended')),
	CONSTRAINT "subscription_transitions_sequence_check" CHECK ("subscription_transitions"."sequence" >= 1),
	CONSTRAINT "ck_subscription_transitions_state_changes" CHECK ("subscription_transitions"."from_state" IS DISTINCT FROM "subscription_transitions"."to_state"),
	CONSTRAINT "ck_subscription_transitions_genesis" CHECK (("subscription_transitions"."from_state" IS NOT NULL) OR ("subscription_transitions"."to_state" = 'trial' AND "subscription_transitions"."reason_code" = 'trial_granted' AND "subscription_transitions"."sequence" = 1))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"subscription_id" uuid PRIMARY KEY NOT NULL,
	"driver_public_id" text NOT NULL,
	"state" text NOT NULL,
	"plan_code" text NOT NULL,
	"plan_version" integer NOT NULL,
	"current_period_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"state_sequence" bigint NOT NULL,
	"state_changed_at" timestamp with time zone NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_subscriptions_driver" UNIQUE("driver_public_id"),
	CONSTRAINT "subscriptions_driver_public_id_check" CHECK ("subscriptions"."driver_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "subscriptions_state_check" CHECK ("subscriptions"."state" IN ('trial', 'active', 'expired', 'community')),
	CONSTRAINT "subscriptions_state_sequence_check" CHECK ("subscriptions"."state_sequence" >= 1),
	CONSTRAINT "ck_subscriptions_period_state" CHECK (("subscriptions"."state" IN ('trial', 'active') AND "subscriptions"."current_period_id" IS NOT NULL AND "subscriptions"."expires_at" IS NOT NULL) OR ("subscriptions"."state" IN ('expired', 'community') AND "subscriptions"."current_period_id" IS NULL AND "subscriptions"."expires_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "fk_referral_rewards_referral" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("referral_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "fk_referral_rewards_period" FOREIGN KEY ("granted_period_id") REFERENCES "public"."subscription_periods"("period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "fk_referral_rewards_plan" FOREIGN KEY ("plan_code","plan_version") REFERENCES "public"."subscription_plans"("plan_code","plan_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "fk_referrals_code" FOREIGN KEY ("referral_code") REFERENCES "public"."referral_codes"("referral_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "fk_referrals_plan" FOREIGN KEY ("plan_code","plan_version") REFERENCES "public"."subscription_plans"("plan_code","plan_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_periods" ADD CONSTRAINT "fk_subscription_periods_plan" FOREIGN KEY ("plan_code","plan_version") REFERENCES "public"."subscription_plans"("plan_code","plan_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan_entitlements" ADD CONSTRAINT "fk_subscription_plan_entitlements_plan" FOREIGN KEY ("plan_code","plan_version") REFERENCES "public"."subscription_plans"("plan_code","plan_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "fk_subscriptions_plan" FOREIGN KEY ("plan_code","plan_version") REFERENCES "public"."subscription_plans"("plan_code","plan_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_referrals_referrer" ON "referrals" USING btree ("referrer_public_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_referrals_pending" ON "referrals" USING btree ("window_ends_at") WHERE "referrals"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "ix_subscription_outbox_unpublished" ON "subscription_outbox" USING btree ("occurred_at") WHERE "subscription_outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_subscription_periods_driver" ON "subscription_periods" USING btree ("driver_public_id","starts_at");--> statement-breakpoint
CREATE INDEX "ix_subscriptions_expiring" ON "subscriptions" USING btree ("expires_at") WHERE "subscriptions"."state" IN ('trial', 'active');