-- WASLA Billing & Fees — rollback of 0002_delivery_order_snapshots (M5-17Q · CLM-0376)
-- 'recorded' ledger rows describe snapshots that this rollback drops; they are
-- removed so the narrower CHECK of 0001 can be restored.
DELETE FROM "billing_relay_consumed_events" WHERE status = 'recorded';
--> statement-breakpoint
ALTER TABLE "billing_relay_consumed_events" DROP CONSTRAINT IF EXISTS "billing_relay_consumed_events_status_check";
--> statement-breakpoint
ALTER TABLE "billing_relay_consumed_events" ADD CONSTRAINT "billing_relay_consumed_events_status_check" CHECK (status IN ('settled', 'ignored', 'ignored_foreign', 'poisoned'));
--> statement-breakpoint
DROP TABLE IF EXISTS "billing_store_order_snapshots";
