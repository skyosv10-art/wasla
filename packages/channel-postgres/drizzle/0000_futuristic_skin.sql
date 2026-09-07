CREATE TABLE "channel_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"chat_ref" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"kind" text NOT NULL,
	"body" jsonb NOT NULL,
	"bot" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"trace_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "channel_deliveries_channel_check" CHECK ("channel_deliveries"."channel" IN ('telegram','web','mobile','whatsapp')),
	CONSTRAINT "channel_deliveries_kind_check" CHECK ("channel_deliveries"."kind" IN ('text','text_with_buttons')),
	CONSTRAINT "channel_deliveries_bot_check" CHECK ("channel_deliveries"."bot" IS NULL OR "channel_deliveries"."bot" IN ('customer','driver','partner')),
	CONSTRAINT "channel_deliveries_priority_check" CHECK ("channel_deliveries"."priority" IN ('critical','high','normal','low')),
	CONSTRAINT "channel_deliveries_status_check" CHECK ("channel_deliveries"."status" IN ('queued','sent','failed')),
	CONSTRAINT "channel_deliveries_attempts_check" CHECK ("channel_deliveries"."attempts" >= 0),
	CONSTRAINT "channel_deliveries_max_attempts_check" CHECK ("channel_deliveries"."max_attempts" >= 1)
);
--> statement-breakpoint
CREATE TABLE "channel_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text DEFAULT 'channel_chat' NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"event_version" text DEFAULT 'v1' NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"trace_id" text,
	CONSTRAINT "channel_outbox_aggregate_type_check" CHECK ("channel_outbox"."aggregate_type" = 'channel_chat'),
	CONSTRAINT "channel_outbox_event_version_check" CHECK ("channel_outbox"."event_version" ~ '^v[0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "channel_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"bot" text NOT NULL,
	"channel_update_id" text NOT NULL,
	"chat_ref" text NOT NULL,
	"kind" text NOT NULL,
	"command" text,
	"status" text DEFAULT 'processed' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"trace_id" text,
	CONSTRAINT "channel_updates_channel_check" CHECK ("channel_updates"."channel" IN ('telegram','web','mobile','whatsapp')),
	CONSTRAINT "channel_updates_bot_check" CHECK ("channel_updates"."bot" IN ('customer','driver','partner')),
	CONSTRAINT "channel_updates_kind_check" CHECK ("channel_updates"."kind" IN ('command','text_message','callback','contact','location','group_event','unsupported')),
	CONSTRAINT "channel_updates_status_check" CHECK ("channel_updates"."status" IN ('processed','skipped','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ux_channel_deliveries_idempotency" ON "channel_deliveries" USING btree ("channel","idempotency_key");--> statement-breakpoint
CREATE INDEX "ix_channel_deliveries_retry_queue" ON "channel_deliveries" USING btree ("status","next_attempt_at") WHERE "channel_deliveries"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "ix_channel_outbox_unpublished" ON "channel_outbox" USING btree ("occurred_at") WHERE "channel_outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_channel_updates_dedup" ON "channel_updates" USING btree ("channel","bot","channel_update_id");--> statement-breakpoint
CREATE INDEX "ix_channel_updates_chat" ON "channel_updates" USING btree ("channel","chat_ref","received_at" DESC);