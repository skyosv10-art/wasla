-- Rollback: revert outbox index from (id) back to (occurred_at).
-- @wasla-upgrade-proof: all-non-baseline

DROP INDEX IF EXISTS "ix_driver_outbox_unpublished";--> statement-breakpoint
CREATE INDEX "ix_driver_outbox_unpublished" ON "driver_outbox" USING btree ("occurred_at") WHERE "published_at" IS NULL;
