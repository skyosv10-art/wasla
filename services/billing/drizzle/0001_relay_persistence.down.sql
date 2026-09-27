-- WASLA Billing & Fees — rollback of 0001_relay_persistence (M5-17P · CLM-0375)
DROP INDEX IF EXISTS "idx_billing_relay_consumed_poisoned";
--> statement-breakpoint
DROP TABLE IF EXISTS "billing_relay_consumed_events";
--> statement-breakpoint
DROP TABLE IF EXISTS "billing_relay_checkpoint";
