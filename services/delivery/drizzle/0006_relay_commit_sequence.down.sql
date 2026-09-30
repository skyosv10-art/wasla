-- Rollback RISK-0012 (CLM-0416 · ADR-057): commit-ordered relay cursors + delivery_outbox.
-- Consumers of the previous release order by the old tuple and ignore these objects.
-- @wasla-upgrade-proof: all-non-baseline

DROP TRIGGER IF EXISTS trg_delivery_outbox_commit_sequence ON delivery_outbox;
--> statement-breakpoint
DROP FUNCTION IF EXISTS delivery_outbox_assign_commit_sequence();
--> statement-breakpoint
DROP INDEX IF EXISTS ux_delivery_outbox_commit_sequence;
--> statement-breakpoint
ALTER TABLE delivery_outbox DROP COLUMN IF EXISTS commit_sequence;
--> statement-breakpoint
DROP SEQUENCE IF EXISTS delivery_outbox_commit_seq;
--> statement-breakpoint
ALTER TABLE delivery_inventory_relay_checkpoint DROP COLUMN IF EXISTS last_commit_sequence;
--> statement-breakpoint
ALTER TABLE delivery_relay_checkpoint DROP COLUMN IF EXISTS last_commit_sequence;
--> statement-breakpoint
ALTER TABLE delivery_tasks DROP COLUMN IF EXISTS dispatch_last_commit_sequence;
