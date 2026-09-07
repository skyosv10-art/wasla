CREATE TABLE "negotiation_agreements" (
	"thread_id" uuid PRIMARY KEY NOT NULL,
	"order_public_id" text NOT NULL,
	"driver_public_id" text NOT NULL,
	"round_no" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"accepted_by" text NOT NULL,
	"policy_version" integer NOT NULL,
	"agreed_at" timestamp with time zone NOT NULL,
	"handoff_state" text DEFAULT 'pending' NOT NULL,
	"handoff_attempts" integer DEFAULT 0 NOT NULL,
	"handed_off_at" timestamp with time zone,
	"next_handoff_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_negotiation_agreements_order_driver" UNIQUE("order_public_id","driver_public_id"),
	CONSTRAINT "negotiation_agreements_order_public_id_check" CHECK ("negotiation_agreements"."order_public_id" ~ '^ORD-[0-9]{10}$'),
	CONSTRAINT "negotiation_agreements_driver_public_id_check" CHECK ("negotiation_agreements"."driver_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "negotiation_agreements_round_no_check" CHECK ("negotiation_agreements"."round_no" >= 1),
	CONSTRAINT "negotiation_agreements_amount_minor_check" CHECK ("negotiation_agreements"."amount_minor" > 0),
	CONSTRAINT "negotiation_agreements_currency_check" CHECK ("negotiation_agreements"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "negotiation_agreements_accepted_by_check" CHECK ("negotiation_agreements"."accepted_by" IN ('customer','driver')),
	CONSTRAINT "negotiation_agreements_handoff_state_check" CHECK ("negotiation_agreements"."handoff_state" IN ('pending','handed_off','rejected','abandoned')),
	CONSTRAINT "negotiation_agreements_handoff_attempts_check" CHECK ("negotiation_agreements"."handoff_attempts" >= 0),
	CONSTRAINT "negotiation_agreements_last_error_code_check" CHECK ("negotiation_agreements"."last_error_code" IS NULL OR char_length("negotiation_agreements"."last_error_code") BETWEEN 3 AND 64),
	CONSTRAINT "ck_negotiation_agreements_handed_off_at" CHECK ((
        "negotiation_agreements"."handoff_state" = 'handed_off' AND
        "negotiation_agreements"."handed_off_at" IS NOT NULL AND
        "negotiation_agreements"."next_handoff_at" IS NULL
      ) OR (
        "negotiation_agreements"."handoff_state" <> 'handed_off' AND
        "negotiation_agreements"."handed_off_at" IS NULL
      )),
	CONSTRAINT "ck_negotiation_agreements_terminal_no_retry" CHECK ("negotiation_agreements"."handoff_state" NOT IN ('rejected','abandoned') OR "negotiation_agreements"."next_handoff_at" IS NULL),
	CONSTRAINT "ck_negotiation_agreements_failure_named" CHECK ("negotiation_agreements"."handoff_state" NOT IN ('rejected','abandoned') OR "negotiation_agreements"."last_error_code" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "negotiation_idempotency" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"thread_id" uuid,
	"payload_fingerprint" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "negotiation_idempotency_idempotency_key_check" CHECK (char_length("negotiation_idempotency"."idempotency_key") BETWEEN 8 AND 128),
	CONSTRAINT "negotiation_idempotency_scope_check" CHECK ("negotiation_idempotency"."scope" IN (
        'open_thread','propose_round','accept_round',
        'reject_round','post_message','cancel_thread'
      )),
	CONSTRAINT "negotiation_idempotency_payload_fingerprint_check" CHECK (char_length("negotiation_idempotency"."payload_fingerprint") = 64),
	CONSTRAINT "negotiation_idempotency_response_status_check" CHECK ("negotiation_idempotency"."response_status" BETWEEN 100 AND 599)
);
--> statement-breakpoint
CREATE TABLE "negotiation_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"sequence_no" integer NOT NULL,
	"author_role" text NOT NULL,
	"body" text,
	"source_locale" text DEFAULT 'ar' NOT NULL,
	"system_code" text,
	"round_no" integer,
	"redacted_at" timestamp with time zone,
	"redaction_reason_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_negotiation_messages_thread_seq" UNIQUE("thread_id","sequence_no"),
	CONSTRAINT "negotiation_messages_sequence_no_check" CHECK ("negotiation_messages"."sequence_no" >= 1),
	CONSTRAINT "negotiation_messages_author_role_check" CHECK ("negotiation_messages"."author_role" IN ('customer','driver','system')),
	CONSTRAINT "negotiation_messages_body_check" CHECK ("negotiation_messages"."body" IS NULL OR char_length("negotiation_messages"."body") BETWEEN 1 AND 1000),
	CONSTRAINT "negotiation_messages_source_locale_check" CHECK ("negotiation_messages"."source_locale" IN ('ar','en','ur')),
	CONSTRAINT "negotiation_messages_system_code_check" CHECK ("negotiation_messages"."system_code" IS NULL OR char_length("negotiation_messages"."system_code") BETWEEN 3 AND 64),
	CONSTRAINT "negotiation_messages_round_no_check" CHECK ("negotiation_messages"."round_no" IS NULL OR "negotiation_messages"."round_no" >= 1),
	CONSTRAINT "negotiation_messages_redaction_reason_code_check" CHECK ("negotiation_messages"."redaction_reason_code" IS NULL OR char_length("negotiation_messages"."redaction_reason_code") BETWEEN 3 AND 64),
	CONSTRAINT "ck_negotiation_messages_body_or_code" CHECK ((
        "negotiation_messages"."author_role" IN ('customer', 'driver') AND
        "negotiation_messages"."system_code" IS NULL AND
        ("negotiation_messages"."body" IS NOT NULL OR "negotiation_messages"."redacted_at" IS NOT NULL)
      ) OR (
        "negotiation_messages"."author_role" = 'system' AND
        "negotiation_messages"."system_code" IS NOT NULL AND
        "negotiation_messages"."body" IS NULL
      )),
	CONSTRAINT "ck_negotiation_messages_redaction" CHECK ((
        "negotiation_messages"."redacted_at" IS NULL AND
        "negotiation_messages"."redaction_reason_code" IS NULL
      ) OR (
        "negotiation_messages"."redacted_at" IS NOT NULL AND
        "negotiation_messages"."redaction_reason_code" IS NOT NULL AND
        "negotiation_messages"."body" IS NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "negotiation_outbox" (
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
	CONSTRAINT "negotiation_outbox_aggregate_type_check" CHECK ("negotiation_outbox"."aggregate_type" IN (
        'negotiation_thread','negotiation_round','negotiation_message'
      )),
	CONSTRAINT "negotiation_outbox_event_type_check" CHECK (char_length("negotiation_outbox"."event_type") >= 3),
	CONSTRAINT "negotiation_outbox_event_version_check" CHECK ("negotiation_outbox"."event_version" ~ '^v[0-9]+$'),
	CONSTRAINT "negotiation_outbox_attempts_check" CHECK ("negotiation_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "negotiation_policies" (
	"policy_version" integer PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"currency" text NOT NULL,
	"min_amount_minor" bigint NOT NULL,
	"max_amount_minor" bigint NOT NULL,
	"max_rounds" integer NOT NULL,
	"round_ttl_seconds" integer NOT NULL,
	"thread_ttl_seconds" integer NOT NULL,
	"max_message_length" integer NOT NULL,
	"max_messages_per_thread" integer NOT NULL,
	"is_frozen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "negotiation_policies_policy_version_check" CHECK ("negotiation_policies"."policy_version" >= 1),
	CONSTRAINT "negotiation_policies_label_check" CHECK (char_length("negotiation_policies"."label") BETWEEN 3 AND 64),
	CONSTRAINT "negotiation_policies_currency_check" CHECK ("negotiation_policies"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "negotiation_policies_min_amount_minor_check" CHECK ("negotiation_policies"."min_amount_minor" > 0),
	CONSTRAINT "negotiation_policies_max_amount_minor_check" CHECK ("negotiation_policies"."max_amount_minor" > 0),
	CONSTRAINT "negotiation_policies_max_rounds_check" CHECK ("negotiation_policies"."max_rounds" BETWEEN 1 AND 20),
	CONSTRAINT "negotiation_policies_round_ttl_seconds_check" CHECK ("negotiation_policies"."round_ttl_seconds" BETWEEN 30 AND 3600),
	CONSTRAINT "negotiation_policies_thread_ttl_seconds_check" CHECK ("negotiation_policies"."thread_ttl_seconds" BETWEEN 60 AND 86400),
	CONSTRAINT "negotiation_policies_max_message_length_check" CHECK ("negotiation_policies"."max_message_length" BETWEEN 1 AND 1000),
	CONSTRAINT "negotiation_policies_max_messages_per_thread_check" CHECK ("negotiation_policies"."max_messages_per_thread" BETWEEN 1 AND 500),
	CONSTRAINT "ck_negotiation_policies_amount_bounds" CHECK ("negotiation_policies"."max_amount_minor" > "negotiation_policies"."min_amount_minor"),
	CONSTRAINT "ck_negotiation_policies_ttl_order" CHECK ("negotiation_policies"."thread_ttl_seconds" >= "negotiation_policies"."round_ttl_seconds")
);
--> statement-breakpoint
CREATE TABLE "negotiation_price_handoffs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"outcome" text,
	"response_status" integer,
	"error_code" text,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ux_negotiation_price_handoffs_attempt" UNIQUE("thread_id","attempt_no"),
	CONSTRAINT "negotiation_price_handoffs_attempt_no_check" CHECK ("negotiation_price_handoffs"."attempt_no" >= 1),
	CONSTRAINT "negotiation_price_handoffs_amount_minor_check" CHECK ("negotiation_price_handoffs"."amount_minor" > 0),
	CONSTRAINT "negotiation_price_handoffs_currency_check" CHECK ("negotiation_price_handoffs"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "negotiation_price_handoffs_outcome_check" CHECK ("negotiation_price_handoffs"."outcome" IS NULL OR "negotiation_price_handoffs"."outcome" IN ('accepted','rejected','unavailable')),
	CONSTRAINT "negotiation_price_handoffs_response_status_check" CHECK ("negotiation_price_handoffs"."response_status" IS NULL OR "negotiation_price_handoffs"."response_status" BETWEEN 100 AND 599),
	CONSTRAINT "negotiation_price_handoffs_error_code_check" CHECK ("negotiation_price_handoffs"."error_code" IS NULL OR char_length("negotiation_price_handoffs"."error_code") BETWEEN 3 AND 64),
	CONSTRAINT "ck_negotiation_price_handoffs_completion" CHECK ((
        "negotiation_price_handoffs"."outcome" IS NULL AND
        "negotiation_price_handoffs"."completed_at" IS NULL
      ) OR (
        "negotiation_price_handoffs"."outcome" IS NOT NULL AND
        "negotiation_price_handoffs"."completed_at" IS NOT NULL
      )),
	CONSTRAINT "ck_negotiation_price_handoffs_failure_named" CHECK ("negotiation_price_handoffs"."outcome" IS NULL OR "negotiation_price_handoffs"."outcome" = 'accepted' OR "negotiation_price_handoffs"."error_code" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "negotiation_rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"round_no" integer NOT NULL,
	"proposed_by" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"resolved_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_negotiation_rounds_thread_no" UNIQUE("thread_id","round_no"),
	CONSTRAINT "negotiation_rounds_round_no_check" CHECK ("negotiation_rounds"."round_no" >= 1),
	CONSTRAINT "negotiation_rounds_proposed_by_check" CHECK ("negotiation_rounds"."proposed_by" IN ('customer','driver')),
	CONSTRAINT "negotiation_rounds_amount_minor_check" CHECK ("negotiation_rounds"."amount_minor" > 0),
	CONSTRAINT "negotiation_rounds_currency_check" CHECK ("negotiation_rounds"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "negotiation_rounds_state_check" CHECK ("negotiation_rounds"."state" IN ('pending','accepted','rejected','superseded','expired')),
	CONSTRAINT "negotiation_rounds_resolved_by_check" CHECK ("negotiation_rounds"."resolved_by" IS NULL OR "negotiation_rounds"."resolved_by" IN ('customer','driver')),
	CONSTRAINT "ck_negotiation_rounds_state_timestamp" CHECK ((
        "negotiation_rounds"."state" = 'pending' AND
        "negotiation_rounds"."responded_at" IS NULL AND
        "negotiation_rounds"."resolved_by" IS NULL
      ) OR (
        "negotiation_rounds"."state" IN ('accepted', 'rejected') AND
        "negotiation_rounds"."responded_at" IS NOT NULL AND
        "negotiation_rounds"."resolved_by" IS NOT NULL
      ) OR (
        "negotiation_rounds"."state" IN ('superseded', 'expired') AND
        "negotiation_rounds"."resolved_by" IS NULL
      )),
	CONSTRAINT "ck_negotiation_rounds_no_self_resolution" CHECK ("negotiation_rounds"."resolved_by" IS NULL OR "negotiation_rounds"."resolved_by" <> "negotiation_rounds"."proposed_by")
);
--> statement-breakpoint
CREATE TABLE "negotiation_threads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_public_id" text NOT NULL,
	"customer_public_id" text NOT NULL,
	"driver_public_id" text NOT NULL,
	"dispatch_offer_id" uuid NOT NULL,
	"service_kind" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"close_reason_code" text,
	"policy_version" integer NOT NULL,
	"currency" text NOT NULL,
	"opening_amount_minor" bigint NOT NULL,
	"opened_by" text NOT NULL,
	"round_count" integer DEFAULT 0 NOT NULL,
	"current_round_no" integer DEFAULT 0 NOT NULL,
	"agreed_round_no" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"next_tick_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ux_negotiation_threads_order_driver" UNIQUE("order_public_id","driver_public_id"),
	CONSTRAINT "ux_negotiation_threads_dispatch_offer" UNIQUE("dispatch_offer_id"),
	CONSTRAINT "negotiation_threads_order_public_id_check" CHECK ("negotiation_threads"."order_public_id" ~ '^ORD-[0-9]{10}$'),
	CONSTRAINT "negotiation_threads_customer_public_id_check" CHECK ("negotiation_threads"."customer_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "negotiation_threads_driver_public_id_check" CHECK ("negotiation_threads"."driver_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "negotiation_threads_service_kind_check" CHECK ("negotiation_threads"."service_kind" IN ('ride','delivery')),
	CONSTRAINT "negotiation_threads_state_check" CHECK ("negotiation_threads"."state" IN ('open','agreed','declined','expired','cancelled')),
	CONSTRAINT "negotiation_threads_close_reason_code_check" CHECK ("negotiation_threads"."close_reason_code" IS NULL OR "negotiation_threads"."close_reason_code" IN (
        'agreed',
        'declined_by_customer','declined_by_driver',
        'max_rounds_reached','thread_expired',
        'cancelled_by_dispatch','order_withdrawn'
      )),
	CONSTRAINT "negotiation_threads_currency_check" CHECK ("negotiation_threads"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "negotiation_threads_opening_amount_minor_check" CHECK ("negotiation_threads"."opening_amount_minor" > 0),
	CONSTRAINT "negotiation_threads_opened_by_check" CHECK ("negotiation_threads"."opened_by" IN ('customer','driver')),
	CONSTRAINT "negotiation_threads_round_count_check" CHECK ("negotiation_threads"."round_count" >= 0),
	CONSTRAINT "negotiation_threads_current_round_no_check" CHECK ("negotiation_threads"."current_round_no" >= 0),
	CONSTRAINT "negotiation_threads_agreed_round_no_check" CHECK ("negotiation_threads"."agreed_round_no" IS NULL OR "negotiation_threads"."agreed_round_no" >= 1),
	CONSTRAINT "negotiation_threads_version_check" CHECK ("negotiation_threads"."version" >= 1),
	CONSTRAINT "ck_negotiation_threads_open_is_clean" CHECK ("negotiation_threads"."state" <> 'open' OR (
        "negotiation_threads"."closed_at" IS NULL AND
        "negotiation_threads"."agreed_round_no" IS NULL AND
        "negotiation_threads"."close_reason_code" IS NULL
      )),
	CONSTRAINT "ck_negotiation_threads_closed_has_reason" CHECK ("negotiation_threads"."state" = 'open' OR (
        "negotiation_threads"."closed_at" IS NOT NULL AND
        "negotiation_threads"."close_reason_code" IS NOT NULL AND
        "negotiation_threads"."next_tick_at" IS NULL
      )),
	CONSTRAINT "ck_negotiation_threads_agreed_names_round" CHECK ((
        "negotiation_threads"."state" = 'agreed' AND
        "negotiation_threads"."agreed_round_no" IS NOT NULL AND
        "negotiation_threads"."close_reason_code" = 'agreed'
      ) OR (
        "negotiation_threads"."state" <> 'agreed' AND
        "negotiation_threads"."agreed_round_no" IS NULL AND
        "negotiation_threads"."close_reason_code" <> 'agreed'
      ) OR "negotiation_threads"."state" = 'open'),
	CONSTRAINT "ck_negotiation_threads_round_counters" CHECK ("negotiation_threads"."current_round_no" <= "negotiation_threads"."round_count"),
	CONSTRAINT "ck_negotiation_threads_agreed_round_exists" CHECK ("negotiation_threads"."agreed_round_no" IS NULL OR "negotiation_threads"."agreed_round_no" <= "negotiation_threads"."current_round_no")
);
--> statement-breakpoint
ALTER TABLE "negotiation_agreements" ADD CONSTRAINT "negotiation_agreements_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."negotiation_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_agreements" ADD CONSTRAINT "negotiation_agreements_policy_version_fkey" FOREIGN KEY ("policy_version") REFERENCES "public"."negotiation_policies"("policy_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_idempotency" ADD CONSTRAINT "negotiation_idempotency_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."negotiation_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."negotiation_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_price_handoffs" ADD CONSTRAINT "negotiation_price_handoffs_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."negotiation_agreements"("thread_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_rounds" ADD CONSTRAINT "negotiation_rounds_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."negotiation_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_threads" ADD CONSTRAINT "negotiation_threads_policy_version_fkey" FOREIGN KEY ("policy_version") REFERENCES "public"."negotiation_policies"("policy_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_negotiation_agreements_order" ON "negotiation_agreements" USING btree ("order_public_id");--> statement-breakpoint
CREATE INDEX "ix_negotiation_agreements_handoff_due" ON "negotiation_agreements" USING btree ("next_handoff_at") WHERE "negotiation_agreements"."handoff_state" = 'pending';--> statement-breakpoint
CREATE INDEX "ix_negotiation_idempotency_thread" ON "negotiation_idempotency" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "ix_negotiation_messages_thread" ON "negotiation_messages" USING btree ("thread_id","sequence_no");--> statement-breakpoint
CREATE INDEX "ix_negotiation_outbox_unpublished" ON "negotiation_outbox" USING btree ("occurred_at") WHERE "negotiation_outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_negotiation_price_handoffs_thread" ON "negotiation_price_handoffs" USING btree ("thread_id","attempt_no" DESC);--> statement-breakpoint
CREATE INDEX "ix_negotiation_rounds_thread" ON "negotiation_rounds" USING btree ("thread_id","round_no" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "ux_negotiation_rounds_one_pending" ON "negotiation_rounds" USING btree ("thread_id") WHERE "negotiation_rounds"."state" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "ux_negotiation_rounds_one_accepted" ON "negotiation_rounds" USING btree ("thread_id") WHERE "negotiation_rounds"."state" = 'accepted';--> statement-breakpoint
CREATE INDEX "ix_negotiation_rounds_pending_due" ON "negotiation_rounds" USING btree ("expires_at") WHERE "negotiation_rounds"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "ix_negotiation_threads_order" ON "negotiation_threads" USING btree ("order_public_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "ix_negotiation_threads_driver" ON "negotiation_threads" USING btree ("driver_public_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "ix_negotiation_threads_state" ON "negotiation_threads" USING btree ("state","created_at" DESC);--> statement-breakpoint
CREATE INDEX "ix_negotiation_threads_tick_due" ON "negotiation_threads" USING btree ("next_tick_at") WHERE "negotiation_threads"."state" = 'open';--> statement-breakpoint
-- ═════════════════════════════════════════════════════════════════════
-- إلحاقٌ مُراجَعٌ — خارجَ نطاقِ التوليدِ (ADR-024 §2.1)
--
-- seed النسخةِ 1 من negotiation_policies في العقدِ (contracts/schema.sql)
-- لا يعرفُهُ تعبيرُ الإسقاطِ (schema.ts) فلا يولِّدُهُ drizzle-kit (لا
-- يُعبِّرُ عن INSERT من pgTable). تُلحَقُ هنا بيدٍ **مُعلَمةٍ صريحاً** فلا
-- يُدَّعى أنّها مولَّدةٌ وهي مُلحَقةٌ، ويقيسُ اختبارُ الدورةِ الكاملةِ
-- (migrations.integration.test.ts) بقاءَ الكلِّ مطابقاً للعقدِ عبرَ
-- مقارنةِ الكتالوجِ على سبعةِ أبعادٍ وعودةِ seed بعدَ الترجعِ وإعادةِ
-- التطبيقِ.
-- النسخةُ 1 'saudi-launch-v1' مُجمَّدةٌ بأرقامٍ **مُعلَنة** في العقدِ
-- (SAR · 500..500000 هللة · 5 أدوار · 120s/900s · 1000/100): كلُّ خيطٍ
-- يُفسَّرُ بالسياسةِ التي حكمَته، فغيابُ الصفِّ يعطّلُ فتحَ أي خيطٍ.
-- ═════════════════════════════════════════════════════════════════════
INSERT INTO "negotiation_policies" (
    "policy_version", "label", "currency",
    "min_amount_minor", "max_amount_minor", "max_rounds",
    "round_ttl_seconds", "thread_ttl_seconds",
    "max_message_length", "max_messages_per_thread", "is_frozen"
)
VALUES (1, 'saudi-launch-v1', 'SAR', 500, 500000, 5, 120, 900, 1000, 100, TRUE)
ON CONFLICT ("policy_version") DO NOTHING;
