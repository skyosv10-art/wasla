# CLM-0438 · RISK-0058 fix — database failure containment, and the DR scenario 2 re-run

- **Work item:** M6-18B · **Risk:** RISK-0058 · **Decision:** [ADR-059](../../../15-decisions/ADR-059-db-failure-containment.md)
- **Date:** 2026-10-02 · **Branch:** `fix/clm-0438-risk-0058-db-failure-containment`
- **Authority:** the owner's written decision of 2026-10-02 (separate claim for RISK-0058, re-run scenario 2, measure RTO and recovery).
- **Baseline before the fix:** [CLM-0436 evidence](../2026-10-02T153600Z-clm-0436-m6-18b-dr-scenario2-replacement/README.md), run `37028089688`. It is unchanged and still valid as a record of the code before the fix.

تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE"

## What changed

The full mechanism is described in ADR-059. In short:

- **Guarded pools:** every runtime `pg.Pool` goes through `guardPgPool(new pg.Pool(withPgPoolDefaults(...)))`.
  - Scope: 17 services, plus `channel-postgres`, `service-auth` (replay store) and `search-e2e`.
  - Settings: connect timeout 5 s, query timeout 15 s, keepAlive.
  - Pool and client `error` listeners.
  - Circuit breaker: 5 failures, 30 s cooldown.
  - The breaker is reset when a probe succeeds.
- **Health:** every service health path answers `503` with `x-wasla-database: down` while its database is down.

## Tests (local; the CI verdict is below)

| suite | result |
|---|---|
| `packages/resilience` | 54/54. The new `pg-guard.test.ts` covers loss, refusal, connect timeout, query timeout, hang, a breaker that opens and fails fast, SQL errors that do not trip it, recovery via the probe and via half-open, health 503 → 200, and no stale `up` after a failure |
| `services/billing/src/__tests__/db-failure-containment.test.ts` | 2/2, with a real `pg.Pool`. Refused: five 503s, then rejection in under 250 ms with the breaker open, and health 503 `ECONNREFUSED`. Blackhole: one call bounded by the connect timeout, health 503 within the probe bound |
| all 17 service suites, `channel-postgres`, `service-auth` | pass. Three `purity.test.ts` dependency lists (marketplace, reputation, subscriptions) were extended by addition with `@wasla/resilience`, each with its reason |
| typecheck | clean for all 17 services and 4 packages. Bringing `@wasla/resilience` under the services' `noUnusedLocals` exposed an unused `TimeoutOptions.message` in `timeout.ts`, which is now applied |

## DR scenario 2 re-run — local (throwaway PG 18, TCP fault proxy, non-production)

Harness: `scripts/ops/m6-18b-dr/scenario2-db-unavailable.mts`. Since this claim, it exits 1 if any check fails.

| experiment | before (CLM-0436) | after (this claim, local) |
|---|---|---|
| **E1 warm drop** | process **crashed** 17 ms after the drop | **alive**. 8/8 calls `503 BILLING_UNAVAILABLE` (max 6 ms). Health **503** in 3 ms. Outage 5.0 s. Health 200 **1 016 ms** after the DB returned; first DB-backed answer **1 019 ms** |
| **E2 cold refuse** | 10/10 503, no breaker, health 200 | 10/10 503. First five 10/2/2/2/3 ms; **calls 6–10 1/1/1/2/3 ms, rejected by the open breaker without the DB**. Health **503**. Recovery with no health traffic (half-open only): **30 169 ms**, which is the 30 s cooldown |
| **E3 partition (blackhole)** | 3/3 hung until the 15 s client timeout, health 200 | first four calls **503 in 5 005–5 012 ms** (bounded by the 5 s connect timeout), then **2 ms** (breaker open). Health **503 in 2 004 ms** (probe bound). Health 200 **1 013 ms** after the partition ended; first DB answer **1 018 ms** |
| **E4 fleet** (new) | — | 16/16 bootable services started from their own `server.ts`. During a 3.0 s outage every health answered **503** (7–24 ms) and none crashed. After the DB returned, all were 200 within **1 023–1 071 ms** |

Verdict: **PASS, 19/19 checks** (record: `verdict.checks` in the harness output).

### Recovery time and RTO (scenario 2)

- **Service recovery after the DB returns, with health traffic** (which Render's health checks provide): about **1.0–1.1 s**. That is the 1 s probe cache plus one poll.
- **Without any health traffic:** at most the **30 s** breaker cooldown, followed by one half-open trial.
- **Scenario 2 RTO** (DB back → service serving DB-backed answers): **≈ 1 s**, measured on billing and on the 16-service fleet.
- **Not measured: failover RTO including a Render repoint.** It stays the open item that keeps M6-18B `Blocked`.

### Partners: excluded with a recorded reason

`partners` does not boot under enforced service identity, regardless of the database: `GET /partners/health` has no `serviceIdentity` classification, and the plugin refuses it at startup. This is recorded as **RISK-0059**, an auth fix that goes in its own PR. The harness lists the exclusion in `E4_fleet.excluded`. Any other service that does not start fails `E4.started`.

## CI verdict

Run [`37044898119`](https://github.com/skyosv10-art/wasla/actions/runs/37044898119) of `dr-replacement-restore.yml` on head `1c37549`, triggered by a push to the claim branch. **Conclusion: success.** Every `pg-guard`, harness and wiring file is identical at the later heads of this PR; the only later changes are to the env registry and ledgers.

### Job `scenario2`: VERDICT PASS, 19/19 checks

| experiment | CI result |
|---|---|
| E1 warm drop | process alive. During the outage every call returned `503 BILLING_UNAVAILABLE`, max 5 ms. Health **503**. After the DB returned: health 200 at **1 013 ms**, first DB answer at **1 017 ms** |
| E2 cold refuse | 503 throughout. First five calls 9/2/2/2/2 ms; **calls 6–10 1/1/1/2/1 ms (breaker open)**. Health **503**. Cooldown-only recovery **30 129 ms** |
| E3 partition | 5 013 / 5 004 / 5 008 / 5 008 ms (connect timeout), then 2/2/1 ms (breaker). Health **503 in 2 003 ms**. Health 200 at **1 017 ms**, first DB answer at **1 021 ms** |
| E4 fleet | 16 started; partners excluded (RISK-0059); none failed to start. All 16 health 503 during the outage, none crashed. Recovery **1 030–1 060 ms** |

### Job `replacement`: PASS (second DR drill into `pvyuhjadrygqqdoczmnd`)

- Restored artifact: backup `2026-10-02T17:09:21Z`, 3 279 s old at drill time.
- Tables: 120/120. Rows: 38/38.
- **Data RTO: 437.8 s**, broken down as:
  - download and integrity check: 2.8 s
  - decrypt: 0.2 s
  - prepare: 7.5 s
  - restore: 232.8 s
  - compare: 194.5 s
  
  The previous drill (CLM-0436) took 471.1 s.
- Billing on the replacement: listening at 2 429 ms, **first DB-backed answer at 2 672 ms**.
- Production was not contacted, and no Render service was linked.

### RTO summary (scenario 2 and the replacement)

| measure | value |
|---|---|
| service recovery after the DB returns, with health traffic | ≈ 1.0 s (local and CI) |
| service recovery after the DB returns, no health traffic | ≤ 30.1 s (breaker cooldown) |
| data restore RTO into the DR project | 437.8 s |
| first DB-backed answer on the DR project | 2.7 s |
| failover RTO including a Render repoint | **not measured** (no cutover by owner decision) |

## DR environment `pvyuhjadrygqqdoczmnd`

- Project ref: `pvyuhjadrygqqdoczmnd` (ap-south-1, free plan, $0). It is kept, by owner decision, for periodic DR drills.
- **DR only, not production.**
  - no cutover
  - no Render service points at it
  - no live traffic
  - `guard-replacement.py` refuses any other ref
  - production `ppixaauyqoykrogwdxtv` is never contacted by the `replacement` job

## Unchanged

- ADR-052 (the 5-minute RPO target stays the target), ADR-058, RISK-0055 (`mitigating`) and RISK-0056.
- Production, Render and migrations.
- No PITR. No destructive test on production.

## Status

- **RISK-0058 → `mitigating`, not `closed`.** Closing requires the CI verdict of this branch, then of main after the merge, recorded here.
- **M6-18B stays `Blocked`:** the RPO is only excepted (ADR-058), and the failover RTO including Render is unmeasured.
