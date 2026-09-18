-- ADR-037: Monotonic sequence_number for outbox ordering (RISK-0012 mitigation).
-- @wasla-upgrade-proof: all-non-baseline
--
-- sequence_number is GENERATED ALWAYS AS IDENTITY — PostgreSQL assigns values
-- in insertion order, even within a single transaction. The drain query orders
-- by sequence_number ASC as the sole sort key, replacing the fragile
-- (occurred_at, outbox_id) ordering that tied on now() within one txn.

ALTER TABLE "marketplace_outbox" ADD COLUMN "sequence_number" bigint GENERATED ALWAYS AS IDENTITY;--> statement-breakpoint
DROP INDEX IF EXISTS "ix_marketplace_outbox_unpublished";--> statement-breakpoint
CREATE INDEX "ix_marketplace_outbox_unpublished" ON "marketplace_outbox" USING btree ("sequence_number") WHERE "published_at" IS NULL;
