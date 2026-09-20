-- Outbox retry tracking (M2-07 gap G3): per-row delivery attempt counter and last error.
--
-- Why: the shared drain contract (ADR-042) exposes an optional
-- `recordDeliveryFailure`. Without `attempts`/`last_error` the failure path had
-- nowhere to write, so a poisoned event looked identical to a fresh one on every
-- pass. `negotiation_outbox` already had both columns; this aligns customer_outbox.
--
-- Backfill-safe: `attempts` defaults to 0, `last_error` is nullable, so existing
-- rows keep their meaning (0 attempts recorded, no error observed).
-- @wasla-upgrade-proof: all-non-baseline

ALTER TABLE "customer_outbox" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "customer_outbox" ADD COLUMN IF NOT EXISTS "last_error" TEXT;
