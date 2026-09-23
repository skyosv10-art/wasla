-- Rollback: drop suspension_reason_code column (M3-04 CLM-0319).
-- Data loss on rollback is intentional and bounded: suspension_reason_code
-- is only set when a customer is suspended; dropping it loses the reason
-- for active suspensions, which is acceptable for a rollback.
-- @wasla-upgrade-proof: all-non-baseline

ALTER TABLE "customer_profiles" DROP COLUMN IF EXISTS "suspension_reason_code";
