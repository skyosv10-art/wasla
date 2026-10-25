-- G-S9.7 (CLM-0649 · ADR-025 §6): derived store-name read model.
--
-- Store names (ar/en/ur) fetched through the signed marketplace read port when a
-- store is approved — never joined across the service boundary and never carried in
-- events (ADR-016 §10). Eligibility is NOT stored here: it is derived at read time
-- from search_marketplace_store_state (approved) and the existence of a visible
-- product in search_marketplace_product_state. Rebuildable: rebuildAll truncates it
-- and replay refetches. Idempotent: the same statement as contracts/schema.sql.
-- @wasla-upgrade-proof: all-non-baseline

CREATE TABLE IF NOT EXISTS search_store_index (
    store_id           UUID        PRIMARY KEY,
    store_slug         TEXT        NOT NULL,
    title_ar           TEXT        NOT NULL,
    title_en           TEXT,
    title_ur           TEXT,
    name_norm_ar       TEXT        NOT NULL,
    name_norm_en       TEXT,
    name_norm_ur       TEXT,
    CONSTRAINT ux_search_store_index_slug UNIQUE (store_slug)
);
