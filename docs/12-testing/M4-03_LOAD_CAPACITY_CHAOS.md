# M4-03: Load, Capacity, and Chaos Testing

**Status:** Ready for Gate
**Work Item:** M4-03
**Claim:** CLM-0342
**Date:** 2026-09-24

## Overview

Load, capacity, and chaos testing for the WASLA staging environment on Render. This artifact defines workloads, SLOs, chaos scenarios, and executable tests that verify system behavior under stress and failure conditions.

## SLOs (from Beta Charter)

| SLO | Target | Source |
|---|---|---|
| Availability | >= 99% | BETA_CHARTER.md |
| p95 Latency | <= 500ms | BETA_CHARTER.md |
| Error Rate | <= 5% | BETA_CHARTER.md |
| Service Uptime | 100% | BETA_CHARTER.md |

## Workload Definitions

| # | Workload | Service | VUs | Duration | RPS | Description |
|---|---|---|---|---|---|---|
| 1 | health-check-burst | identity | 10 | 30s | 20 | Burst of health checks to all services |
| 2 | geography-lookup | geography | 15 | 30s | 30 | Geography service under sustained load |
| 3 | search-products | search | 20 | 30s | 40 | Search service under load |
| 4 | orders-throughput | orders | 15 | 30s | 25 | Orders service throughput |
| 5 | observability-scrape | observability | 5 | 30s | 10 | Metrics endpoint under scrape load |

## Chaos Scenarios

### 1. Single Service Isolation

- **Target:** reputation service
- **Expected:** All other services respond with 200; isolated service times out
- **Verify:** identity, customers, geography, orders, search

### 2. Observability Failover

- **Target:** observability collector
- **Expected:** All business services respond normally; metrics unavailable
- **Verify:** identity, customers, orders, search

### 3. Partial Network Degradation

- **Target:** marketplace service
- **Expected:** p95 latency may increase but stays under 2000ms (stop metric)
- **Verify:** identity, customers, orders, search, marketplace

## Test Package

```
packages/load-testing/
├── package.json          — @wasla/load-testing
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── harness.ts         — SLO defs, workloads, chaos scenarios, load runner
    └── __tests__/
        └── load-capacity.test.ts  — 20 tests (skip without GOLDEN_STAGING_BASE)
```

## Running

```bash
# Set staging env vars
export GOLDEN_STAGING_BASE=https://wasla-identity.onrender.com
export GOLDEN_SERVICE_AUTH_KEY=...
export GOLDEN_SERVICE_AUTH_KID=...

# Run tests
pnpm --filter @wasla/load-testing test

# Run load tests directly
pnpm --filter @wasla/load-testing test:load

# Run chaos tests directly
pnpm --filter @wasla/load-testing test:chaos
```

Tests skip gracefully when `GOLDEN_STAGING_BASE` is not set.

## SLO Comparison

After running load tests, the results are compared against SLOs:

| Metric | SLO | How Measured |
|---|---|---|
| Availability | >= 99% | successful_requests / total_requests * 100 |
| p95 Latency | <= 500ms | 95th percentile of response durations |
| Error Rate | <= 5% | failed_requests / total_requests * 100 |
| Service Uptime | 100% | All 14 services responding to /health |

## Dependencies

- M2-08 (observability stack) — for metrics verification
- M4-02 (golden E2E journeys) — for staging URL conventions and harness patterns
- Render staging services (14 HTTP services + observability collector)

## Render Dashboard

- Observability: https://dashboard.render.com/web/srv-daqk61h42hec73a0koo0
- All 14 services: https://wasla-<service>.onrender.com
