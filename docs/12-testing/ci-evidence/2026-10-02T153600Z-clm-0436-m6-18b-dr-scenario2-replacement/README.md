# M6-18B: DR scenario 2 and a full replacement-project restore (CLM-0436)

- **Date:** 2026-10-02
- **Claim:** `CLM-0436`
- **Branch:** `feat/clm-0436-m6-18b-dr-execution`
- **Owner approval:** given in advance on 2026-10-02 for DR scenario 2 and for a restore into a replacement Supabase project. No new approval was requested.
- **Mandate:** تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE".

**Proof run:** GitHub Actions run [`37028089688`](https://github.com/skyosv10-art/wasla/actions/runs/37028089688), workflow `dr-replacement-restore.yml`, on the claim branch. Both jobs ended `success`:
- `scenario2`: job `110907732035`
- `replacement`: job `110907731467`

The same scenario 2 harness was first run locally on a throwaway PostgreSQL 18 cluster, with the same results (see §1).

**What was not touched:**
- production `ppixaauyqoykrogwdxtv`;
- Render;
- migrations and RISK-0056;
- ADR-052.

On production, the only access was one **read-only** count query (§2.3). RISK-0055 stays `mitigating`, and ADR-058 is still the RPO exception in force.

---

## 1. DR scenario 2: database unavailable

**Procedure (`M6-18B_DRILL.md` §3, scenario 2):**
- The unchanged billing service (`services/billing/src/http/server.ts`) runs as a child process.
- Its `BILLING_DATABASE_URL` points at a TCP fault proxy, and the proxy points at a throwaway postgres:17.
- The proxy injects two failures:
  - **refuse**: the listener is closed and open sockets are reset (DB down);
  - **blackhole**: connections are accepted and never answered (network partition).
- Harness: `scripts/ops/m6-18b-dr/scenario2-db-unavailable.mts`. It measures and asserts nothing about the expected outcome.
- Client timeout: 15 s.

| Experiment | Measured (CI job `110907732035`) | Expected by the drill doc |
| --- | --- | --- |
| **E1: warm drop.** The pool holds idle connections, then the DB goes away. | **The process exits (code 1) 17 ms after the drop.** The error is `Unhandled 'error' event … Emitted 'error' event on BoundPool … Client.idleListener`. | The service stays up and returns errors. |
| **E2: cold refuse.** The DB is down before the first query. | 10/10 requests return `503 BILLING_UNAVAILABLE`. First five: 9·3·2·2·2 ms. After five: 2·2·2·3·2 ms. **No change after 5 failures: no circuit breaker opens.** `/billing/health` = **200 `ok`** during the outage. Recovery 8 ms after the DB returns. | Breaker trips after 5 failures, rejects immediately, half-open after 30 s. |
| **E3: partition.** Connections are accepted and never answered. | 3/3 requests **hang until the client gives up (15 s)**: no server-side timeout and no breaker. `/billing/health` = **200 `ok`**. Recovery 11 ms after the network returns. | Timeout, then breaker. |

**Static cause (read in code, 2026-10-02):**
- **No service imports `@wasla/resilience`.** The search `rg "resilience|CircuitBreaker"` over `services/ apps/ packages/` finds only the package itself and an unrelated comment. The circuit breaker of M6-18A exists and is unit-tested (35 tests), but it is **not wired** into any request path. So `HA_CAPACITY_DR.md` §7 ("Circuit breaker trips after 5 failures") describes intent, not behaviour.
- **No `Pool` `'error'` listener and no `connectionTimeoutMillis`.** Postgres pools are created in 17 services and 3 packages. None registers `pool.on("error", …)` and none sets `connectionTimeoutMillis`. Only `partners` sets `idleTimeoutMillis`.
  - E1 (crash on an idle-connection drop) and E3 (unbounded wait) are therefore **expected in every Postgres-backed service**.
  - **Measured on billing only.** The other services are inferred from code, not measured.
- **`/billing/health` does not reflect the database.** It returns `ok` while every DB call fails.

**Verdict for scenario 2: executed, FAIL against its expected results.**
- The circuit breaker test fails: no breaker is wired.
- A DB connection drop crashes the process. On Render this becomes a restart; the restart path was measured as a 37.6 s outage in the 2026-09-29 drill. It is not graceful degradation.
- A partition blocks callers with no bound.

Recorded as **RISK-0058**. Remediation is not done here.

---

## 2. Full restore into a replacement Supabase project

### 2.1 Target

- **Project:** `wasla-dr-replacement`, ref `pvyuhjadrygqqdoczmnd`, region ap-south-1.
- **Organisation:** the owner's free-plan organisation. Creation cost reported by Supabase: **$0/month**, so the zero budget holds.
- **Restore role:** a dedicated role `dr_restore`. Its password was generated locally and only its SCRAM verifier was sent. The plaintext is stored only as the GitHub secret `DR_REPLACEMENT_DB_URL`, never printed.
- **Grants:** `CREATE` on `public`, plus `pg_trgm` installed in `public` by the project admin.
- **Guard:** `guard-replacement.py` accepts only `pvyuhjadrygqqdoczmnd`. It refuses production, the retired project and TEST by name. Run output: `target replacement · project ref pvyuhjadrygqqdoczmnd · host supavisor-session · port 5432`.

### 2.2 Result (job `110907731467`)

**Source:**
- the stored artifact `db-backup-20261002T114023Z` from db-backup run `37002194560` (production `ppixaauyqoykrogwdxtv`, on main);
- backup age at drill start: 14 144 s.

**Stages (each fail-closed):**

| Stage | Result |
| --- | --- |
| manifest | PASS · 120 tables · 38 rows |
| cipher | PASS · sha256 = manifest |
| decrypt | PASS · sha256 = manifest |
| target | PASS · role `dr_restore`, 6 tables from the local pre-test dropped |
| restore | PASS · `--exit-on-error --single-transaction --schema=public` |
| compare | PASS · **120/120 tables · 38/38 rows** |
| platform | PASS · see §2.3 |

**Data-restore RTO (from artifact pick to verified compare): 471.1 s (7.9 min).** Against the T1 target of 15 min, this is met for the data layer.

| Part | Seconds |
| --- | --- |
| download + integrity | 2.4 |
| decrypt | 0.1 |
| target prepare | 7.1 |
| restore | 252.7 |
| compare | 208.7 |

The runner (US) is far from ap-south-1. Compare opens one connection per table, so it is the largest share.

**Service level:**
- The unchanged billing service was started against the replacement (`service-on-replacement.mts`).
- It was listening after 795 ms.
- Its **first DB-backed answer** (`404 BILLING_INVOICE_NOT_FOUND`, which only a working query produces) came after **2 618 ms**.
- Data RTO plus this check comes to about 474 s.
- **Not measured:** repointing the 17 Render services to a replacement. Render was not touched, so a full production failover RTO is still unmeasured.

### 2.3 auth / storage / vault: what is restored and what needs separate setup

**Source rows on production (read-only count via the Supabase connector, 2026-10-02):**
- `auth.users` 0 and `auth.identities` 0;
- `storage.buckets` 0 and `storage.objects` 0;
- `vault.secrets` 0;
- `public` 120 base tables.

**Dump TOC of the artifact:**
- auth: 27 tables, 27 TABLE DATA entries;
- storage: 8 tables, 8 entries;
- vault: 1 TABLE DATA entry;
- public: 120 tables, 120 entries.

**Replacement after the restore:**
- `storage.buckets` 0, `storage.objects` 0 and `vault.secrets` 0;
- `auth.users` is not readable by `dr_restore` (`permission denied for schema auth`; the project admin cannot grant `USAGE` on `auth`).

| Part | Status | Separate setup needed |
| --- | --- | --- |
| `public` (all 14 services) | **Restored and verified** (120/120 tables, 38/38 rows) | None |
| `auth` data | In the dump. **Not restored:** the source has 0 users, and the `auth` schema belongs to `supabase_auth_admin` on the new project. | If users exist: a data-only restore as an admin role. Auth settings, providers, SMTP, redirect URLs and API keys are not in the database ([Supabase: Restore Dashboard backup](https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore)). |
| `storage` | Metadata is in the dump; 0 buckets and 0 objects at the source. | File bytes live in S3, not in the database. They must be copied separately ([Supabase: Restore Dashboard backup](https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore), [Download Objects](https://supabase.com/docs/guides/storage/management/download-objects)). |
| `vault` | 0 secrets at the source. | Vault and encrypted columns use a per-project root key. It must be copied with the Management API before encrypted values can be read ([Supabase: Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)). Otherwise the secrets must be entered again. |
| Extensions in `public` (`pg_trgm`) | Installed by the project admin before the restore | Yes. `dr_restore` cannot create extensions. |

So **the platform-schema data restore was not exercised**: there was nothing to restore. That is a measured fact about the source, not a capability that was proven.

---

## 3. What this changes for M6-18B

- DR scenario 2: **executed** and **failed** against expectations (no breaker, crash on drop, unbounded wait). Now RISK-0058.
- Full replacement-project restore: **executed and PASS** for `public`. Data RTO is 471.1 s. auth/storage/vault are inventoried, with no data at the source.
- RPO 5 min: **not met**. ADR-058 is a temporary exception (review 2026-10-13, expiry 2026-11-02); RISK-0055 stays `mitigating`.
- Full production failover RTO (Render repoint): **not measured**.

**Status: stays `Blocked`.** Under STATUS_MODEL, `Ready for Gate` means verified locally with only external evidence missing. Here, scenario 2 found a defect that is inside the executor's control (RISK-0058), and that has to be fixed and re-measured first. The RPO target is also unmet and only excepted.

## 4. Reproduce

- Scenario 2:
  ```
  DR_UPSTREAM_PORT=<local pg port> ./services/audit/node_modules/.bin/tsx scripts/ops/m6-18b-dr/scenario2-db-unavailable.mts
  ```
- Replacement restore: dispatch `dr-replacement-restore.yml` on main, with an empty `backup_run_id` for the latest backup.
