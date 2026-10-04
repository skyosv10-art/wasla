# CLM-0460 · Bot `/health` reports the database · live TLS acceptance on the 2.5 s probe · RISK-0061 (cross-region)

| | |
|---|---|
| **Code measured live** | `main` `f53e0a7` (CLM-0459, PR [#608](https://github.com/skyosv10-art/wasla/pull/608), guard probe 2.5 s). Main CI run 37173621444 and Render deploy run 37173621434 green. Scenario 2 on the PR: [37172097263](https://github.com/skyosv10-art/wasla/actions/runs/37172097263) **PASS 19/19**, E3 health 503 in **2 503 ms** (< 3 s) |
| **TLS** | unchanged since run 37167859053: 17/17 verify-full + pinned CA |

## 1. Live acceptance on `f53e0a7` (idle-spaced, 20 s between rounds, operator sandbox)

| | 2 s probe (`e75c08f`, CLM-0459) | **2.5 s probe (`f53e0a7`)** |
|---|---|---|
| Guarded `/health` calls | 140 | 98 |
| False 503 (`probe_timeout`, breaker closed) | 1 (geography, 2.34 s end to end) | **1** (orders, 2.80 s end to end) |
| End-to-end median / p95 / max | 1.94 s / — / 2.34 s | 1.91 s / 2.19 s / 2.80 s |
| `/delivery/ready` | 3/3 200 | 7/7 200 (max 2.98 s) |

So 2.5 s did not remove the tail. A cold connect with verify-full sometimes takes longer than 2.5 s. The probe bound cannot grow further without breaking ADR-059 E3 (< 3 s under partition), so the bound is **not** changed again. The cause is recorded as RISK-0061.

Impact of one false miss, measured: one 503 on health. The breaker stays `closed` (5 consecutive failures are needed, and the next success resets it), and query traffic is not refused. Render has no `healthCheckPath` on these services, so there is no restart either.

## 2. RISK-0061: compute and database are on different continents

- Render API: 21 services in `oregon` (3 without a region: static/cron).
- Production DB pooler: `aws-0-ap-south-1` (Mumbai).
- So every cold connect (TCP + TLS + startup/SCRAM, several round trips) crosses the Pacific. The sandbox, against the Seoul test pooler, measured a median of 954 ms in clear and 1 293 ms with verify-full. From Render to Mumbai, the end-to-end health tail exceeds 2.5 s.
- Moving one side (Render region, or a Supabase project in the US) is an infrastructure decision with DR and data-residency implications. It is not taken by this claim.
- Open, `sev:medium`.

## 3. Bots' `/health` now reports the database (ADR-059 gap)

- Before: `packages/bot-runtime` never attached `attachDatabaseHealth`. The three bots hold guarded pools (`channel-postgres`; the customer bot also the customers pool) but answered `200 {"status":"ok"}` with no `x-wasla-database`. Measured live on all three bots.
- Fix: `attachBotDatabaseHealth(app, bot)` in both launchers (`startBot`, `runBotApp`), in the registry form, as the services attach it in their `server.ts`. In memory mode nothing changes. The 503 is the ADR-059 operational answer and is not added to the OpenAPI contract (ADR-059 line 74).
- Test `bot-database-health.test.ts` goes through the real `runBotApp`: pool down → 503 `down`, `service: customer-bot`; pool up → 200 `up`, body unchanged. Mutation check: without the attach in `runBotApp`, the test fails. bot-runtime 208/208.
- Not claimed: scenario 2 E4 still starts the 17 services and none of the bots. Adding them needs their Telegram and service-identity configuration in the harness.

تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE".
