# CLM-0498 — Render blue/green migration to a new Singapore workspace: Phase 0–3

**Date:** 2026-10-08T10:20–11:05Z · **Work item:** M6-18B · **Main at start:** `f4b348b` (CI green)
**Old workspace:** `tea-damm8atbedkc73ca3ahg` (oregon) — **untouched** · **New workspace:** `tea-db0vtkpsrm7s739dm5c0` (Singapore) — created with the **new** API key only.
**Scope stop:** Phase 3 report. Phase 4 (cutover plan) and Phase 5 (domains) not started, per owner instruction.

No secret value is recorded. Values moved API-to-API; only key names, counts, IDs, hosts and public bot usernames appear.

---

## 1. Phase 0 — inventory of the old workspace (read-only)

All services: repo `https://github.com/skyosv10-art/wasla`, branch `main`, rootDir `/`, auto-deploy `yes` (inert — repo linked by URL, CLM-0401). Custom domains: **none**. Persistent disks: **none**. Secret files: **none**. Pre-deploy commands: none. Render cron jobs: **none deployed** (5 tick-scheduler cron jobs exist only in `infra/terraform/cron/main.tf`, never applied). Background loops: none in the 21 deployed services (only `services/billing` has an in-process relay, and billing is not deployed); bots never call `setWebhook`/`getUpdates` at boot.

| Old service | Type | Region | Plan | Build | Start | healthCheckPath | Env names | Class | New URL |
|---|---|---|---|---|---|---|---|---|---|
| `wasla-admin-app` | static | global CDN | — | `` → `` | — | `—` | 1: `NODE_VERSION` | static (CDN) | https://wasla-admin-app-p36w.onrender.com |
| `wasla-alertmanager` | web | oregon | free | docker `infra/observability/Dockerfile.alertmanager` ctx `infra/observability` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 5: `AM_BASIC_AUTH_HASH` `AM_BASIC_AUTH_USER` `PORT` `TELEGRAM_BOT_TOKEN` `TELEGRAM_CHAT_ID` | singleton alerting — stateful (alert state) | **not created** (§4) |
| `wasla-audit` | web | oregon | free | docker `./Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `/health` | 8: `DATABASE_URL` `NODE_ENV` `OTEL_EXPORTER_OTLP_ENDPOINT` `WASLA_PG_SSL_CA` `WASLA_PG_SSL_MODE` `WASLA_SERVICE` `WASLA_SERVICE_AUTH_ACTIVE_KID` `WASLA_SERVICE_AUTH_KEYS` | stateless HTTP | https://wasla-audit-pz7l.onrender.com |
| `wasla-customer-app` | static | global CDN | — | `` → `` | — | `—` | 1: `NODE_VERSION` | static (CDN) | https://wasla-customer-app-4jsv.onrender.com |
| `wasla-customer-bot` | web | oregon | free | docker `Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 13: `CUSTOMER_BOT_MINI_APP_URL` `CUSTOMER_BOT_TOKEN` `CUSTOMER_BOT_WEBHOOK_SECRET` `CUSTOMER_DATABASE_URL` `DATABASE_URL` `IDENTITY_SERVICE_URL` `NODE_ENV` `OTEL_EXPORTER_OTLP_ENDPOINT` `WASLA_PG_SSL_CA` `WASLA_PG_SSL_MODE` `WASLA_SERVICE` `WASLA_SERVICE_AUTH_ACTIVE_KID` `WASLA_SERVICE_AUTH_KEYS` | bot, webhook-driven, stateless | https://wasla-customer-bot-fw29.onrender.com |
| `wasla-customers` | web | oregon | free | docker `Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 11: `DATABASE_URL` `GEOGRAPHY_SERVICE_URL` `IDENTITY_SERVICE_URL` `NODE_ENV` `ORDER_SERVICE_URL` `OTEL_EXPORTER_OTLP_ENDPOINT` `WASLA_PG_SSL_CA` `WASLA_PG_SSL_MODE` `WASLA_SERVICE` `WASLA_SERVICE_AUTH_ACTIVE_KID` `WASLA_SERVICE_AUTH_KEYS` | stateless HTTP | https://wasla-customers-nzgs.onrender.com |
| `wasla-delivery` | web | oregon | free | docker `Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 9: `DATABASE_URL` `MARKETPLACE_SERVICE_URL` `NODE_ENV` `OTEL_EXPORTER_OTLP_ENDPOINT` `WASLA_PG_SSL_CA` `WASLA_PG_SSL_MODE` `WASLA_SERVICE` `WASLA_SERVICE_AUTH_ACTIVE_KID` `WASLA_SERVICE_AUTH_KEYS` | stateless HTTP | https://wasla-delivery-3rm5.onrender.com |
| `wasla-dispatch` | web | oregon | free | docker `Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 11: `DATABASE_URL` `DISPATCH_WAVE_SIZE` `MATCHING_BASE_URL` `NODE_ENV` `ORDERS_BASE_URL` `OTEL_EXPORTER_OTLP_ENDPOINT` `WASLA_PG_SSL_CA` `WASLA_PG_SSL_MODE` `WASLA_SERVICE` `WASLA_SERVICE_AUTH_ACTIVE_KID` `WASLA_SERVICE_AUTH_KEYS` | stateless HTTP | https://wasla-dispatch-bsba.onrender.com |
| `wasla-driver-app` | static | global CDN | — | `` → `` | — | `—` | 1: `NODE_VERSION` | static (CDN) | https://wasla-driver-app-1opi.onrender.com |
| `wasla-driver-bot` | web | oregon | free | docker `Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 12: `DATABASE_URL` `DRIVER_BOT_MINI_APP_URL` `DRIVER_BOT_TOKEN` `DRIVER_BOT_WEBHOOK_SECRET` `IDENTITY_SERVICE_URL` `NODE_ENV` `OTEL_EXPORTER_OTLP_ENDPOINT` `WASLA_PG_SSL_CA` `WASLA_PG_SSL_MODE` `WASLA_SERVICE` `WASLA_SERVICE_AUTH_ACTIVE_KID` `WASLA_SERVICE_AUTH_KEYS` | bot, webhook-driven, stateless | https://wasla-driver-bot-d8dv.onrender.com |
| `wasla-drivers` | web | oregon | free | docker `Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 8: `DATABASE_URL` `NODE_ENV` `OTEL_EXPORTER_OTLP_ENDPOINT` `WASLA_PG_SSL_CA` `WASLA_PG_SSL_MODE` `WASLA_SERVICE` `WASLA_SERVICE_AUTH_ACTIVE_KID` `WASLA_SERVICE_AUTH_KEYS` | stateless HTTP | https://wasla-drivers-1bwi.onrender.com |
| `wasla-geography` | web | oregon | free | docker `Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 9: `DATABASE_URL` `IDENTITY_SERVICE_URL` `NODE_ENV` `OTEL_EXPORTER_OTLP_ENDPOINT` `WASLA_PG_SSL_CA` `WASLA_PG_SSL_MODE` `WASLA_SERVICE` `WASLA_SERVICE_AUTH_ACTIVE_KID` `WASLA_SERVICE_AUTH_KEYS` | stateless HTTP | https://wasla-geography-ossq.onrender.com |
| `wasla-identity` | web | oregon | free | docker `Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 9: `DATABASE_URL` `NODE_ENV` `OTEL_EXPORTER_OTLP_ENDPOINT` `WASLA_PG_SSL_CA` `WASLA_PG_SSL_MODE` `WASLA_SERVICE` `WASLA_SERVICE_AUTH_ACTIVE_KID` `WASLA_SERVICE_AUTH_KEYS` `WASLA_USER_ASSERTION_SIGNING_KEY` | stateless HTTP | https://wasla-identity-rl0b.onrender.com |
| `wasla-marketplace` | web | oregon | free | docker `Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 10: `DATABASE_URL` `NODE_ENV` `OTEL_EXPORTER_OTLP_ENDPOINT` `WASLA_PG_SSL_CA` `WASLA_PG_SSL_MODE` `WASLA_SERVICE` `WASLA_SERVICE_AUTH_ACTIVE_KID` `WASLA_SERVICE_AUTH_KEYS` `WASLA_USER_ASSERTION_MODE` `WASLA_USER_ASSERTION_PUBLIC_KEYS` | stateless HTTP | https://wasla-marketplace-qa01.onrender.com |
| `wasla-matching` | web | oregon | free | docker `Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 11: `DATABASE_URL` `GEOGRAPHY_BASE_URL` `NODE_ENV` `OTEL_EXPORTER_OTLP_ENDPOINT` `WASLA_PG_SSL_CA` `WASLA_PG_SSL_MODE` `WASLA_SERVICE` `WASLA_SERVICE_AUTH_ACTIVE_KID` `WASLA_SERVICE_AUTH_KEYS` `WASLA_USER_ASSERTION_MODE` `WASLA_USER_ASSERTION_PUBLIC_KEYS` | stateless HTTP | https://wasla-matching-h26c.onrender.com |
| `wasla-negotiations` | web | oregon | free | docker `Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 10: `DATABASE_URL` `NODE_ENV` `OTEL_EXPORTER_OTLP_ENDPOINT` `WASLA_PG_SSL_CA` `WASLA_PG_SSL_MODE` `WASLA_SERVICE` `WASLA_SERVICE_AUTH_ACTIVE_KID` `WASLA_SERVICE_AUTH_KEYS` `WASLA_USER_ASSERTION_MODE` `WASLA_USER_ASSERTION_PUBLIC_KEYS` | stateless HTTP | https://wasla-negotiations-i32q.onrender.com |
| `wasla-observability` | web | oregon | free | docker `Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `/healthz` | 2: `NODE_ENV` `WASLA_SERVICE` | stateless HTTP | https://wasla-observability-kmxe.onrender.com |
| `wasla-orders` | web | oregon | free | docker `Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 8: `DATABASE_URL` `NODE_ENV` `OTEL_EXPORTER_OTLP_ENDPOINT` `WASLA_PG_SSL_CA` `WASLA_PG_SSL_MODE` `WASLA_SERVICE` `WASLA_SERVICE_AUTH_ACTIVE_KID` `WASLA_SERVICE_AUTH_KEYS` | stateless HTTP | https://wasla-orders-9p85.onrender.com |
| `wasla-otel-collector` | web | oregon | free | docker `infra/observability/Dockerfile.otel-collector` ctx `infra/observability` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 1: `PORT` | stateless HTTP | https://wasla-otel-collector-c33v.onrender.com |
| `wasla-partner-bot` | web | oregon | free | docker `Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 12: `DATABASE_URL` `IDENTITY_SERVICE_URL` `NODE_ENV` `OTEL_EXPORTER_OTLP_ENDPOINT` `PARTNER_BOT_MINI_APP_URL` `PARTNER_BOT_TOKEN` `PARTNER_BOT_WEBHOOK_SECRET` `WASLA_PG_SSL_CA` `WASLA_PG_SSL_MODE` `WASLA_SERVICE` `WASLA_SERVICE_AUTH_ACTIVE_KID` `WASLA_SERVICE_AUTH_KEYS` | bot, webhook-driven, stateless | https://wasla-partner-bot-tri8.onrender.com |
| `wasla-prometheus` | web | oregon | free | docker `infra/observability/Dockerfile.prometheus` ctx `infra/observability` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 2: `AM_BASIC_AUTH_PASSWORD` `PORT` | singleton alerting — stateful (alert state) | **not created** (§4) |
| `wasla-reputation` | web | oregon | free | docker `Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 8: `DATABASE_URL` `NODE_ENV` `OTEL_EXPORTER_OTLP_ENDPOINT` `WASLA_PG_SSL_CA` `WASLA_PG_SSL_MODE` `WASLA_SERVICE` `WASLA_SERVICE_AUTH_ACTIVE_KID` `WASLA_SERVICE_AUTH_KEYS` | stateless HTTP | https://wasla-reputation-a0ph.onrender.com |
| `wasla-search` | web | oregon | free | docker `Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 8: `DATABASE_URL` `NODE_ENV` `OTEL_EXPORTER_OTLP_ENDPOINT` `WASLA_PG_SSL_CA` `WASLA_PG_SSL_MODE` `WASLA_SERVICE` `WASLA_SERVICE_AUTH_ACTIVE_KID` `WASLA_SERVICE_AUTH_KEYS` | stateless HTTP | https://wasla-search-wjcz.onrender.com |
| `wasla-subscriptions` | web | oregon | free | docker `Dockerfile` ctx `.` | image ENTRYPOINT → `WASLA_SERVICE` | `—` | 8: `DATABASE_URL` `NODE_ENV` `OTEL_EXPORTER_OTLP_ENDPOINT` `WASLA_PG_SSL_CA` `WASLA_PG_SSL_MODE` `WASLA_SERVICE` `WASLA_SERVICE_AUTH_ACTIVE_KID` `WASLA_SERVICE_AUTH_KEYS` | stateless HTTP | https://wasla-subscriptions-5t78.onrender.com |

### 1.1 Service-to-service URLs (old → rewritten)

Env keys holding a Render URL: `OTEL_EXPORTER_OTLP_ENDPOINT` (16 services → observability), `IDENTITY_SERVICE_URL` (customers, geography, 3 bots), `ORDERS_BASE_URL`/`MATCHING_BASE_URL` (dispatch), `ORDER_SERVICE_URL`/`GEOGRAPHY_SERVICE_URL` (customers), `GEOGRAPHY_BASE_URL` (matching), `MARKETPLACE_SERVICE_URL` (delivery), `*_BOT_MINI_APP_URL` (3 bots). Static-site rewrite routes: 39 per site.

Hard-coded in the repository (not rewritten — §4): `infra/observability/prometheus.yml` scrape targets; `infra/render/app-rewrites.json` host convention `https://wasla-<svc>.onrender.com` (new hosts carry a suffix); `infra/terraform/*`; ops scripts.

### 1.2 Pre-existing findings (recorded, not fixed in the old workspace)

1. **INC-0004 (new):** the three old bots carry `WASLA_SERVICE=customer-bot|driver-bot|partner-bot` (set in the CLM-0492 restoration). The container entrypoint resolves `WASLA_SERVICE` as a **package name** (`@wasla/<x>-bot`); the bare name fails with `resolve-package: … exit 66`. Measured on the new customer-bot's first deploy (`update_failed`). The old bots run only because they still run the pre-wipe `93a4e33` deploy; **the next old-bot deploy would fail to boot**.
2. INC-0003 (crossed customer/driver tokens) — still present in the old workspace.
3. `wasla-audit` uses a different service-auth keyring from the other 16 signing services (active kid `stg-audit-k6` vs `k1`). Copied as-is; needs its own review.
4. `PARTNER_BOT_MINI_APP_URL` points at the **admin** app (old and new) — kept, flagged.

---

## 2. Phase 1 — new workspace

Created via `POST /v1/services` with the new key: **22 services** — 19 web services `region=singapore plan=free runtime=docker autoDeploy=no`, same Dockerfile/context/healthCheckPath as old; 3 static sites (Render static sites have no region — global CDN), same build command and publish path, previews off. **No database created**; DB-bound services keep the existing Supabase production `DATABASE_URL` (pooler `aws-0-ap-south-1`, port 5432). All 22 built and went `live` on commit **`f4b348b`**.

Render API limit: `POST /v1/services` = 20 per hour ([Render rate limiting](https://api-docs.render.com/reference/rate-limiting)); driver-bot and partner-bot were created after the window reset (10:59Z).

---

## 3. Phase 2 — configuration

| Rule | Applied |
|---|---|
| Full set, no key dropped | env names **identical** to the old service for 22/22 |
| Service URLs rewritten | every `https://wasla-<x>.onrender.com` in env values and in 117 static-site routes rewritten to the new host; **0** old hosts left; route order identical (39/39 ×3) |
| Provider/runtime values not copied blindly | Render-managed `PORT`/`RENDER_*` not injected (only user-defined `PORT` keys of the 3 observability images kept); **bot webhook secrets regenerated** (new ≠ old, 3/3) |
| Bot tokens from the trusted source | owner-supplied tokens, identity checked with `getMe` before create: customer-bot → `@ODD_CU_BOT`, driver-bot → `@ODD_DR_BOT`, partner-bot → `@ZizoGoBot` (**INC-0003 not reproduced**) |
| `WASLA_SERVICE` for bots | package names `@wasla/customer-bot` · `@wasla/driver-bot` · `@wasla/partner-bot` (INC-0004). customer-bot: single-key `PUT /env-vars/WASLA_SERVICE` (not a set replacement), count re-measured 13, one deploy → `live` |
| Shared secrets (DB URL, SSL CA/mode, service-auth keys, user-assertion keys) | copied from the old service of the same name (the only existing source); not printed |

---

## 4. Phase 3 — validation

| Check | Result |
|---|---|
| Required services present | **22 / 24**. Not created: `wasla-prometheus`, `wasla-alertmanager` — singleton alerting pair; `prometheus.yml` hard-codes old targets and alertmanager pages the on-call Telegram chat, so a second copy would scrape the old stack and duplicate alerts. Needs a repo change (parameterised targets) and a pause-old-first decision — Phase 4 |
| Env names/counts | identical 22/22 |
| Build/start config | same as old; 22/22 `live` on `f4b348b` |
| `/health` | 200 on 16 app/bot services with `x-wasla-database: up` (≈1–2 s warm); observability `/healthz` 200; 3 static `/` 200; otel-collector `/health` 404 — **same 404 on the old collector** |
| Routing / connectivity | new customer-app `/identity/me`, `/orders`, `/geo/zones`, `/search` → 401 `AUTHN_UNAUTHENTICATED` from the new services (rewrite + DNS + TLS). Authenticated service-to-service calls **not exercised** (would require signing with production keys) |
| Production data | no write: only `/health` (`select 1`) and unauthenticated requests |
| Telegram | **no `setWebhook`**; `getWebhookInfo` ×3 unchanged (customer/driver still crossed to the old services, partner → old partner); pending 0 |
| Old workspace | 24 services, env unchanged (value-level comparison), none suspended, no new deploy |
| BOT_E2E | not started |

### 4.1 New services

| Service | New ID | New URL |
|---|---|---|
| `wasla-admin-app` | `srv-db3mvrm0tbcc7386gog0` | https://wasla-admin-app-p36w.onrender.com |
| `wasla-audit` | `srv-db3mvbnavr4c73aevsug` | https://wasla-audit-pz7l.onrender.com |
| `wasla-customer-app` | `srv-db3mvn7lk1mc73c6jmv0` | https://wasla-customer-app-4jsv.onrender.com |
| `wasla-customer-bot` | `srv-db3n08gm7kps73fb8950` | https://wasla-customer-bot-fw29.onrender.com |
| `wasla-customers` | `srv-db3mvgmi0phs73ar0ed0` | https://wasla-customers-nzgs.onrender.com |
| `wasla-delivery` | `srv-db3mvfjtqb8s73eld440` | https://wasla-delivery-3rm5.onrender.com |
| `wasla-dispatch` | `srv-db3mvhugekts73fegn1g` | https://wasla-dispatch-bsba.onrender.com |
| `wasla-driver-app` | `srv-db3mvpegekts73fehb80` | https://wasla-driver-app-1opi.onrender.com |
| `wasla-driver-bot` | `srv-db3nfr7avr4c73agq9s0` | https://wasla-driver-bot-d8dv.onrender.com |
| `wasla-drivers` | `srv-db3mv8e0tbcc7386ejrg` | https://wasla-drivers-1bwi.onrender.com |
| `wasla-geography` | `srv-db3mvdjncjis73b2er2g` | https://wasla-geography-ossq.onrender.com |
| `wasla-identity` | `srv-db3mv6aj9qps738aege0` | https://wasla-identity-rl0b.onrender.com |
| `wasla-marketplace` | `srv-db3mvcnlk1mc73c6if70` | https://wasla-marketplace-qa01.onrender.com |
| `wasla-matching` | `srv-db3mvenavr4c73af07o0` | https://wasla-matching-h26c.onrender.com |
| `wasla-negotiations` | `srv-db3mv9mi0phs73aqvfo0` | https://wasla-negotiations-i32q.onrender.com |
| `wasla-observability` | `srv-db3mucij9qps738abipg` | https://wasla-observability-kmxe.onrender.com |
| `wasla-orders` | `srv-db3mv749v7es73dn9gn0` | https://wasla-orders-9p85.onrender.com |
| `wasla-otel-collector` | `srv-db3mv5om7kps73fb4390` | https://wasla-otel-collector-c33v.onrender.com |
| `wasla-partner-bot` | `srv-db3nftbtqb8s73en7o20` | https://wasla-partner-bot-tri8.onrender.com |
| `wasla-reputation` | `srv-db3mv8u0tbcc7386emug` | https://wasla-reputation-a0ph.onrender.com |
| `wasla-search` | `srv-db3mv7jncjis73b2e0ng` | https://wasla-search-wjcz.onrender.com |
| `wasla-subscriptions` | `srv-db3mvagm7kps73fb4ivg` | https://wasla-subscriptions-5t78.onrender.com |

### 4.2 Risks of running two stacks (Phase 4 input)

- Both stacks share the production Supabase pooler (session mode, port 5432); connections are lazy and `free` services sleep, but concurrent load doubles potential clients.
- Free instance hours (750/workspace/month) and build minutes now come from the new workspace; the old remains exhausted (RISK-0063).
- Old bots still carry INC-0003 and INC-0004 — do not deploy them.

```
OLD_SERVICES            = 24 (21 web oregon free + 3 static) — untouched
NEW_SERVICES            = 22 (19 web singapore free + 3 static), all live on f4b348b
MISSING_SERVICES        = wasla-prometheus, wasla-alertmanager (deliberate — §4)
ENV_MIGRATION           = names identical 22/22; bot tokens correct; webhook secrets regenerated; WASLA_SERVICE fixed for bots
INTERNAL_URL_REWRITES   = env + 117 routes rewritten, 0 old hosts left; repo-hardcoded URLs pending
BOT_IDENTITY            = customer↔@ODD_CU_BOT · driver↔@ODD_DR_BOT · partner↔@ZizoGoBot (new); Telegram webhooks unchanged
HEALTH                  = 200 on all app/bot/static; db up; otel-collector 404 = parity with old
DATASTORE_DEPENDENCIES  = Supabase production only (pooler ap-south-1); no Render datastore, disk or cron
DOMAIN_READINESS        = no custom domains on old or new (Phase 5 not started)
CUTOVER_PLAN            = not written (Phase 4 awaits owner review)
DELETE_OLD              = NO
```
