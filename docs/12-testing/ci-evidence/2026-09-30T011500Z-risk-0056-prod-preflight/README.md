# RISK-0056 Production Preflight — READ ONLY

- **Claim:** `CLM-0411` · **Work item:** M6-18B (stays **Blocked**) · **Risk:** RISK-0056 (stays **open**)
- **Branch:** `ops/risk-0056-prod-preflight` · **Workflow:** `.github/workflows/risk-0056-prod-preflight.yml`
- **Runs:** [36654049665](https://github.com/skyosv10-art/wasla/actions/runs/36654049665) (success), [36654335923](https://github.com/skyosv10-art/wasla/actions/runs/36654335923) (success; adds ACL/role/audit detail)
- **Production project ref:** `snlpxywskyqrjattbpgn` (only identifier printed; derived from the pooler user by `guard-prod-readonly.py`, which aborts on any other ref)
- **Nothing was applied to production.** No migration, no DDL, no DML, no extension, no secret, no Render change. PR #549 not merged. governance-guard not bypassed. RISK-0012/0013/0042 untouched.

## 1. How read-only was enforced (proven, not promised)

`catalog-snapshot.mjs --read-only-required`, via secret `SUPABASE_DB_URL` (session pooler):

1. `SET default_transaction_read_only = on` (+ `statement_timeout 15s`, `lock_timeout 2s`, `idle_in_transaction_session_timeout 30s`).
2. Proof before any read: `SHOW default_transaction_read_only` = `on`; inside `BEGIN`, `SHOW transaction_read_only` = `on`; canary `CREATE TEMP TABLE` **rejected with SQLSTATE 25006** (`read_only_sql_transaction`), then `ROLLBACK`. Any failed proof ⇒ exit 4 before reading.
3. All reads inside `BEGIN READ ONLY … ROLLBACK`: `pg_catalog` / `information_schema` only, plus `count(*)` on the 5 existing tables.

Log line (both runs): `read-only proof: default_transaction_read_only=on transaction_read_only=on canary=rejected_25006 → PROVEN`.

Limitation stated honestly: the login role is the project's `postgres` role (not a dedicated read-only role); read-only is enforced at session + transaction level and proven by the canary. No dedicated role was created because that itself would be a production change.

## 2. Production schema state (2026-09-30T01:16Z)

- PostgreSQL **17.6**. `public`: **5 tables** — `audit_events` (10 rows), `channel_deliveries` (1), `channel_outbox` (2), `channel_updates` (1), `wasla_service_token_replay` (1). RLS off on all, 0 policies, no explicit ACL (owner only).
- `public` has 0 functions, 2 sequences, 0 user types. No name collision with any function, index, sequence or type the migrations would create.
- Roles `anon`, `authenticated`, `service_role`: **no USAGE and no CREATE on schema `public`**; no default ACL in `public` ⇒ new tables will not be reachable through the Supabase Data API unless someone grants it.
- Migration login can CREATE in `public`: yes.
- Event triggers present (Supabase standard): `pgrst_ddl_watch`, `pgrst_drop_watch`, `issue_pg_graphql_access`, `issue_pg_cron_access`, `issue_pg_net_access`, `issue_graphql_placeholder` — they fire on every DDL (PostgREST schema-cache reload; grant helpers act only on their own extensions).
- Connections at snapshot: 1 active (this preflight), 5 idle, 1 background.

## 3. `audit_events` — production vs `services/audit/contracts/schema.sql`

Compared column-by-column against the postgres:17 reference built from the contract: **identical** (0 differences).

| Column | Type | NOT NULL | Default |
|---|---|---|---|
| id | bigint (BIGSERIAL) | yes | `nextval('audit_events_id_seq'::regclass)` |
| actor_id / actor_role / action / resource_type / resource_id | text | yes | — |
| metadata | jsonb | yes | `'{}'::jsonb` |
| created_at | timestamptz | yes | `now()` |

Constraints: `audit_events_pkey PRIMARY KEY (id)` only (no unique/check/FK), both sides. Indexes: `audit_events_pkey`, `ix_audit_events_action (action)`, `ix_audit_events_actor_id (actor_id)`, `ix_audit_events_created_at (created_at DESC)` — all present in production and identical. Triggers: 0/0. ⇒ running the audit migration is a pure no-op (only `IF NOT EXISTS` notices).

## 4. Statements that can affect production

Full generated inventory: [statement-inventory.md](statement-inventory.md) (340 statements, 14 files). Summary:

- **CREATE TABLE IF NOT EXISTS** ×107 (106 new; `audit_events` no-op).
- **CREATE [UNIQUE] INDEX IF NOT EXISTS** ×128 (27 unique), all on the new tables except 3 no-ops on `audit_events`.
- **CREATE SEQUENCE IF NOT EXISTS**: `order_public_id_seq` (orders), `store_order_public_id_seq` (delivery); plus implicit identity/serial sequences.
- **CREATE OR REPLACE FUNCTION** ×8 (`customer_/dispatch_/driver_/geo_/identity_/order_set_updated_at`, `search_set_indexed_at`, `search_set_updated_at`) — none exists in production, so nothing is replaced.
- **DROP TRIGGER IF EXISTS + CREATE TRIGGER** ×22 pairs (customers 3, dispatch 3, drivers 3, geography 6, identity 1, orders 2, search 4) — only on new tables.
- **DROP INDEX IF EXISTS** `ix_*_outbox_unpublished` ×7 then re-created (dispatch, marketplace, matching, negotiations, orders, reputation, subscriptions) — indexes do not exist in production.
- **ALTER TABLE**: `ADD COLUMN IF NOT EXISTS sequence_number … GENERATED ALWAYS AS IDENTITY` on 7 new outbox tables; orders `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT fk_orders_active_assignment` (the only intra-service FK re-add; unguarded ADD, safe because it is preceded by the DROP in the same transaction).
- **CREATE EXTENSION IF NOT EXISTS pg_trgm** (search) — see §7.
- **INSERT … ON CONFLICT DO NOTHING** ×6 in SQL + 2 code-level seeds — see §6.
- No `DROP TABLE`, `TRUNCATE`, `UPDATE`, `DELETE`, `GRANT`/`REVOKE`, RLS or `ALTER` on any pre-existing table.
- Transactions: 13 files wrapped in `BEGIN … COMMIT` (atomic per service); `audit` is not wrapped (all its statements are no-ops in production).

## 5. The 107 expected tables

Result: **1 present & identical (`audit_events`), 0 present-but-different, 106 missing.** Production-only tables (untouched by any migration): `channel_deliveries`, `channel_outbox`, `channel_updates`, `wasla_service_token_replay`.

| Service | Expected | Tables |
|---|---|---|
| audit | 1 | `audit_events` |
| customers | 5 | `customer_order_request_stops`, `customer_order_requests`, `customer_outbox`, `customer_profiles`, `customer_saved_places` |
| delivery | 14 | `delivery_idempotency_keys`, `delivery_inventory_conflicts`, `delivery_inventory_observations`, `delivery_inventory_relay_checkpoint`, `delivery_inventory_relay_consumed_events`, `delivery_inventory_reservations`, `delivery_outbox`, `delivery_relay_checkpoint`, `delivery_relay_consumed_events`, `delivery_task_transitions`, `delivery_tasks`, `store_order_items`, `store_order_transitions`, `store_orders` |
| dispatch | 5 | `dispatch_idempotency`, `dispatch_jobs`, `dispatch_offers`, `dispatch_outbox`, `dispatch_waves` |
| drivers | 9 | `driver_candidacy_publications`, `driver_documents`, `driver_eligibility_log`, `driver_eligibility_policies`, `driver_idempotency`, `driver_outbox`, `driver_profiles`, `driver_service_zones`, `driver_vehicles` |
| geography | 13 | `geo_cities`, `geo_city_names`, `geo_countries`, `geo_country_names`, `geo_district_names`, `geo_districts`, `geo_outbox`, `geo_region_names`, `geo_regions`, `geo_user_location_history`, `geo_user_locations`, `geo_zone_names`, `geo_zones` |
| identity | 6 | `identity_history`, `identity_links`, `identity_outbox`, `identity_recovery_requests`, `identity_sessions`, `identity_users` |
| marketplace | 10 | `inventory_adjustments`, `marketplace_idempotency`, `marketplace_outbox`, `product_inventory`, `product_reviews`, `products`, `store_categories`, `store_reviews`, `store_staff`, `stores` |
| matching | 6 | `driver_candidacy`, `matching_decision_candidates`, `matching_decisions`, `matching_idempotency`, `matching_outbox`, `matching_rulesets` |
| negotiations | 8 | `negotiation_agreements`, `negotiation_idempotency`, `negotiation_messages`, `negotiation_outbox`, `negotiation_policies`, `negotiation_price_handoffs`, `negotiation_rounds`, `negotiation_threads` |
| orders | 5 | `order_assignments`, `order_outbox`, `order_status_history`, `order_stops`, `orders` |
| reputation | 9 | `fraud_signals`, `reputation_facts`, `reputation_fraud_thresholds`, `reputation_idempotency`, `reputation_outbox`, `reputation_ratings`, `reputation_rule_weights`, `reputation_rulesets`, `reputation_scores` |
| search | 6 | `search_marketplace_product_state`, `search_marketplace_store_state`, `search_outbox`, `search_product_index`, `search_relay_checkpoint`, `search_relay_consumed_events` |
| subscriptions | 10 | `referral_codes`, `referral_rewards`, `referrals`, `subscription_idempotency`, `subscription_outbox`, `subscription_periods`, `subscription_plan_entitlements`, `subscription_plans`, `subscription_transitions`, `subscriptions` |

Per service — migration = `pnpm --filter @wasla/<svc>-service db:migrate` running `contracts/schema.sql` (no migration-history table):

| Service | Expected / now | Creates / alters | May write data | Seed | Extension | Locks / risk |
|---|---|---|---|---|---|---|
| audit | 1 / 1 | nothing (all no-op) | no | none | — | brief ShareLock on `audit_events` per `CREATE INDEX IF NOT EXISTS` (existence checked after the lock) — blocks audit writes for ms |
| customers | 5 / 0 | 5 tables, 8 idx, 1 fn, 3 triggers | no | none | — | new objects only |
| delivery | 14 / 0 | 14 tables, 14 idx, 1 sequence | no | none | — | new objects only |
| dispatch | 5 / 0 | 5 tables, 9 idx, identity column, 1 fn, 3 triggers | no | none | — | new objects only |
| drivers | 9 / 0 | 9 tables, 15 idx, 1 fn, 3 triggers | yes | 1 row `driver_eligibility_policies` | — | new objects only |
| geography | 13 / 0 | 13 tables, 8 idx, 1 fn, 6 triggers | no | none | — | new objects only |
| identity | 6 / 0 | 6 tables, 7 idx, 1 fn, 1 trigger | no | none | — | new objects only |
| marketplace | 10 / 0 | 10 tables, 9 idx, identity column | code seed (declared 0) | 0 rows `store_categories` | — | new objects only |
| matching | 6 / 0 | 6 tables, 5 idx, identity column | yes | 1 row `matching_rulesets` | — | new objects only |
| negotiations | 8 / 0 | 8 tables, 14 idx, identity column | yes | 1 row `negotiation_policies` | — | new objects only |
| orders | 5 / 0 | 5 tables, 11 idx, 1 sequence, FK, identity column, 1 fn, 2 triggers | no | none | — | new objects only |
| reputation | 9 / 0 | 9 tables, 11 idx, identity column | yes | 1 + 9 + 5 rows | — | new objects only |
| search | 6 / 0 | 6 tables, 9 idx (1 GIN `gin_trgm_ops`), 2 fn, 4 triggers | no | none | **pg_trgm (missing)** | CREATE EXTENSION in production — **blocker** |
| subscriptions | 10 / 0 | 10 tables, 5 idx, identity column | yes (code) | 1 plan + 4 entitlements | — | seed runs after COMMIT, not atomic with schema |

## 6. Every `ON CONFLICT DO NOTHING` / seed

| Source | Target table | Rows | Kind | Conflict target | Can it affect existing production data? |
|---|---|---|---|---|---|
| drivers schema.sql #18 | `driver_eligibility_policies` | 1 (`version=1`, `saudi-launch-v1`, frozen) | config | `(version)` | No — table does not exist in production |
| matching schema.sql #7 | `matching_rulesets` | 1 | config | `(version)` | No — new table |
| negotiations schema.sql #3 | `negotiation_policies` | 1 | config | `(policy_version)` | No — new table |
| reputation schema.sql #3 | `reputation_rulesets` | 1 | config | `(ruleset_version)` | No — new table |
| reputation schema.sql #5 | `reputation_rule_weights` | 9 | config | `(ruleset_version, subject_type, fact_kind)` | No — new table |
| reputation schema.sql #7 | `reputation_fraud_thresholds` | 5 | config | `(ruleset_version, rule_code)` | No — new table |
| subscriptions `migrate.ts` (Drizzle) | `subscription_plans` | 1 (`saudi-driver-monthly` v1, frozen, `frozen_at = now()` at migrate time) | config | none specified ⇒ any unique violation skipped | No — new table; note `frozen_at` is non-deterministic |
| subscriptions `migrate.ts` | `subscription_plan_entitlements` | 4 | config | none specified | No — new table |
| marketplace `migrate-cli.ts` | `store_categories` | 0 (seed array is empty) | config | `(slug)` | No |

Total: **23 configuration rows, 0 operational rows**, all into tables that do not exist yet. Row counts verified on the reference DB. On re-run every seed is skipped by its conflict clause (proven twice on the test DB).

## 7. Extensions

Production installed extensions include standard Supabase ones; **`pg_trgm` is NOT installed**, available version 1.6. Not created (as instructed). **Blocker B1:** search's `CREATE EXTENSION IF NOT EXISTS pg_trgm` (no `SCHEMA` clause) would create it in production during migration, in the first schema of the login's `search_path` (unverified — likely `public`), and `gin_trgm_ops` / `%` are referenced unqualified. Owner decision needed: allow the migration to create it, or pre-enable it (e.g. dashboard into `extensions`) and confirm `search_path` resolves it. No other extension is required.

## 8. Migration order

No cross-service foreign keys, no shared objects, no name collisions ⇒ **no inter-service dependency**; any order works (the test DB used the list order). Intra-file order is fixed by each file. Proposed: `audit` (no-op) → the 12 without extension → `search` last (isolates B1) — or `search` held back until B1 is decided. Unknown U3 below concerns application code, not migration order.

## 9. Rollback — limits

- **Before operational data:** rollback = drop the 106 created tables, 8 functions, 2 named sequences (and `pg_trgm` if created). No data is lost because only the 23 config rows exist. This is manual SQL; it is not automated in the repo.
- **Partial failure:** each of the 13 wrapped files is atomic — a failing service leaves no objects; services already committed stay. Re-running is idempotent. Exception: subscriptions commits the schema, then seeds in separate statements (partial seed possible; re-run completes it).
- **`git revert` is NOT a database rollback:** there is no migration-history table or down-migration; reverting code leaves every table, function, trigger and row in PostgreSQL.
- **After real data exists:** dropping tables loses data; recovery = restore from backup, losing everything after the backup.
- **RISK-0055 backup:** `db-backup.yml` (pg_dump → GPG AES-256 → 30-day artifact) — nominal **RPO ≈ 6 h, not PITR**; restore = decrypt + `pg_restore` into a new/emptied DB. Must be run manually immediately before the migration.

## 10. Locks and risks

- New tables: locks only on objects nobody uses yet. `audit_events`: three short ShareLocks (`CREATE INDEX IF NOT EXISTS` checks existence after locking) — writes wait milliseconds; if a long transaction held `audit_events`, the index statement and writers behind it would queue (the runner sets no `lock_timeout` — U2).
- Every DDL fires `pgrst_ddl_watch` (PostgREST cache reloads) — harmless, noisy.
- Tables are created RLS-off and owner-only; safe today because API roles lack USAGE on `public`; any future grant to `anon`/`authenticated` would expose them (R1, record only).
- 5 idle service connections exist; the migration does not touch their tables.

## 11. Blockers and unknowns

- **B1** `pg_trgm` missing in production (§7) — owner decision.
- **B2** governance-guard fails on every PR because RISK-0012/0013/0042 reviews expired 2026-09-29 (untouched by instruction) — owner decision.
- **U1** effective `search_path` of the migration login (determines where `pg_trgm` lands) — not read to avoid scope creep; readable in a later read-only run.
- **U2** whether the session pooler forwards `PGOPTIONS` (`lock_timeout`) — unverified.
- **U3** the preflight did not prove each service's runtime queries beyond the test-DB smoke (CLM-0410).
- **U4** the reference was postgres 17.11 vs production 17.6 — no catalog-text difference observed.

## 12. Safest future procedure (proposed, NOT executed)

1. Run `db-backup.yml` manually right before the migration.
2. Verify the run succeeded and the artifact decrypts and restores (restore job).
3. Confirm the backup is minutes old.
4. Re-read this preflight (re-run it; it is read-only) and confirm nothing drifted.
5. Resolve B1 and obtain the owner's explicit approval.
6. Apply per §8 (`db:migrate` per service, from a workflow using `SUPABASE_DB_URL`).
7. HTTP smoke tests on affected services.
8. `/health`, `/delivery/ready`, reads and writes.
9. Watch errors/alerts (M6-18C Telegram) after application.
10. Record in RISK-0056 and M6-18B.

## Files

- `run-36654335923-excerpt.txt` — filtered log lines (leak scan: no connection string, user or password).
- `statement-inventory.md` — generated by `scripts/ops/risk-0056/analyze-schema-statements.py`.
- Scripts: `guard-prod-readonly.py`, `catalog-snapshot.mjs`, `compare-preflight.py`.
