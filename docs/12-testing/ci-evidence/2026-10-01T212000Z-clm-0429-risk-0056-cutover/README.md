# RISK-0056 — cutover of production to `ppixaauyqoykrogwdxtv` (CLM-0429)

**Date:** 2026-10-01 (21:12–21:30 UTC) · **Claim:** CLM-0429 · **main:** `09d888978b56dba6d6ececcd585367b2c1812a53` (PR #573 merged, approved by xuuux-voox; main WASLA CI / roadmap / Render deploy = success on this SHA).
تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE".
No secret value appears here. The DB password exists only as GitHub secrets set by the owner (`SUPABASE_DB_URL` 20:41 UTC, Environment `production-migration` `PRODUCTION_MIGRATION_DB_URL` 21:10 UTC); the agent never read it.

## 1. Plan — run [36927089959](https://github.com/skyosv10-art/wasla/actions/runs/36927089959) — success
- `guard-target.py production` on `PRODUCTION_MIGRATION_DB_URL` **and** `SUPABASE_DB_URL`: both `project ref ppixaauyqoykrogwdxtv · port 5432`.
- `apply.sh` preflight: `schema.sql sha256: 14/14 identical … at 09d8889` · `server=17.11 public_tables=120` · nothing written.
- `schema-rw-smoke.mjs` (write → read-back → ROLLBACK): 14/14 services `schema_ok read_ok write_ok`.
- Render mapping before apply: 18 variables / 17 services → `snlpxywskyqrjattbpgn`.
- Drift check on the old project immediately before apply (agent, read-only): the 13 non-empty tables have the same row count and content hash as at the 15:3x UTC comparison, so the cutover lost no data.

## 2. Apply — run [36927646063](https://github.com/skyosv10-art/wasla/actions/runs/36927646063) — success (all 4 jobs)
| service | variables changed → `ppixaauyqoykrogwdxtv` | deploy | live commit | /health |
|---|---|---|---|---|
| wasla-audit | DATABASE_URL | dep-davcsnugekts73diind0 | 09d8889 | 200 |
| wasla-customer-bot | DATABASE_URL, CUSTOMER_DATABASE_URL | dep-davcso2d0e5s73fgbra0 | 09d8889 | 200 |
| wasla-customers | DATABASE_URL | dep-davcsom7bikc73dils40 | 09d8889 | 200 |
| wasla-delivery | DATABASE_URL | dep-davcsos9v7es73fao8og | 09d8889 | 200 |
| wasla-dispatch | DATABASE_URL | dep-davcspegekts73diirm0 | 09d8889 | 200 |
| wasla-driver-bot | DATABASE_URL | dep-davcspm7bikc73dim1mg | 09d8889 | 200 |
| wasla-drivers | DATABASE_URL | dep-davcsq0u01pc73e9bf3g | 09d8889 | 200 |
| wasla-geography | DATABASE_URL | dep-davcsq9srm7s73bgsbng | 09d8889 | 200 |
| wasla-identity | DATABASE_URL | dep-davcsqou01pc73e9bh8g | 09d8889 | 200 |
| wasla-marketplace | DATABASE_URL | dep-davcsr2d0e5s73fgc6tg | 09d8889 | 200 |
| wasla-matching | DATABASE_URL | dep-davcsrid0e5s73fgc8ag | 09d8889 | 200 |
| wasla-negotiations | DATABASE_URL | dep-davcss6gekts73dij65g | 09d8889 | 200 |
| wasla-orders | DATABASE_URL | dep-davcssad0e5s73fgcarg | 09d8889 | 200 |
| wasla-partner-bot | DATABASE_URL | dep-davcssou01pc73e9bnk0 | 09d8889 | 200 |
| wasla-reputation | DATABASE_URL | dep-davcst67bikc73dimgvg | 09d8889 | 200 |
| wasla-search | DATABASE_URL | dep-davcstlg1s2s73a108m0 | 09d8889 | 200 |
| wasla-subscriptions | DATABASE_URL | dep-davcsts9v7es73faou0g | 09d8889 | 200 |

The verifier requires each live deploy to BE the post-cutover deploy: 17/17. Deploys reached a terminal state: 17/17 `live`. Delivery readiness: HTTP 200, `status: ready`, `database ok: true`. Verdict PASS.

## 3. Independent post-cutover checks (agent, outside the workflow)
- **Render sweep** (Render API, refs only): 18/18 DB variables → `ppixaauyqoykrogwdxtv`; **0** variables on any wasla-* service reference `snlpxywskyqrjattbpgn`. The 7 non-DB services (4 observability, 3 static apps) have no DB variables.
- **Old project `pg_stat_activity`**: no client sessions; only its internal `pg_net` background worker (started 2026-09-11).
- **New project `pg_stat_activity`**: `postgres` sessions via `Supavisor` opened at 21:20 UTC (after the cutover deploys).
- **Live /health (17/17 = 200)**: services that report persistence report `postgres` (customers, dispatch, drivers, marketplace, matching, negotiations, orders, reputation, subscriptions); the rest report `status: ok`.
- **Delivery readiness**: `checks: [database ok:true]`, `status: ready`, `marketplace_catalog ok:true`.
- **Read / write / read-after-write on the new project**: `audit_events` count 10 → INSERT id 14 (`probe-clm-0429-postcutover`, metadata.target `ppixaauyqoykrogwdxtv`) → SELECT by id returns it → DELETE 1 row → count 10.
- **Known gap, unrelated to the DB**: the 3 bots answer `/health` 200 with `status: degraded`. In `packages/bot-runtime`, `degraded` means `identityDegraded` (no `IDENTITY_SERVICE_URL`). None of the 3 bots has that variable on Render (measured). This configuration gap existed before the cutover; it is outside RISK-0056 and recorded here.

## 4. Backup + restore of the NEW production — same run, job `backup` — success
- `backup source project ref: ppixaauyqoykrogwdxtv (as expected)`.
- `stage 1 snapshot-dump: ok · public tables=120`.
- `artifact-decrypt`: the uploaded ciphertext decrypts to the dump byte for byte.
- Guards: `nonempty` · `list` (TOC lists all 120 public tables) · `gpg` AES256 round-trip · `restore --exit-on-error --single-transaction` into a separate scratch PostgreSQL 17 · `compare 120/120 tables · every row count equal` → `BACKUP-GUARD RESULT PASS`.
- Manifest: `public_tables 120 · public_rows_total 38 · restore_all_match true · dump 124.0 s · verify_restore 14.1 s`.
- Artifact `db-backup-pre-migration-20261001T212122Z` (751,023 bytes, retained 90 days, expires 2026-12-30).

## 5. Old production `snlpxywskyqrjattbpgn`
Kept, not deleted, no client sessions. Its final restore-verified backup is run 36884804585 (90 days). **Rollback path:** run `render-cutover.py` with the refs swapped and redeploy. This is not automated and is used only as a documented recovery step. Writes made on the new project after 21:20 UTC exist only there.

## 6. Data old → new (precise)
- 103 of the 111 common tables: same row count and same content hash.
- 8 seed tables (`driver_eligibility_policies`, `matching_rulesets`, `negotiation_policies`, `reputation_fraud_thresholds`, `reputation_rule_weights`, `reputation_rulesets`, `subscription_plan_entitlements`, `subscription_plans`): same rows, but `created_at` and, for 2 of them, `frozen_at` differ, because they were seeded at migration time. **Not identical.**
- 9 tables exist only in the new project (`billing_*` ×6, `support_*` ×3), all with 0 rows.
- Schema: RLS is enabled on all 120 tables in the new project (disabled in the old); services connect as `postgres` (BYPASSRLS).

## Verdict
RISK-0056 closure conditions, all measured on `ppixaauyqoykrogwdxtv` after the cutover: migrations present (14/14 manifests, 107/107 declared tables), schema validation, data integrity (precise as in §6), connectivity on 17/17 services, readiness `database ok`, real read/write, backup PASS, restore validation PASS → **CLOSED**.
