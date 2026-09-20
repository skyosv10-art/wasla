-- Rollback: drop the search relay dead-letter acknowledgement triple (G5 · wave 3).
--
-- Data loss on rollback is intentional and bounded: an acknowledgement is an
-- operator note on a poisoned row, not domain state. The row itself, its status
-- and its error text survive, so nothing that the relay reads is lost — the
-- verdict simply stops excluding acknowledged rows, i.e. it gets LOUDER, never
-- quieter. Dropping the columns drops the constraints and the partial index with
-- them, but both are dropped explicitly first so a partial rollback is visible.
-- @wasla-upgrade-proof: all-non-baseline

DROP INDEX IF EXISTS "ix_search_relay_consumed_unacknowledged";--> statement-breakpoint
ALTER TABLE "search_relay_consumed_events" DROP CONSTRAINT IF EXISTS "ck_search_relay_consumed_events_ack_poisoned_only";--> statement-breakpoint
ALTER TABLE "search_relay_consumed_events" DROP CONSTRAINT IF EXISTS "ck_search_relay_consumed_events_ack_triple";--> statement-breakpoint
ALTER TABLE "search_relay_consumed_events" DROP CONSTRAINT IF EXISTS "search_relay_consumed_events_ack_reason_check";--> statement-breakpoint
ALTER TABLE "search_relay_consumed_events" DROP CONSTRAINT IF EXISTS "search_relay_consumed_events_ack_by_check";--> statement-breakpoint
ALTER TABLE "search_relay_consumed_events" DROP COLUMN IF EXISTS "acknowledgement_reason";--> statement-breakpoint
ALTER TABLE "search_relay_consumed_events" DROP COLUMN IF EXISTS "acknowledged_by";--> statement-breakpoint
ALTER TABLE "search_relay_consumed_events" DROP COLUMN IF EXISTS "acknowledged_at";
