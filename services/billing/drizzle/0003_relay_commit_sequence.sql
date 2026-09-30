-- RISK-0012 (CLM-0416 · ADR-057): commit-ordered relay cursor
--
-- Consumers now read the producer's outbox in COMMIT order. `commit_sequence` is
-- (re)assigned by a DEFERRABLE INITIALLY DEFERRED constraint trigger at COMMIT,
-- under a per-table advisory lock, so a transaction that inserted first but
-- committed last gets the higher number and is never skipped by a consumer that
-- already read past its insert-time position. Existing rows are backfilled in
-- their existing append order. Idempotent: the same statements as contracts/schema.sql.
-- @wasla-upgrade-proof: all-non-baseline

ALTER TABLE billing_relay_checkpoint ADD COLUMN IF NOT EXISTS last_commit_sequence BIGINT NOT NULL DEFAULT 0;
