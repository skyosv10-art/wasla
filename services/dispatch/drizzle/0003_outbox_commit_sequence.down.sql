-- Rollback RISK-0012 (CLM-0416 · ADR-057): commit-ordered dispatch_outbox.
-- Consumers of the previous release order by the old tuple and ignore these objects.
-- @wasla-upgrade-proof: all-non-baseline

DROP TRIGGER IF EXISTS trg_dispatch_outbox_commit_sequence ON dispatch_outbox;
--> statement-breakpoint
DROP FUNCTION IF EXISTS dispatch_outbox_assign_commit_sequence();
--> statement-breakpoint
DROP INDEX IF EXISTS ux_dispatch_outbox_commit_sequence;
--> statement-breakpoint
ALTER TABLE dispatch_outbox DROP COLUMN IF EXISTS commit_sequence;
--> statement-breakpoint
DROP SEQUENCE IF EXISTS dispatch_outbox_commit_seq;
