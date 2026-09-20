-- Rollback: drop outbox retry tracking columns (M2-07 gap G3 · wave 2).
-- Data loss on rollback is intentional and bounded: attempt counters and last
-- error strings are operational telemetry, not domain state.
-- @wasla-upgrade-proof: all-non-baseline

ALTER TABLE "matching_outbox" DROP COLUMN IF EXISTS "last_error";--> statement-breakpoint
ALTER TABLE "matching_outbox" DROP COLUMN IF EXISTS "attempts";
