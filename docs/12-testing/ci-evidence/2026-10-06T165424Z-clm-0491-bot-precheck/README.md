# BOT_PRECHECK — 2026-10-06T16:54:24Z (CLM-0491)

**TEST_STATUS = BLOCKED_PRECHECK.** The functional test (`/start`, Mini App, test order) was **not run**.

**Scope:** read-only. Render API (`GET` only), each bot's `GET /health`, and Telegram `getWebhookInfo` (a read-only call). The token was used in memory only and never printed or stored. Values of settings are not recorded; **names only**.
**Not done:** no deploy, no restart, no Render change, no secret/token change, no restore, no `setWebhook`, no message sent.
**Deployment under test:** `93a4e33` (live on all three bots since 2026-10-06T01:58Z).

## Results

| Check | customer-bot | driver-bot | partner-bot |
|---|---|---|---|
| `GET /health` | 200 `{"status":"ok","channel":"telegram"}` (64.7 s, cold start) | 200 (34.2 s, cold start) | 200 (33.3 s, cold start) |
| Registry `required: always` (`packages/config/env-registry.json`) | `CUSTOMER_BOT_MINI_APP_URL` `CUSTOMER_BOT_TOKEN` `CUSTOMER_BOT_WEBHOOK_SECRET` | `DRIVER_BOT_*` (same 3) | `PARTNER_BOT_*` (same 3) |
| Setting names on the Render service now | `CUSTOMER_BOT_TOKEN` only | `DRIVER_BOT_TOKEN` only | `PARTNER_BOT_TOKEN` only |
| **Missing required** | **`CUSTOMER_BOT_MINI_APP_URL`, `CUSTOMER_BOT_WEBHOOK_SECRET`** | **`DRIVER_BOT_MINI_APP_URL`, `DRIVER_BOT_WEBHOOK_SECRET`** | **`PARTNER_BOT_MINI_APP_URL`, `PARTNER_BOT_WEBHOOK_SECRET`** |
| Missing vs CLM-0431 baseline (`2026-10-02T090000Z-clm-0431-…/after.json`) | 10 of 11 | 9 of 10 | 9 of 10 |
| Telegram `getWebhookInfo` | **`url` empty**, pending 0, no last error | **`url` empty**, pending 0 | **`url` empty**, pending 0 |

## Stop reasons

1. **Required configuration is missing or unprovable (INC-0002).** `*_WEBHOOK_SECRET` and `*_MINI_APP_URL` are `always` in the registry and enforced by `loadBotConfig()` (`packages/bot-runtime/src/config.ts`, `required(...)`). They are absent from the service configuration. The running process answers `/health` 200, which suggests it still holds the earlier deploy's configuration. That cannot be proven without printing values, and a `200` from `/health` is not proof of configuration (lesson of INC-0002). A deploy would boot the bots without them.
2. **No webhook is registered with Telegram for any of the three bots (new finding).** Telegram therefore delivers no update to `/channel/:bot/webhook`, and `/start` cannot reach the bot whatever its configuration. When, and whether, the webhook was ever registered for these tokens is **not known** from this check. Registering it needs `setWebhook` with the webhook secret, i.e. an operational step with a secret, which needs separate authorization and depends on INC-0002.

## What `200` on `/health` does and does not prove

It proves the process is up and the HTTP channel answers. It does not prove the webhook secret, the Mini App URL, the database or identity wiring, or that Telegram routes updates to the bot.

## To unblock (not done here; separate authorization needed)

1. Restore the bots' full configuration (INC-0002), with the setting names verified against the CLM-0431 baseline plus TLS keys.
2. Register each bot's webhook with Telegram using that secret, then re-run this precheck (it must show `url` set, pending 0, no last error).
3. Only then run BOT_E2E with test accounts.

Both steps must avoid a deploy while RISK-0063 is open, or be ordered so that the configuration is complete **before** any deploy.
