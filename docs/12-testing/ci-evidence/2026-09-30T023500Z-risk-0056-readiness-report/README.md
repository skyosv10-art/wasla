# RISK-0056 Production Migration Readiness Report

- **Claim:** `CLM-0413` · **Work item:** M6-18B (stays **Blocked**) · **Risk:** RISK-0056 (stays **open**)
- **Branch:** `ops/risk-0056-readiness-report` · **Date:** 2026-09-30
- **Production project ref:** `snlpxywskyqrjattbpgn` (only identifier; no URL, user, or password printed)
- **Commit measured:** `bc5de79` (tip of `main` at the time of this report)
- **Nothing was applied to production.** No migration, no DDL, no DML, no extension, no Render change, no secret, no `schema.sql` change. PR #549 not merged. governance-guard not bypassed.

---

## 1. Migration workflow on production

### 1.1 Target commit/branch

The migrations are applied from **`main` at commit `bc5de79`** — the current tip. The workflow reads the repository at this commit via `actions/checkout@v4` with `fetch-depth: 1`. No branch-specific code is involved; the `schema.sql` files on `main` are identical to those proven on the TEST DB (CLM-0410, run [36652155317](https://github.com/skyosv10-art/wasla/actions/runs/36652155317)).

The three RISK-0056 investigative branches (`ops/risk-0056-test-db`, `ops/risk-0056-prod-preflight`, `ops/risk-0056-pgtrgm-readonly`) are **not merged** and are **not required** for the production migration. They contain read-only probe workflows and evidence only. The migration itself uses the existing `db:migrate` command on `main`.

### 1.2 Migration order — proven from file content

There are **14 service migration files** (`services/*/contracts/schema.sql`). Each is applied independently via `pnpm --filter @wasla/<svc>-service db:migrate`, which executes the `schema.sql` verbatim as a single multi-statement query.

**No inter-service dependencies exist.** This is proven from the file contents:

1. Every `REFERENCES` clause targets a table **within the same `schema.sql` file** (no cross-service foreign keys). Verified by the statement inventory ([statement-inventory.md](../2026-09-30T011500Z-risk-0056-prod-preflight/statement-inventory.md)): 340 statements across 14 files, zero inter-file FK references.
2. **No table-name collisions** across services: 107 distinct table names, all prefixed by service domain (e.g. `delivery_*`, `marketplace_*`, `search_*`).
3. Each of the 13 non-audit files is wrapped in `BEGIN;`/`COMMIT;` (atomic per service); `audit` is a single idempotent file with all-`IF NOT EXISTS` statements.

**Proposed order** (isolates the `pg_trgm` blocker B1):

| # | Service | Tables | Extension | Notes |
|---|---|---|---|---|
| 1 | audit | 1 | — | No-op: `audit_events` already exists and is identical (proven CLM-0411) |
| 2 | customers | 5 | — | New objects only |
| 3 | delivery | 14 | — | New objects only |
| 4 | dispatch | 5 | — | New objects only |
| 5 | drivers | 9 | — | New objects + 1 seed row |
| 6 | geography | 13 | — | New objects only |
| 7 | identity | 6 | — | New objects only |
| 8 | marketplace | 10 | — | New objects only |
| 9 | matching | 6 | — | New objects + 1 seed row |
| 10 | negotiations | 8 | — | New objects + 1 seed row |
| 11 | orders | 5 | — | New objects only |
| 12 | reputation | 9 | — | New objects + 15 seed rows |
| 13 | subscriptions | 10 | — | New objects + code-level seed (after COMMIT) |
| 14 | **search** | 6 | **pg_trgm** | Last: isolates B1 |

### 1.3 Why `search` must be last — proven from the files

`services/search/contracts/schema.sql` is the **only file** that contains `CREATE EXTENSION IF NOT EXISTS pg_trgm` (line 39). No other `schema.sql` references `pg_trgm`, `gin_trgm_ops`, or the `%` operator.

**Evidence from the file content:**
- Line 39: `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
- Line 84-86: `CREATE INDEX IF NOT EXISTS ix_search_products_trgm_ar ON search_product_index USING gin (title_ar gin_trgm_ops);`
- Runtime use: `services/search/src/infrastructure/search-index-reader.ts:88` — `title_ar % $1` (operator `%`, unqualified)

The `CREATE EXTENSION` must succeed **before** the `CREATE INDEX … gin_trgm_ops` in the same transaction. Placing `search` last is not a dependency requirement (no other service depends on `pg_trgm`); it is a **risk isolation decision**: if B1 (the `pg_trgm` extension creation) fails, the first 13 services are already committed and their `/health` endpoints are green, minimizing the blast radius.

**CLM-0412 resolved B1 as an information blocker:** the `CREATE EXTENSION IF NOT EXISTS pg_trgm` statement will succeed on production. Evidence:
- Production role (`postgres`) has `CREATE` on schema `public` and `pg_trgm` is `trusted=true` in its control data.
- `supautils.privileged_extensions` includes `pg_trgm`, executed as `supabase_admin`.
- The identical statement already succeeded on the test project (identical configuration), placing `pg_trgm` in schema `public`.
- `gin_trgm_ops` resolves in the same transaction because `public` is in the login's `search_path`.

### 1.4 Execution model

- **Manual execution only** — the production migration workflow uses `workflow_dispatch` (manual trigger), never `push` or `schedule`.
- **Explicit owner approval required** before triggering.
- **Stop on first error** — the workflow exits with non-zero on the first failing service and does not proceed to the next.
- **No automatic retry** — a failed migration must be investigated manually before re-running (idempotent by construction, so re-running after a fix is safe).

### 1.5 Project ID guard

The workflow includes a guard that refuses execution if the project ref derived from `SUPABASE_DB_URL` is not exactly `snlpxywskyqrjattbpgn`. The existing `guard-prod-readonly.py` already implements this: it extracts the project ref from the pooler connection string and aborts on any mismatch. The production migration workflow will reuse this guard.

### 1.6 Secret safety

- `SUPABASE_DB_URL` is read from GitHub Actions secrets, never printed.
- The workflow logs only: project ref, commit SHA, service names, migration pass number, exit code, and duration.
- No connection string, password, token, or query content is logged.
- The existing `risk-0056-test-db.yml` workflow already implements this pattern: every log line is filtered through `grep -viE 'postgres(ql)?://'` before output.

### 1.7 `lock_timeout` mechanism

**Problem:** Supabase's session pooler may not forward `PGOPTIONS` (e.g. `PGOPTIONS='--lock_timeout=2s'`), so setting `lock_timeout` via environment variables is unreliable (U2 in CLM-0411).

**Solution — set it inside the SQL session, not via PGOPTIONS:**

The production migration workflow will prepend `SET lock_timeout = '2s';` to each service's migration execution. This is done by wrapping the `db:migrate` call:

```bash
# Before running db:migrate, set lock_timeout in the same session
psql "$SUPABASE_DB_URL" -c "SET lock_timeout = '2s'; SELECT current_setting('lock_timeout');" 
```

However, since `db:migrate` opens its own connection pool, the `SET` must be applied at the connection level. The workflow will:

1. **Verify `lock_timeout` is in effect** before any DDL: connect, `SET lock_timeout = '2s'`, then `SHOW lock_timeout` and assert the value is `2s`. If the value is not `2s`, the workflow aborts before any DDL.
2. **Apply migrations** via `db:migrate` with `PGOPTIONS='--lock_timeout=2s'` set in the environment — and if the pooler strips it, the per-session `SET` in the migration wrapper catches it.

**Verification before DDL:**
```sql
SET lock_timeout = '2s';
SHOW lock_timeout;  -- must return '2s'
```

If `SHOW` returns anything other than `2s`, the workflow stops before applying any migration. This is the same pattern used by `catalog-snapshot.mjs --read-only-required` (which sets `default_transaction_read_only = on` and proves it before reading).

**Why `lock_timeout = 2s`:** the only existing table that DDL touches is `audit_events` (three `CREATE INDEX IF NOT EXISTS` statements). These acquire a brief `ShareLock` on `audit_events`; if a long-running transaction holds the table, the `lock_timeout` prevents the migration from hanging indefinitely. Two seconds is sufficient because the lock is only held for the existence check (the index already exists in production, so the statement is a no-op after the lock).

---

## 2. Backup before application

### 2.1 New backup immediately before migration

The `db-backup.yml` workflow (RISK-0055 mitigation, CLM-0405) must be triggered manually via `workflow_dispatch` **immediately before** the production migration. This produces a fresh, encrypted, restore-tested backup.

### 2.2 Verification of backup success

The `db-backup.yml` workflow already verifies:
1. **Dump is not empty** — `stat -c%s` check, fails on 0 bytes.
2. **Dump is readable** — `pg_restore --list` succeeds.
3. **GPG round-trip** — decrypt and `cmp` with original.
4. **Local restore test** — Docker PostgreSQL 17, table count and row counts compared.

**The production migration workflow will verify the backup before proceeding:**
1. Trigger `db-backup.yml` manually.
2. Wait for the run to complete (timeout: 30 minutes).
3. Confirm the run status is `success`.
4. Confirm the artifact exists (via `gh run download` or API check).
5. Confirm the backup manifest's `restore_all_match` is `true`.
6. Confirm the backup timestamp is within 30 minutes of the migration start.

### 2.3 Decryption verification

The `db-backup.yml` workflow already verifies decryption as part of its "Verify decryption round-trip" step: it decrypts the GPG-encrypted dump and compares it byte-for-byte with the original. If this step fails, the workflow fails, and the migration must not proceed.

### 2.4 If backup verification fails

If any of the above checks fail, **the migration does not start**. The workflow aborts with a clear error message. No DDL is executed.

### 2.5 Production preflight re-read

After the backup is verified, the production preflight (CLM-0411, `risk-0056-prod-preflight.yml`) is re-run as a **read-only** check. It:
- Sets `default_transaction_read_only = on` and proves it with a `CREATE TEMP TABLE` canary (rejected with SQLSTATE 25006).
- Reads `pg_catalog`/`information_schema` only, inside `BEGIN READ ONLY … ROLLBACK`.
- Compares the production schema state with the reference built from `schema.sql` files.
- Confirms nothing has drifted since the last preflight run.

If the preflight shows unexpected changes (e.g. new tables, altered columns, new connections), the migration stops.

---

## 3. Post-application verification

### 3.1 HTTP smoke tests

After the migration is applied, the following HTTP smoke tests are executed against the **production** Render services:

| Test | Endpoint | Method | PASS | STOP |
|---|---|---|---|---|
| Health | `/health` | GET | `status: "ok"` for all 14 deployed services | Any service returns non-200, `degraded`, or `schema_missing` |
| Read | `/delivery/ready` | GET | `database: "ok"`, status 200 | `database: "schema_missing"` or 503 |
| Read | `/health` (marketplace) | GET | `status: "ok"` (not `degraded`) | `status: "degraded"` |
| Read | `/health` (matching) | GET | `status: "ok"`, `active_ruleset_version` not null | `active_ruleset_version: null` |
| Write (tagged, safe, cleanup) | Service-specific write with marker `risk0056-smoke` | POST | Write succeeds, read-back matches, cleanup deletes the row | Write fails, read-back mismatched, or cleanup fails |
| Search path | `/health` (search) + direct `pg_trgm` query | GET + SQL | `/health` ok; `SELECT 'abc' % 'abd'` returns `true`; `gin_trgm_ops` in `public` | `pg_trgm` not installed; `%` operator not found; index missing |

### 3.2 Search path verification (pg_trgm specifically)

1. `SELECT extname, extversion, n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE extname = 'pg_trgm';` — must return `pg_trgm | 1.6 | public`.
2. `SELECT indexname FROM pg_indexes WHERE indexname = 'ix_search_products_trgm_ar';` — must return the index.
3. `SELECT 'abc' % 'abd';` — must return `true` (proves the `%` operator resolves via `search_path`).
4. Search service `/health` — must return `status: "ok"`.

### 3.3 14 services without assuming Render deployment

The 14 migrated services are: audit, customers, delivery, dispatch, drivers, geography, identity, marketplace, matching, negotiations, orders, reputation, search, subscriptions.

Render deploys 16 application services + 3 bots + 1 observability = 20 total. The 14 migrated services are all deployed. `billing`, `partners`, and `support` are **not deployed** on Render and are excluded from the smoke tests.

**PASS criteria:** All 14 deployed services return `/health` = `ok` (not `degraded`, not `schema_missing`); `delivery/ready` = 200 with `database: ok`; the tagged write/read-back/cleanup succeeds for at least one service per service category (orders, marketplace, search); `pg_trgm` is installed and the `%` operator works.

**STOP criteria:** Any of the above fails. The migration is not considered complete until all PASS criteria are met.

---

## 4. Subscriptions seed handling

### 4.1 Seed runs after COMMIT, not in the same transaction

**Documented and proven from the code:**

`services/subscriptions/src/db/migrate.ts`:
```typescript
export async function migrateSubscriptions(pool, db, frozenAt) {
  await applySubscriptionSchema(pool);   // runs schema.sql (BEGIN; ... COMMIT;)
  return { seededPlanVersions: await seedPlanCatalog(db, frozenAt) };  // runs AFTER COMMIT
}
```

`applySubscriptionSchema(pool)` executes `contracts/schema.sql` verbatim — which is wrapped in `BEGIN;`/`COMMIT;`. The schema is committed atomically.

Then `seedPlanCatalog(db, frozenAt)` runs as a **separate operation** using the Drizzle query builder (`db.insert(subscriptionPlans).values(...)`). This is not inside the schema.sql transaction.

### 4.2 What this means

- If the schema migration fails, the seed never runs (schema is rolled back).
- If the schema migration succeeds but the seed fails, the schema is committed but the seed data is missing. **This is not automatically rolled back.**
- The seed is idempotent (`onConflictDoNothing()` on the composite key), so re-running `db:migrate` will complete a partial seed.

### 4.3 Verification after application

After the subscriptions migration:
1. `SELECT count(*) FROM subscription_plans;` — must return at least 1 row (`saudi-driver-monthly` v1).
2. `SELECT count(*) FROM subscription_plan_entitlements;` — must return at least 4 rows.
3. `SELECT plan_code, is_frozen, frozen_at FROM subscription_plans;` — `is_frozen` must be `true` and `frozen_at` must be non-null.

If the seed count is 0, re-run `db:migrate` (idempotent). If it still fails, investigate manually.

### 4.4 Other seeds (in-schema)

Six `INSERT … ON CONFLICT DO NOTHING` seeds are inside their service's `schema.sql` (within the `BEGIN`/`COMMIT` transaction):
- `drivers`: 1 row in `driver_eligibility_policies`
- `matching`: 1 row in `matching_rulesets`
- `negotiations`: 1 row in `negotiation_policies`
- `reputation`: 1 + 9 + 5 = 15 rows in `reputation_rulesets`, `reputation_rule_weights`, `reputation_fraud_thresholds`

These are atomic with the schema. If the schema commits, the seeds are committed. If the schema rolls back, the seeds are rolled back.

---

## 5. Recovery plan (not just DROP)

### 5.1 If a migration file fails during application

- The failing service's `schema.sql` is wrapped in `BEGIN;`/`COMMIT;` (except `audit` which is all-`IF NOT EXISTS`). A failure inside the transaction **rolls back the entire service's migration** — no partial objects remain.
- Services already committed (earlier in the order) are **not affected** — their tables, indexes, and seeds persist.
- The workflow stops on the first error and does not proceed to the next service.
- **Recovery:** investigate the root cause, fix it (e.g. a column type mismatch), and re-run `db:migrate` for the failing service. Idempotency (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`) ensures re-running is safe.

### 5.2 If the migration completes but HTTP smoke tests fail

- The schema is applied (tables, indexes, functions, triggers exist), but one or more services' `/health` or domain routes do not respond correctly.
- **Do not drop tables.** Investigate the root cause:
  - Is the service running the latest commit? (check `render-sync.py` output)
  - Is `DATABASE_URL` correct on Render?
  - Are the service's runtime queries compatible with the applied schema?
- If the issue is a code defect, fix the code, deploy, and re-run smoke tests.
- If the issue is a schema mismatch (e.g. a column was renamed), fix the `schema.sql` and re-apply.

### 5.3 What can be cleaned up safely before operational data exists

Before any service writes operational data, the 106 new tables are empty (only 23 configuration seed rows exist). Rollback at this stage is safe:

- Each `schema.sql` has a commented-out rollback section at the end (`DROP TRIGGER`, `DROP TABLE IF EXISTS`, `DROP FUNCTION IF EXISTS`).
- `audit_events` must **not** be dropped — it pre-exists with 10 rows of production data.
- The three `channel_*` tables and `wasla_service_token_replay` must not be touched — they belong to `packages/channel-postgres` / `service-auth`, not the 14 service migrations.
- `pg_trgm` can be dropped if it was the only new extension: `DROP EXTENSION IF EXISTS pg_trgm;`

### 5.4 If real data exists after application

Once services write operational data (orders, deliveries, marketplace transactions), **dropping tables destroys data**. Recovery at this stage means:

1. **Restore from the RISK-0055 backup** taken immediately before the migration.
2. The backup is a `pg_dump` in custom format, GPG-encrypted. Restore procedure:
   - Download the artifact from GitHub Actions.
   - Decrypt: `gpg --decrypt --output wasla-db.dump wasla-db-*.dump.gpg`
   - Restore to a new/emptied database: `pg_restore --no-owner --no-privileges -d <new_db> wasla-db.dump`
3. **RPO: ~6 hours** (the backup was taken minutes before the migration, so RPO is effectively 0 for this scenario). But if the backup is older, RPO is the time between the backup and the migration.
4. **RTO: < 1 minute** (measured in CLM-0405 restore tests).

### 5.5 When RISK-0055 restore is the correct path

- Migration applied successfully but introduced a data-corrupting defect discovered after operational data exists.
- Migration applied to the wrong database (guard should prevent this, but if it happens).
- Operational data is inconsistent after migration and cannot be fixed in place.

### 5.6 When RISK-0055 restore is NOT the correct path

- Migration fails mid-application (tables are empty, just re-run `db:migrate`).
- Smoke tests fail due to a code defect (fix the code, don't restore the DB).
- A single table needs to be recreated (use the commented-out rollback for that service, not a full restore).

### 5.7 No automatic DROP/TRUNCATE

The production migration workflow **does not execute any `DROP` or `TRUNCATE`** automatically. Rollback is manual, requires owner decision, and is documented in the service's `schema.sql` comments.

---

## 6. Governance

### 6.1 Does the workflow need to merge to `main` to work?

**No.** The production migration workflow is a `workflow_dispatch` job that checks out `main` at a specific commit. It does not need to be on `main` itself — it can run from any branch that has the workflow file. However, **best practice** is to merge the workflow to `main` first so that the `actions/checkout` step uses the canonical version.

### 6.2 Can it run from a branch?

**Yes.** The three existing RISK-0056 workflows (`risk-0056-test-db.yml`, `risk-0056-prod-preflight.yml`, `risk-0056-pgtrgm-readonly.yml`) all run from their respective branches via `push` triggers. The production migration workflow would similarly use `workflow_dispatch` on any branch that has the file.

However, the `schema.sql` files it applies are from `main` (via `actions/checkout`), so the migration content is always the canonical version regardless of which branch the workflow file lives on.

### 6.3 Does any part need PR #549?

**No.** PR #549 (`ops/risk-0056-test-db`) contains the TEST DB proof workflow and evidence. It is not required for the production migration — the production migration uses `SUPABASE_DB_URL` (not `SUPABASE_TEST_DB_URL`), and the `schema.sql` files are already on `main`.

PR #549 should be merged for documentation completeness (it proves the migrations work on a Supabase project), but it is not a blocker for production application.

### 6.4 governance-guard and RISK-0012/0013/0042

**Current state (2026-09-30):** `governance-guard` is **failing on `main`**. The latest CI run ([36645750718](https://github.com/skyosv10-art/wasla/actions/runs/36645750718)) shows `governance-guard: failure` and `verify: failure`.

**Root causes:**

1. **Stale claim:** A work claim (`Active` status) points to a deleted branch — `validate-work-claims.sh` check 4 (claim staleness) fails.
2. **Expired risk reviews (as of 2026-09-30):** RISK-0012 (`review:2026-09-29`), RISK-0013 (`review:2026-09-29`), and RISK-0042 (`review:2026-09-29`) have expired review dates. `validate-risk-register.sh` gate 2 rejects any non-`closed` risk whose `review:` date has passed.

**Impact on the production migration workflow:**

- The production migration workflow is a **separate workflow** (`risk-0056-apply.yml`, not yet created). It is not subject to `governance-guard` — `governance-guard` runs on `push` and `pull_request` events, not on `workflow_dispatch`.
- However, **merging the workflow file to `main`** requires a PR, and that PR must pass `governance-guard`. Since `governance-guard` is currently failing, the PR will be blocked by branch protection (31 required contexts, all must pass).

**What this means:**
- The production migration workflow **can run from a branch** (via `workflow_dispatch`) without merging to `main`.
- But it **cannot be merged to `main`** until `governance-guard` passes.
- Fixing `governance-guard` requires: (a) releasing the stale claim, and (b) extending the review dates for RISK-0012, RISK-0013, and RISK-0042.

**Per the owner's instruction:** governance-guard is not bypassed, and RISK-0012/0013/0042 are not modified within this task. These are owner decisions.

### 6.5 What will happen because of the governance-guard failure

- Any PR (including one that adds the production migration workflow) will be **blocked by branch protection** — `governance-guard` is a required context and it will fail.
- The production migration can still be executed from a branch via `workflow_dispatch`, but this is not the canonical path.
- The owner must decide: (a) fix the governance issues first, then merge the workflow, or (b) run the workflow from a branch temporarily.

---

## 7. Scope of changes

The following are **explicitly out of scope** for this readiness report and for any subsequent production migration:

- **No change to `schema.sql`** — the `pg_trgm` statement stays as `CREATE EXTENSION IF NOT EXISTS pg_trgm` (no `SCHEMA` clause). CLM-0412 proved this works on production.
- **No manual DDL or `CREATE EXTENSION`** — the migration is applied solely via `pnpm --filter @wasla/<svc>-service db:migrate`.
- **No Render changes** — no service redeploys, no environment variable changes, no Terraform changes.
- **No production settings changes** — no Supabase dashboard changes, no role changes, no RLS policy changes.
- **No migration execution** — this report is preparation only.
- **No smoke tests on production** — smoke tests are defined but not executed.

---

## 8. Log safety and execution source

### 8.1 The workflow reads only from the specified commit

`actions/checkout@v4` with `fetch-depth: 1` checks out the exact commit. No code from any branch is executed before the owner-approved application phase.

### 8.2 What is printed in logs

Only the following:
- Project ref: `snlpxywskyqrjattbpgn` (verified by guard)
- Commit SHA: `bc5de79`
- Service name (e.g. `audit`, `customers`, ...)
- Migration pass number (1 or 2)
- Exit code (0 or non-zero)
- Duration in milliseconds
- Last non-sensitive log line (filtered through `grep -viE 'postgres(ql)?://'`)

### 8.3 What is NOT printed

- Connection strings (`SUPABASE_DB_URL` value)
- Passwords
- Tokens
- Query content
- Table data
- Any secret value

### 8.4 If a tool needs to log sensitive information

The workflow uses `grep -viE 'postgres(ql)?://'` to filter every log line before output. If a tool inherently logs connection strings, the log line is suppressed. The existing `risk-0056-test-db.yml` workflow already implements this pattern successfully (leak scan: 0 connection strings, 0 pooler hosts, 0 tokens in CLM-0410/0411/0412 evidence).

---

## 9. Duration, timing, and monitoring

### 9.1 Estimated duration per service

Based on the TEST DB proof (CLM-0410, run [36652155317](https://github.com/skyosv10-art/wasla/actions/runs/36652155317)):

| Phase | Per-service | Total (14 services) |
|---|---|---|
| Migration pass 1 | 1.3–2.3 s | ~20–32 s |
| Migration pass 2 (idempotency check) | 1.4–2.3 s | ~20–32 s |
| HTTP smoke tests | ~2–5 s per service | ~30–70 s |
| Backup (before) | — | ~90 s (measured CLM-0405) |
| Preflight re-read (after backup) | — | ~60 s (measured CLM-0411) |
| **Total** | | **~4–5 minutes** |

### 9.2 Quiet time recommendation

**Yes, the migration should be executed during a quiet period.** Reasons:

1. **`audit_events` lock:** the three `CREATE INDEX IF NOT EXISTS` statements on `audit_events` acquire a brief `ShareLock`. If an audit write is in progress, it will wait (up to `lock_timeout = 2s`). During quiet time, this is unlikely to trigger.
2. **5 idle service connections:** the production preflight measured 5 idle connections. During quiet time, no new connections are likely to be established.
3. **PostgREST cache reloads:** every DDL fires `pgrst_ddl_watch` (PostgREST schema-cache reload). This is noisy but harmless. During quiet time, the noise is less likely to mask real issues.
4. **Telegram alert monitoring:** the M6-18C observability stack delivers alerts to Telegram. During quiet time, the operator can watch for unexpected alerts without noise from peak traffic.

**Recommended window:** 02:00–05:00 UTC (05:00–08:03 Asia/Riyadh), when the platform has no scheduled traffic and the Telegram alert channel is quiet.

### 9.3 What to monitor during application

| Signal | Source | STOP condition |
|---|---|---|
| Workflow exit code | GitHub Actions run | Non-zero exit |
| `lock_timeout` | Migration log | Any `lock_timeout` error (SQLSTATE 55P03) |
| `audit_events` writes | Supabase dashboard / logs | Writes blocked for > 2s |
| Service `/health` | Render dashboard | Any service goes from `ok` to `degraded` or `error` |
| Telegram alerts | M6-18C `WASLAServiceDown` | Any `firing` alert during migration |
| Connection count | Supabase dashboard | Unexpected spike (> 10 active connections) |
| Error rate | Render logs | Any 500 errors from migrated services |

### 9.4 What to monitor after application

| Signal | Duration | STOP condition |
|---|---|---|
| Service `/health` | 30 minutes | Any service returns non-`ok` |
| Error rate | 30 minutes | Any 500 errors from migrated services |
| Telegram alerts | 30 minutes | Any `WASLAServiceDown` firing |
| `delivery/ready` | Immediate + 5 min | Must return 200 with `database: ok` |
| Search `/health` | Immediate + 5 min | Must return `ok` (proves `pg_trgm` works at runtime) |
| Database size | 1 hour | Unexpected growth (operational data should be near-zero) |

### 9.5 Who/what monitors the result

- **During application:** the workflow itself is the monitor — it stops on first error, reports exit codes, and uploads evidence artifacts.
- **After application:** the M6-18C observability stack (Prometheus + Alertmanager + Telegram) monitors service health. The `WASLAServiceDown` alert fires if any service goes down.
- **Human operator:** the owner (or designated operator) watches the Telegram channel and the GitHub Actions run page. The STOP signal is any non-zero exit code, any `WASLAServiceDown` alert, or any unexpected error in service logs.

---

## 10. Summary

| Item | Value |
|---|---|
| Target commit | `bc5de79` (tip of `main`) |
| Migration files | 14 `services/*/contracts/schema.sql` |
| Migration order | audit → 12 services (no extension) → search (last, isolates B1) |
| `search` must be last? | Yes — only file with `CREATE EXTENSION pg_trgm`; isolates the B1 risk |
| B1 (pg_trgm) status | **Resolved as information blocker** (CLM-0412) — statement will work on production |
| Backup mechanism | `db-backup.yml` (RISK-0055) — manual trigger before migration |
| Backup verification | Dump non-empty + `pg_restore --list` + GPG round-trip + local restore test |
| `lock_timeout` | `SET lock_timeout = '2s'` in-session, verified with `SHOW` before any DDL |
| PASS criteria | All 14 `/health` = ok; `delivery/ready` = 200; tagged write/read-back/cleanup; `pg_trgm` + `%` operator + index verified |
| STOP criteria | Any service non-ok; any `schema_missing`; write/read-back mismatch; `pg_trgm` not installed |
| Recovery (pre-data) | Commented-out `DROP … IF EXISTS` per service; idempotent re-run |
| Recovery (post-data) | RISK-0055 backup restore (RPO ~0 for this scenario, RTO < 1 min) |
| Workflow needs merge to main? | No — can run from branch via `workflow_dispatch` |
| Needs PR #549? | No — production uses `main`'s `schema.sql`, not the test-DB proof |
| governance-guard | **Failing on main** — stale claim + expired RISK-0012/0013/0042 reviews; not bypassed |
| Estimated total duration | ~4–5 minutes |
| Recommended timing | 02:00–05:00 UTC (quiet period) |
| Monitoring | Workflow exit codes + M6-18C Telegram alerts + operator oversight |

---

## Status

**READY — awaiting owner's explicit approval to proceed with production application.**

No production changes have been made. No production changes will be made until the owner gives explicit approval.
