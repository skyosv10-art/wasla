-- WASLA Billing & Fees — delivery store-order source (M5-17Q · CLM-0376)
-- Mirrors contracts/schema.sql: the billing-owned money snapshot of every
-- store order consumed from delivery_outbox (store_order.created), and the
-- ledger status 'recorded' for snapshot events. Additive: one new table and
-- a widened CHECK; no existing row changes.

CREATE TABLE IF NOT EXISTS "billing_store_order_snapshots" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"order_public_id" text NOT NULL,
	"store_id" uuid NOT NULL,
	"store_slug" text NOT NULL,
	"currency_code" text NOT NULL,
	"items_total_minor_units" bigint NOT NULL,
	"delivery_fee_minor_units" bigint NOT NULL,
	"source_event_id" uuid NOT NULL,
	"settlement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_store_order_snapshots_currency_check" CHECK (currency_code = 'SAR'),
	CONSTRAINT "billing_store_order_snapshots_items_total_check" CHECK (items_total_minor_units >= 0),
	CONSTRAINT "billing_store_order_snapshots_delivery_fee_check" CHECK (delivery_fee_minor_units >= 0),
	CONSTRAINT "billing_store_order_snapshots_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "billing_settlements"("settlement_id"),
	CONSTRAINT "billing_store_order_snapshots_settlement_id_unique" UNIQUE ("settlement_id")
);
--> statement-breakpoint
ALTER TABLE "billing_relay_consumed_events" DROP CONSTRAINT IF EXISTS "billing_relay_consumed_events_status_check";
--> statement-breakpoint
ALTER TABLE "billing_relay_consumed_events" ADD CONSTRAINT "billing_relay_consumed_events_status_check" CHECK (status IN ('settled', 'recorded', 'ignored', 'ignored_foreign', 'poisoned'));
