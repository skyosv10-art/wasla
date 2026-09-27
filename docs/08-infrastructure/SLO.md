# WASLA Service Level Objectives (SLOs)

**Last Updated:** 2026-09-28  
**Authority:** M6-18A (CLM-0380)  
**ADR:** [ADR-051](../15-decisions/ADR-051-resilience-patterns.md)

---

## 1. Overview

This document defines the Service Level Objectives (SLOs) for all WASLA
microservices. SLOs are the measurable targets that govern availability,
latency, and reliability. They are derived from the resilience patterns
implemented in `@wasla/resilience` (circuit breaker, bulkhead, timeout,
retry).

### Terminology

- **SLI** (Service Level Indicator): a measured metric (e.g. error rate).
- **SLO** (Service Level Objective): a target for an SLI over a window.
- **Error Budget:** the allowed failure percentage before the SLO is breached.

---

## 2. Service Tiers

Services are classified into tiers by criticality:

| Tier | Description | Examples |
|------|-------------|----------|
| T1 | Critical path — order creation, payment, dispatch | orders, billing, dispatch |
| T2 | Core business — catalog, matching, delivery | marketplace, matching, delivery |
| T3 | Supporting — search, reputation, notifications | search, reputation, notifications |

---

## 3. SLOs

### 3.1 Availability

| Tier | SLO | Target | Window |
|------|-----|--------|--------|
| T1 | Availability (non-5xx responses) | 99.9% | 30 days |
| T2 | Availability (non-5xx responses) | 99.5% | 30 days |
| T3 | Availability (non-5xx responses) | 99.0% | 30 days |

### 3.2 Latency (p99)

| Tier | Endpoint | p99 Target |
|------|----------|------------|
| T1 | Order creation | 500ms |
| T1 | Payment processing | 2s |
| T1 | Dispatch assignment | 1s |
| T2 | Product search | 200ms |
| T2 | Driver matching | 1s |
| T3 | Notification delivery | 5s |

### 3.3 Error Budgets

| Tier | Monthly Error Budget | Allowed failures (per 100k requests) |
|------|---------------------|--------------------------------------|
| T1 | 0.1% | 100 |
| T2 | 0.5% | 500 |
| T3 | 1.0% | 1,000 |

When error budget is consumed at >2x the burn rate, on-call must be paged.

---

## 4. Resilience Controls

The following controls from `@wasla/resilience` enforce the SLOs:

| Control | Package | Purpose |
|---------|---------|---------|
| Circuit Breaker | `createCircuitBreaker` | Prevents cascading failures when a downstream is unhealthy |
| Bulkhead | `createBulkhead` | Limits concurrent in-flight operations per route |
| Timeout | `withTimeout` | Enforces latency deadlines on all outbound calls |
| Retry | `withRetry` | Recovers from transient failures with exponential backoff + jitter |

### 4.1 Recommended Defaults

```typescript
import { createCircuitBreaker, createBulkhead, withTimeout, withRetry } from "@wasla/resilience";

// T1 service defaults
const breaker = createCircuitBreaker({
  failureThreshold: 5,      // trip after 5 consecutive failures
  cooldownMs: 30_000,        // 30s before half-open probe
});

const bulkhead = createBulkhead({
  maxConcurrent: 20,         // max 20 concurrent operations
  maxQueue: 10,              // queue 10 before rejecting
});

// Apply timeout to all DB calls
const result = await withTimeout(dbQuery(), { timeoutMs: 1_000 });

// Retry transient failures
const data = await withRetry(fetchData, {
  maxAttempts: 3,
  baseDelayMs: 500,
});
```

---

## 5. Failure Scenarios Covered

The chaos/failure tests in `packages/resilience/src/__tests__/chaos-scenarios.test.ts`
verify behavior under these scenarios:

| Scenario | Control | Expected Behavior |
|----------|---------|-------------------|
| DB unavailable | Circuit Breaker | Trips after threshold, rejects further calls |
| DB slow | Timeout | Fires TimeoutError after deadline |
| Service unavailable | Retry | Retries with backoff, recovers on transient |
| Network timeout | Timeout | Fires TimeoutError |
| Duplicate request | Bulkhead | Rejects when concurrent limit reached |
| Process restart | Circuit Breaker | Can be reset to closed state |
| Partial success | Circuit Breaker | Does not trip on intermittent failures |
| Node failure | Circuit Breaker | Recovers via half-open probe after cooldown |

---

## 6. Monitoring

SLO compliance is monitored via the existing Prometheus metrics in
`@wasla/observability`:

- `http_requests_total` — used for availability SLI
- `http_request_duration_seconds` — used for latency SLI
- `http_requests_in_progress` — used for bulkhead saturation

Alerts should be configured when error budget burn rate exceeds 2x.
