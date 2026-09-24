# M4-02 — Golden Cross-Service E2E Journeys

> **Work Item:** M4-02
> **Status:** Ready for Gate
> **Owner:** @uxxxu (agent: perplexity-computer)
> **Claim:** CLM-0340
> **Date:** 2026-09-24

---

## 1. Overview

This document maps the five golden journeys defined in [`BETA_CHARTER.md`](../16-progress/BETA_CHARTER.md) to their service dependencies, endpoints, and staging test artifacts. The executable tests live in `packages/golden-e2e/`.

## 2. Staging Environment

- **Services:** 14 HTTP services + 3 Telegram bots on Render Free tier
- **Database:** Supabase PostgreSQL (shared staging)
- **Observability:** Node.js collector at `https://wasla-observability.onrender.com`
- **Service URL convention:** `https://wasla-<service>.onrender.com`

## 3. Golden Journey Mapping

### Journey 1: Customer Order Journey

| Step | Service | Endpoint | Description |
|---|---|---|---|
| 1 | identity | POST /identity | Create customer identity from Telegram |
| 2 | customers | POST /customers | Create customer profile |
| 3 | customers | POST /customers/:id/order-requests | Create order request |
| 4 | orders | POST /orders | Create order in engine |
| 5 | delivery | POST /delivery | Delivery orchestration |
| 6 | dispatch | POST /dispatch | Wave-based driver assignment |
| 7 | drivers | PATCH /drivers/:id | Driver accepts assignment |
| 8 | orders | PATCH /orders/:id | Order state transitions |
| 9 | audit | GET /audit | Audit trail verification |

**Services:** identity, customers, orders, delivery, dispatch, drivers, audit

### Journey 2: Driver Assignment Journey

| Step | Service | Endpoint | Description |
|---|---|---|---|
| 1 | drivers | PATCH /drivers/:id | Driver goes online |
| 2 | matching | POST /matching | Driver-order matching |
| 3 | dispatch | POST /dispatch | Wave assignment |
| 4 | delivery | POST /delivery | Delivery orchestration |
| 5 | reputation | POST /reputation | Reputation update |

**Services:** drivers, matching, dispatch, delivery, reputation

### Journey 3: Marketplace Search Journey

| Step | Service | Endpoint | Description |
|---|---|---|---|
| 1 | marketplace | POST /stores | Partner lists store |
| 2 | marketplace | POST /products | Partner lists product |
| 3 | search | GET /search | Customer searches |
| 4 | orders | POST /orders | Customer orders from search |

**Services:** marketplace, search, orders

### Journey 4: Negotiation Journey

| Step | Service | Endpoint | Description |
|---|---|---|---|
| 1 | negotiations | POST /negotiations | Customer initiates negotiation |
| 2 | negotiations | PATCH /negotiations/:id | Partner counter-offers |
| 3 | negotiations | PATCH /negotiations/:id | Agreement reached |
| 4 | orders | POST /orders | Order created from negotiation |

**Services:** negotiations, orders

### Journey 5: Subscription Journey

| Step | Service | Endpoint | Description |
|---|---|---|---|
| 1 | subscriptions | POST /subscriptions | Customer subscribes |
| 2 | tick-scheduler | Cron | Renewal tick fires |
| 3 | subscriptions | PATCH /subscriptions/:id | Subscription renewed/cancelled |

**Services:** subscriptions, dispatch (tick-scheduler endpoint)

## 4. Test Artifacts

| Artifact | Location | Type |
|---|---|---|
| Golden journey tests | `packages/golden-e2e/src/__tests__/golden-journeys.golden.test.ts` | Vitest E2E |
| Staging harness | `packages/golden-e2e/src/harness.ts` | URL builder + HTTP client |
| This document | `docs/12-testing/M4-02_GOLDEN_JOURNEYS.md` | Journey mapping |

## 5. Running the Tests

```bash
# Set staging env vars
export GOLDEN_STAGING_BASE=1
export GOLDEN_SERVICE_AUTH_KEY=<service auth key>
export GOLDEN_SERVICE_AUTH_KID=<key id>

# Run golden journeys
pnpm --filter @wasla/golden-e2e test
```

Without `GOLDEN_STAGING_BASE`, all tests skip with a documented reason.

## 6. Current Status

| Journey | Status | Notes |
|---|---|---|
| 0: Staging Health | Runnable | All 14 services + observability verified |
| 1: Customer Order | Health check | Full journey requires authenticated service-to-service calls |
| 2: Driver Assignment | Health check | Full journey requires auth + seed data |
| 3: Marketplace Search | Health check | Full journey requires auth + seed data |
| 4: Negotiation | Health check | Full journey requires auth + seed data |
| 5: Subscription | Health check | Full journey requires auth + tick-scheduler |
| Audit Trail | Health check | Audit service reachable |
| Observability | Runnable | Metrics, targets, alerts, OTLP all verified |

## 7. Gate Criteria

M4-02 is **Ready for Gate** when:

- [x] Golden journey test package exists (`packages/golden-e2e/`)
- [x] Five golden journeys enumerated with service mappings
- [x] Staging health check tests runnable against deployed Render services
- [x] Observability coverage verified (metrics, targets, alerts, OTLP)
- [x] Documentation artifact exists (`docs/12-testing/M4-02_GOLDEN_JOURNEYS.md`)
- [ ] Full authenticated journeys (blocked on service auth key for automated tests)

## 8. Dependencies

| Dependency | Status |
|---|---|
| M4-01 (beta charter) | Completed |
| M1..M3 (all milestones) | Completed |
| M2-09 (staging parity) | Completed |
| M2-08 (observability) | Completed |
