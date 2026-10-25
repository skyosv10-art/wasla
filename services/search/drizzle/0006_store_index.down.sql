-- Rollback G-S9.7 (CLM-0649 · ADR-025 §6): derived store-name read model.
-- A derived projection — dropping it loses nothing a replay cannot refetch.
-- @wasla-upgrade-proof: all-non-baseline

DROP TABLE IF EXISTS search_store_index;
