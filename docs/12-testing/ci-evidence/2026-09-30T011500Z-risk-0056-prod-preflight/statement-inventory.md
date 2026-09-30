# Statement inventory — services/*/contracts/schema.sql (offline, generated)

| Service | Statements | CREATE TABLE | CREATE INDEX (unique) | ALTER TABLE | FUNCTION | TRIGGER (drop/create) | DROP INDEX | INSERT (seed) | EXTENSION | Unguarded |
|---|---|---|---|---|---|---|---|---|---|---|
| audit | 4 | 1 | 3 (0) | 0 | 0 | 0/0 | 0 | 0 | 0 | 0 |
| customers | 22 | 5 | 8 (4) | 0 | 1 | 3/3 | 0 | 0 | 0 | 3 |
| delivery | 33 | 14 | 14 (0) | 0 | 0 | 0/0 | 0 | 0 | 0 | 0 |
| dispatch | 25 | 5 | 9 (2) | 1 | 1 | 3/3 | 1 | 0 | 0 | 3 |
| drivers | 34 | 9 | 15 (5) | 0 | 1 | 3/3 | 0 | 1 | 0 | 3 |
| geography | 36 | 13 | 8 (5) | 0 | 1 | 6/6 | 0 | 0 | 0 | 6 |
| identity | 18 | 6 | 7 (3) | 0 | 1 | 1/1 | 0 | 0 | 0 | 1 |
| marketplace | 23 | 10 | 9 (4) | 1 | 0 | 0/0 | 1 | 0 | 0 | 0 |
| matching | 16 | 6 | 5 (0) | 1 | 0 | 0/0 | 1 | 1 | 0 | 0 |
| negotiations | 27 | 8 | 14 (2) | 1 | 0 | 0/0 | 1 | 1 | 0 | 0 |
| orders | 28 | 5 | 11 (2) | 3 | 1 | 2/2 | 1 | 0 | 0 | 3 |
| reputation | 27 | 9 | 11 (0) | 1 | 0 | 0/0 | 1 | 3 | 0 | 0 |
| search | 28 | 6 | 9 (0) | 0 | 2 | 4/4 | 0 | 0 | 1 | 4 |
| subscriptions | 19 | 10 | 5 (0) | 1 | 0 | 0/0 | 1 | 0 | 0 | 0 |

## Every non-CREATE-TABLE / non-CREATE-INDEX statement

| Service | # | Kind | Target | Guarded | Detail |
|---|---|---|---|---|---|
| customers | 15 | CREATE FUNCTION | customer_set_updated_at | yes |  |
| customers | 16 | DROP TRIGGER | trg_customer_profiles_updated_at | yes | customer_profiles |
| customers | 17 | CREATE TRIGGER | trg_customer_profiles_updated_at | **no** | customer_profiles |
| customers | 18 | DROP TRIGGER | trg_customer_saved_places_updated_at | yes | customer_saved_places |
| customers | 19 | CREATE TRIGGER | trg_customer_saved_places_updated_at | **no** | customer_saved_places |
| customers | 20 | DROP TRIGGER | trg_customer_order_requests_updated_at | yes | customer_order_requests |
| customers | 21 | CREATE TRIGGER | trg_customer_order_requests_updated_at | **no** | customer_order_requests |
| delivery | 2 | CREATE SEQUENCE | store_order_public_id_seq | yes |  |
| dispatch | 13 | ALTER TABLE | dispatch_outbox | yes | ADD COLUMN IF NOT EXISTS sequence_number BIGINT GENERATED ALWAYS AS IDENTITY |
| dispatch | 14 | DROP INDEX | ix_dispatch_outbox_unpublished | yes |  |
| dispatch | 18 | CREATE FUNCTION | dispatch_set_updated_at | yes |  |
| dispatch | 19 | DROP TRIGGER | trg_dispatch_jobs_updated_at | yes | dispatch_jobs |
| dispatch | 20 | CREATE TRIGGER | trg_dispatch_jobs_updated_at | **no** | dispatch_jobs |
| dispatch | 21 | DROP TRIGGER | trg_dispatch_waves_updated_at | yes | dispatch_waves |
| dispatch | 22 | CREATE TRIGGER | trg_dispatch_waves_updated_at | **no** | dispatch_waves |
| dispatch | 23 | DROP TRIGGER | trg_dispatch_offers_updated_at | yes | dispatch_offers |
| dispatch | 24 | CREATE TRIGGER | trg_dispatch_offers_updated_at | **no** | dispatch_offers |
| drivers | 18 | INSERT | driver_eligibility_policies | yes | ON CONFLICT (version) DO NOTHING |
| drivers | 27 | CREATE FUNCTION | driver_set_updated_at | yes |  |
| drivers | 28 | DROP TRIGGER | trg_driver_profiles_updated_at | yes | driver_profiles |
| drivers | 29 | CREATE TRIGGER | trg_driver_profiles_updated_at | **no** | driver_profiles |
| drivers | 30 | DROP TRIGGER | trg_driver_vehicles_updated_at | yes | driver_vehicles |
| drivers | 31 | CREATE TRIGGER | trg_driver_vehicles_updated_at | **no** | driver_vehicles |
| drivers | 32 | DROP TRIGGER | trg_driver_documents_updated_at | yes | driver_documents |
| drivers | 33 | CREATE TRIGGER | trg_driver_documents_updated_at | **no** | driver_documents |
| geography | 23 | CREATE FUNCTION | geo_set_updated_at | yes |  |
| geography | 24 | DROP TRIGGER | trg_geo_countries_updated_at | yes | geo_countries |
| geography | 25 | CREATE TRIGGER | trg_geo_countries_updated_at | **no** | geo_countries |
| geography | 26 | DROP TRIGGER | trg_geo_regions_updated_at | yes | geo_regions |
| geography | 27 | CREATE TRIGGER | trg_geo_regions_updated_at | **no** | geo_regions |
| geography | 28 | DROP TRIGGER | trg_geo_cities_updated_at | yes | geo_cities |
| geography | 29 | CREATE TRIGGER | trg_geo_cities_updated_at | **no** | geo_cities |
| geography | 30 | DROP TRIGGER | trg_geo_districts_updated_at | yes | geo_districts |
| geography | 31 | CREATE TRIGGER | trg_geo_districts_updated_at | **no** | geo_districts |
| geography | 32 | DROP TRIGGER | trg_geo_zones_updated_at | yes | geo_zones |
| geography | 33 | CREATE TRIGGER | trg_geo_zones_updated_at | **no** | geo_zones |
| geography | 34 | DROP TRIGGER | trg_geo_user_locations_updated_at | yes | geo_user_locations |
| geography | 35 | CREATE TRIGGER | trg_geo_user_locations_updated_at | **no** | geo_user_locations |
| identity | 15 | CREATE FUNCTION | identity_set_updated_at | yes |  |
| identity | 16 | DROP TRIGGER | trg_identity_users_updated_at | yes | identity_users |
| identity | 17 | CREATE TRIGGER | trg_identity_users_updated_at | **no** | identity_users |
| marketplace | 20 | ALTER TABLE | marketplace_outbox | yes | ADD COLUMN IF NOT EXISTS sequence_number BIGINT GENERATED ALWAYS AS IDENTITY |
| marketplace | 21 | DROP INDEX | ix_marketplace_outbox_unpublished | yes |  |
| matching | 7 | INSERT | matching_rulesets | yes | ON CONFLICT (version) DO NOTHING |
| matching | 12 | ALTER TABLE | matching_outbox | yes | ADD COLUMN IF NOT EXISTS sequence_number BIGINT GENERATED ALWAYS AS IDENTITY |
| matching | 13 | DROP INDEX | ix_matching_outbox_unpublished | yes |  |
| negotiations | 3 | INSERT | negotiation_policies | yes | ON CONFLICT (policy_version) DO NOTHING |
| negotiations | 24 | ALTER TABLE | negotiation_outbox | yes | ADD COLUMN IF NOT EXISTS sequence_number BIGINT GENERATED ALWAYS AS IDENTITY |
| negotiations | 25 | DROP INDEX | ix_negotiation_outbox_unpublished | yes |  |
| orders | 2 | CREATE SEQUENCE | order_public_id_seq | yes |  |
| orders | 16 | ALTER TABLE | orders | yes | DROP CONSTRAINT IF EXISTS fk_orders_active_assignment |
| orders | 17 | ALTER TABLE | orders | **no** | ADD CONSTRAINT fk_orders_active_assignment FOREIGN KEY (active_assignment_id) REFERENCES order_assignments(id) ON DELETE SET NULL |
| orders | 19 | ALTER TABLE | order_outbox | yes | ADD COLUMN IF NOT EXISTS sequence_number BIGINT GENERATED ALWAYS AS IDENTITY |
| orders | 20 | DROP INDEX | ix_order_outbox_unpublished | yes |  |
| orders | 23 | CREATE FUNCTION | order_set_updated_at | yes |  |
| orders | 24 | DROP TRIGGER | trg_orders_updated_at | yes | orders |
| orders | 25 | CREATE TRIGGER | trg_orders_updated_at | **no** | orders |
| orders | 26 | DROP TRIGGER | trg_order_assignments_updated_at | yes | order_assignments |
| orders | 27 | CREATE TRIGGER | trg_order_assignments_updated_at | **no** | order_assignments |
| reputation | 3 | INSERT | reputation_rulesets | yes | ON CONFLICT (ruleset_version) DO NOTHING |
| reputation | 5 | INSERT | reputation_rule_weights | yes | ON CONFLICT (ruleset_version, subject_type, fact_kind) DO NOTHING |
| reputation | 7 | INSERT | reputation_fraud_thresholds | yes | ON CONFLICT (ruleset_version, rule_code) DO NOTHING |
| reputation | 24 | ALTER TABLE | reputation_outbox | yes | ADD COLUMN IF NOT EXISTS sequence_number BIGINT GENERATED ALWAYS AS IDENTITY |
| reputation | 25 | DROP INDEX | ix_reputation_outbox_unpublished | yes |  |
| search | 2 | CREATE EXTENSION | pg_trgm | yes |  |
| search | 18 | CREATE FUNCTION | search_set_indexed_at | yes |  |
| search | 19 | CREATE FUNCTION | search_set_updated_at | yes |  |
| search | 20 | DROP TRIGGER | trg_search_product_index_indexed_at | yes | search_product_index |
| search | 21 | CREATE TRIGGER | trg_search_product_index_indexed_at | **no** | search_product_index |
| search | 22 | DROP TRIGGER | trg_search_product_state_updated_at | yes | search_marketplace_product_state |
| search | 23 | CREATE TRIGGER | trg_search_product_state_updated_at | **no** | search_marketplace_product_state |
| search | 24 | DROP TRIGGER | trg_search_store_state_updated_at | yes | search_marketplace_store_state |
| search | 25 | CREATE TRIGGER | trg_search_store_state_updated_at | **no** | search_marketplace_store_state |
| search | 26 | DROP TRIGGER | trg_search_checkpoint_updated_at | yes | search_relay_checkpoint |
| search | 27 | CREATE TRIGGER | trg_search_checkpoint_updated_at | **no** | search_relay_checkpoint |
| subscriptions | 16 | ALTER TABLE | subscription_outbox | yes | ADD COLUMN IF NOT EXISTS sequence_number BIGINT GENERATED ALWAYS AS IDENTITY |
| subscriptions | 17 | DROP INDEX | ix_subscription_outbox_unpublished | yes |  |

## Unguarded statements (would error or re-run without an existence guard)

- customers #17 CREATE TRIGGER trg_customer_profiles_updated_at customer_profiles
- customers #19 CREATE TRIGGER trg_customer_saved_places_updated_at customer_saved_places
- customers #21 CREATE TRIGGER trg_customer_order_requests_updated_at customer_order_requests
- dispatch #20 CREATE TRIGGER trg_dispatch_jobs_updated_at dispatch_jobs
- dispatch #22 CREATE TRIGGER trg_dispatch_waves_updated_at dispatch_waves
- dispatch #24 CREATE TRIGGER trg_dispatch_offers_updated_at dispatch_offers
- drivers #29 CREATE TRIGGER trg_driver_profiles_updated_at driver_profiles
- drivers #31 CREATE TRIGGER trg_driver_vehicles_updated_at driver_vehicles
- drivers #33 CREATE TRIGGER trg_driver_documents_updated_at driver_documents
- geography #25 CREATE TRIGGER trg_geo_countries_updated_at geo_countries
- geography #27 CREATE TRIGGER trg_geo_regions_updated_at geo_regions
- geography #29 CREATE TRIGGER trg_geo_cities_updated_at geo_cities
- geography #31 CREATE TRIGGER trg_geo_districts_updated_at geo_districts
- geography #33 CREATE TRIGGER trg_geo_zones_updated_at geo_zones
- geography #35 CREATE TRIGGER trg_geo_user_locations_updated_at geo_user_locations
- identity #17 CREATE TRIGGER trg_identity_users_updated_at identity_users
- orders #17 ALTER TABLE orders
- orders #25 CREATE TRIGGER trg_orders_updated_at orders
- orders #27 CREATE TRIGGER trg_order_assignments_updated_at order_assignments
- search #21 CREATE TRIGGER trg_search_product_index_indexed_at search_product_index
- search #23 CREATE TRIGGER trg_search_product_state_updated_at search_marketplace_product_state
- search #25 CREATE TRIGGER trg_search_store_state_updated_at search_marketplace_store_state
- search #27 CREATE TRIGGER trg_search_checkpoint_updated_at search_relay_checkpoint
