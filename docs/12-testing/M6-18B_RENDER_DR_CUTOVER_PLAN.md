# M6-18B · Full Render → DR cutover plan (CLM-0449)

| | |
|---|---|
| **Owner approval** | 2026-10-03, written: measure the full RTO with Render on the **isolated** DR replacement project only; do not change production `ppixaauyqoykrogwdxtv`; back up and verify the project ref first; switch Render temporarily under this documented plan, then return it to production; check health/readiness and read/write; record the full time; this is a **documented DR measurement, not the production RTO of record**; ADR-052 and ADR-058 unchanged |
| **Work item / claim** | `M6-18B` (stays `Blocked`) · `CLM-0449` |
| **Workflow** | [`.github/workflows/dr-render-cutover.yml`](../../.github/workflows/dr-render-cutover.yml) — manual, `main` only, typed full SHA |
| **Script** | [`scripts/ops/m6-18b-dr/render-dr-cutover.py`](../../scripts/ops/m6-18b-dr/render-dr-cutover.py) |

## 1. Targets and guards

| Project | Ref | Role in the drill |
|---|---|---|
| Production | `ppixaauyqoykrogwdxtv` | **read-only** source of the backup; every Render DB variable must point here before the cutover and again after the rollback |
| DR replacement (free plan) | `pvyuhjadrygqqdoczmnd` | restore target and temporary Render target |
| Retired production / TEST | `snlpxywskyqrjattbpgn` / `obeptvwpvqbduwkahorq` | refused by name (`guard-replacement.py`) |

Render scope (plan mode, read-only, 2026-10-03 against `9b80724`): **17 services,
18 variables**. Every `*DATABASE_URL` variable has the same production value:
audit, customer-bot (`DATABASE_URL`, `CUSTOMER_DATABASE_URL`), customers, delivery,
dispatch, driver-bot, drivers, geography, identity, marketplace, matching,
negotiations, orders, partner-bot, reputation, search, subscriptions. No other
variable is touched.

## 2. Sequence (one workflow run)

| # | Job | What | Production effect |
|---|---|---|---|
| 0 | guard | `main`, typed SHA == run commit | none |
| 1 | plan | DR guard; read-only map of DB variables; refuse unless all point at production | none |
| 2 | backup | `db-backup.yml` with `expect_project_ref=ppixaauyqoykrogwdxtv`: dump → encrypt → decrypt-compare → restore → exact compare, 90-day artifact | read-only dump |
| 3 | restore | that very artifact → DR (`replacement-restore.sh`): manifest, cipher, decrypt, target, single-transaction restore, table/row compare → **data RTO** | none |
| 4a | cutover | T0 · PUT the DR URL on the 18 variables · deploy each service **pinned to its live commit** · wait `live` | Render serves from DR |
| 4b | verify on DR | `/health` 200 on every changed web service · delivery `/delivery/ready` database ok · committed write + read-back on DR (`public.dr_cutover_probe`) and table count → **Render RTO** | — |
| 4c | rollback | PUT the **original values** (captured in memory at 4a) · deploy pinned to the same commit · `/health` + readiness on production | Render back on production |
| 4d | prove | env fingerprint (sha256[:16] per key, every `wasla-*` service) after == before, key for key; no variable on DR | none |

The rollback runs in a `finally` block and on SIGTERM (job cancel), so a failure at
any step after 4a still returns Render to the original values. The workflow shares
the `render-deploy` concurrency group, so a merge to `main` cannot deploy in the
middle of the window.

**Full RTO (DR measurement)** = data restore (3) + Render cutover to healthy, ready and
read/write (4a → 4b). The rollback time is recorded separately.

## 3. Known limits, stated before the run

- **Writes during the window land in DR and are not replayed to production.**
  Production had no end-user traffic in the 24 h before (RISK-0042 baseline: only
  uptime pings), so the exposure is small, but it is not zero.
- Telegram bots restart twice (cutover and rollback). Updates that arrive during a
  restart are retried by Telegram (webhook) or picked up on the next poll.
- The DR project is on the **free plan**. Pool limits and cold starts there are not
  the production plan's. That is one more reason this is not the RTO of record.
- Read/write is proven on the database Render points at, from the runner, plus
  delivery's readiness (a real DB read from a Render service). No service write API
  is open without service identity, so a write **through** a Render service is not
  part of this drill.
- `auth` / `storage` / `vault` data: as in CLM-0436, not restored (source had none).

## 4. Abort and manual recovery

If the workflow itself dies before 4c can run (runner lost), the operator restores
the production value on the 18 variables through the Render API (value read back
from the production secret, never printed), redeploys pinned to the live commit, and
re-runs `scripts/ops/render-env-fingerprint.py diff` against the pre-run snapshot.
