# RISK-0056 — inventory and test-database proof (production NOT touched)

**Claim:** CLM-0410 · **Work item:** M6-18B (stays **Blocked**) · **Risk:** RISK-0056 (stays **open**)
**Date:** 2026-09-30 · **Branch:** `ops/risk-0056-test-db` · **Commit measured:** `383eb8e`
**Run:** [36652155317](https://github.com/skyosv10-art/wasla/actions/runs/36652155317) — success · [filtered log excerpt](run-36652155317-excerpt.txt)
**Target database:** the separate TEST project behind secret `SUPABASE_TEST_DB_URL` — project ref `obeptvwpvqbduwkahorq`, Session pooler, PostgreSQL 17.6. The guard ([`guard-test-db.py`](../../../scripts/ops/risk-0056/guard-test-db.py)) refused any URL carrying the production ref `snlpxywskyqrjattbpgn`; it matched none. No connection string, user, or password appears in logs, files, or this report.

## 1. Phase 1 — read-only inventory

### 1.1 Which services show the fault on production (read-only HTTP GET, 2026-09-30)

| Service | Open route answer on production | Detects missing schema? |
|---|---|---|
| delivery | `/delivery/ready` → 503 `database: schema_missing` | **Yes** — probes `SELECT 1 FROM store_orders` |
| marketplace | `/health` → `{"status":"degraded","mode":"postgres"}` | **Yes** — health reads `store_categories` |
| matching | `/health` → `degraded`, `active_ruleset_version: null` | **Yes** — health reads the active ruleset |
| audit, customers, dispatch, drivers, geography, identity, negotiations, orders, reputation, search, subscriptions | `/health` → `ok` (`persistence: postgres`) | **No** — health does not touch a table, so `ok` hides the missing schema |
| billing, partners, support | 404 — not deployed on Render | n/a (out of scope for the live DB) |

Only `delivery` reports the literal `schema_missing`. The other 13 deployed services are equally
affected: `public` on production holds 5 tables and none of theirs
([DR drill inventory](../2026-09-29T130000Z-m6-18b-dr-drill-live/schema-inventory-raw.txt)).
The test DB **before** migration reproduced production's answers exactly for all 14 services
(same `schema_missing`, same two `degraded`, same eleven blind `ok`) — so the fault is fully
explained by missing tables, not by code or config.

### 1.2 How migrations work here (measured from the code)

- Each service's `db:migrate` (`src/db/migrate-cli.ts` → `migrate.ts`) executes
  **`services/<svc>/contracts/schema.sql` verbatim**. The Drizzle files under `drizzle/` are a
  mirror, not what the runner applies. There is no migration-history table.
- All 14 `schema.sql` files: every `CREATE TABLE` is `IF NOT EXISTS`; indexes/triggers use
  `IF NOT EXISTS` / `DROP … IF EXISTS` then re-create; seed rows use `ON CONFLICT DO NOTHING`;
  13 of 14 are wrapped in `BEGIN;`/`COMMIT;` (audit is a single idempotent file). ⇒ **idempotent by construction**, proven by pass 2 below.
- **No cross-service foreign keys** (every `REFERENCES` target is in the same file) and **no
  table-name collisions** across services (107 distinct tables). ⇒ services can be applied in any
  order; the only external prerequisite is `CREATE EXTENSION IF NOT EXISTS pg_trgm` (search),
  which is in its own file.
- The table set in each `schema.sql` equals the table set in its Drizzle migrations (diff = 0).

### 1.3 Tables each service needs (from its `contracts/schema.sql`)

| Service | # | Tables |
|---|---|---|
| audit | 1 | audit_events *(already exists on production — 10 rows)* |
| customers | 5 | customer_profiles, customer_saved_places, customer_order_requests, customer_order_request_stops, customer_outbox |
| delivery | 14 | store_orders, store_order_items, store_order_transitions, delivery_tasks, delivery_task_transitions, delivery_outbox, delivery_idempotency_keys, delivery_relay_checkpoint, delivery_relay_consumed_events, delivery_inventory_observations, delivery_inventory_reservations, delivery_inventory_conflicts, delivery_inventory_relay_checkpoint, delivery_inventory_relay_consumed_events |
| dispatch | 5 | dispatch_jobs, dispatch_waves, dispatch_offers, dispatch_outbox, dispatch_idempotency |
| drivers | 9 | driver_profiles, driver_vehicles, driver_documents, driver_service_zones, driver_eligibility_policies, driver_eligibility_log, driver_candidacy_publications, driver_outbox, driver_idempotency |
| geography | 13 | geo_countries, geo_regions, geo_cities, geo_districts, geo_zones (+ 5 `*_names`), geo_user_locations, geo_user_location_history, geo_outbox |
| identity | 6 | identity_users, identity_links, identity_sessions, identity_history, identity_recovery_requests, identity_outbox |
| marketplace | 10 | stores, store_categories, store_staff, store_reviews, products, product_inventory, product_reviews, inventory_adjustments, marketplace_outbox, marketplace_idempotency |
| matching | 6 | matching_rulesets (+ seed v1), matching_decisions, matching_decision_candidates, driver_candidacy, matching_outbox, matching_idempotency |
| negotiations | 8 | negotiation_policies (+ seed), negotiation_threads, negotiation_rounds, negotiation_messages, negotiation_agreements, negotiation_price_handoffs, negotiation_outbox, negotiation_idempotency |
| orders | 5 | orders, order_stops, order_status_history, order_assignments, order_outbox |
| reputation | 9 | reputation_rulesets / rule_weights / fraud_thresholds (+ seeds), reputation_facts, reputation_scores, reputation_ratings, fraud_signals, reputation_outbox, reputation_idempotency |
| search | 6 | search_product_index, search_marketplace_product_state, search_marketplace_store_state, search_outbox, search_relay_checkpoint, search_relay_consumed_events |
| subscriptions | 10 | subscription_plans (+ seed), subscription_plan_entitlements, subscriptions, subscription_periods, subscription_transitions, referral_codes, referrals, referral_rewards, subscription_outbox, subscription_idempotency |

Columns: the proof compares every column (name, type, nullability) of all 107 tables against a
vanilla `postgres:17` reference built from the same files — see §2.2.

### 1.4 Verdict of the inventory

**The existing migrations are sufficient. No new migration was written.** For every one of the
14 services the fix is **"apply the existing migration"** (`pnpm --filter @wasla/<svc>-service db:migrate`).

## 2. Phase 2 — test database only

### 2.1 Application (pass 1 + pass 2)

All 14 × 2 runs exited 0. Pass 1 took 1.34–2.31 s per service; pass 2 (re-run on an already
migrated DB) 1.37–2.31 s with no error and no duplicate seed ⇒ idempotent.
`public` tables on the test DB: **0 → 107**. Other schemas unchanged (auth 27, storage 8, realtime 3, vault 1).

### 2.2 Per-service results

| Service | Solution | Schema present + columns = reference | All tables readable | Write + read-back, rolled back (0 rows left) | Boot on test DB | `/health` before → after |
|---|---|---|---|---|---|---|
| audit | existing migration | ✅ 1/1 | ✅ | ✅ audit_events | ✅ | ok → ok (blind) |
| customers | existing migration | ✅ 5/5 | ✅ | ✅ customer_outbox | ✅ | ok → ok (blind) |
| delivery | existing migration | ✅ 14/14 | ✅ | ✅ delivery_outbox | ✅ | `/delivery/ready` 503 **schema_missing → 200 ready, database ok** |
| dispatch | existing migration | ✅ 5/5 | ✅ | ✅ dispatch_outbox | ✅ | ok → ok (blind) |
| drivers | existing migration | ✅ 9/9 | ✅ | ✅ driver_outbox | ✅ | ok → ok (blind) |
| geography | existing migration | ✅ 13/13 | ✅ | ✅ geo_outbox | ✅ | ok → ok (blind) |
| identity | existing migration | ✅ 6/6 | ✅ | ✅ identity_outbox | ✅ | ok → ok (blind) |
| marketplace | existing migration | ✅ 10/10 | ✅ | ✅ marketplace_outbox | ✅ | **degraded → ok** |
| matching | existing migration | ✅ 6/6 | ✅ | ✅ matching_outbox | ✅ | **degraded (ruleset null) → ok (ruleset 1)** |
| negotiations | existing migration | ✅ 8/8 | ✅ | ✅ negotiation_outbox | ✅ | ok → ok (blind) |
| orders | existing migration | ✅ 5/5 | ✅ | ✅ order_outbox | ✅ | ok → ok (blind) |
| reputation | existing migration | ✅ 9/9 | ✅ | ✅ reputation_outbox | ✅ | ok → ok (blind) |
| search | existing migration | ✅ 6/6 | ✅ | ✅ search_outbox | ✅ | ok → ok (blind) |
| subscriptions | existing migration | ✅ 10/10 | ✅ | ✅ subscription_outbox | ✅ | ok → ok (blind) |

Write smoke method ([`schema-rw-smoke.mjs`](../../../scripts/ops/risk-0056/schema-rw-smoke.mjs)): one
`INSERT … RETURNING` per service with text columns set to the marker `risk0056-smoke`, read back
by primary key inside the same transaction, then `ROLLBACK`, then a check that the key no longer
exists. Nothing persisted; no production data is involved.

Services were booted inside the Actions runner (`pnpm --filter … start`, never on Render) with
`DATABASE_URL` = the test DB and an ephemeral per-run service-auth key
([`boot-health.sh`](../../../scripts/ops/risk-0056/boot-health.sh)).

### 2.3 What is NOT proven (stated, not claimed)

1. **Service-level (HTTP) reads/writes beyond health.** Domain routes are behind service identity
   (401 without a minted, route-bound token and caller allow-list). The write/read proof above is
   at the SQL layer against the exact schema the services use; delivery/marketplace/matching also
   proved a real **read through service code** (their probes query `store_orders`,
   `store_categories`, and the active ruleset). A per-route HTTP write for each service was not executed.
2. **Eleven services' `/health` cannot see the schema at all.** For them "health no longer reports
   schema_missing" is vacuous — they reported `ok` before too. Their schema proof is §2.2 columns 3–5.
3. **The test DB started empty; production does not.** Production already has `audit_events`
   (10 rows), the three `channel_*` tables and `wasla_service_token_replay`. `CREATE TABLE IF NOT
   EXISTS audit_events` will **skip** the existing table, so its columns must be compared read-only
   against `services/audit/contracts/schema.sql` before production application. The channel/replay
   tables belong to `packages/channel-postgres` / `service-auth` and are not touched by these 14 files.
4. `billing`, `partners`, `support` are not deployed — not applied, not tested here.

## 3. Rollback limits

- The 106 new tables are empty after application (plus declared seed rows: matching ruleset v1,
  negotiation policy, reputation rulesets/weights/thresholds, driver eligibility policy, subscription plan v1).
  **While still empty**, rollback = each service's documented down section (commented `DROP … IF EXISTS`
  at the end of its `schema.sql`, and `drizzle/*.down.sql`). `audit_events` must **not** be dropped (pre-existing data).
- **Once services write data**, dropping tables destroys it; rollback then means restore from the
  RISK-0055 encrypted backup (6 h RPO, not PITR).
- There is no migration-history table, so "which version is applied" is not recorded in the DB;
  later column additions rely on `ADD COLUMN IF NOT EXISTS` statements (present in 7 files).

## 4. Remaining risks / gaps

- Production application **not done** — requires the owner's explicit approval (mandatory stop).
- `infra/migrations/migration-owners.json` journal counts are stale (e.g. delivery lists 3, repo has 6) — documentation drift, not fixed here.
- `pg_trgm` is created in schema `public` (Supabase advisors flag extensions in `public`) — cosmetic.
- The test DB keeps the 107-table schema and seed rows (no smoke rows) for repeatable runs.
- RISK-0056 stays **open**; M6-18B stays **Blocked**.
