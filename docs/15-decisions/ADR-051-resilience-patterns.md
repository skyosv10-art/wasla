# ADR-051: Resilience Patterns Package

**Status:** Accepted  
**Date:** 2026-09-28  
**Authority:** M6-18A (CLM-0380)  
**Supersedes:** None

---

## Context

The WASLA platform operates 20+ microservices that depend on shared
infrastructure (Postgres, Supabase, Telegram Bot API, Render). When any
downstream dependency fails or slows down, cascading failures can propagate
across services. Prior to M6-18A, only the channel-core package had a
retry policy with exponential backoff and jitter. There was no:

- Circuit breaker pattern
- Bulkhead / bounded concurrency
- Timeout middleware
- SLO definitions
- Chaos/failure tests

The LAUNCH_EXECUTION_BOARD.md acceptance criteria for M6-18A requires:
chaos/load evidence, timeouts, retries, exponential backoff, jitter, circuit
breakers, bounded concurrency, bulkheads, dependency failure behavior,
outbox recovery, and duplicate event tolerance.

## Decision

Create a dedicated `@wasla/resilience` package that provides four
composable resilience primitives:

1. **CircuitBreaker** — state machine (closed → open → half_open → closed)
   that trips after N consecutive failures and rejects calls until a
   cooldown period has elapsed. A half-open probe allows one trial call.

2. **Bulkhead** — bounded concurrency limiter that rejects (or queues)
   operations when the in-flight count exceeds a threshold. Prevents
   resource exhaustion on one route from starving others.

3. **withTimeout** — wraps a promise with a deadline using Promise.race.
   The timer is unref'd so it does not keep the process alive. The
   underlying operation is not cancelled (JavaScript limitation), but
   the caller is unblocked.

4. **withRetry** — generic retry with exponential backoff and optional
   jitter. Extracted as a general-purpose utility alongside the existing
   channel-core retry policy (which remains authoritative for delivery).

### Design Principles

- **Pure functions**: The circuit breaker is a pure decision function over
  an injected clock — no timers, no background work. Testable without
  real time.
- **Composable**: The primitives can be combined (circuit breaker + timeout
  + retry) in a single pipeline.
- **No dependencies**: The package has zero runtime dependencies. It works
  with any Promise-based runtime.
- **SLO-driven**: Defaults are derived from the SLO targets in
  `docs/08-infrastructure/SLO.md`.

### SLOs

Service Level Objectives are defined in `docs/08-infrastructure/SLO.md`
with three tiers (T1/T2/T3) and targets for availability, latency, and
error budgets.

## Consequences

- All services can now import resilience patterns from a single package.
- The chaos/failure tests in `chaos-scenarios.test.ts` serve as evidence
  that the patterns work under simulated failure conditions.
- Services that adopt the patterns must wire them into their HTTP handlers
  (a follow-up task per service).
- The circuit breaker state is in-memory per process — if a service runs
  multiple instances, each has its own breaker. A shared breaker (Redis)
  is a future enhancement if needed.
