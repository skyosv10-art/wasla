# RISK-0056 — NEW production project `ppixaauyqoykrogwdxtv` (CLM-0429)

**Date:** 2026-10-01 · **Claim:** CLM-0429 · **Trigger:** owner statement 2026-10-01: production is `ppixaauyqoykrogwdxtv`, not `snlpxywskyqrjattbpgn`.
تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE".

No secret, password, key or connection string appears in this file. Values were handled only at runtime.

## A. OLD PRODUCTION — `snlpxywskyqrjattbpgn` (retired, preserved, NOT deleted)
- Final 90-day encrypted backup, restore-verified (fail-closed `backup.sh`): run [36884804585](https://github.com/skyosv10-art/wasla/actions/runs/36884804585) — success. Earlier: 36869786393 (pre-apply), 36870868925 (post-apply).
- Evidence in `2026-10-01T134500Z-clm-0429-risk-0056-production-migration/` concerns THIS project only and is **not** RISK-0056 closure evidence.
- Guards now refuse it as production and as test (`RETIRED_PRODUCTION_REFS`).

## B. NEW PRODUCTION — identity (Supabase MCP `get_project`)
| field | value |
|---|---|
| ref | `ppixaauyqoykrogwdxtv` |
| name | wasla |
| region | ap-south-1 |
| status | ACTIVE_HEALTHY |
| engine | PostgreSQL 17.11 |
| created | 2026-10-01T09:41:58Z |
| IPv4 path | Supavisor session pooler `aws-0-ap-south-1.pooler.supabase.com:5432` (verified; `aws-1-…` → tenant not found) |

## C. Preflight (official `apply.sh`, `RISK0056_MODE=preflight`, `RISK0056_TARGET=production`) — PASS
```
== 1. target guard (production)
target production · project ref ppixaauyqoykrogwdxtv · port 5432
== 2. source guard: schema.sql sha256
schema.sql sha256: 14/14 identical to schema-sha256.txt at 28bf9d8
== 3. read-only preflight inventory
server=17.11 public_tables=120 schemas=auth:27,…,public:120,realtime:3,storage:8,supabase_migrations:1,vault:1
mode=preflight — nothing written
```
Postflight check of the same script on that inventory: **declared tables 107 · present 107 · missing 0**.

## D. MIGRATIONS — how the schema got there
The new project's schema was **already present** when this work started: `supabase_migrations.schema_migrations` lists 70 migrations applied 2026-10-01 11:21–11:39 UTC (Supabase migration API; author not proven from available evidence). `apply.sh` mode=apply was therefore NOT re-run (its DDL would collide with existing objects).
Structural parity vs. the schema applied by the repo procedure (`apply.sh`, old project), measured over `information_schema` / `pg_catalog`:

| object | old (apply.sh) | new | missing in new | extra in new |
|---|---|---|---|---|
| columns | 1137 | 1220 | **0** | 83 |
| constraints | 830 | 871 | **0** | 41 |
| indexes | 291 | 307 | **0** | 16 |
| functions | 42 | 43 | **0** | 1 (`rls_auto_enable`) |
| triggers | 25 | 25 | 0 | 0 |
| extensions | 6 | 6 | 0 | 0 |

Extras = 9 tables of services outside the 14 (`billing_*` ×6, `support_*` ×3) + Supabase's `rls_auto_enable` event-trigger function.
**Difference declared:** RLS is ENABLED on all 120 public tables in new (disabled on all 111 in old). Services connect as a role with `BYPASSRLS` (`postgres`), so behaviour is unchanged; any non-bypass role would see zero rows.

## E. DATA MIGRATION / INTEGRITY — PASS
Per-table row count + md5 over sorted row md5s, both sides in one REPEATABLE READ snapshot each:
- tables compared: 111 (common) · total rows old 38 / new 38
- **103 tables identical byte-for-byte** (incl. `audit_events` 10, `channel_*` 4, `wasla_service_token_replay` 1)
- 8 seed tables (`driver_eligibility_policies`, `matching_rulesets`, `negotiation_policies`, `reputation_fraud_thresholds`, `reputation_rule_weights`, `reputation_rulesets`, `subscription_plan_entitlements`, `subscription_plans`): same row count, differing columns **only** `created_at` / `frozen_at` (seeded at migration time).
- 9 tables only in new: all 0 rows.

## F. READ / WRITE / READ-AFTER-WRITE on NEW — PASS
`audit_events`: count 10 → INSERT (actor `probe-clm-0430`, metadata.target `ppixaauyqoykrogwdxtv`) id 11 → SELECT by id returns it → DELETE → count 10. REST (`/rest/v1/audit_events`, service_role key of new project) → HTTP 200.

## G. GITHUB secrets
| secret | before | after |
|---|---|---|
| SUPABASE_URL | old | **new** (`https://ppixaauyqoykrogwdxtv.supabase.co`) |
| SUPABASE_SERVICE_ROLE_KEY | old | **new** (JWT ref=ppixaauyqoykrogwdxtv, role=service_role) |
| SUPABASE_ANON_KEY | old | **new** (legacy anon JWT, ref=ppixaauyqoykrogwdxtv) |
| SUPABASE_PUBLISHABLE_KEY | old | **new** (`sb_publishable_jAN…`) |
| SUPABASE_DB_URL | old (pooler) | **unchanged — pending `postgres` credential of new project** |
| PRODUCTION_MIGRATION_DB_URL (env `production-migration`) | absent | **pending** same credential |
| SUPABASE_TEST_DB_URL | deleted earlier (was pointing at old prod) | still absent — needs a real TEST URL |

None of the four updated secrets is read by any workflow (grep of `.github/workflows`), so updating them changes no running job.

## H. RENDER — mapping (names only)
17 services / 18 variables reference a database; all point to the OLD ref today. No `SUPABASE_*` variables exist on Render.

| service | variable(s) | current | target | status |
|---|---|---|---|---|
| wasla-audit | `DATABASE_URL` | old (`snlpxywskyqrjattbpgn`) | new (`ppixaauyqoykrogwdxtv`) | **not changed yet** — pending credential |
| wasla-dispatch | `DATABASE_URL` | old (`snlpxywskyqrjattbpgn`) | new (`ppixaauyqoykrogwdxtv`) | **not changed yet** — pending credential |
| wasla-customers | `DATABASE_URL` | old (`snlpxywskyqrjattbpgn`) | new (`ppixaauyqoykrogwdxtv`) | **not changed yet** — pending credential |
| wasla-matching | `DATABASE_URL` | old (`snlpxywskyqrjattbpgn`) | new (`ppixaauyqoykrogwdxtv`) | **not changed yet** — pending credential |
| wasla-delivery | `DATABASE_URL` | old (`snlpxywskyqrjattbpgn`) | new (`ppixaauyqoykrogwdxtv`) | **not changed yet** — pending credential |
| wasla-geography | `DATABASE_URL` | old (`snlpxywskyqrjattbpgn`) | new (`ppixaauyqoykrogwdxtv`) | **not changed yet** — pending credential |
| wasla-search | `DATABASE_URL` | old (`snlpxywskyqrjattbpgn`) | new (`ppixaauyqoykrogwdxtv`) | **not changed yet** — pending credential |
| wasla-customer-bot | `CUSTOMER_DATABASE_URL`, `DATABASE_URL` | old (`snlpxywskyqrjattbpgn`) | new (`ppixaauyqoykrogwdxtv`) | **not changed yet** — pending credential |
| wasla-partner-bot | `DATABASE_URL` | old (`snlpxywskyqrjattbpgn`) | new (`ppixaauyqoykrogwdxtv`) | **not changed yet** — pending credential |
| wasla-negotiations | `DATABASE_URL` | old (`snlpxywskyqrjattbpgn`) | new (`ppixaauyqoykrogwdxtv`) | **not changed yet** — pending credential |
| wasla-drivers | `DATABASE_URL` | old (`snlpxywskyqrjattbpgn`) | new (`ppixaauyqoykrogwdxtv`) | **not changed yet** — pending credential |
| wasla-reputation | `DATABASE_URL` | old (`snlpxywskyqrjattbpgn`) | new (`ppixaauyqoykrogwdxtv`) | **not changed yet** — pending credential |
| wasla-orders | `DATABASE_URL` | old (`snlpxywskyqrjattbpgn`) | new (`ppixaauyqoykrogwdxtv`) | **not changed yet** — pending credential |
| wasla-driver-bot | `DATABASE_URL` | old (`snlpxywskyqrjattbpgn`) | new (`ppixaauyqoykrogwdxtv`) | **not changed yet** — pending credential |
| wasla-marketplace | `DATABASE_URL` | old (`snlpxywskyqrjattbpgn`) | new (`ppixaauyqoykrogwdxtv`) | **not changed yet** — pending credential |
| wasla-identity | `DATABASE_URL` | old (`snlpxywskyqrjattbpgn`) | new (`ppixaauyqoykrogwdxtv`) | **not changed yet** — pending credential |
| wasla-subscriptions | `DATABASE_URL` | old (`snlpxywskyqrjattbpgn`) | new (`ppixaauyqoykrogwdxtv`) | **not changed yet** — pending credential |

Not changed: services run start-up DDL (`CREATE INDEX IF NOT EXISTS …`) that PostgreSQL only allows the **table owner** to run. Measured with a non-owner role on the new project: `must be owner of table wasla_service_token_replay` / `audit_events`. Tables are owned by `postgres`, so the runtime URL must use the `postgres` role. Its password is not available; `ALTER ROLE postgres PASSWORD` via SQL is refused by Supabase (“Only superusers can alter privileged roles”); `GRANT postgres TO …` refused (no ADMIN option). A full `pg_dump` with a non-owner role fails (`permission denied for schema auth`) — so the backup secret also needs the `postgres` credential.

## H2. Temporary role (created and removed)
To run C/D/E/F without the `postgres` password, a temporary login role `wasla_ops` (BYPASSRLS, DML on `public` only, SCRAM verifier computed locally — plaintext never sent anywhere) was created via the Supabase connector, used for the read-only checks and the reversible probe, then **revoked and dropped** (`pg_roles` count 0). It owned no objects.

## I. SERVICE VALIDATION / RECOVERY on NEW — NOT YET (blocked by H)
## J. Code changes in this PR
- `guard-target.py`: `PRODUCTION_REF = ppixaauyqoykrogwdxtv`; `RETIRED_PRODUCTION_REFS = {snlpxywskyqrjattbpgn}` refused for production and test; Supavisor `<role>.<ref>` user form parsed.
- `guard-test-db.py`: both production refs denied; same parsing.
- `risk-0056-apply.yml` + `check-apply-workflow.py`: `expect_project_ref = ppixaauyqoykrogwdxtv`.
- `db-backup.yml` expected-ref parser: Supavisor `<role>.<ref>` form.
- Local guard matrix: 10/10 cases as expected (new→production 0; old→production 1; 6543 refused; new/old→test 1; test ref→test 0; direct host new→production 0).

## RISK-0056 verdict: **OPEN**

## K. Addendum 2026-10-01 16:40 UTC — credential channel and cutover workflow
- Owner stated the new `postgres` credential is available via the approved secure channel. Measured at 16:30 UTC: repo secret `SUPABASE_DB_URL` last updated 13:34 UTC (still the retired project), Environment `production-migration` has **no** secrets, the agent credential vault is empty, Render variables 18/18 still on the retired ref. The credential is therefore not yet in any channel the pipeline can read.
- Because the password must never pass through a person or the agent, the cutover runs **inside GitHub Actions**: new workflow `.github/workflows/risk-0056-cutover.yml` + `scripts/ops/risk-0056/render-cutover.py`.
  - `plan` (read-only, run locally with the Render key): 18 (service, variable) pairs on 17 services, all → `snlpxywskyqrjattbpgn`.
  - `apply`: guard both DB secrets (`guard-target.py production`) → official `apply.sh` preflight → per-service write/read-back/ROLLBACK smoke (`schema-rw-smoke.mjs`) → PUT new URL on each Render variable → redeploy → wait `live` → verify (no retired ref anywhere; live deploy is the post-cutover deploy; `/health` 200; delivery readiness `status: ready` + `database ok`) → `db-backup.yml` with `expect_project_ref: ppixaauyqoykrogwdxtv` (dump → encrypt → decrypt-compare → restore → exact compare, fail-closed).
- Owner action required (values never shown to anyone): set repo secret `SUPABASE_DB_URL` **and** Environment `production-migration` secret `PRODUCTION_MIGRATION_DB_URL` to the session-pooler URL of `ppixaauyqoykrogwdxtv` (user `postgres.ppixaauyqoykrogwdxtv`, host `aws-0-ap-south-1.pooler.supabase.com`, port `5432`).
