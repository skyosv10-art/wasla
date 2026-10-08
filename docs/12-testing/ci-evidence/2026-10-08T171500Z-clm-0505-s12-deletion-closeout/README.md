# CLM-0505 — M6-18B: S12 legacy deletion (D-7) + blue/green closeout — migration COMPLETE

**Date:** 2026-10-08T16:55–17:15Z · **Work item:** M6-18B · **main at start:** `3d6478d4` (CLM-0504 merged)
**Executed under the owner's deletion approval (D-7, recorded CLM-0503):** «تحقق من النقل ثم احذف كل خدمات القديمة». This is the irreversible S12 step of the CLM-0500 plan.

## 1. The CLM-0504 merge deploy (first attempt failed transiently)

- Run [37812350800](https://github.com/skyosv10-art/wasla/actions/runs/37812350800) attempt 1: failed after 1m22s on a **transient Render API socket read timeout** (`TimeoutError: The read operation timed out`) mid-trigger; 7/24 services had already redeployed to `3d6478d4` (measured). No code defect; the fail-closed verdict worked.
- Re-run of the same run: **verdict PASS — 24/24 services live=3d6478d4** (2m52s). main WASLA CI success (37812350799), Roadmap freshness success.

## 2. Paging path verified end-to-end (S6e)

- New Prometheus runtime config (measured via `/api/v1/status/config`): `alertmanagers: [wasla-alertmanager-6hhq.onrender.com]`, basic auth wired.
- `/api/v1/alertmanagers`: active = `https://wasla-alertmanager-6hhq.onrender.com/api/v2/alerts`.
- **Test alert fired** through the new AM API (basic auth, 200; alert `CLM-0504-cutover-paging-test` active in AM state). Delivery proven by AM metrics: `alertmanager_notification_requests_total{integration="telegram"} = 1`, `notifications_failed_total{integration="telegram"} = 0`, latency 0.59 s — **the single page went through the new stack to the on-call chat.**

## 3. S10 validation (final, 17:10Z)

| Check | Result |
|---|---|
| 14 DB-backed services `/health` | 200 × 14 (3 transient 503s right after the redeploy — cold-start DB warm-up, re-probed 200 × 3 rounds; ADR-059 fail-closed behaviour, not a defect) |
| 3 bots | `/health` 200; `getWebhookInfo`: all on the new hosts, pending 0, no errors |
| Webhook auth | wrong-secret POST → 401 × 3 |
| Static apps × 3 | 200 |
| Prometheus | `/-/healthy` 200; 15 targets all `up` |
| Alertmanager | fail-closed 401 without basic auth (by design) |
| Bot env URLs | all point at new hosts (identity-rl0b, new app hosts; DB = production `ppixaauyqoykrogwdxtv`) |

## 4. S12 — legacy deletion (D-7; the irreversible step)

All **24** legacy services deleted via the OLD key in the roadmap order (bots → apps → services → observability → prometheus/alertmanager), each `DELETE 204` with a read-back `404`:

```
bots:        wasla-customer-bot, wasla-driver-bot, wasla-partner-bot
apps:        wasla-admin-app, wasla-driver-app, wasla-customer-app
services:    wasla-audit, wasla-customers, wasla-delivery, wasla-dispatch,
             wasla-geography, wasla-identity, wasla-marketplace, wasla-matching,
             wasla-negotiations, wasla-orders, wasla-reputation, wasla-search,
             wasla-subscriptions, wasla-drivers
observability: wasla-observability, wasla-otel-collector
paging:      wasla-prometheus, wasla-alertmanager (the legacy AM was already suspended at 16:22Z)
```

**Final state (measured):** legacy owner `tea-damm8atbedkc73ca3ahg` → **0 services**; new owner `tea-db0vtkpsrm7s739dm5c0` → **24 services**. Data safety: production data lives on Supabase (`ppixaauyqoykrogwdxtv`), untouched by Render deletion; the 6-hourly encrypted `db-backup.yml` continues (RPO evidence per ADR-058/066).

## 5. Rollback (post-deletion)

S12 has no Render-side rollback (recorded in CLM-0502 §11.7). Recovery path if ever needed: redeploy from `main` via `render-sync.py` (the 22 service definitions are the repo + API), re-register webhooks with the bot tokens. The Telegram webhook secrets and bot tokens are held by the owner; no secret was printed or stored during this execution.

## 6. Migration completeness (the owner's D-7 precondition)

| Dimension | Evidence |
|---|---|
| Service parity 24/24 | §4 final state (the 2 deferred services delivered by CLM-0504 §4) |
| Env key parity 22/22 | CLM-0503 §1 |
| Bot tokens uncrossed | CLM-0503 §2.3 + CLM-0504 §3 |
| Webhooks cut (first traffic change) | CLM-0504 §3 + §3 final re-verify |
| Paging owner flipped + page delivered | §2 |
| Health green 24/24 | §3 |
| Legacy autoDeploy neutralized | CLM-0503 §2.2 (measured `no` ×24 before deletion) |

## 7. Residual (recorded, not blockers)

- P5-3 authenticated probes (D-3 DEFER) — post-cutover follow-up, owner decision.
- New services on Render **free** plan (sleep after inactivity; bots could miss webhooks while asleep) — owner cost decision, recorded CLM-0503 §6. The owner's attention is drawn to it: upgrading the 3 bot services (at minimum) avoids missed Telegram updates.
- M6-18B itself stays `Blocked` on the remaining DR items (RISK-0058 production partition drill; RISK-0060 Supabase enforce-SSL toggle) — the blue/green migration sub-work is complete, not the whole work item.
- `render-oregon-legacy.targets` is now a historical record (its hosts are deleted); annotated as retired.

## Verdict

```
BLUE/GREEN MIGRATION = COMPLETE
  old workspace: 0 services (24 deleted, D-7)
  new workspace: 24 services, all live on main (3d6478d4), health green, paging verified
  traffic: all 3 bots on the new hosts; no legacy traffic path remains
  M6-18B: stays Blocked on RISK-0058 / RISK-0060 (separate from the migration)
```
