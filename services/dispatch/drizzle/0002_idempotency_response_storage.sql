-- Idempotency response storage (M2-07 gap G6): store the actual response so
-- replays return the cached result instead of reprocessing.
--
-- Why: the shared idempotency tables in dispatch/drivers/matching stored only
-- a payload fingerprint. A replay with the same key had to reprocess the request
-- because the original response was lost. The 5 services that already cache
-- (reputation, marketplace, negotiations, subscriptions, delivery) can return
-- the stored response directly. This aligns dispatch_idempotency.
--
-- Backfill-safe: response_status and response_body are nullable with a CHECK
-- that requires both-or-neither. Existing rows keep NULL (no response was
-- recorded) and code falls back to reprocessing for those legacy rows.
-- @wasla-upgrade-proof: all-non-baseline

ALTER TABLE "dispatch_idempotency" ADD COLUMN IF NOT EXISTS "response_status" INTEGER CHECK ("dispatch_idempotency"."response_status" BETWEEN 100 AND 599);--> statement-breakpoint
ALTER TABLE "dispatch_idempotency" ADD COLUMN IF NOT EXISTS "response_body" JSONB;--> statement-breakpoint
ALTER TABLE "dispatch_idempotency" ADD CONSTRAINT "ck_dispatch_idempotency_response_pair"
    CHECK (("dispatch_idempotency"."response_status" IS NULL) = ("dispatch_idempotency"."response_body" IS NULL));
