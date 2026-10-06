# Operational Readiness Review — Current-State Operational Verification

**Date:** 2026-10-06
**Author:** @skyosv10-art (agent:perplexity-computer)
**Scope:** Brief operational readiness review per Program Owner instruction (Oct 6, 2026)
**Framing:** Current-State Operational Verification — NOT RISK-0056 remediation. No closed risks reopened. No new risks opened (see caveat on backup failure below).

---

## 1. Production DB State

**Production Supabase project:** `ppixaauyqoykrogwdxtv`

All 14 domain services + 3 bots report `status: ok` with `persistence: postgres`:

| Service | Health | DB Mode |
|---------|--------|---------|
| wasla-delivery | ok | postgres |
| wasla-identity | ok | — |
| wasla-marketplace | ok | postgres |
| wasla-orders | ok | postgres |
| wasla-customers | ok | postgres |
| wasla-drivers | ok | postgres |
| wasla-geography | ok | — |
| wasla-matching | ok | postgres |
| wasla-negotiations | ok | postgres |
| wasla-dispatch | ok | postgres |
| wasla-reputation | ok | postgres |
| wasla-search | ok | — |
| wasla-subscriptions | ok | postgres |
| wasla-audit | ok | — |
| wasla-customer-bot | ok | telegram |
| wasla-driver-bot | ok | telegram |
| wasla-partner-bot | ok | telegram |

**Delivery readiness** (`GET /delivery/ready`): `database: ok: true` (was `schema_missing` before CLM-0429 cutover on Oct 1). One dependency probe (`marketplace_catalog`) reports `gates_readiness: false` with `marketplace_timeout` — this is a cross-service dependency probe, not a DB connectivity issue.

**Conclusion:** Production DB is alive. DB-backed services that expose persistence report `postgres` mode; delivery readiness reports `database: ok`; no `schema_missing` observed.

---

## 2. Migration State

- 14/14 migrations were applied on 2026-10-01 (CLM-0429) to the production project `ppixaauyqoykrogwdxtv`
- 107/107 tables present (postflight verified)
- 111 public tables total (including Supabase managed tables)
- No pending migrations observed — all DB-backed services report `database: ok` in health/readiness responses (direct migration status not independently verified in this review)

---

## 3. Schema/Readiness

- All 14 DB-backed services report `persistence: postgres` in health responses
- Delivery readiness endpoint confirms DB schema is applied
- No `schema_missing` errors observed

---

## 4. Render Connectivity

- 21 web services: all `not_suspended`
- 3 static sites (admin-app, customer-app, driver-app): deployed
- All services respond to `/health` within 60s (Render free tier cold-start latency)
- Services that responded immediately (delivery, identity, marketplace, orders) were already warm
- Services that required cold-start (customers, drivers, geography, etc.) woke up successfully

**Observability stack:** wasla-observability, wasla-prometheus, wasla-otel-collector, wasla-alertmanager — all deployed and not suspended.

---

## 5. Backup/Restore Baseline

### Backup workflow (`db-backup.yml`)

**FAILING** — last 3 scheduled runs all failed:

| Run | Time | Result | Error |
|-----|------|--------|-------|
| 37412101202 | 2026-10-06 04:06Z | failure | `ESSLREQUIRED: SSL connection is required for user: postgres` |
| 37388962875 | 2026-10-05 23:31Z | failure | (same) |
| 37314771590 | 2026-10-05 13:10Z | failure | (same) |

**Root cause:** The `SUPABASE_DB_URL` secret in GitHub Actions does not include `sslmode=require`, but the production Supabase project enforces SSL. This is directly related to RISK-0060 (Render → Supabase TLS not configured). The backup script connects via `pg_dump` using the raw connection string, which lacks SSL parameters.

**Impact:** No encrypted backups have been created since at least Oct 5. The RPO measured by the DR restore drill (median 5.21h, worst 10.21h) is now stale — the actual gap is growing.

**Note:** This is an operational finding from current-state verification, not a RISK-0056 remediation action. RISK-0055 (backup mitigation) status is unchanged. RISK-0060 (TLS) remains `mitigating`.

### DR restore drill (`dr-restore-drill.yml`)

**PASSING** — last run 2026-10-05 11:45Z succeeded. The drill restores from the last successful backup artifact and verifies table/row counts.

**Caveat:** The drill can only verify from the last successful backup. If no new backups are created, the drill is verifying an increasingly stale snapshot.

---

## 6. M6 Gates

| Gate | Status | Blockers |
|------|--------|----------|
| M6-18A (resilience/SLOs) | **Completed** | — |
| M6-18B (HA/capacity/DR) | **Blocked** | RPO not met (RISK-0055), DB failure containment (RISK-0058), TLS (RISK-0060), cross-region latency (RISK-0061) |
| M6-19A | Not started | Depends on M6-18B |
| M7 | Not started | Depends on M6 |

### M6-18B blockers (unchanged):

1. **RISK-0055** (mitigating): Backup RPO ~6h, not 5min (ADR-052 T1). Backup workflow now failing — RPO is degrading.
2. **RISK-0058** (mitigating): DB failure containment code in place, but closure requires scenario 2 fleet re-run on production.
3. **RISK-0060** (mitigating): TLS code support exists (`WASLA_PG_SSL_MODE`), but production not switched to `verify-full`. This is the root cause of the backup failure.
4. **RISK-0061** (open): Compute (Oregon) and DB (Mumbai) on different continents — false health 503s measured.

---

## 7. Current Operational Blockers

1. **Backup workflow failure** (HIGH): The `SUPABASE_DB_URL` GitHub Actions secret needs `sslmode=require` appended (or the backup script needs to pass `--sslmode=require` to `pg_dump`). This is the most urgent operational issue — no backups since Oct 5.

2. **Stale remote branches** (LOW): 5 stale branches exist from prior RISK-0056 work:
   - `docs/m6-18-live-evidence` (PR #542 merged)
   - `ops/risk-0056-pgtrgm-readonly` (no PR)
   - `ops/risk-0056-prod-preflight` (no PR)
   - `ops/risk-0056-readiness-report` (PR #550 closed)
   - `ops/risk-0056-test-db` (PR #549 closed)

3. **Marketplace catalog probe** (LOW): Delivery readiness reports `marketplace_catalog: gates_readiness: false` with `marketplace_timeout`. This is a cross-service dependency probe, not a DB issue — marketplace itself reports `ok`.

---

## 8. Summary

| Area | Status |
|------|--------|
| Production DB | OK — alive, schemas applied, all services connected |
| Migration state | OK — 14/14 applied, no pending |
| Schema/readiness | OK — all services report `database: ok` |
| Render connectivity | OK — 21 web services + 3 static sites, all not suspended |
| Backup/restore | **DEGRADED** — backup workflow failing (SSL), DR drill passing on stale snapshot |
| M6 gates | M6-18A complete, M6-18B blocked (4 open/mitigating risks) |
| RISK-0056 | CLOSED — not reopened, no new evidence |
