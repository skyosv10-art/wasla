-- Outbox unpublished-events index: align with BIGSERIAL PK for monotonic ordering.
-- The BIGSERIAL id/outbox_id is already a monotonic sequence (ADR-037 §Scope).
-- This migration changes the index from (occurred_at) to (id) so the query
-- planner can use it for the ORDER BY id ASC used by the drain/replay path.
-- @wasla-upgrade-proof: all-non-baseline

DROP INDEX IF EXISTS "ix_driver_outbox_unpublished";--> statement-breakpoint
CREATE INDEX "ix_driver_outbox_unpublished" ON "driver_outbox" USING btree ("id") WHERE "published_at" IS NULL;
