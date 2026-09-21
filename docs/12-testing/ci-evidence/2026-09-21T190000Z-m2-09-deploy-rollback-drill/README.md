# M2-09 Deploy/Rollback Drill — 2026-09-21

## Scope

Staged deploy/rollback drill on Render staging for all 16 WASLA services.

## Root Cause Analysis

All 16 Render services had `update_failed` status. Investigation revealed the Docker
**build** succeeds (~15s), but the **runtime startup** fails (~20s) for two reasons:

### 1. DATABASE_URL — DNS Resolution Failure

The Supabase **direct URL** (`db.snlpxywskyqrjattbpgn.supabase.co`) does not resolve
DNS from Render's network. The **pooler URL** (`aws-0-ap-northeast-2.pooler.supabase.com`)
resolves correctly and connects (PostgreSQL 17.6 verified).

### 2. WASLA_SERVICE_AUTH_KEYS — Missing Environment Variable

Every service (except the 3 bots) calls `keyRegistryFromEnv(process.env)` at startup.
This function throws `ServiceAuthKeyError` if `WASLA_SERVICE_AUTH_KEYS` is missing or
empty — by design (fail-fast on missing auth keys, per ADR-022). The variable was
completely absent from all 16 Render services.

## Fix Applied

### Terraform Changes

1. **Added `WASLA_SERVICE_AUTH_KEYS` and `WASLA_SERVICE_AUTH_ACTIVE_KID`** to
   `common_env` in `render.tf` — applied to all 16 services.
2. **Changed `NODE_ENV`** from hardcoded `"production"` to
   `var.environment == "staging" ? "staging" : "production"`.
3. **Added Terraform variables** `wasla_service_auth_keys` and
   `wasla_service_auth_active_kid` (sensitive, passed via `TF_VAR_*`).

### Render API Direct Update

Terraform apply failed for 5 services due to a Render provider bug
(`maintenance_mode can only be configured for non-free tier services`). The env vars
were updated directly via Render REST API instead (GET → modify → PUT full set).

- DATABASE_URL → Supabase pooler URL
- NODE_ENV → `staging`
- WASLA_SERVICE_AUTH_KEYS → `k1:active:<48-byte base64 secret>`
- WASLA_SERVICE_AUTH_ACTIVE_KID → `k1`

## Deploy Results

| Service | Status | Smoke Probe |
|---|---|---|
| wasla-identity | live | 401 (expected) |
| wasla-geography | live | 401 (expected) |
| wasla-orders | live | 401 (expected) |
| wasla-customers | live | 401 (expected) |
| wasla-delivery | live | 401 (expected) |
| wasla-dispatch | live | 401 (expected) |
| wasla-drivers | live | 401 (expected) |
| wasla-matching | live | 401 (expected) |
| wasla-negotiations | live | 401 (expected) |
| wasla-reputation | live | 401 (expected) |
| wasla-search | live | 401 (expected) |
| wasla-marketplace | live | 401 (expected) |
| wasla-subscriptions | live | 401 (expected) |
| wasla-customer-bot | live | 200 (health check) |
| wasla-driver-bot | live | 200 (health check) |
| wasla-partner-bot | live | 200 (health check) |

**16/16 services live.** Bot services were brought online after the owner provided
Telegram bot tokens. The bots also required `DATABASE_URL` (pooler) for the
service-auth token replay store, which was added to all 3 bot services.

Bot env vars set via Render API:
- `CUSTOMER_BOT_TOKEN` / `DRIVER_BOT_TOKEN` / `PARTNER_BOT_TOKEN` (owner-provided)
- `CUSTOMER_BOT_WEBHOOK_SECRET` / `DRIVER_BOT_WEBHOOK_SECRET` / `PARTNER_BOT_WEBHOOK_SECRET`
  (48-char hex secrets generated via `openssl rand -hex 24`)
- `CUSTOMER_BOT_MINI_APP_URL` / `DRIVER_BOT_MINI_APP_URL` / `PARTNER_BOT_MINI_APP_URL`
  (set to service URL for staging)
- `DATABASE_URL` (pooler) — needed by `createServiceTokenReplayStore` for replay guard

**401 response for HTTP services is expected**: services require `x-wasla-service-auth`
header for service-to-service authentication. A 401 proves the service is running and
enforcing auth, not that it is broken. Bot services respond 200 on `/health`.

## Rollback Drill (wasla-identity)

1. **Deploy current commit** `4894f39` → live (build ~15s, startup ~20s)
2. **Rollback to previous commit** `12ff405` → live (deploy `dep-daoohadbedkc73b2vqng`)
3. **Smoke probe on rollback** → 401 (service running on old commit)
4. **Roll-forward to latest** `4894f39` → live (deploy `dep-daooi9p42hec7392o9tg`)
5. **Smoke probe on roll-forward** → 401 (service running on latest commit)

Rollback/roll-forward drill: **PASSED**.

## Evidence

- Deploy `dep-daooe0ff3r2c73dettvg`: wasla-identity initial deploy → live
- Deploy `dep-daoohadbedkc73b2vqng`: wasla-identity rollback to 12ff405 → live
- Deploy `dep-daooi9p42hec7392o9tg`: wasla-identity roll-forward to 4894f39 → live
- All 13 HTTP services respond with 401 (auth required) — service is alive
- All 3 bot services respond with 200 on /health — service is alive
- Bot services required additional `DATABASE_URL` for service-auth replay store
