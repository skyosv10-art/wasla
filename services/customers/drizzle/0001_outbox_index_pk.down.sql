-- Rollback: revert outbox index from (id) back to (occurred_at).
-- @wasla-upgrade-proof: all-non-baseline

DROP INDEX IF EXISTS "ix_customer_outbox_unpublished";--> statement-breakpoint
CREATE INDEX "ix_customer_outbox_unpublished" ON "customer_outbox" USING btree ("occurred_at") WHERE "published_at" IS NULL;
