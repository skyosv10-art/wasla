# CLM-0500 — Render blue/green migration: Phase 4 report (design, proof, remediation)

**Date:** 2026-10-08T11:20–12:30Z (legacy re-check 12:16Z) · **Work item:** M6-18B · **Main at start:** `9baeca4` (CLM-0498, PR #654, merged after independent CODEOWNER approval)
**Owner decision in force:** conditional GO for Phase 4 only. Phase 5, DNS, Telegram webhook cutover, and suspend/delete of the old stack are **NO-GO** until the gates in §10 are met and approved.
**Executed in Phase 4:** read-only Render/Telegram/HTTP measurements; repository change PR #655 (CLM-0499); this report. **Not executed:** any step of §4, `setWebhook`, DNS, custom domains, suspend/delete, Supabase change, old-stack deploy, new Prometheus/Alertmanager.

No secret value is recorded. Keyrings are described by key ID and status only.

---

## 1. Hostname identity proof (Gate P4-1)

Source: `GET /v1/services?limit=100` with the **old** key (owner `tea-damm8atbedkc73ca3ahg`) and the **new** key (owner `tea-db0vtkpsrm7s739dm5c0`), 2026-10-08T11:35Z. Hostnames are parsed from `serviceDetails.url`.

| Service | Old ID | Old host | New ID | New host | old_host == new_host |
|---|---|---|---|---|---|
| `wasla-admin-app` | `srv-daprqr8u01pc73do6edg` | `wasla-admin-app.onrender.com` | `srv-db3mvrm0tbcc7386gog0` | `wasla-admin-app-p36w.onrender.com` | **false** |
| `wasla-audit` | `srv-daprrq0u01pc73do9npg` | `wasla-audit.onrender.com` | `srv-db3mvbnavr4c73aevsug` | `wasla-audit-pz7l.onrender.com` | **false** |
| `wasla-customer-app` | `srv-daprqr8u01pc73do6eb0` | `wasla-customer-app.onrender.com` | `srv-db3mvn7lk1mc73c6jmv0` | `wasla-customer-app-4jsv.onrender.com` | **false** |
| `wasla-customer-bot` | `srv-daodb6bm8hqs73e8aa50` | `wasla-customer-bot.onrender.com` | `srv-db3n08gm7kps73fb8950` | `wasla-customer-bot-fw29.onrender.com` | **false** |
| `wasla-customers` | `srv-daodbe3m8hqs73e8b5ag` | `wasla-customers.onrender.com` | `srv-db3mvgmi0phs73ar0ed0` | `wasla-customers-nzgs.onrender.com` | **false** |
| `wasla-delivery` | `srv-daodbc3m8hqs73e8atvg` | `wasla-delivery.onrender.com` | `srv-db3mvfjtqb8s73eld440` | `wasla-delivery-3rm5.onrender.com` | **false** |
| `wasla-dispatch` | `srv-daodbfmk1f9s73bknib0` | `wasla-dispatch.onrender.com` | `srv-db3mvhugekts73fegn1g` | `wasla-dispatch-bsba.onrender.com` | **false** |
| `wasla-driver-app` | `srv-daprqr8u01pc73do6ef0` | `wasla-driver-app.onrender.com` | `srv-db3mvpegekts73fehb80` | `wasla-driver-app-1opi.onrender.com` | **false** |
| `wasla-driver-bot` | `srv-daodb6740ujc73esa79g` | `wasla-driver-bot.onrender.com` | `srv-db3nfr7avr4c73agq9s0` | `wasla-driver-bot-d8dv.onrender.com` | **false** |
| `wasla-drivers` | `srv-daodb6740ujc73esa7v0` | `wasla-drivers.onrender.com` | `srv-db3mv8e0tbcc7386ejrg` | `wasla-drivers-1bwi.onrender.com` | **false** |
| `wasla-geography` | `srv-daodbbn40ujc73esarsg` | `wasla-geography.onrender.com` | `srv-db3mvdjncjis73b2er2g` | `wasla-geography-ossq.onrender.com` | **false** |
| `wasla-identity` | `srv-daodb63m8hqs73e8a900` | `wasla-identity.onrender.com` | `srv-db3mv6aj9qps738aege0` | `wasla-identity-rl0b.onrender.com` | **false** |
| `wasla-marketplace` | `srv-daodb60ae00c73c2utjg` | `wasla-marketplace.onrender.com` | `srv-db3mvcnlk1mc73c6if70` | `wasla-marketplace-qa01.onrender.com` | **false** |
| `wasla-matching` | `srv-daodbdrtqb8s73et2sl0` | `wasla-matching.onrender.com` | `srv-db3mvenavr4c73af07o0` | `wasla-matching-h26c.onrender.com` | **false** |
| `wasla-negotiations` | `srv-daodb6ek1f9s73bkmcr0` | `wasla-negotiations.onrender.com` | `srv-db3mv9mi0phs73aqvfo0` | `wasla-negotiations-i32q.onrender.com` | **false** |
| `wasla-observability` | `srv-daqk61h42hec73a0koo0` | `wasla-observability.onrender.com` | `srv-db3mucij9qps738abipg` | `wasla-observability-kmxe.onrender.com` | **false** |
| `wasla-orders` | `srv-daodb63m8hqs73e8a9fg` | `wasla-orders.onrender.com` | `srv-db3mv749v7es73dn9gn0` | `wasla-orders-9p85.onrender.com` | **false** |
| `wasla-otel-collector` | `srv-daqgfs0jo6nc73ec60t0` | `wasla-otel-collector.onrender.com` | `srv-db3mv5om7kps73fb4390` | `wasla-otel-collector-c33v.onrender.com` | **false** |
| `wasla-partner-bot` | `srv-daodb6f40ujc73esa8bg` | `wasla-partner-bot.onrender.com` | `srv-db3nftbtqb8s73en7o20` | `wasla-partner-bot-tri8.onrender.com` | **false** |
| `wasla-reputation` | `srv-daodb63tqb8s73et1tlg` | `wasla-reputation.onrender.com` | `srv-db3mv8u0tbcc7386emug` | `wasla-reputation-a0ph.onrender.com` | **false** |
| `wasla-search` | `srv-daodbbbtqb8s73et2i0g` | `wasla-search.onrender.com` | `srv-db3mv7jncjis73b2e0ng` | `wasla-search-wjcz.onrender.com` | **false** |
| `wasla-subscriptions` | `srv-daodb66gekts73br8q9g` | `wasla-subscriptions.onrender.com` | `srv-db3mvagm7kps73fb4ivg` | `wasla-subscriptions-5t78.onrender.com` | **false** |

**Result: 22/22 `false`.** Service IDs differ 22/22, and the owner workspace differs 22/22. The only old services without a new counterpart are `wasla-prometheus` and `wasla-alertmanager` (deliberate, §3).

**Why the Phase 3 report could look identical:** its Phase 0 table is keyed by the **old service name**, which is the same in both workspaces. Render assigns `<name>.onrender.com` only when the name is free globally, so the new services got suffixed hosts (`-kmxe`, `-rl0b`, …). Names are equal; hosts are not.

**Serving-side proof (not just API):**
- `wasla-identity.onrender.com` and `wasla-identity-rl0b.onrender.com` resolve to the same Render edge addresses (216.24.57.16/.18 — shared anycast). Each answers `/health` with its own `rndr-id`.
- The new static site routes `/identity/me` · `/orders` · `/geo/zones` · `/search` to the new services (Phase 3).
- The new collector's `/api/v1/targets` listing the **old** hosts (§2) was itself observable only because the stacks are distinct.

`PHASE_4_BLOCKED` condition (a real host match, or an unprovable difference): **not met.**

---

## 2. Monitoring remediation (Gate P4-2) — PR #655 · CLM-0499 · ADR-068

**Measured defect:** the new `wasla-observability` (Singapore) listed the **14 legacy hosts** in `/api/v1/targets` (11:41Z), all `down`. The hosts were hard-coded in:

| Source | Kind | Runtime effect | Fix |
|---|---|---|---|
| `services/observability/src/config.ts` | runtime code (deployed) | new collector watches the old stack | **PR #655:** reads the registry |
| `infra/observability/prometheus.yml` | runtime config (image) | a new Prometheus would scrape old hosts **and page through the old Alertmanager** | **PR #655:** template + per-environment render |
| `scripts/ops/health/check-health.py` + `.github/workflows/service-health.yml` | scheduled (6 h), opens GitHub issues | watches only the old stack | **PR #655:** reads the registry; workflow pinned to the paging owner |
| `infra/render/app-rewrites.json` | route table (prefix → service **name**) | none; hosts are not in this file. The live new routes were written by API with new hosts | no change needed. Its consumer `infra/terraform/apps/main.tf` derives hosts by convention → §9 |
| `infra/terraform/{apps,cron,observability}` | IaC scaffold, **never applied** to the live Render | none today; would re-introduce old hosts if applied | Phase 5 acceptance item (§10, P5-9) |
| `scripts/deploy/dr-drill.py`, `scripts/ops/risk-0056/*`, `scripts/ops/m6-18b-dr/*`, `scripts/m3-07-*.py`, test harnesses | manual tools / historical drills | none unless run | Phase 5 acceptance item (§10, P5-9). No mass replace |

**Design (ADR-068, Proposed):**
- One registry per environment: `infra/observability/targets/render-oregon-legacy.targets` (paging owner) and `render-singapore.targets` (shadow, `alertmanager none`).
- Every consumer selects it with `WASLA_OBS_ENVIRONMENT`. There is no default; a missing, unknown, or mismatched value fails closed.
- The legacy stack keeps monitoring now: its running images are not redeployed. A future legacy redeploy needs `WASLA_OBS_ENVIRONMENT=render-oregon-legacy` set first, and fails visibly without it. The old hostname set cannot return by omission.
- Guard `scripts/checks/validate-observability-targets.sh` (mandatory in `scripts/verify.sh`) fails on:
  - a hostname in the template, the collector, or the health probe;
  - a host shared by two environments;
  - more than one paging owner;
  - a health workflow that watches a non-owner;
  - targets missing from the image;
  - a start without an environment.

  Each rule has a mutation self-test (10/10). Collector unit tests pass (11).
- Measured on the new stack with the new code (GET only): `check-health.py` with `render-singapore` → **14/14 healthy**. The collector run locally against `render-singapore` scraped `wasla-delivery-3rm5` (152 lines).

**Activation (Phase 5 step S1, not done):** `PUT /env-vars/WASLA_OBS_ENVIRONMENT=render-singapore` on the **new** `wasla-observability` (single key, count re-measured), then deploy the merged commit. Legacy: no change.

---

## 3. Prometheus / Alertmanager singleton decision (Gate P4-3)

| Question | Decision |
|---|---|
| Who owns the singleton during migration | **Legacy** `wasla-prometheus` + `wasla-alertmanager` (oregon). Git records this as the only non-`none` `alertmanager` line (`render-oregon-legacy.targets`); the guard rejects a second owner. |
| How the new stack is monitored before it is primary | (a) new collector on `render-singapore` (S1), which logs alert states only and never pages; (b) a **shadow Prometheus** in the new workspace (S6a) with `alertmanagers: []`, which evaluates `alert-rules.yml` on the new hosts, visible at `/alerts`, sending nothing; (c) `check-health.py` on demand with `render-singapore`. |
| When ownership moves | After all three bots have run on the new stack for the stabilization window (§4 S5, ≥ 24 h, no rollback). Then a clean 24 h comparison follows: shadow `/alerts` vs legacy (no new-only firing alerts not explained by stack differences). Owner approval is required (it includes an old-stack action). |
| How duplicate Telegram paging is prevented | (1) Git: ≤ 1 owner, enforced by CI. (2) Runtime ordering: **stop legacy paging before new paging exists.** Legacy Alertmanager cannot be reconfigured without a deploy (build minutes exhausted, RISK-0063), so the stop is `suspend` of legacy `wasla-alertmanager` (reversible: `resume`). Sequence: suspend legacy AM → merge flip PR (singapore `alertmanager <new host>`, legacy `none`, health workflow → `render-singapore`) → deploy new Prometheus with AM → one owner-approved test alert. (3) The new Alertmanager is created only at transfer time. Before that, nothing can send to it. |
| Gap | Between legacy-AM suspend and new-AM live, alerting is down. The window is bounded by one deploy; the collector and health probe remain. Rollback: resume legacy AM, revert the flip PR. |

---

## 4. Cutover sequence (Phase 5 — none executed)

Each step: preconditions, then action, then validation, then a go/no-go to the next step. One step at a time; no batching. All Render actions use the **new** key unless marked OLD.

| # | Area | Action | Validation | Rollback |
|---|---|---|---|---|
| S0 | prerequisites | Phase 5 approval; §10 gates green; record the current `getWebhookInfo` ×3 (URL, pending, last error) as the rollback target; measure new-workspace build minutes left | gates evidence | — |
| S1 | observability (new) | `WASLA_OBS_ENVIRONMENT=render-singapore` on new `wasla-observability`, deploy merged commit | `/api/v1/targets` = 14 **new** hosts | revert env/deploy (new stack only) |
| S2 | static apps | **No traffic switch exists for them.** New apps are reached only through the new bots' `*_MINI_APP_URL` (already new). Check BotFather menu-button/`getChatMenuButton` for each bot: a menu button with a hard-coded old URL would keep users on the old apps | menu buttons point at no old host, or the list of ones to change is approved | — |
| S3 | stateless services | **No switch.** They receive traffic only from the new static apps and new bots. Run the authenticated probes (§6) | §6 matrix all expected | none needed |
| S4 | bots (one at a time: partner → driver → customer) | `setWebhook(url=<new bot host>/channel/<role>/webhook, secret_token=<new service's secret>, drop_pending_updates=false)` | `getWebhookInfo` ×3: URL = new, pending → 0, no `last_error`; new bot logs 200 on webhook POSTs; old bot receives none | `setWebhook` back to the S0-recorded URL with the secret of the **old service that holds that token** (INC-0003 crossed mapping), `drop_pending_updates=false` |
| S5 | stabilization | ≥ 24 h after the last bot; health probe and collector on `render-singapore` | no rollback trigger (§5) | §5 |
| S6 | Prometheus/Alertmanager | (a) create shadow `wasla-prometheus` (new, `alertmanager none`), 24 h comparison; (b) §3 transfer: OLD suspend legacy AM → flip PR → create new `wasla-alertmanager` → deploy new Prometheus with AM → test alert | one page per test alert; legacy AM suspended | resume legacy AM; revert flip PR |
| S7 | custom domains | **None exist** on old or new. Adding one is a separate owner decision. If chosen: add to **new** services only, wait for Render TLS `verified`, before any DNS | Render domain status | remove domain |
| S8 | DNS | N/A without S7. If S7: lower TTL ≥ 24 h ahead, switch CNAME to the new host, keep the old record noted | `dig` + TLS + `/health` via the domain | restore the CNAME |
| S9 | Telegram webhooks | covered by S4 (the only traffic entry point today) | — | — |
| S10 | validation | Health 22/22; `getWebhookInfo` ×3; authenticated probes; DB pooler connection count (read-only `pg_stat_activity` count) vs pre-cutover; BOT_E2E **only if** its prerequisites exist (test accounts, isolated data path, no prod write, cleanup plan), otherwise passive validation | evidence README | — |
| S11 | old-stack freeze | OLD: `autoDeploy=no` on all 24; no env changes; record final env inventory **outside git** (chmod 600, encrypted) | API read-back | re-enable only with approval |
| S12 | final deletion | After ≥ 14 days frozen with no rollback, plus a verified backup/RPO evidence, plus explicit owner approval: delete OLD in reverse dependency order (bots → apps → services → observability → prometheus/alertmanager last) | `GET /services` (old) = 0 | none (irreversible) |

---

## 5. Rollback sequence

Triggers: any bot webhook `last_error` that persists > 5 min · new-stack `/health` failure that persists > 10 min · DB pooler saturation · an owner call.

1. **Bots (seconds, per bot):** `setWebhook` to the S0-recorded old URL with the secret of the old service holding that token. `drop_pending_updates=false`, so updates queued at Telegram are kept. Verify with `getWebhookInfo`. Note: this restores the **pre-existing** INC-0003 crossed behaviour of customer/driver in the old stack. It is an availability fallback, not a fix.
2. **Static apps/services:** nothing to switch back. Once bots point to old, users get the old Mini App URLs again.
3. **Observability:** S1 revert (new stack only). If S6 ran: resume legacy AM, revert the flip PR, suspend new Prometheus.
4. **Domains/DNS:** restore the CNAME (only if S7/S8 ran).
5. **Data:** shared database, so there is no data rollback. Both stacks read/write the same rows. Rollback does not need a DB restore, and cannot undo writes made through the new stack.
6. **Never** deploy old customer/driver bots as part of rollback (INC-0003, INC-0004 — §8).

---

## 6. Authenticated service-to-service validation plan (Gate P4-6 — plan only, not executed)

**Mechanism:** the production signer (`createServiceRequestSigner` → `wsvc3` token, `kid` k1, bound to method + path + query, TTL ≤ 60 s) runs in a one-off runner process. The k1 secret is read from the **new** Render env in memory, never printed or written.

| Probe | As (principal → audience) | Request (read-only) | Expected | Proves |
|---|---|---|---|---|
| A1 | customers → identity (new) | `GET /identity/users/<random non-existent public id>` | not 401: 404, or the route's assertion-required code, pinned first by an in-process dry run against `services/identity` tests | k1 accepted by new identity; route reached |
| A2 | customers → geography (new) | `GET /geo/zones/<random uuid>?locale=ar` | 404 | signing incl. query binding |
| A3 | matching → geography (new) | same as A2 | 404 | second principal |
| A4 | dispatch → orders (new) | one read route from `services/orders` (pinned in the dry run) | 404 / 200 | dispatch credential |
| N1 | negative | A2 unsigned | 401 `AUTHN_UNAUTHENTICATED` | the gate is real |
| N2 | negative | A2 with audience `orders` | 401 | audience binding |
| N3 | negative | replay the exact A2 token | 401 (replay) | shared replay store |

**This is not zero-write — owner decision D-3.** Every accepted token inserts one row into `wasla_service_token_replay` (`kid`, `jti`, `retain_until`) in the production database, pruned by `DELETE … WHERE retain_until <= now`. That is the same row every normal internal call writes; no business table is touched (random non-existent IDs, GET only). The owner must either accept ≈ 7 replay rows as non-business writes, or defer the probes until an isolated data path exists.

---

## 7. Dual-stack safety controls (Gate P4-5)

Both stacks use the same Supabase production database. The old stack stays the recovery fallback.

| Hazard | Measured state | Control |
|---|---|---|
| Duplicate webhook processing | Telegram delivers each bot's updates to **one** URL; all 3 still point at the old stack, so the new bots receive nothing. New webhook secrets ≠ old, so a delivery to the wrong stack is rejected with 401 rather than processed | one `setWebhook` per bot (S4), `getWebhookInfo` after each; rollback is a single `setWebhook`; never both |
| Duplicate consumers/workers | No background loop in any deployed service. `setInterval` exists only in the observability collector (read-only scrape/eval). The `services/billing` relay is **not deployed** in either stack | Phase 5 gate P5-7: a new background consumer cannot be deployed in either stack during dual-run without a DB lease (`FOR UPDATE SKIP LOCKED` / advisory lock) |
| Duplicate scheduled work | tick-scheduler (5 jobs) **not deployed** in either stack (`infra/terraform/cron` never applied). GitHub schedules: `service-health` (read-only; pinned to the paging owner), `db-backup` and `dr-restore-drill` (database-side, independent of Render stacks), `merged-branch-cleanup` (repo) | do not deploy tick-scheduler until S12 or an approved lease; migrate `infra/terraform/cron` hosts to the registry first (P5-9) |
| Duplicate alerts | Only legacy Prometheus → legacy AM pages. The new collector logs only. New Prometheus/AM not created | ADR-068 guard (≤ 1 owner, health workflow = owner); §3 runtime ordering |
| Cross-stack token use | One shared keyring (k1) and one shared replay table, so a token minted in one stack is accepted once in the other and never twice | intended: the replay store is in Postgres, not memory |
| Per-instance memory state | Limits, caches and counters held in process memory are per stack, so effective limits double while both serve traffic | accepted for the dual-run window; no traffic splits while bots point at one stack |
| DB connections | Two stacks can open up to twice the pooler connections (session mode, port 5432). Free services sleep | measure `pg_stat_activity` count (read-only) at S0 and S10; rollback trigger on saturation |
| Accidental old deploy | Old bots would fail to boot (INC-0004). After #655, old observability/prometheus would fail closed without `WASLA_OBS_ENVIRONMENT`. Old build minutes are exhausted (RISK-0063) | S11 freeze (`autoDeploy=no`) |

---

## 8. Legacy safety (measured 2026-10-08T12:16Z, read-only)

- OLD workspace untouched: 24 services; env-var **counts** equal the Phase 0 inventory 24/24; none suspended. The value-level comparison 24/24 was made at the end of Phase 3 (CLM-0498, 11:05Z). The local copy of the old values was then destroyed (`shred`) so that it is not held, so this re-check is count-level.
- No old deploy since the CLM-0497 preflight: the newest deploy across all 24 is 2026-10-08T01:11:21Z (`wasla-customer-bot`, `build_failed`), before this work.
- INC-0003 (crossed customer/driver tokens) **remains in OLD**. `getWebhookInfo` is unchanged: @ODD_CU_BOT → `wasla-driver-bot.onrender.com`, @ODD_DR_BOT → `wasla-customer-bot.onrender.com`.
- INC-0004 (`WASLA_SERVICE` not a package name) **remains in OLD**.
- **Therefore: DO NOT deploy the old customer/driver bots**. The partner bot too: INC-0004 affects all three.

---

## 9. Config questions — resolved by evidence

**Q1 — `wasla-audit` active kid `stg-audit-k6` vs `k1` elsewhere.**
- Origin: the M3-07 key-rotation drill (CLM-0326, 2026-09-24, owner-delegated). It rotated **only `wasla-audit`** (`stg-audit-k5 → stg-audit-k6`, final state `k6:active, k5:revoked`). [`M3-07_GATE.md`](../../M3-07_GATE.md) §7.5 says other services were not rotated.
- Measured now: audit's keyring = {`stg-audit-k6` active, `stg-audit-k5` revoked} and contains **no `k1`**. The other 18 signing services share one identical keyring = {`k1` active}.
- Effect: audit and the other services cannot authenticate each other. Repo search shows **no runtime caller** of audit (no `AUDIT_*_URL`, no outbound signer with audience `audit`), so there is no functional impact today.
- **Answer:** intended as a drill end-state. Not intended as the target state; the runbook requires all services to rotate together. It is copied unchanged to the new stack for parity. Decision D-1 (owner): converge with a planned full rotation after cutover, or record audit as an isolated keyring with an ADR. It does not block cutover.

**Q2 — `PARTNER_BOT_MINI_APP_URL` → admin app.**
- Origin: CLM-0278 (2026-09-21) set the three `*_MINI_APP_URL` values "to service URLs for staging". `apps/partner-mini-app` contains only `.gitkeep`, so **no partner Mini App exists**. The admin portal is the only built app with partner screens (`apps/admin-portal/src/screens/Partners.tsx`).
- **Answer:** not a product decision. It is a staging placeholder pointing at the only available app. It is kept identical on the new stack (no behaviour change at cutover). Decision D-2 (owner, product): keep it, build `partner-mini-app`, or hide the partner Mini App button. Required before FIELD_TRIAL; not a cutover blocker.

---

## 10. Gates

### Phase 4 gates

| Gate | Evidence | Result |
|---|---|---|
| P4-1 host identity | §1 — 22/22 false, IDs and owners differ | **PASS** |
| P4-2 monitoring remediation | PR #655 (CLM-0499): registry, fail-closed selection, guard 10/10, tests 11/11, 14/14 health on new | **PASS** when #655 is merged with CI green (recorded at merge) |
| P4-3 singleton decision | §3 | **PASS** (design) |
| P4-4 cutover + rollback plan | §4, §5 | **PASS** (design) |
| P4-5 dual-stack safety | §7 | **PASS** (design + measurements) |
| P4-6 authenticated validation plan | §6 | **PASS** (plan); execution needs D-3 |
| P4-7 config questions | §9 | **PASS** (resolved; follow-ups D-1, D-2) |
| P4-8 legacy safety | §8 | **PASS** |

### Exact acceptance gates for Phase 5 (all required before S1)

| # | Gate | How it is proven |
|---|---|---|
| P5-1 | Owner approves Phase 5 explicitly, and approves ADR-068 | written approval |
| P5-2 | PR #655 merged; `validate-observability-targets.sh` green on main | CI run on main |
| P5-3 | Owner decision D-3 on the authenticated probes; if accepted, §6 matrix = expected on the new stack | evidence README |
| P5-4 | New collector activated (S1) and `/api/v1/targets` = 14 new hosts for ≥ 1 h with no `down` not explained by sleep | API capture |
| P5-5 | Bot menu buttons audited (S2) | `getChatMenuButton` capture |
| P5-6 | Rollback targets recorded: `getWebhookInfo` ×3 + for each the old service whose env holds that token (names only) | evidence README |
| P5-7 | No background consumer/scheduler added to either stack since this report | repo diff + Render service list |
| P5-8 | New-workspace build-minute headroom ≥ 2 full redeploys of the services touched in Phase 5 | Render billing/usage read |
| P5-9 | `infra/terraform/{apps,cron,observability}` and the active ops scripts read the registry, not the convention (separate PR), or they are explicitly marked "legacy-only, do not run against new" | PR + guard |
| P5-10 | Stabilization window and rollback triggers (§5) accepted by the owner | written approval |
| P5-11 | BOT_E2E stays BLOCKED until its prerequisites exist; validation in S10 is passive unless they do | owner confirmation |

### Unresolved decisions (owner)

- **D-1** audit keyring: converge vs isolate (§9 Q1). Not a cutover blocker.
- **D-2** partner Mini App target (§9 Q2). Not a cutover blocker; required before FIELD_TRIAL.
- **D-3** accept ≈ 7 replay-store rows for the authenticated probes, or defer (§6). Blocks P5-3.
- **D-4** whether to add custom domains at all (§4 S7). Without them, S7/S8 are N/A.
- **D-5** stabilization window length (proposed ≥ 24 h per stage) and the 14-day freeze before deletion (§4 S5/S12).

---

```
PHASE_4 = READY  (conditional on P4-2: PR #655 merged with CI green)
HOST_IDENTITY        = 22/22 distinct (old_host == new_host → false)
MONITORING           = ADR-068 registry; new stack in shadow; legacy owns paging
SINGLETON            = legacy until S6 transfer; suspend-legacy-AM before new AM
CUTOVER_EXECUTED     = NO   · SETWEBHOOK = NO · DNS = NO · DOMAINS = none exist
OLD_STACK            = untouched · DO NOT deploy old bots (INC-0003, INC-0004)
DELETE_OLD           = NO
```
