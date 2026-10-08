# CLM-0502 — Render blue/green Phase 5 PREFLIGHT (read-only) + P5-9 legacy-tool guard

**Date:** 2026-10-08T13:55–14:30Z · **Work item:** M6-18B · **main at start:** `ef7bef45d6c6e9ca54890b75ca8951bf87f4b1be`
**Executed:** read-only Render API (both keys; GET only), read-only Telegram Bot API (`getChatMenuButton`, `getMe`, `getMyCommands`, `getWebhookInfo`), repository change for P5-9 (this PR). **Not executed:** setWebhook, DNS, custom domains, suspend/delete, env change on either workspace, Supabase reads/writes, authenticated probes, Prometheus/Alertmanager, change of `deploy-target.json` mode, change of `RENDER_API_KEY`.

## Owner decisions recorded (2026-10-08)

| # | Decision | Recorded effect |
|---|---|---|
| D-1 | **KEEP SEPARATE** | `wasla-audit` keyring stays `{stg-audit-k6 active, stg-audit-k5 revoked}` on old and new, unchanged. It was inherited from the M3-07 rotation drill (CLM-0326, `docs/12-testing/M3-07_GATE.md` §7). Full key convergence is a separate change after the migration (follow-up, not in Phase 5) |
| D-2 | **KEEP CURRENT TEMPORARY TARGET** | `PARTNER_BOT_MINI_APP_URL` → admin app is a **staging placeholder** (CLM-0278; `apps/partner-mini-app` holds only `.gitkeep`). Behaviour unchanged during the migration. It must become a product decision before FIELD_TRIAL. Not a cutover blocker |
| D-3 | **DEFER** | No authenticated probe that writes `wasla_service_token_replay`. No Supabase test rows. **P5-3 = BLOCKED.** A no-write design is proposed below for the owner's consideration only |
| D-4 | **NO CUSTOM DOMAINS NOW** | S7/S8 = N/A. Render default hosts stay the traffic targets |
| D-5 | **APPROVED** | Stabilization ≥ 24 h after the last bot cutover; old-stack freeze ≥ 14 days before deletion; deletion needs backup/RPO evidence plus explicit owner approval |

## 1. Deploy guard on main (preflight item 1)

| Check | Result |
|---|---|
| `infra/render/deploy-target.json` | `mode: frozen`, `owner_id: null`, `frozen_owners: [tea-damm8atbedkc73ca3ahg]`, since 2026-10-08 |
| Hard-coded workspace in `scripts/deploy/render-sync.py` | none (`rg 'tea-[a-z0-9]{6,}'` → 0 hits) |
| `validate-render-deploy-target.sh` | ✓, 6/6 mutations |
| `validate-observability-targets.sh` | ✓, 10/10 mutations |
| CI on main `ef7bef4` | WASLA CI ✓ (37784823606), Service health ✓ (37785755228), Roadmap freshness ✓ |
| Last `render-deploy.yml` run on main (`5f64b97`, run [37781376636](https://github.com/skyosv10-art/wasla/actions/runs/37781376636)) | `::notice:: Render deploy target is FROZEN … nothing deployed` |
| Render deploys since 12:30Z | **legacy 0 · new 0**. Live: legacy 24/24 `93a4e33`, new 22/22 `f4b348b` (13:58Z) |

**Additional hazard (measured, not changed):** all 24 legacy services have Render-side `autoDeploy=yes` (`autoDeployTrigger=commit`, repo `skyosv10-art/wasla`, branch `main`). Across **1,588** recorded legacy deploys the trigger is `api` (1,564) or `manual` (24), never `new_commit`. Render's GitHub auto-deploy has therefore never fired, including for the three merges today. The setting is latent. If the Render GitHub app's access to the repo is installed or repaired, every main merge would deploy the frozen stack. Control: until S11 (`autoDeploy=no` on legacy, an OLD action that needs approval), **the owner does not install or change the Render GitHub app**. Recommendation: move the S11 `autoDeploy=no` write earlier, to just before STEP B, with explicit owner approval. All 22 new services already have `autoDeploy=no`.

## 2. Credential / target transition (preflight item 2)

**STEP A — owner, outside git:** replace the repository secret `RENDER_API_KEY` with the **new** Singapore workspace key. `deploy-target.json` stays `frozen`.
- **Verify A:** the next `render-deploy.yml` run (the merge of any non-doc PR, or `workflow_dispatch`) logs `FROZEN … nothing deployed`. In frozen mode the script returns before importing the key or opening a socket (guard check 4), so a FROZEN run makes **0 Render calls**.
- **Safety while the key is new and the target frozen:** every legacy ops tool now refuses to run (exit 3, §5), and the read tools need an explicit `RENDER_OWNER_ID`. The new key also cannot see a single legacy service (measured: 22 services, all `tea-db0vtkpsrm7s739dm5c0`).

**STEP B — reviewed PR (not prepared, not opened):** `deploy-target.json` → `mode: deploy`, `owner_id: tea-db0vtkpsrm7s739dm5c0`. `frozen_owners` and `legacy_owner` keep `tea-damm8atbedkc73ca3ahg`. **Merging STEP B is the first action that auto-triggers a deployment.** That merge deploys the STEP B commit to **all 22** new services (the 3 bots are redeployed too; they do not register webhooks themselves, so no traffic moves).

**Proof that STEP B can address only the new owner** (`render-sync.py --verify-only` on a temporary copy with the STEP B target; GET only, no deploy):

| Simulated target | Key | Result |
|---|---|---|
| deploy · owner = NEW | NEW | reaches **22** services, each with `ownerId = tea-db0vtkpsrm7s739dm5c0` (per-service owner check passes). Verdict FAIL only because live `f4b348b` ≠ requested `ef7bef4`, which is expected for verify-only |
| deploy · owner = NEW | OLD (STEP A not done) | `no wasla- services visible for owner tea-db0vtkpsrm7s739dm5c0 with this key — refusing` (rc 1, no deploy) |
| deploy · owner = OLD | OLD | `owner_id 'tea-damm8atbedkc73ca3ahg' is … frozen — refusing to deploy` (rc 1) |

So, after STEP B, a deploy can reach only the declared new owner. With the old key it refuses rather than falling back. The old owner is refused by name.

**Precondition for STEP B:** set `WASLA_OBS_ENVIRONMENT=render-singapore` on the new `wasla-observability` **before** the STEP B merge (S1a; env write on the new stack only). Without it, the observability entrypoint fails closed by design (ADR-068). Its deploy would then be `update_failed` and `render-sync` would report FAIL, while the previous instance kept serving.

## 3. P5-8 — new-workspace build minutes

The Render API exposes no usage/billing endpoint (`/owners/{id}` → identity only). Measured as an **upper bound** from deploy wall-clock time (created → finished; this includes queue and deploy phases, so it is ≥ pipeline minutes):

| Item | Value |
|---|---|
| Workspace | `tea-db0vtkpsrm7s739dm5c0` (team) |
| Deploys in October | 23, **≤ 28.4 min** total |
| One full redeploy of all 22 (last live deploys) | **≈ 27.5 min** (bots 0.8–1.8, services 1.3–1.6, static 0.3–0.5, collector 0.7) |
| Included allowance | **500 min / month** for the Hobby plan, then $5 per extra block ([Render pricing](https://render.com/pricing)); a higher plan includes more |
| Headroom | **≥ 471 min ≈ 17 full redeploys** (≥ 2 required) |

Phase 5 touches at most: the STEP B redeploy of 22 (≈ 27.5), the observability env-only S1a (0), shadow Prometheus build (≈ 2), and Alertmanager build (≈ 1), plus a full re-run as rollback margin. That totals ≈ 60 min. **PASS.** The exact remaining figure is visible only in the Render dashboard (owner).

## 4. S2 / P5-5 — bot menu buttons (read-only)

| Bot | `getChatMenuButton` (default) | Web App URL | Class | Main Mini App (`getMe.has_main_web_app`) | Commands |
|---|---|---|---|---|---|
| customer @ODD_CU_BOT | `commands` | — | none | false | 0 |
| driver @ODD_DR_BOT | `commands` | — | none | false | 0 |
| partner @ZizoGoBot | `commands` | — | none | false | 0 |

No menu button and no Main Mini App points at any host (old, new or non-Render). No code calls `setChatMenuButton`/`setMyCommands` (`rg` over `bots/`, `packages/`). Mini Apps are reached **only** through inline buttons that bots send, built from `*_MINI_APP_URL`; the new bots already carry the new app hosts. Residual (documented, not a blocker): inline buttons in **past** chat messages sent by the old bots still open the old static apps. They keep working while the old stack lives, and they break at S12 deletion of the old apps. **No menu mutation is needed. P5-5 PASS.**

## 5. P5-9 — terraform and ops scripts (this PR, no mass replacement)

Inventory: every tracked non-doc file naming `onrender.com`, the `wasla-${…}` convention or a `tea-…` workspace id. Each is classified in the new `infra/render/host-sources.json`, and an unclassified file fails `scripts/checks/validate-render-host-sources.sh`, which is mandatory in `scripts/verify.sh`.

| Class | Files | Enforcement |
|---|---|---|
| registry | `infra/render/deploy-target.json`, `infra/observability/targets/{render-oregon-legacy,render-singapore}.targets` | the sources of truth |
| legacy **write** tools | `scripts/ops/m6-18b-dr/render-dr-cutover.py`, `scripts/ops/risk-0056/render-cutover.py`, `scripts/ops/risk-0060/render-tls-activate.py` (imports the former), `scripts/deploy/dr-drill.py`, `scripts/m3-07-audit-drill.py`, `scripts/m3-07-key-rotation-drill.py` | `render_target.legacy_only()`: **exit 3 while the legacy owner is frozen**, and refuses any other owner. Measured: 6/6 refuse, network blocked |
| legacy **read** tools | `scripts/ops/risk-0042/observe-report.py`, `scripts/ops/render-env-fingerprint.py` | `render_target.explicit_owner()`: no default workspace, exit 2 without `RENDER_OWNER_ID` |
| legacy-marked | `infra/terraform/{apps,cron,observability}/main.tf` (never applied), `infra/render/app-rewrites.json`, `services/observability/render.yaml` (Blueprint not in use), `scripts/m3-07-health-scan.py`, test harness defaults in `packages/{golden-e2e,incident-ops,load-testing}` | `LEGACY-ONLY (CLM-0502)` marker, checked |
| guards / resolver | the 4 `validate-render-*`/observability checks, `scripts/ops/render_target.py` | — |

**Before this PR:** four of these tools carried `RENDER_OWNER_ID` defaulting to the legacy owner (`render-dr-cutover.py`, `risk-0056/render-cutover.py`, `risk-0042/observe-report.py`, `render-env-fingerprint.py`). Two of them, plus `render-tls-activate.py` which imports `render-dr-cutover.py`, sit behind `workflow_dispatch` workflows that write Render env (`dr-render-cutover.yml`, `risk-0056-cutover.yml`, `risk-0060-render-tls.yml`). After STEP A those workflows would have aimed the new key at the legacy owner id. **After this PR** they refuse at import time.

The guard runs a baseline (an unmutated copy must pass) and then catches 7/7 mutations: unclassified host file, default workspace re-introduced, write-tool guard removed, read-tool guard removed, marker removed, legacy owner unfrozen, classified file deleted. `deploy-target.json` gains `legacy_owner` (same id as `frozen_owners`). `validate-render-deploy-target.sh` still passes 6/6.

## 6. P5-6 — rollback targets (read-only, 14:05Z)

| Bot (token) | Current webhook = rollback target | pending | last_error | Old service whose env holds this token (INC-0003 crossed mapping) |
|---|---|---|---|---|
| customer @ODD_CU_BOT | `https://wasla-driver-bot.onrender.com/channel/driver/webhook` | 0 | none | `wasla-driver-bot` (srv-daodb6740ujc73esa79g) |
| driver @ODD_DR_BOT | `https://wasla-customer-bot.onrender.com/channel/customer/webhook` | 0 | none | `wasla-customer-bot` (srv-daodb6bm8hqs73e8aa50) |
| partner @ZizoGoBot | `https://wasla-partner-bot.onrender.com/channel/partner/webhook` | 0 | none | `wasla-partner-bot` (srv-daodb6f40ujc73esa8bg) |

`max_connections` 40 and `allowed_updates` default on all three. The rollback `secret_token` is the `TELEGRAM_WEBHOOK_SECRET` of that old service. It is read from Render at rollback time and never written to git. Re-capture at S0.

## 7. P5-7 — no new consumer/scheduler

Render: legacy 24 = 21 web + 3 static. New 22 = 19 web + 3 static. No `background_worker`, no `cron_job`, none suspended. Repo `ef7bef4..HEAD` under `services/ bots/ packages/`: only the 5 one-line `LEGACY-ONLY` comment markers of this PR. No consumer, worker or scheduler added. **PASS.**

## 8. P5-3 — proposal for a no-write authenticated probe (proposal only; P5-3 stays BLOCKED)

Measured order in `packages/service-auth`: `token.ts` checks structure → kid known/not revoked → **signature** → iat/exp → lifetime → **audience (6)** → **request binding (7)**. Only then does `enforce.ts:147` call `replayGuard.remember()`, the single replay-row write. Rejections are only logged (`request.log.warn({reason})`, `fastify.ts:290–301`). There is no DB write on the rejection path.

**Design N-W:** for each S2S edge of §6 in the CLM-0500 report, mint a token with the caller's live key. Its `aud` is correct but its `req` binds a **different path** than the one requested. The target must answer 401, and its log line must show `reason=request_binding_mismatch`, not `bad_signature`/`unknown_key`. That proves reachability, keyring parity (the signature verified under the target's keys) and live enforcement mode. **Zero replay rows**, zero DB writes. Reading the log would use the Render logs API (read).
**Not proven by N-W:** the scope check and handler path after the replay step, which only an accepted request reaches.
**Requires:** reading signing-key values from Render env into memory (never printed or stored), and owner acceptance as a substitute or partial substitute for D-3. Until then **P5-3 = BLOCKED**.

## 9. Gates

| Gate | Evidence | State |
|---|---|---|
| P5-1 owner approves Phase 5 execution, and ADR-068 (still *Proposed*) | decisions D-1..D-5 given; execution and ADR-068 approval not yet given | **PENDING (owner)** — expected; the cutover cannot start without it |
| P5-2 guards green on main, target frozen | §1 | **PASS** |
| P5-3 authenticated probes | D-3 = DEFER | **BLOCKED (D-3)** · no-write design N-W proposed (§8) |
| P5-4 new collector = 14 new hosts ≥ 1 h | executes in S1 (env + STEP B deploy); not allowed in preflight | **NOT YET (execution-time)**; gates S3/S4, not S1 |
| P5-5 menu buttons audited | §4 | **PASS** |
| P5-6 rollback targets recorded | §6 | **PASS** (re-capture at S0) |
| P5-7 no new consumer/scheduler | §7 | **PASS** |
| P5-8 build-minute headroom ≥ 2 redeploys | §3 (≈ 17) | **PASS** |
| P5-9 terraform/ops scripts registry or legacy-only | §5, this PR, guard 7/7 | **PASS** when this PR is merged with CI green |
| P5-10 stabilization/rollback accepted | D-5 | **PASS** |
| P5-11 BOT_E2E blocked, passive validation | standing owner constraint (test accounts, isolated data path, no prod write, cleanup plan — none exist) | **PASS** (S10 passive) |

## 10. Execution order S0 → S12 (D-4 applied; none executed)

| # | Step | Who / key | Validation | Go to next when |
|---|---|---|---|---|
| S0 | Owner's Phase 5 approval (P5-1); re-capture `getWebhookInfo` ×3; re-check gates | owner / read | evidence | all gates except P5-4 green and P5-3 resolved |
| S1a | `WASLA_OBS_ENVIRONMENT=render-singapore` on **new** `wasla-observability` (env only, no deploy) | NEW key (agent) | env read-back | — |
| S1b | **STEP A** — owner replaces `RENDER_API_KEY` with the new key | owner (GitHub) | next run FROZEN, 0 calls | FROZEN observed |
| S1c | (recommended) legacy `autoDeploy=no` ×24 — moved earlier from S11 | OLD key, **explicit approval** | API read-back | 24/24 `no` |
| S1d | **STEP B** reviewed PR → `mode: deploy`, `owner_id` NEW; merge (**first auto-deploy**) | review + merge | `render-sync` verdict PASS: 22/22 live on the STEP B commit, all `ownerId` NEW; legacy deploys 0 | PASS |
| S1e | P5-4: new collector `/api/v1/targets` = 14 **new** hosts for ≥ 1 h | read | API capture | P5-4 PASS |
| S2 | menu buttons — nothing to change (§4) | — | — | done |
| S3 | authenticated probes — **BLOCKED (D-3)**; N-W only if accepted | — | — | P5-3 resolved |
| S4 | bots, one at a time, partner → driver → customer: `setWebhook(new host, new service secret, drop_pending_updates=false)` (**first traffic change**) | bot token | `getWebhookInfo`: URL new, pending → 0, no error; new bot 200; old bot gets none | each bot clean ≥ 1 h before the next |
| S5 | stabilization ≥ 24 h after the last bot (D-5) | read | health, collector, no §5 trigger | 24 h clean |
| S6 | Prometheus/Alertmanager: (a) shadow new Prometheus `alertmanager none` 24 h; (b) suspend legacy AM (OLD, approval) → flip PR → create new AM → Prometheus with AM → test alert | NEW + OLD (approval) | one page per test alert | single pager verified |
| S7/S8 | custom domains / DNS — **N/A (D-4)** | — | — | — |
| S9 | Telegram webhooks — covered by S4 | — | — | — |
| S10 | validation: health 22/22, `getWebhookInfo` ×3, pooler connection count (read-only), passive bot validation (P5-11) | read | evidence | clean |
| S11 | old freeze: `autoDeploy=no` (if not done in S1c), no env change; env inventory outside git | OLD (approval) | read-back | — |
| S12 | deletion after ≥ 14 days frozen with no rollback, plus backup/RPO evidence, plus explicit owner approval (D-5): bots → apps → services → observability → prometheus/alertmanager | OLD (approval) | `GET /services` old = 0 | **irreversible** |

## 11. Rollback order (reverse; each step independent)

1. **Bots (S4), reverse order customer → driver → partner:** `setWebhook` back to the §6/S0 URL with the `TELEGRAM_WEBHOOK_SECRET` of the old service holding that token, `drop_pending_updates=false`; verify `getWebhookInfo`.
2. **Alerting (S6):** delete or suspend the new Alertmanager; resume the legacy Alertmanager; revert the flip PR. Legacy pages again.
3. **Deploy target (S1d):** revert PR → `mode: frozen` (a main merge deploys nothing again). If a bad commit is live on new, redeploy the previous commit with `render-sync.py <sha>` (new key). Legacy is not touched.
4. **Key (S1b):** the owner may restore the old key value; it is harmless while frozen. The legacy tools stay refused while the legacy owner is frozen.
5. **Observability (S1a):** remove `WASLA_OBS_ENVIRONMENT` on new, or set it back; new stack only.
6. **Legacy autoDeploy (S1c/S11):** setting it back to `yes` is possible but not recommended.
7. **S12:** no rollback.

**Triggers (D-5 / CLM-0500 §5):** webhook `last_error` or pending growth, 5xx on any new service, collector `down` not explained by sleep, a duplicate or missing page.

## 12. First actionable / irreversible steps

- **First actionable step:** S1a (env on the new observability; new stack only, reversible). The first step **outside the agent's hands** is S1b STEP A (owner swaps the secret; reversible, and harmless while frozen).
- **First automatic deployment:** S1d, the STEP B merge (reversible by revert plus redeploy of the previous commit).
- **First production traffic change:** S4, the partner `setWebhook` (reversible in seconds by `setWebhook` back).
- **First irreversible step:** S12, deletion of the old stack (D-5 conditions).

## Verdict

```
P5_PREFLIGHT = BLOCKED
  blocking:  P5-3 (owner decision D-3 = DEFER; no-write design N-W proposed, §8)
  pending by design: P5-1 (owner approval of execution + ADR-068), P5-4 (measured in S1, after STEP B)
  all other gates: PASS (P5-9 at merge of this PR)
```
