# M6-18B DR Drill — Procedure and Targets

**Date:** 2026-09-28  
**Claim:** CLM-0381  
**ADR:** [ADR-052](../15-decisions/ADR-052-ha-capacity-dr.md)  
**Architecture:** [HA_CAPACITY_DR.md](../08-infrastructure/HA_CAPACITY_DR.md)

---

## 1. Overview

This document defines the DR drill procedure and RTO/RPO targets for the
WASLA platform. The drill verifies that services can recover from failures
within the defined targets using the resilience patterns from M6-18A and
the existing outbox replay mechanism.

**Status:** Procedure defined. Drill execution requires a live environment
with Render and Supabase access (not available in sandbox). The procedure
is designed to be executable by an operator with the listed credentials.

---

## 2. Drill Scenarios

| # | Scenario | Service | Tier | RTO Target | RPO Target |
|---|----------|---------|------|------------|------------|
| 1 | Service crash + restart | billing | T1 | 15 min | 5 min |
| 2 | Database unavailable | billing | T1 | 15 min | 5 min |
| 3 | Outbox replay after restart | billing | T1 | 15 min | 5 min |
| 4 | Circuit breaker isolation | orders → billing | T1 | 15 min | 5 min |
| 5 | Slow database query | orders | T1 | 15 min | 5 min |

---

## 3. Drill Procedure

### Scenario 1: Service Crash + Restart

**Prerequisites:** billing service deployed on Render, Supabase DB accessible.

**Steps:**
1. Stop the billing service via Render dashboard or API (`render restart <service-id>`)
2. Poll `GET /health` on the billing service URL — expect non-200 during downtime
3. Wait for Render auto-restart (expected: <30 seconds)
4. Poll `GET /health` — expect 200 after restart
5. Verify data integrity: query a recent invoice and confirm it exists

**Expected Results:**
- RTO: <15 minutes (Render auto-restart typically <30 seconds)
- RPO: 0 (no data loss — database is independent of service process)
- Health check: non-200 during downtime, 200 after restart

### Scenario 2: Database Unavailable

**Prerequisites:** billing service running, Supabase DB accessible.

**Steps:**
1. Simulate DB connection failure (e.g., set `DATABASE_URL` to invalid value, or block network)
2. Make 5 consecutive requests to billing service — all should fail
3. Verify circuit breaker trips to OPEN state (after 5 failures per M6-18A defaults)
4. Make additional requests — should be rejected immediately (before() returns false)
5. Restore DB connectivity
6. Wait for circuit breaker cooldown (30 seconds per M6-18A defaults)
7. Verify half-open probe succeeds and breaker closes

**Expected Results:**
- Circuit breaker trips after 5 consecutive failures
- Downstream services are protected from cascading failure
- Breaker recovers via half-open probe after cooldown

### Scenario 3: Outbox Replay After Restart

**Prerequisites:** billing service running, outbox table has pending events.

**Steps:**
1. Insert test events into `billing_outbox` table (or wait for natural events)
2. Stop the billing service
3. Restart the billing service
4. Verify relay loop starts and reads from last checkpoint
5. Verify pending outbox events are published
6. Verify consumed-event ledger is updated

**Expected Results:**
- RTO: <15 minutes (service restart + relay startup)
- RPO: 0 events lost (outbox + consumed-event ledger)
- All pending events delivered after restart

### Scenario 4: Circuit Breaker Isolation

**Prerequisites:** orders and billing services running, orders calls billing.

**Steps:**
1. Stop billing service (or make it return 500)
2. Make 5 consecutive requests from orders to billing — all should fail
3. Verify orders circuit breaker trips to OPEN
4. Make additional orders-to-billing calls — should be rejected immediately
5. Verify orders service continues serving other routes (not affected)
6. Restart billing service
7. Wait for cooldown, verify half-open probe succeeds, breaker closes

**Expected Results:**
- Cascading failure prevented
- Orders service remains available for non-billing routes
- Breaker recovers after billing is restored

### Scenario 5: Slow Database Query

**Prerequisites:** orders service running, Supabase DB accessible.

**Steps:**
1. Simulate slow DB query (e.g., add artificial delay, or use `pg_sleep`)
2. Make a request that triggers the slow query
3. Verify timeout fires at configured deadline (1 second default per M6-18A)
4. Verify retry with exponential backoff (500ms base, 2x per attempt)
5. If 2nd attempt succeeds, verify result is returned

**Expected Results:**
- Timeout fires within configured deadline
- Caller is unblocked (not waiting indefinitely)
- Retry recovers if the slowness is transient

---

## 4. Resilience Pattern Verification (Unit Tests)

The following unit tests from M6-18A verify the resilience patterns used
in the DR drill scenarios above:

| Test File | Tests | Scenarios |
|-----------|-------|-----------|
| `circuit-breaker.test.ts` | 7 | Trip threshold, reset, half-open transition |
| `bulkhead.test.ts` | 6 | Concurrency limit, queue, reject when full |
| `timeout.test.ts` | 6 | Resolve in time, timeout fire, error propagation |
| `retry.test.ts` | 6 | Retry recovery, max attempts, isRetryable |
| `chaos-scenarios.test.ts` | 10 | DB unavailable, DB slow, service unavailable, etc. |
| **Total** | **35** | All pass |

These tests verify that the resilience primitives work correctly in isolation.
The DR drill procedure above verifies their integration in a live environment.

---

## 5. Execution Plan

The DR drill procedure is designed to be executed by an operator with:
- Render dashboard/API access (to stop/restart services)
- Supabase dashboard access (to verify database state)
- Network access to service URLs (to make test requests)

**Execution status:** Not yet executed in a live environment. The procedure
is documented and ready for execution when a live environment is available.

**Update 2026-09-29 (CLM-0401) — first live execution:** see
[`ci-evidence/2026-09-29T130000Z-m6-18b-dr-drill-live/`](ci-evidence/2026-09-29T130000Z-m6-18b-dr-drill-live/README.md).
RTO met (0 s restart · 37.6 s outage); process RPO 0; DB RPO not met (no PITR/backups);
scenarios 2/3/5 not executed (domain schemas absent on the live DB; fault injection
requires owner decision). `billing` is not deployed on Render — `orders` drilled as T1.

---

## 6. Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| RTO/RPO drill procedure defined | ✅ | 5 scenarios with steps and expected results |
| RTO/RPO targets defined | ✅ | T1: 15min/5min, T2: 30min/15min, T3: 1h/1h |
| Architecture review | ✅ | HA_CAPACITY_DR.md + ADR-052 |
| Resilience patterns verified | ✅ | 35 unit tests (M6-18A) |
| Drill execution in live env | ⏳ Pending | Requires live Render + Supabase access |

**Note:** The drill procedure is fully defined and the resilience patterns
are verified by unit tests. Live drill execution requires environment access
that is not available in the sandbox. The procedure is ready for execution.

---

## 7. Scenario 2 and the replacement-project restore: executed (CLM-0436, 2026-10-02)

Evidence: [`ci-evidence/2026-10-02T153600Z-clm-0436-m6-18b-dr-scenario2-replacement/`](ci-evidence/2026-10-02T153600Z-clm-0436-m6-18b-dr-scenario2-replacement/README.md), run `37028089688`.

**Scenario 2: executed, FAIL against §3.**
- Warm drop: the billing process **exits 17 ms after the DB drops** (no `Pool` `'error'` listener).
- DB down: `503` on every call, with **no circuit breaker**. No service imports `@wasla/resilience`.
- Partition: calls **hang until the client timeout** (no `connectionTimeoutMillis`).
- `/health` says `ok` throughout.
- Recovery after the DB returns: ≤ 11 ms (for a process that survived).
- Recorded as RISK-0058.

**Replacement restore: PASS for `public`.**
- Production's stored artifact was restored into the replacement project `pvyuhjadrygqqdoczmnd`: 120/120 tables, 38/38 rows.
- Data RTO: 471.1 s. Billing on the replacement gave its first DB-backed answer after 2.6 s.
- auth, storage and vault have **0 rows at the source**: inventoried, not exercised.
- Render repoint: not measured.

Earlier sections are unchanged. Scenario 4 (`orders → billing` breaker) is subject to the same cause: no breaker is wired anywhere.

## 8. Scenario 2 re-run after the RISK-0058 fix (CLM-0438, 2026-10-02)

Evidence: [`ci-evidence/2026-10-02T180000Z-clm-0438-risk-0058-db-failure-containment/README.md`](ci-evidence/2026-10-02T180000Z-clm-0438-risk-0058-db-failure-containment/README.md). Decision: [ADR-059](../15-decisions/ADR-059-db-failure-containment.md). §7 stays as recorded, because it describes the code before the fix.

The harness now fails closed on the §3 / ADR-059 criteria. Local result: **PASS, 19/19 checks.**

- **Warm drop:** the process stays alive. Calls get 503 in ≤ 6 ms; health is 503.
- **DB down:** the breaker opens after 5 failures, and calls 6–10 are rejected in 1–3 ms without touching the DB. Health is 503.
- **Partition:** calls are bounded at about 5.0 s (connect timeout) and then 2 ms (breaker open). Health is 503 in 2.0 s.
- **Recovery after the DB returns:** about 1.0 s with health traffic, and 30.2 s with none (half-open after the cooldown).
- **Fleet:** 16/16 bootable services answer health 503 during the outage, none crash, and all are 200 again within 1.07 s.
- **Partners:** excluded with the reason recorded (RISK-0059: it does not boot under enforced service identity).

The CI verdict is recorded in the evidence README. **M6-18B stays `Blocked`:** the RPO is excepted only by ADR-058, and the failover RTO including Render is unmeasured.

