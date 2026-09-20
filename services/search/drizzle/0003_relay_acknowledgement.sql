-- Search relay dead-letter acknowledgement (M2-07 gap G5 · wave 3): the record.
--
-- Why: `GET /search/relay/dead-letters` (wave 1) turns `warning` on at one
-- poisoned row and `POST .../requeue` (wave 2) only helps when the cause is
-- gone. A row whose cause still stands leaves the alert on forever until an
-- operator silences the whole signal — and then the NEXT loss is invisible too.
-- The acknowledgement triple lets one row be excluded from the VERDICT while
-- staying in `total_poisoned`, with a named acknowledger and a written reason.
--
-- Backfill-safe: all three columns are nullable, so every existing row reads
-- "not acknowledged" — which is the truth for rows written before this wave.
--
-- `ck_..._ack_poisoned_only` is the constraint that forces requeue to clear the
-- triple: the database refuses an acknowledged row that is no longer poisoned,
-- so "handled" cannot survive on a row that became live again.
-- @wasla-upgrade-proof: all-non-baseline

ALTER TABLE "search_relay_consumed_events" ADD COLUMN IF NOT EXISTS "acknowledged_at" TIMESTAMPTZ;--> statement-breakpoint
ALTER TABLE "search_relay_consumed_events" ADD COLUMN IF NOT EXISTS "acknowledged_by" TEXT;--> statement-breakpoint
ALTER TABLE "search_relay_consumed_events" ADD COLUMN IF NOT EXISTS "acknowledgement_reason" TEXT;--> statement-breakpoint
ALTER TABLE "search_relay_consumed_events" DROP CONSTRAINT IF EXISTS "search_relay_consumed_events_ack_by_check";--> statement-breakpoint
ALTER TABLE "search_relay_consumed_events" ADD CONSTRAINT "search_relay_consumed_events_ack_by_check" CHECK ("acknowledged_by" IS NULL OR char_length("acknowledged_by") BETWEEN 1 AND 128);--> statement-breakpoint
ALTER TABLE "search_relay_consumed_events" DROP CONSTRAINT IF EXISTS "search_relay_consumed_events_ack_reason_check";--> statement-breakpoint
ALTER TABLE "search_relay_consumed_events" ADD CONSTRAINT "search_relay_consumed_events_ack_reason_check" CHECK ("acknowledgement_reason" IS NULL OR char_length("acknowledgement_reason") BETWEEN 12 AND 512);--> statement-breakpoint
ALTER TABLE "search_relay_consumed_events" DROP CONSTRAINT IF EXISTS "ck_search_relay_consumed_events_ack_triple";--> statement-breakpoint
ALTER TABLE "search_relay_consumed_events" ADD CONSTRAINT "ck_search_relay_consumed_events_ack_triple" CHECK (("acknowledged_at" IS NULL) = ("acknowledged_by" IS NULL) AND ("acknowledged_at" IS NULL) = ("acknowledgement_reason" IS NULL));--> statement-breakpoint
ALTER TABLE "search_relay_consumed_events" DROP CONSTRAINT IF EXISTS "ck_search_relay_consumed_events_ack_poisoned_only";--> statement-breakpoint
ALTER TABLE "search_relay_consumed_events" ADD CONSTRAINT "ck_search_relay_consumed_events_ack_poisoned_only" CHECK ("acknowledged_at" IS NULL OR "status" = 'poisoned');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_search_relay_consumed_unacknowledged" ON "search_relay_consumed_events" ("consumed_at") WHERE "status" = 'poisoned' AND "acknowledged_at" IS NULL;
