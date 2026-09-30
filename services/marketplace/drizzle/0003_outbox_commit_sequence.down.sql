-- Rollback RISK-0012 (CLM-0416 · ADR-057): commit-ordered marketplace_outbox.
-- Consumers of the previous release order by the old tuple and ignore these objects.
-- @wasla-upgrade-proof: all-non-baseline

DROP TRIGGER IF EXISTS trg_marketplace_outbox_commit_sequence ON marketplace_outbox;
--> statement-breakpoint
DROP FUNCTION IF EXISTS marketplace_outbox_assign_commit_sequence();
--> statement-breakpoint
DROP INDEX IF EXISTS ux_marketplace_outbox_commit_sequence;
--> statement-breakpoint
ALTER TABLE marketplace_outbox DROP COLUMN IF EXISTS commit_sequence;
--> statement-breakpoint
DROP SEQUENCE IF EXISTS marketplace_outbox_commit_seq;
