-- Revert: idempotency response storage (M2-07 gap G6)

ALTER TABLE "driver_idempotency" DROP CONSTRAINT IF EXISTS "ck_driver_idempotency_response_pair";--> statement-breakpoint
ALTER TABLE "driver_idempotency" DROP COLUMN IF EXISTS "response_body";--> statement-breakpoint
ALTER TABLE "driver_idempotency" DROP COLUMN IF EXISTS "response_status";
