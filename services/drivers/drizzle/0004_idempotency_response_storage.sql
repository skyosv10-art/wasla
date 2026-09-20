-- Idempotency response storage (M2-07 gap G6): store the actual response so
-- replays return the cached result instead of reprocessing.
-- Aligns driver_idempotency with reputation/marketplace/negotiations/subscriptions.
-- Backfill-safe: nullable columns with all-or-none CHECK. Legacy rows keep NULL.
-- @wasla-upgrade-proof: all-non-baseline

ALTER TABLE "driver_idempotency" ADD COLUMN IF NOT EXISTS "response_status" INTEGER CHECK ("driver_idempotency"."response_status" BETWEEN 100 AND 599);--> statement-breakpoint
ALTER TABLE "driver_idempotency" ADD COLUMN IF NOT EXISTS "response_body" JSONB;--> statement-breakpoint
ALTER TABLE "driver_idempotency" ADD CONSTRAINT "ck_driver_idempotency_response_pair"
    CHECK (("driver_idempotency"."response_status" IS NULL) = ("driver_idempotency"."response_body" IS NULL));
