# M6-18B · Render → DR full cutover — run 1 (CLM-0449) · **FAIL, rolled back cleanly**

| | |
|---|---|
| **Run** | [GitHub Actions 37117434969](https://github.com/skyosv10-art/wasla/actions/runs/37117434969) · `dr-render-cutover.yml` mode=apply on `main` `0c045e2` |
| **Plan** | [`docs/12-testing/M6-18B_RENDER_DR_CUTOVER_PLAN.md`](../../M6-18B_RENDER_DR_CUTOVER_PLAN.md) |
| **Files** | `plan.json` (read-only mapping) · `replacement.json` (data restore) · `cutover.json` (switch, verify, rollback, fingerprint) — names, refs, timings and HTTP codes only |
| **Verdict** | Data restore **PASS** · Render on DR **FAIL** · rollback **PASS** · fingerprint **identical** |

## Timeline (UTC, 2026-10-03)

| Step | Time | Result |
|---|---|---|
| Guard + read-only plan | 10:45 | 17 services, 18 variables, all on production `ppixaauyqoykrogwdxtv` |
| Production backup (`expect_project_ref`) | 10:48:04 | PASS: dump → encrypt → decrypt-compare → restore → exact compare |
| Restore of **that** artifact into DR `pvyuhjadrygqqdoczmnd` | 10:50:52 → +390.5 s | **PASS**: 120/120 public tables, 38 rows, backup age 168 s. **Data RTO 390.5 s** |
| T0: 18 variables → DR | 10:57:49.8 | switched in 1.1 s |
| Deploys pinned to `0c045e2` | → +920.1 s | 15 `live`; **`wasla-identity` and `wasla-audit` `update_failed`**: Render's health check failed, so it kept the previous (production) instance |
| `/health` on DR (budget 900 s) | until 11:28:24 | **12 of 17 never 200**: customers, delivery, dispatch, drivers, geography, marketplace, matching, negotiations, orders, reputation, search, subscriptions. Delivery readiness: `database ok=false`, detail `pg_SELF_SIGNED_CERT_IN_CHAIN` |
| Read/write on DR (runner, psql) | 11:28:2x | **PASS**: committed write + read-back (`public.dr_cutover_probe`), 121 public tables, 1.88 s |
| Rollback: original values, same commit | 11:28:27.8 → 11:29:59.6 | **PASS in 91.7 s**: 17/17 deploys `live`, 17/17 `/health` 200, delivery readiness `database ok` |
| Fingerprint after vs before | 11:30:01 | **identical**: 24 services, 0 differences |

Window with DB-backed services unavailable: 10:57:49.8 → about 11:29:50, roughly
**32 min**. In the 24 h before, no end-user request reached the platform (RISK-0042
baseline: only uptime pings), so no user saw it. Writes during the window: none
observed. The two `update_failed` services kept their production instances, so they
were never on DR.

## Root cause

The DR secret `DR_REPLACEMENT_DB_URL` ends in `sslmode=require`. psql (libpq) needs
that parameter, and the restore uses it. node-postgres reads `sslmode=require` as
**verify-full**, and the Supavisor pooler's chain is not in Node's trust store, so
every pool failed `SELF_SIGNED_CERT_IN_CHAIN`. The production value carries **no**
query parameter, and no pool sets `ssl`, so production connects **without TLS**. That
is a separate finding: **RISK-0060** (high, open).

The runner-side read/write passed because psql verified nothing beyond `require`.

## What run 1 does not give

- **No full RTO.** The services never became healthy on DR, so a Render RTO cannot be
  read from this run. Only the data RTO (390.5 s) and the rollback time (91.7 s) are
  measured.
- Not a production RTO of record. ADR-052 and ADR-058 are unchanged. M6-18B stays
  `Blocked`.

## Fix for run 2 (CLM-0450)

- `render_value()`: the value Render gets keeps **only the query-parameter names
  production has** (here: drops `sslmode`). The drill switches databases, not TLS
  settings. The dropped names are recorded in the report.
- Fail fast: one `update_failed` deploy ends the wait and goes straight to rollback.
  The health budget on DR drops from 900 s to 300 s. Run 1 measured that services
  which come up do so within 60 s of `live`.
