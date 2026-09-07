CREATE TABLE "identity_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_internal_uuid" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "identity_history_field_check" CHECK ("identity_history"."field" IN ('telegram_username','phone','link','status')),
	CONSTRAINT "identity_history_source_check" CHECK ("identity_history"."source" IN ('customer_bot','driver_bot','partner_bot','recovery','admin','system'))
);
--> statement-breakpoint
CREATE TABLE "identity_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_internal_uuid" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_links_provider_external_id_key" UNIQUE("provider","external_id"),
	CONSTRAINT "identity_links_provider_check" CHECK ("identity_links"."provider" IN ('telegram','phone','email','web','mobile'))
);
--> statement-breakpoint
CREATE TABLE "identity_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_version" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "identity_outbox_event_id_key" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "identity_recovery_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_internal_uuid" uuid NOT NULL,
	"verification_method" text NOT NULL,
	"status" text DEFAULT 'verification_pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "identity_recovery_requests_verification_method_check" CHECK ("identity_recovery_requests"."verification_method" IN ('phone_otp','email_otp','admin_assisted')),
	CONSTRAINT "identity_recovery_requests_status_check" CHECK ("identity_recovery_requests"."status" IN ('verification_pending','completed','rejected'))
);
--> statement-breakpoint
CREATE TABLE "identity_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_internal_uuid" uuid NOT NULL,
	"actor_type" text DEFAULT 'customer' NOT NULL,
	"channel" text NOT NULL,
	"token_hash" text NOT NULL,
	"init_data_hash" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "identity_sessions_actor_type_check" CHECK ("identity_sessions"."actor_type" IN ('customer','driver','admin','support')),
	CONSTRAINT "identity_sessions_channel_check" CHECK ("identity_sessions"."channel" IN ('telegram','web','mobile')),
	CONSTRAINT "identity_sessions_token_hash_check" CHECK ("identity_sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "identity_sessions_init_data_hash_check" CHECK (("identity_sessions"."init_data_hash" IS NULL OR "identity_sessions"."init_data_hash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "identity_sessions_check" CHECK ("identity_sessions"."expires_at" > "identity_sessions"."issued_at"),
	CONSTRAINT "identity_sessions_check1" CHECK (("identity_sessions"."revoked_at" IS NULL) = ("identity_sessions"."revoked_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "identity_users" (
	"internal_uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wasla_public_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "identity_users_wasla_public_id_key" UNIQUE("wasla_public_id"),
	CONSTRAINT "identity_users_status_check" CHECK ("identity_users"."status" IN ('active','suspended','deleted','recovery_in_progress'))
);
--> statement-breakpoint
ALTER TABLE "identity_history" ADD CONSTRAINT "identity_history_user_internal_uuid_fkey" FOREIGN KEY ("user_internal_uuid") REFERENCES "public"."identity_users"("internal_uuid") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_links" ADD CONSTRAINT "identity_links_user_internal_uuid_fkey" FOREIGN KEY ("user_internal_uuid") REFERENCES "public"."identity_users"("internal_uuid") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_recovery_requests" ADD CONSTRAINT "identity_recovery_requests_user_internal_uuid_fkey" FOREIGN KEY ("user_internal_uuid") REFERENCES "public"."identity_users"("internal_uuid") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_sessions" ADD CONSTRAINT "identity_sessions_user_internal_uuid_fkey" FOREIGN KEY ("user_internal_uuid") REFERENCES "public"."identity_users"("internal_uuid") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_identity_history_user_field" ON "identity_history" USING btree ("user_internal_uuid","field","effective_at" DESC);--> statement-breakpoint
CREATE INDEX "ix_identity_links_user" ON "identity_links" USING btree ("user_internal_uuid","provider");--> statement-breakpoint
CREATE INDEX "ix_identity_outbox_unpublished" ON "identity_outbox" USING btree ("occurred_at") WHERE "identity_outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_identity_sessions_token" ON "identity_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_identity_sessions_user" ON "identity_sessions" USING btree ("user_internal_uuid","issued_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_identity_sessions_init_data" ON "identity_sessions" USING btree ("init_data_hash") WHERE "identity_sessions"."init_data_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_identity_users_public_id" ON "identity_users" USING btree ("wasla_public_id");
-- ═════════════════════════════════════════════════════════════════════
-- إلحاقٌ مُراجَعٌ — خارجَ نطاقِ التوليدِ (ADR-024 §2.1)
--
-- الدالةُّ والمُطلِقُّ في العقدِ (contracts/schema.sql) خارجَ نطاقِ تعبيرِ
-- الإسقاطِ (schema.ts)، فلا يولِّدُها drizzle-kit. تُلحَقُ هنا بيدٍ **مُعلَمةٍ
-- صريحاً** فلا يُدَّعى أنّها مولَّدةٌ وهي مُلحَقةٌ، ويقيسُ اختبارُ التكافؤِ
-- (migrations.integration.test.ts) بقائَها مطابقةً للعقدِ حرفاً.
-- ═════════════════════════════════════════════════════════════════════
CREATE FUNCTION identity_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_identity_users_updated_at BEFORE UPDATE ON identity_users
    FOR EACH ROW EXECUTE FUNCTION identity_set_updated_at();