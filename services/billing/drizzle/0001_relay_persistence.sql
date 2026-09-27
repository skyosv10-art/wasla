-- WASLA Billing & Fees — relay persistence (M5-17P · CLM-0375)
-- Mirrors contracts/schema.sql: checkpoint + consumed-events ledger.
-- Additive only: two new tables, no change to existing rows.

CREATE TABLE IF NOT EXISTS "billing_relay_checkpoint" (
	"consumer_id" text PRIMARY KEY NOT NULL,
	"last_occurred_at" timestamp with time zone NOT NULL,
	"last_event_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_relay_checkpoint_consumer_id_check" CHECK (char_length(consumer_id) BETWEEN 1 AND 64)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_relay_consumed_events" (
	"consumer_id" text NOT NULL,
	"event_id" uuid NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"settlement_id" uuid,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_relay_consumed_events_consumer_id_event_id_pk" PRIMARY KEY("consumer_id","event_id"),
	CONSTRAINT "billing_relay_consumed_events_consumer_id_check" CHECK (char_length(consumer_id) BETWEEN 1 AND 64),
	CONSTRAINT "billing_relay_consumed_events_status_check" CHECK (status IN ('settled', 'ignored', 'ignored_foreign', 'poisoned')),
	CONSTRAINT "billing_relay_settled_has_settlement" CHECK ((status = 'settled') = (settlement_id IS NOT NULL)),
	CONSTRAINT "billing_relay_consumed_events_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "billing_settlements"("settlement_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_relay_consumed_poisoned" ON "billing_relay_consumed_events" ("consumer_id","consumed_at") WHERE status = 'poisoned';
