# CLM-0504 — M6-18B: blue/green execution (STEP B result · S1e · S4 cutover · S6 paging flip)

**Date:** 2026-10-08T16:00–16:30Z · **Work item:** M6-18B · **main at start:** `057ccb77` (CLM-0503 merged)
**Executed under the owner's Phase 5 delegation (D-6/D-7 of CLM-0503).** This PR carries the S6 paging flip; the live actions below were executed between the CLM-0503 merge and this PR, all measured.

## 1. STEP B result (CLM-0503 merge → first auto-deploy)

`render-deploy.yml` run [37805377068](https://github.com/skyosv10-art/wasla/actions/runs/37805377068) on the CLM-0503 merge (`057ccb77`): **verdict PASS — 22/22 services live=057ccb77** (render-sync.json artifact), deploy job 2m17s. main CI green: WASLA CI [37805377186](https://github.com/skyosv10-art/wasla/actions/runs/37805377186) success, Roadmap freshness 37805377079 success. Legacy deploys during the run: 0.

## 2. S1e / P5-4 — collector + Prometheus measurement

- 14 DB-backed new services `/health` → **200 × 14** (16:05Z).
- New `wasla-otel-collector` (c33v): data path configured from `render-singapore.targets`; note `/api/v1/targets` is a Prometheus endpoint, not a collector endpoint — the explicit scrape measurement moved to the new Prometheus (§4), which the S6 step creates.

## 3. S4 — Telegram webhook cutover (the first traffic change)

One bot at a time, `setWebhook(new host, new service secret, drop_pending_updates=false)`; each verified by `getWebhookInfo` (URL new, pending 0, no error) and the new service `/health` 200:

| Bot | New webhook URL | Result |
|---|---|---|
| partner @ZizoGoBot | `https://wasla-partner-bot-tri8.onrender.com/channel/partner/webhook` | set ✓ · pending 0 · no error |
| driver @ODD_DR_BOT | `https://wasla-driver-bot-d8dv.onrender.com/channel/driver/webhook` | set ✓ · pending 0 · no error |
| customer @ODD_CU_BOT | `https://wasla-customer-bot-fw29.onrender.com/channel/customer/webhook` | set ✓ · pending 0 · no error |

The mapping is the **uncrossed** one: on the NEW workspace each bot service holds its own token (measured, CLM-0503 §2.3), so the cutover also removes the crossed-webhook condition of INC-0003 for traffic. Liveness/auth probe: POST with a wrong secret → **401 × 3** (endpoints alive, auth enforced). Rollback (recorded): `setWebhook` back to the old hosts with the old services' secrets, `drop_pending_updates=false`.

## 4. S6 — new Prometheus + Alertmanager (new workspace, via Render API)

Created with the same build context as legacy (`infra/observability`, Dockerfiles from the repo) in the Singapore workspace, `autoDeploy=no`, plan free (matches legacy — an owner cost decision), env copied from the legacy services (values never printed or stored):

| Service | Host | First deploy | Measured |
|---|---|---|---|
| `wasla-prometheus` (srv-db3s2mui0phs73bc42sg) | `https://wasla-prometheus-p80v.onrender.com` | live (16:14Z) | `/api/v1/targets`: **15 active targets — 14 new hosts all `up`** + prometheus itself → **P5-4 PASS** |
| `wasla-alertmanager` (srv-db3s2nui0phs73bc45cg) | `https://wasla-alertmanager-6hhq.onrender.com` | live (16:14Z) | unauthenticated `/-/ready` → **401** (fail-closed as designed) |

The new workspace is now **24/24** — full parity with legacy (the only 2 missing services of CLM-0503 §1 are delivered here).

## 5. Legacy Alertmanager suspended (S6b, before the flip)

`wasla-alertmanager` (legacy, srv-daqgfrad0e5s73agd5jg) → **suspended** via the OLD key at 16:22Z (read-back `suspended: suspended`). Old pager stops paging; the flip in this PR makes the new one the only paging owner.

## 6. This PR — the paging flip (S6c)

- `render-singapore.targets`: `alertmanager none` → `alertmanager wasla-alertmanager-6hhq.onrender.com` (paging owner).
- `render-oregon-legacy.targets`: `alertmanager wasla-alertmanager.onrender.com` → `none` (retired; its AM is suspended, hosts historical after S12).
- `service-health.yml`: `WASLA_OBS_ENVIRONMENT` → `render-singapore` (the 6-hourly probe now reads the paging owner's registry — the new hosts).
- **Merging this PR redeploys all 24 new services** (render-deploy), so the new Prometheus re-renders its config from the flipped targets file and starts alerting through the new Alertmanager.

## 7. Guard root-cause fix on this branch (same defect class as CLM-0503)

`validate-observability-targets.sh` self-test anchored its mutations on the literal pre-flip state (`alertmanager none` in the singapore file; `render-oregon-legacy` in the workflow). The legitimate flip breaks those anchors. Fixed by deriving every anchor from the live files: the second-paging-owner mutation now gives an AM to whichever environment currently declares `none` (always producing two owners, catchable in any state), and the workflow mutation flips between the live and the other environment. Measured: **10/10 mutations caught pre-flip and 10/10 post-flip**. No rule weakened, no case removed.

## 8. Verification after merge (executed in the follow-up)

Prometheus redeploys with the AM wired → fire a test alert through the new Alertmanager API (basic auth) → verify the single Telegram page to the on-call chat → S10 validation (health 24/24, webhooks clean) → S12 legacy deletion (D-7). Documented in the follow-up claim.
