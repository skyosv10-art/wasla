# RISK-0060 / ADR-059 · Guard probe margin under live TLS (CLM-0459)

| | |
|---|---|
| **Code measured** | `main` `e75c08f` (CLM-0458, PR [#607](https://github.com/skyosv10-art/wasla/pull/607)): guard probe 2 s, delivery readiness = connect + 1.5 s. Main CI run 37171267625 and Render deploy run 37171267553 green. TLS variables unchanged since run 37167859053 (17/17 verify-full + pinned CA, hashes re-checked) |
| **Scenario 2 on CLM-0458 (PR run)** | [37169219108](https://github.com/skyosv10-art/wasla/actions/runs/37169219108): **PASS 19/19**. E3 health 503 in **2 004 ms**; calls 5 013/5 005/5 008/5 008, then 2/1/1 ms |

## Live acceptance on `e75c08f` (operator sandbox, idle-spaced, 20 s between rounds)

| Batch | Guarded `/health` calls | Not 200 |
|---|---|---|
| A: 3 rounds × 14 guarded services (+ 3 bots, + `/delivery/ready`) | 42 guarded | **1**: `wasla-geography` 503 `x-wasla-database: down` in 2.34 s end to end (round 0) |
| B: 7 rounds × 14 guarded services | 98 | 0 |
| `/delivery/ready` (3 calls) | — | 0. All 200, 2.79–2.96 s |

**Measured false-down rate of the 2 s guard probe under verify-full TLS: 1/140 (0.7 %).** End-to-end `/health` median 1.94 s, max 2.34 s. The sandbox → Oregon round trip is about 0.3 s (the bots answer in 0.16–0.34 s).

## Decision (ADR-059 amendment 3)

- The probe default moves from 2 s to **2.5 s**. The requirement in ADR-059 is E3: health answers 503 within 3 s under partition, and 2.5 s keeps it. The CLM-0458 lesson stays: the probe bound must never include the 5 s connect bound.
- A single probe miss does not open the breaker (5 consecutive failures are needed, and the next success resets it), so query traffic was not affected. The cost was a false "down" on health.
- The PR re-runs scenario 2 (CLM-0458 trigger). After deploy, the idle-spaced acceptance is repeated.

## Discovery recorded (not fixed here)

The three bots (`customer-bot`, `driver-bot`, `partner-bot`) use guarded pools (`channel-postgres`), but `packages/bot-runtime` `/health` does not attach `attachDatabaseHealth`. They answer `{"status":"ok"}` without `x-wasla-database`. Scenario 2 E4 covers 17 services, none of them bots. ADR-059's "every service health path answers 503" therefore does not hold for the bots. This goes to its own claim next.

تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE".
