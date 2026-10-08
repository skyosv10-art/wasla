# CLM-0497 — Render bot build-target preflight · BOT_E2E attempt · INC-0003 · RISK-0063 decision pack · RISK-0060 plan · owner decisions

**Date:** 2026-10-08T02:05–02:25Z · **Main at start:** `69c6627` (CI green) · **Mode:** read-only measurement + docs · **Render/Supabase/Telegram mutations:** none · **Deployment:** none

All values below are names, IDs, hosts or public bot IDs. No secret value is recorded.

---

## 1. Build-target preflight (read-only)

### 1.1 Why Render shows `078ad9a`

| Fact | Measured |
|---|---|
| Deploy path | `.github/workflows/render-deploy.yml` → `scripts/deploy/render-sync.py` → `POST /services/{id}/deploys` with `commitId=<sha>` (commit-pinned). Render auto-deploy is inert (repo linked by URL, CLM-0401). |
| Trigger filter | `push` to `main` with `paths-ignore: docs/**, **/*.md` + `workflow_dispatch` (default `sha` = workflow commit). |
| Last non-docs commits after `93a4e33` | `60018e9` (CLM-0478) · `078ad9a` (#638). Every later commit is docs/md only → no push-triggered deploy. |
| Bot deploy history | customer: `078ad9a` build_failed 2026-10-08T01:11:21Z (api) · `078ad9a` build_failed 10-06T09:50Z · `60018e9` build_failed 10-06T03:00Z · **`93a4e33` live 10-06T01:58Z**. driver/partner: same without the 10-08 attempt. Every failure event = `pipeline_minutes_exhausted`. |
| 2026-10-08T01:11:21Z customer-bot attempt | `trigger=api`, not from this session (this session's Render calls were GET only). Actor not identifiable from the API. |
| `078ad9a` vs `aab1796`/`69c6627` | `git diff 078ad9a <main> -- . ':(exclude)docs/**' ':(exclude)*.md'` = **empty**. |

**Conclusion:** Render "picks" `078ad9a` because it is the last commit `render-deploy.yml` was triggered for (last non-docs change). A `workflow_dispatch` without `sha` would target current `main`, whose non-docs tree is identical to `078ad9a`; docs differ, and `COPY . .` copies docs into the image, so the image bytes are not identical even then.

### 1.2 `078ad9a` vs `93a4e33` — bot runtime/build inputs

`git diff --stat 93a4e33 078ad9a` = 17 files. Non-docs: `.github/workflows/db-backup.yml`, `package.json`, `pnpm-lock.yaml`, `packages/authz-policy/src/bindings.ts`, `packages/authz-policy/src/__tests__/policy.test.ts`, `scripts/ops/risk-0056/snapshot-dump.mjs`.

| Input | In bot image? | In bot runtime closure? | Change |
|---|---|---|---|
| `packages/authz-policy/src/bindings.ts` | yes (`COPY . .`) | **yes** — closure of all three bots: `bot-runtime`, `service-auth` → `authz-policy` (`service-auth/src/outbound.ts` imports `assertSignerComposition`) | 6 hunks, **only `note:` string literals** changed; `audience`/`dimension`/`strength`/`evidence` unchanged; no runtime code reads `.note` (`grep '\.note\b'` in service-auth/authz-policy src = none) |
| `package.json` + `pnpm-lock.yaml` | yes | no — overrides `source-map-js` 1.2.1→1.2.2 (dependent: `postcss`) and `tinypool` 1.1.1→2.2.0 (dependent: `vitest`); bot external runtime deps are `drizzle-orm`, `fastify`, `pg`, `prom-client` | dev-toolchain packages installed into the image (dev deps are installed) |
| `scripts/ops/risk-0056/snapshot-dump.mjs`, `db-backup.yml` | script yes / workflow no (`.github` in `.dockerignore`) | no | backup tooling |
| Base image | `node:20.20.1-alpine@sha256:b88333c4…` pinned | — | `RUN apk upgrade --no-cache` (Dockerfile:48) pulls **current** Alpine packages at build time → a rebuild today is not byte-reproducible vs the 2026-10-06 image |

```
BOT_TARGET_BUILD          = 078ad9a  (non-docs tree identical to current main)
BOT_SOURCE_DELTA          = authz-policy note strings only (runtime-inert by grep), dev-toolchain lock bumps
BOT_RUNTIME_EQUIVALENCE   = NOT_PROVEN  (apk upgrade at build time; lockfile change; no image digest comparison possible without a build)
```

Not a blocker by itself; recorded per owner instruction.

---

## 2. Live state (read-only)

| Check | customer-bot | driver-bot | partner-bot |
|---|---|---|---|
| Render live deploy | `93a4e33` | `93a4e33` | `93a4e33` |
| Instance plan / region | `free` / oregon | `free` / oregon | `free` / oregon |
| `/health` | 200 `{"status":"ok","channel":"telegram"}` · `x-wasla-database: up` · first call 34.4 s (cold spin-up) | 200 · db up · 33.2 s | 200 · db up · 33.2 s |
| Unauthenticated `GET /channel/<bot>/mini-app` | 401 `AUTHN_UNAUTHENTICATED`, no secret in body/headers | same | same |
| Mini App static site | `wasla-customer-app` 200 | `wasla-driver-app` 200 | `wasla-admin-app` 200 (configured as partner Mini App URL) |
| `getMe.has_main_web_app` | false | false | false |

`trace_id: req-3` on all three after the first call confirms a fresh process boot (free-plan spin-down → spin-up).

Correction by addition to CLM-0495: "all 24 services on `starter` plan" referred to the **build** plan; the bots' **instance** plan is `free`.

---

## 3. INC-0003 — customer/driver bot tokens crossed on Render

| Bot (Telegram) | Owner label (session 2026-10-07) + repo history | Render service holding its token | Webhook registered to |
|---|---|---|---|
| `@ODD_CU_BOT` (id 8790173546) | customer ("راكب") | **`wasla-driver-bot` (`DRIVER_BOT_TOKEN`)** | `https://wasla-driver-bot.onrender.com/channel/driver/webhook` |
| `@ODD_DR_BOT` (id 8934057143) | driver — also named the driver bot in M6-18C evidence 2026-09-29 | **`wasla-customer-bot` (`CUSTOMER_BOT_TOKEN`)** | `https://wasla-customer-bot.onrender.com/channel/customer/webhook` |
| `@ZizoGoBot` (id 8669721368) | partner | `wasla-partner-bot` | `https://wasla-partner-bot.onrender.com/channel/partner/webhook` ✓ |

Method: Render `GET /env-vars`, only the public numeric bot-ID prefix of each `*_BOT_TOKEN` compared; Telegram `getMe` + `getWebhookInfo` with owner-supplied tokens. `pending_update_count = 0`, `last_error_message = null` for all three.

**Effect when deployed:** a user opening the customer bot would be served by the driver service and the driver Mini App, and vice versa. CLM-0492's "webhooks verified" proved registration and internal consistency with Render's env, not correct bot↔service mapping.

**Not fixed** — the fix is an env-var change on two services + `setWebhook` for two bots + a deploy, all prohibited in this scope. Fix scope prepared (§6).

---

## 4. BOT_E2E_TEST

```
BOT_E2E_RESULT = BLOCKED_E2E
```

| Step | Result | Reason |
|---|---|---|
| health/readiness | PASS (all three 200, db up) | §2 |
| secret non-leakage (unauthenticated routes, health) | PASS | §2 |
| Mini App reachable | PASS (static 200) / not opened in Telegram | `has_main_web_app=false`; opening needs a Telegram user client |
| `/start`, update arrival | **BLOCKED** | (a) INC-0003 — the test would exercise the wrong mapping; (b) the Bot API cannot originate a user `/start`; no Telegram test-user account is available; (c) running instances are the `93a4e33` deploy — per [Render deploy docs](https://render.com/docs/deploys) a restart "always uses the exact same Git commit and configuration as the running instance… if you've recently updated your service's environment variables but haven't redeployed since then, restarting does not incorporate those changes", so the CLM-0492 env (new webhook secrets) is not proven loaded without a deploy |
| test order / cross-service state transition | **BLOCKED** | bots and services are bound to the production project `ppixaauyqoykrogwdxtv`; no test-data path exists without writing to production (prohibited) |

---

## 5. RISK-0063 — Owner Decision Pack (no purchase or plan change made)

Measured: last successful build durations 7–43 s per web service (21 services, sum 11.8 min); bots 43 / 35 / 35 s. Every deploy since 10-06T02:59Z fails `pipeline_minutes_exhausted`.

| Option | Cost (Render published) | Wait | Effect on E2E | Effect on Pilot |
|---|---|---|---|---|
| A. Add payment method + pipeline spend limit (Workspace Settings → Build Pipeline → Set spend limit) | extra minutes **$5 per 1K** ([pricing](https://render.com/pricing)); 3 bot builds ≈ 2–3 min; full 21-service push ≈ 12–21 min | immediate after the limit is raised ([build pipeline](https://render.com/docs/build-pipeline)) | unblocks the deploy step only; INC-0003 and the test-data path still block | necessary, not sufficient |
| B. Upgrade workspace to Pro | **$25/month** flat, 1K included minutes, then $5/1K ([pricing](https://render.com/pricing)) | immediate | same as A | same as A; more headroom |
| C. Wait for the monthly reset | $0 | builds stay disabled "for the remainder of the current month" ([build pipeline](https://render.com/docs/build-pipeline)) → expected 2026-11-01 (exact reset time not documented) | blocked ~24 days | blocked; RISK-0058/0060 reviews fall due first |
| D. Manual restart without build | not stated whether it consumes minutes | immediate | **does not help**: same commit and same configuration as the running instance; env changes not incorporated ([deploys](https://render.com/docs/deploys)) | none |

Note (no change made): `render-deploy.yml` deploys all 24 services on every non-docs push; at 500 min/month (Hobby) that pattern is what exhausted the minutes. Per-service filtering is a candidate follow-up.

---

## 6. Prepared fix scope for INC-0003 (NOT executed — needs owner authorization)

1. Render: for `wasla-customer-bot` and `wasla-driver-bot`, swap the values of `CUSTOMER_BOT_TOKEN` / `DRIVER_BOT_TOKEN` using **GET full set → modify one key → PUT full set** (INC-0002 lesson), then re-GET and compare key counts 13/12.
2. Telegram: `setWebhook` for `@ODD_CU_BOT` → `wasla-customer-bot` and `@ODD_DR_BOT` → `wasla-driver-bot`, each with that service's `*_WEBHOOK_SECRET`.
3. Deploy customer-bot only → verify live commit/health/config → driver-bot → partner-bot (owner execution order) → `getWebhookInfo` ×3 → stop.
4. Actions secrets `CUSTOMER_BOT_TOKEN`/`DRIVER_BOT_TOKEN` (set 2026-10-06T13:31Z) cannot be read; whether they are crossed too is **unknown**.

---

## 7. RISK-0060 — read-only plaintext-rejection plan (prepared, NOT executed)

Source of target: the existing repository Actions secret `SUPABASE_DB_URL` (already used by `db-backup.yml`); no URL requested from the owner.

Proposed `workflow_dispatch`-only job (new file → its own claim; governance/deployment category):

1. Parse host and project ref from `SUPABASE_DB_URL` inside the runner; print **only** ref and host; fail unless ref = `ppixaauyqoykrogwdxtv`.
2. Probe A (must fail): `psql "<url> sslmode=disable" -c 'select 1'` → PASS only if non-zero exit **and** the server message is SSL-required (`ESSLREQUIRED` / "SSL connection is required").
3. Probe B (control, must succeed): `sslmode=require` → `select 1` = 1.
4. Upload a JSON verdict (ref, host, probe A message class, probe B result, timestamps). No query beyond `select 1`; no write.

Historical evidence that already exists: run [37199256304](https://github.com/skyosv10-art/wasla/actions/runs/37199256304) (2026-10-04) — `db-backup.yml` plaintext connection rejected with `ESSLREQUIRED` before the CLM-0482 fix. It is incidental, not a deliberate probe.

Why not executed now: it requires a new workflow plus a deliberate connection to production; the owner's instruction for this step is "prepare", and an earlier direct attempt from the agent sandbox was refused by the platform safety layer.

---

## 8. Owner decisions recorded (Program Owner message, 2026-10-08)

Verbatim: «أصادق ADR-066 وADR-067 صراحةً» · «وافق على بوابات M6-18C وM6-19B وM6-19C».

| Decision | Recorded effect |
|---|---|
| Ratify ADR-066 (corrected text, `69c6627`) | `Proposed` → `Accepted — ratified explicitly`. RISK-0055 closure now owner-authorised **on acceptance of the measured RPO** (6 h target not met; worst 7 d gap 54.72 h). |
| Ratify ADR-067 (corrected text, `69c6627`) | `Proposed` → `Accepted — ratified explicitly`. RISK-0061 closure owner-authorised. |
| M6-18C gate approved | `Ready for Gate` → `Completed` (dependency M6-18A Completed; live-fire evidence; open limits stay recorded). |
| M6-19B gate approved | Approval recorded; status stays `Ready for Gate` — board dependency **M6-19A is not Completed** and the same message keeps M6-19A blocked; promotion takes effect when M6-19A completes (STATUS_MODEL §2.1, no jump). |
| M6-19C gate approved | as M6-19B. |

READY_FOR_M7 remains **NO** (M6-18B Blocked, M6-19A not performed).
