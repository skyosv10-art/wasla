# CLM-0503 — Render blue/green Phase 5 STEP B (deploy target → new Singapore workspace)

**Date:** 2026-10-08T15:12–15:30Z · **Work item:** M6-18B · **main at start:** `8ad804fd` (CI green: WASLA CI 37791797658, Roadmap freshness 37791797777, Render deploy FROZEN 37791797788)
**Owner authorization:** the owner's written instruction of 2026-10-08 (this session) — full executive delegation to execute Phase 5 per the roadmap, auto-merge every green, use the new Singapore Render credentials, verify the old→new transfer, then delete the legacy services. This instruction is recorded as owner decisions **D-6 (execution approval)** and **D-7 (deletion approval)** below.

## 1. What was measured before this PR (read-only, both Render keys)

| Check | Result |
|---|---|
| GitHub OAuth connection | CONNECTED (`gh` CLI as `skyosv10-art`, admin:true) |
| main CI | green on `8ad804fd` (3/3 workflows success) |
| Open PRs / branches other than main | none |
| Active work claims | none (`current-state.sh`: claims still open — none) |
| NEW workspace services | **22** (19 web + 3 static), owner `tea-db0vtkpsrm7s739dm5c0`, region singapore, `autoDeploy=no` ×22, not suspended |
| LEGACY workspace services | **24** (21 web + 3 static), owner `tea-damm8atbedkc73ca3ahg`, `autoDeploy=no` ×24, not suspended |
| Env key parity old→new (22 shared services) | **22/22 identical key sets** (only diff: new `wasla-observability` adds `WASLA_OBS_ENVIRONMENT`) |
| Missing in new | `wasla-prometheus`, `wasla-alertmanager` (deferred to S6 by the CLM-0500 plan) |

## 2. Discoveries vs the CLM-0502 preflight (recorded, not fixed here)

1. **S1a is already done:** `WASLA_OBS_ENVIRONMENT=render-singapore` is present on the new `wasla-observability` (`srv-db3mucij9qps738abipg`). The STEP B precondition of CLM-0502 §2 is met. Executor unknown (owner-side or created-with); measured, not assumed.
2. **S1c is already done:** all 24 legacy services now have Render-side `autoDeploy=no` (measured 15:12Z via the OLD key). CLM-0502 §1 measured `yes` ×24 at 13:58Z. The preflight's hazard (latent auto-deploy on legacy) is therefore already neutralized. Executor unknown; recorded by measurement.
3. **INC-0003 is a legacy-workspace-only condition:** on the NEW workspace each bot service holds its own correct token (`wasla-customer-bot`→CUSTOMER_BOT_TOKEN, `wasla-driver-bot`→DRIVER_BOT_TOKEN, `wasla-partner-bot`→PARTNER_BOT_TOKEN, values verified against the owner-supplied tokens). The crossed-token state exists only on the legacy services. Consequence for S4: the new webhooks are the uncrossed mapping (see §4).

## 3. Owner decisions recorded (2026-10-08, this session)

| # | Decision | Effect |
|---|---|---|
| D-6 | **Phase 5 execution approved** (supersedes the P5-1 pending state; P5-3 stays DEFER per D-3 — the cutover proceeds without the authenticated probes, which remain a post-cutover follow-up) | This PR (STEP B) + the S1e/S4/S10 execution that follows |
| D-7 | **Legacy deletion approved now** — the owner ordered: verify the old→new transfer, then delete all legacy services and continue. This is the explicit owner approval that D-5 reserved for S12; it supersedes the D-5 timing (≥24 h stabilization, ≥14-day freeze) as a direct, later owner instruction. Recorded here because it contradicts a recorded decision; the deletion evidence will be documented in the follow-up claim | S12 executes after cutover verification |

## 4. STEP A executed before this PR (owner-secret action, outside git)

- Repository secret `RENDER_API_KEY` replaced with the new Singapore workspace key (updated 2026-10-08T15:19:45Z). The old key remains valid and is held by the executor for legacy read/delete actions (S11/S12) per D-7.
- **Verify A (frozen run, 0 Render calls):** `workflow_dispatch` of `render-deploy.yml` on `main` @ `8ad804fd` → run [37799850193](https://github.com/skyosv10-art/wasla/actions/runs/37799850193) success, log: `::notice:: Render deploy target is FROZEN since 2026-10-08 — nothing deployed`. The guard check runs before any key import or socket use; the new key made 0 Render calls in frozen mode.

## 5. This PR (STEP B)

`infra/render/deploy-target.json`: `mode: frozen → deploy`, `owner_id: null → tea-db0vtkpsrm7s739dm5c0`. `frozen_owners`/`legacy_owner` keep `tea-damm8atbedkc73ca3ahg` (the legacy tools of P5-9 still refuse that owner).

**What merging this PR does (the first auto-deploy):** `render-deploy.yml` runs `render-sync.py` on the merge commit with the NEW key against the NEW owner → deploys the merge commit to all 22 new services and requires each service's latest live deploy to carry that commit. This is exactly the STEP B of CLM-0502 §2, whose safety was proven there by simulation (NEW/NEW → 22 services, all NEW owner; NEW key + OLD target → refuse; OLD key → refuse).

**S4 webhook targets (prepared, executed in the follow-up claim):** each bot to the NEW service that holds its token (uncrossed, §2.3), with that service's `*_BOT_WEBHOOK_SECRET`:

| Bot | New webhook URL |
|---|---|
| customer @ODD_CU_BOT (8790173546) | `https://wasla-customer-bot-fw29.onrender.com/channel/customer/webhook` |
| driver @ODD_DR_BOT (8934057143) | `https://wasla-driver-bot-d8dv.onrender.com/channel/driver/webhook` |
| partner @ZizoGoBot (8669721368) | `https://wasla-partner-bot-tri8.onrender.com/channel/partner/webhook` |

Rollback (recorded, per CLM-0502 §11): `setWebhook` back to the old hosts — customer→`https://wasla-driver-bot.onrender.com/channel/driver/webhook`, driver→`https://wasla-customer-bot.onrender.com/channel/customer/webhook`, partner→`https://wasla-partner-bot.onrender.com/channel/partner/webhook`, `drop_pending_updates=false`, with the old service's secret.

## 6. Gates after this PR

- P5-1 execution approval: **given (D-6)** · P5-2: PASS (main green, target frozen at PR time) · P5-3: stays DEFER (D-3) — recorded conflict with S0's ordering, resolved by D-6 · P5-4: measured at S1e after this merge · P5-5..P5-11: PASS per CLM-0502, unchanged.
- Residual (observed, owner-level): the 22 new services are on Render's **free** plan (`plan: free` measured on `wasla-customer-bot`), which sleeps after inactivity; plan choice is an owner cost decision, recorded not changed.

## 7. Guard root-cause fix on this branch (CI run 37800511103)

The first CI run failed in the `verify` job: `validate-render-deploy-target.sh` self-test crashed with `AssertionError: ('infra/render/deploy-target.json', '"mode": "frozen",\n  "owner_id": null')`. Root cause: the guard's mutation anchors were hard-coded against the frozen-state literal, so the guard broke the moment the target file legitimately switched to `deploy` — the exact state STEP B creates. The fix (same rules, same 6 cases, nothing weakened): anchors derive from the CURRENT file content, and the frozen-network rule is tested on a copy forced into the frozen state. Measured after the fix: deploy state 6/6 mutations caught, frozen state 6/6 mutations caught.

## 8. Not changed by this PR

Both Render workspaces, Telegram, DNS, Supabase, bot env vars, `RENDER_API_KEY` value (already swapped in §4), observability targets, service-health workflow. No code, test or migration change.
