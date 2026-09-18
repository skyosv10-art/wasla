-- Rollback for 0001_outbox_sequence_number (ADR-037 · RISK-0012).
-- Drops the index and column; existing rows lose their sequence values.

DROP INDEX IF EXISTS "ix_negotiation_outbox_unpublished";--> statement-breakpoint
ALTER TABLE "negotiation_outbox" DROP COLUMN IF EXISTS "sequence_number";
