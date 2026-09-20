-- Rollback: drop outbox trace_id column (M2-07 gap G4).
-- Data loss on rollback is intentional and bounded: trace_id is operational
-- observability telemetry, not domain state.
-- @wasla-upgrade-proof: all-non-baseline

ALTER TABLE "identity_outbox" DROP COLUMN IF EXISTS "trace_id";
