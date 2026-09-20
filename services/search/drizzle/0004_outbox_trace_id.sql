-- Outbox trace correlation (M2-07 gap G4): per-row trace_id for cross-service
-- observability correlation.
--
-- Why: the shared drain contract (ADR-042) exposes OutboxRecord.traceId. Six
-- outbox tables had no trace_id column at all, so the adapter returned null
-- and the trace context written by the producer was lost at the outbox boundary.
-- delivery_outbox already had trace_id; this aligns search_outbox.
--
-- Backfill-safe: trace_id is nullable, so existing rows keep their meaning
-- (no trace context recorded).
-- @wasla-upgrade-proof: all-non-baseline

ALTER TABLE "search_outbox" ADD COLUMN IF NOT EXISTS "trace_id" TEXT;
