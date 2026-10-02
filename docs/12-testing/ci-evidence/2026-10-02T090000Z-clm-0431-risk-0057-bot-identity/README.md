# RISK-0057 — `IDENTITY_SERVICE_URL` on the 3 bots (CLM-0431 · M0-51)

**Date:** 2026-10-02 08:54–08:58 UTC · **Claim:** CLM-0431 (registered and pushed before the change) · code on Render: `4ed351d` (unchanged).
تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE"، وتفويض المالك بإصلاح RISK-0057 (2026-10-02).

## Value and its documented source (not guessed)
`IDENTITY_SERVICE_URL = https://wasla-identity.onrender.com`. Sources, all of which agree:
1. Live Render config of `wasla-customers` and `wasla-geography`: both already call identity with exactly this value. `RENDER_SERVICE_INVENTORY.md` §Inter-service Dependencies says "customers → identity · geography → identity · via public URLs".
2. Render API `serviceDetails.url` of `wasla-identity` (srv-daodb63m8hqs73e8a900): the same URL.
3. Repo records: `TASK_LOG.md` line 1539 (`wasla-identity (srv-daodb63m8hqs73e8a900) → https://wasla-identity.onrender.com`), `M4-04_INCIDENT_ONCALL_ROLLBACK.md`, `scripts/m3-07-health-scan.py`.

Preconditions in code (`packages/bot-runtime/src/config.ts`): with `IDENTITY_SERVICE_URL` set, boot **requires** `WASLA_SERVICE_AUTH_KEYS` and `WASLA_SERVICE_AUTH_ACTIVE_KID`. All 3 bots already had both (variable names checked). `authz-policy/src/grants.ts` grants `customer-bot`, `driver-bot` and `partner-bot` their identity calls.

## Change (only this key)
`PUT /v1/services/{id}/env-vars/IDENTITY_SERVICE_URL` per bot, then a deploy pinned to the same live commit. For each bot, sha256 hashes of every other variable's value were compared before and after the PUT (hashes only, `apply.json`):

| bot | env before → after | added | removed | other values changed | deploy | status |
|---|---|---|---|---|---|---|
| wasla-customer-bot | 10 → 11 | IDENTITY_SERVICE_URL | — | none | dep-davn3pe7bikc73en8c4g | live 08:57:57 |
| wasla-driver-bot | 9 → 10 | IDENTITY_SERVICE_URL | — | none | dep-davn3pm7bikc73en8cqg | live 08:57:57 |
| wasla-partner-bot | 9 → 10 | IDENTITY_SERVICE_URL | — | none | dep-davn3prncjis73f16ce0 | live 08:58:01 |

## Before / after (`before.json` 08:54:17Z · `after.json` 08:58:37Z)
| bot | before /health | after /health | live commit |
|---|---|---|---|
| wasla-customer-bot | 200 `{"status":"degraded","channel":"telegram"}` | 200 `{"status":"ok","channel":"telegram"}` | 4ed351d → 4ed351d |
| wasla-driver-bot | 200 `degraded` | 200 `ok` | 4ed351d → 4ed351d |
| wasla-partner-bot | 200 `degraded` | 200 `ok` | 4ed351d → 4ed351d |

- **Readiness:** the bots document no readiness route. `bot-runtime/http/app.ts` exposes only `GET /health` (liveness, `ok | degraded`).
- **Boot logs** (Render, after 08:57:30Z): `Server listening` with no error. The only 401s are Render's own unauthenticated port probes (`HEAD /`, `GET /`, reason `missing_credentials`), which are expected.
- `wasla-identity /health` was 200 at the time of the change.

## Proven / not proven
- **Proven:** the variable is set from a documented source on all 3 bots; no other variable changed; 3/3 redeployed on the same commit; 3/3 `/health` = `ok`, so `degraded` is gone.
- **Not proven:** an end-to-end `/start` from a real Telegram user (identity resolve → session). That needs a real chat and was not performed.
