-- Outbox retry tracking (M2-07 gap G3 · wave 2): per-row delivery attempt counter and last error.
--
-- Why: the shared drain contract (ADR-042) exposes an optional
-- `recordDeliveryFailure`. Without `attempts`/`last_error` the failure path had
-- nowhere to write, so a poisoned event looked identical to a fresh one on every
-- pass. Wave 1 (`CLM-0245`) aligned five tables; this aligns matching_outbox.
--
-- Backfill-safe: `attempts` defaults to 0, `last_error` is nullable, so existing
-- rows keep their meaning (0 attempts recorded, no error observed).
-- @wasla-upgrade-proof: all-non-baseline

ALTER TABLE "matching_outbox" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "matching_outbox" ADD COLUMN IF NOT EXISTS "last_error" TEXT;
