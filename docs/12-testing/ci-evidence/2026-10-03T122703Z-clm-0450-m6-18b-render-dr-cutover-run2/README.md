# M6-18B · Render → DR full cutover — run 2 (CLM-0450) · **PASS**

| | |
|---|---|
| **Run** | [GitHub Actions 37122144763](https://github.com/skyosv10-art/wasla/actions/runs/37122144763) · `dr-render-cutover.yml` mode=apply on `main` `1831176` |
| **Plan** | [`docs/12-testing/M6-18B_RENDER_DR_CUTOVER_PLAN.md`](../../M6-18B_RENDER_DR_CUTOVER_PLAN.md) · run 1: [`…-run1/`](../2026-10-03T105749Z-clm-0449-m6-18b-render-dr-cutover-run1/README.md) |
| **Change since run 1** | Render value keeps only production's query-parameter names (dropped: `sslmode`); fail fast; DR health budget 300 s |
| **Status** | A documented **DR measurement** on a free-plan replacement project, **not the production RTO of record**. ADR-052/ADR-058 unchanged. M6-18B stays `Blocked`. |

## Results

| Stage | UTC | Measured |
|---|---|---|
| Production backup (`expect_project_ref=ppixaauyqoykrogwdxtv`) | 12:16:12 | PASS: dump → encrypt → decrypt-compare → restore → exact compare |
| Restore of that artifact into DR `pvyuhjadrygqqdoczmnd` | → +445.4 s | **PASS**: 120/120 public tables, 38 rows, backup age 178 s. Restore 237.8 s + compare 198.5 s + prepare/decrypt 9.2 s |
| T0: 18 variables on 17 services → DR | 12:27:03.7 | switched in **1.3 s** |
| Deploys pinned to the live commit | +73.2 s | **17/17 `live`** |
| `/health` 200 on 17/17 + delivery `/delivery/ready` database ok **on DR** | +92.9 s | **PASS** |
| Committed write + read-back on DR, 121 public tables | +96.3 s | **PASS** (1.64 s) |
| Rollback: original values, same commit | 12:28:39.9 → 12:30:10.6 | **PASS in 90.6 s**: 17/17 `live`, 17/17 `/health` 200, readiness database ok on production |
| Env fingerprint after vs before | 12:30:12 | **identical**: 24 services, 0 differences |

## Full RTO (DR measurement)

| Component | Seconds |
|---|---|
| Data: verified restore of the latest production backup into DR | 445.4 |
| Render: switch → all deploys live → healthy + ready → read/write | 96.3 |
| **Full RTO** | **541.7 s (9 min 1.7 s)** |
| Return to production (rollback, not part of the RTO) | 90.6 |

DB-backed services on DR: 12:27:03.7 → 12:28:39.9 (96 s). The window had no end-user
traffic (RISK-0042 observe report, same day: only uptime pings).

## Limits

- Free-plan DR project. Pool limits and cold starts are not production's.
- The data stage includes a 198.5 s full compare. A restore without verification
  would be faster, but it would not be proven.
- Read/write is proven on the database Render points at (runner, committed) and
  through delivery's readiness read. No service write API is open without service
  identity.
- The RPO is not measured here. ADR-058's accepted worst case (10.21 h) still stands,
  and ADR-052's 5-minute RPO is unmet (RISK-0055).
- TLS: the drill mirrors production's plaintext form. RISK-0060 (open) covers that.
