# ADR-059 · DR scenario 2 on the CLM-0456 guard (CLM-0458) · **FAIL, then corrected**

| | |
|---|---|
| **Why this run exists** | CLM-0456 (PR #605, `0eec83e`) changed the guard's default probe bound from 2 s to `connectionTimeoutMillis + 2 s`. Scenario 2 never ran against that change: `dr-replacement-restore.yml` re-ran it on pushes to two named old claim branches only. CLM-0458 adds a `pull_request` trigger for the guard, the harness and the workflow. The `replacement` job, which holds secrets, is excluded on PRs. |
| **Run** | [37168930267](https://github.com/skyosv10-art/wasla/actions/runs/37168930267) · `pull_request` · code = `main` `372bbfe` (+ the trigger change only) |

## Verdict on the CLM-0456 guard: FAIL (1 of 19 checks)

| Check | Result |
|---|---|
| E1 warm drop (alive, no hang, 503, health 503, recovery) | PASS 5/5. Recovery 1 012 / 1 015 ms |
| E2 cold refuse (503, breaker fast, health 503, half-open, alive) | PASS 5/5. Cooldown recovery 30 118 ms |
| E3.bounded / breaker-fast / recovers / alive | PASS 4/4. Calls 5 011/5 004/5 007/5 004 ms, then 2/1/1 ms |
| **E3.health-503** | **FAIL: health during the partition answered 503 in 5 007 ms (criterion < 3 s)** |
| E4 fleet (17/17 started, alive, health 503, recovers ≤ 1 045 ms) | PASS 4/4 |

## Why

Under a partition, a probe that waits for the pool's connect bound reports "down" only when that bound expires (5 s). The 2 s bound in ADR-059 exists so that health tells the truth within 3 s.

## Why the 2 s bound is still safe under TLS (measured, CLM-0456 attempt 1)

- Attempt 1 ran the **2 s guard** with verify-full on Render. Idle-spaced `/health` (which runs the guard probe on every call) was 9/9 200 on orders, identity and marketplace, 15 s apart.
- What failed in attempt 1 was **delivery's own** readiness race (1.5 s, `readiness-probe.ts`). That fix (connect bound + 1.5 s, delivery only) is kept: no scenario 2 criterion covers `/delivery/ready`, and E4 passed with it.

## Correction (CLM-0458)

- Guard default probe bound back to `PG_GUARD_DEFAULTS.probeTimeoutMs` (2 s); `probeBoundMs` removed.
- New unit test: a hanging DB on a pool with a 5 s connect bound is "down" in < 3 s. Mutation check: a +5 s default fails 2 tests.
- ADR-059 amendment 1 is superseded by amendment 2, by addition.
- The PR re-runs scenario 2. After merge and deploy, the idle-spaced `/health` acceptance under TLS is repeated on all 17 services.

تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE".
