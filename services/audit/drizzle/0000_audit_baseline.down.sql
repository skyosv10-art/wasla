-- Rollback: drop the audit_events table (baseline, so rollback drops everything).
-- Data loss on rollback is intentional: this is the baseline migration.
-- @wasla-upgrade-proof: all-non-baseline

DROP TABLE IF EXISTS "audit_events";
