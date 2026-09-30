-- Rollback RISK-0012 (CLM-0416 · ADR-057): commit-ordered relay cursor.
-- Consumers of the previous release order by the old tuple and ignore these objects.
-- @wasla-upgrade-proof: all-non-baseline

ALTER TABLE billing_relay_checkpoint DROP COLUMN IF EXISTS last_commit_sequence;
