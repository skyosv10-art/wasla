# ADR-059: Database failure containment — guarded pools, circuit breaker, DB-aware health

**Status:** Accepted · **Date:** 2026-10-02 · **Decider:** Program Owner (@skyosv10-art), recorded by agent:perplexity-computer (CLM-0438)
**Fixes:** RISK-0058 (moves to `mitigating`; closing needs the CI run of the merged code)
**Related:** [ADR-052](ADR-052-ha-capacity-dr.md) (unchanged, including the 5-minute RPO target) · [ADR-058](ADR-058-temporary-rpo-exception.md) (unchanged) · M6-18A (`@wasla/resilience`) · M6-18B (stays `Blocked`) · RISK-0059 (opened)
**Authority:** the owner's written decision of 2026-10-02 to open a separate claim for RISK-0058, under the written mandate "MASTER REPAIR & MERGE" of 2026-09-30.

تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE"

## Context

DR scenario 2 (CLM-0436, [evidence](../12-testing/ci-evidence/2026-10-02T153600Z-clm-0436-m6-18b-dr-scenario2-replacement/README.md)) measured three faults on the billing service as shipped:

1. When an idle connection dropped, the process **crashed** 17 ms later. pg-pool removes its idle `error` listener when a client is checked out, and no one else listened.
2. There was **no circuit breaker**. `@wasla/resilience` (M6-18A) was imported by no service.
3. `/health` answered `ok` throughout the outage. Under a network partition, calls hung until the client gave up (15 s).

Static scope: 17 services and 3 packages create `pg.Pool` instances with no error listener and no connect timeout.

## Decision

### 1. Every runtime pool is guarded

`packages/resilience/src/pg-guard.ts` provides two helpers that wrap each pool:

```
guardPgPool(new pg.Pool(withPgPoolDefaults({...})), { name })
```

**`withPgPoolDefaults`** adds the following defaults. It does not override a value the caller set, and it rejects an invalid environment value.

| setting | default | env override |
|---|---|---|
| `connectionTimeoutMillis` | 5 000 ms | `WASLA_PG_CONNECT_TIMEOUT_MS` |
| `query_timeout` (client side) | 15 000 ms | `WASLA_PG_QUERY_TIMEOUT_MS` |
| `keepAlive` | true | — |

**`guardPgPool`** adds:

- **Error listeners**:
  - one on the pool `error` event
  - one per-client `error` listener, attached via the pool `connect` event
  
  Both log a JSON line (`db_pool_error` / `db_client_error`) and never throw, so a dropped connection no longer ends the process.
- **A circuit breaker** wrapped around `pool.query` (promise and callback forms) and the promise form of `pool.connect`:
  - only connectivity errors count: `ECONN*`, `ETIMEDOUT`, SQLSTATE `08xxx` / `57P01-03`, and the pg timeout and "terminated" messages
  - SQL errors (constraint violations, syntax) never trip it
  - it opens after **5** consecutive failures, with a **30 s** cooldown
  - while it is open, calls are rejected without touching the database
- **`DbUnavailableError`**: code `DB_UNAVAILABLE`, `statusCode` 503. Connectivity errors are converted to it, and its `cause` is dropped so that no connection detail leaks.
  - The existing per-service error translators already map unknown errors to 503.
  - Delivery is the exception. It keeps `500 DELIVERY_INTERNAL_ERROR` by its documented rule: a non-idempotent `POST /store-orders` must not be told "retry". The breaker still makes that answer fast.
- **`probe()`**: a raw `SELECT 1` bounded at **2 s** and cached for **1 s**.
  - A successful probe resets the breaker. This probe-driven reset is the equivalent of a half-open trial; the breaker's own half-open trial after the cooldown also stays in place.
  - A cached "up" is dropped at the first connectivity failure after it, so health never repeats a stale `ok`. This was found and fixed during the re-run (E2).

### 2. Health reflects the database

`attachDatabaseHealth(app, { paths, service })` is registered before `listen()` in all 17 servers. It applies to GET/HEAD requests on each service's health paths:

- `/billing/health`
- `/delivery/health` and `/health`
- `/search/health` and `/health`
- `/partners/health`
- `/health` everywhere else

Behaviour:

- It probes every guarded pool in the process.
- If any pool is down, it answers **503** with `{status: "unavailable", service, database: [...]}` and the header `x-wasla-database: down`.
- Otherwise the route's own `ok` answer passes through, with `x-wasla-database: up`.
- In memory mode (no pool) nothing changes.

This 503 is an operational answer defined here. It is not added to the service OpenAPI contracts.

**Render implication (accepted):** Render's health check now sees 503 during a database outage and may restart instances. That is acceptable:

- a restart cannot make things worse when the database is down
- the guarded process recovers in about 1 s once the database returns
- the alternative is a false `ok`, which is what RISK-0058 is about

### 3. Not covered by the guard

- `migrate-cli` and `idempotency-sweep-cli`: one-shot processes that must fail loudly and exit, not degrade.
- Test harness pools: `packages/search-e2e` is guarded only for parity.

### 4. Unchanged

- ADR-052: the targets, including the 5-minute RPO.
- ADR-058 and RISK-0055 (`mitigating`).
- RISK-0056, production `ppixaauyqoykrogwdxtv`, Render configuration, and migrations.

No PITR, and no destructive test on production.

## Evidence and verdict

- Unit tests: `packages/resilience/src/__tests__/pg-guard.test.ts`.
- Composition test: `services/billing/src/__tests__/db-failure-containment.test.ts`, which runs a real `pg.Pool` against a refused port and a blackhole port.
- Scenario 2 re-run with a fail-closed verdict: `scripts/ops/m6-18b-dr/scenario2-db-unavailable.mts`, in job `scenario2` of `dr-replacement-restore.yml`.

Results: [CLM-0438 evidence](../12-testing/ci-evidence/2026-10-02T180000Z-clm-0438-risk-0058-db-failure-containment/README.md).

## Consequences

- RISK-0058 moves to `mitigating`. M6-18B stays `Blocked`: the RPO is only excepted (ADR-058), and the Render failover RTO is still unmeasured.
- Partners cannot boot under enforced service identity, regardless of the database. This is recorded as RISK-0059, to be fixed in its own auth PR.

## Amendment 2026-10-04 (CLM-0456 · RISK-0060): the probe bound covers connection acquisition

Measured: with verify-full TLS on Render, 12/12 idle-spaced readiness calls answered `probe_timeout` while the database was reachable (evidence: `docs/12-testing/ci-evidence/2026-10-04T003917Z-clm-0456-risk-0060-render-tls-activation-1/`). An idle pool opens a connection inside the probe, and a 2 s probe bound shorter than the pool's own 5 s connect bound turns a slow-but-successful connect into a false "down" that also counts against the breaker.

Decision: the default probe bound is now `connectionTimeoutMillis` of the pool + 2 s (7 s with the defaults). It is still finite, so a hanging database is still "down" in bounded time. An explicit `probeTimeoutMs` is kept as given. The 1 s cache, the reset-on-success and the stale-"up" invalidation are unchanged. The text above is left as it was; this section supersedes the "**2 s**" in the `probe()` bullet.

تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE".

## Amendment 2 2026-10-04 (CLM-0458): amendment 1 is withdrawn — the guard probe stays 2 s

Measured: DR scenario 2 on the amendment-1 guard (run 37168930267) failed **E3.health-503**. Under partition, health answered 503 in 5 007 ms against the < 3 s criterion. Amendment 1 had been merged without that run. The guard probe at 2 s had already passed under verify-full TLS on Render (CLM-0456 attempt 1: idle-spaced `/health` 9/9 200). The readiness failures came from delivery's own 1.5 s race, and that fix stays.

Decision: the default probe bound is 2 s again, independent of the pool's connect bound. Amendment 1 stays in this file as the record. This section supersedes it. `dr-replacement-restore.yml` now runs scenario 2 on every PR that touches the guard, so a change to these bounds is measured before merge.

تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE".

## Amendment 3 2026-10-04 (CLM-0459): probe default 2.5 s, from the live TLS measurement

Measured on `e75c08f` with verify-full on Render: 1 of 140 idle-spaced guarded `/health` calls answered a false 503 (geography, 2.34 s end to end). The 2 s probe sometimes falls just short of a cold TLS connect. Decision: the default probe bound is **2.5 s**. The binding requirement stays E3 (health 503 within 3 s under partition), and scenario 2 runs on the PR. The bound still excludes the connect bound (amendment 2). Evidence: `docs/12-testing/ci-evidence/2026-10-04T024500Z-clm-0459-risk-0060-guard-probe-tls-margin/`.

Recorded gap: the bots' `/health` (`packages/bot-runtime`) does not report the database. It goes to its own claim.

تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE".

## Amendment 4 2026-10-04 (CLM-0460): bots are covered; the probe tail is a region problem

- The three bots' `/health` now answers the ADR-059 503 while their guarded pools are down (`attachBotDatabaseHealth` in `packages/bot-runtime` launchers). This closes the "every service health path" gap for the bots. Scenario 2 E4 still excludes them.
- At 2.5 s the live false-503 tail remains (1/98, orders 2.80 s). The bound is **not** raised further: E3 (< 3 s) is the binding requirement. The tail comes from cold cross-region connects (Render `oregon`, DB `ap-south-1`), recorded as RISK-0061.

تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE".
