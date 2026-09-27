# WASLA Observability Operating Model

**Last Updated:** 2026-09-28  
**Authority:** M6-18C (CLM-0382)  
**ADR:** [ADR-053](../15-decisions/ADR-053-observability-operating-model.md)  
**Related:** [SLO](SLO.md), [HA/DR](HA_CAPACITY_DR.md), [Resilience](../15-decisions/ADR-051-resilience-patterns.md)

---

## 1. Overview

This document defines the observability operating model for WASLA: alert
rules, runbooks, on-call procedures, and escalation paths. It builds on the
Prometheus metrics and OpenTelemetry tracing from `@wasla/observability`
and the SLOs defined in M6-18A.

### Observability Stack

| Component | Package | Status |
|-----------|---------|--------|
| Prometheus metrics | `@wasla/observability` | Implemented (request count, latency, in-progress) |
| /metrics endpoint | `@wasla/observability` | Implemented (Prometheus text format) |
| OpenTelemetry tracing | `@wasla/observability` | Opt-in (OTEL_EXPORTER_OTLP_ENDPOINT) |
| Health checks | Per-service `/health` | Implemented (all 16 services) |
| Alert rules | This document | Defined (pending Prometheus deployment) |
| Runbooks | This document | Defined |

---

## 2. Alert Rules

### Alert Naming Convention

`<severity>_<service>_<condition>`

Example: `critical_billing_error_rate_high`

### Alert Definitions

#### Error Rate Alerts

| Alert | Severity | Condition | For | Action |
|-------|----------|-----------|-----|--------|
| `critical_t1_error_rate` | critical | 5xx rate > 1% for 5 min | T1 services | Page on-call |
| `warning_t1_error_rate` | warning | 5xx rate > 0.5% for 10 min | T1 services | Notify on-call |
| `critical_t2_error_rate` | critical | 5xx rate > 5% for 10 min | T2 services | Page on-call |
| `warning_t2_error_rate` | warning | 5xx rate > 2% for 15 min | T2 services | Notify on-call |

#### Latency Alerts

| Alert | Severity | Condition | For | Action |
|-------|----------|-----------|-----|--------|
| `critical_t1_latency` | critical | p99 > 500ms for 5 min | T1 services | Page on-call |
| `warning_t1_latency` | warning | p99 > 300ms for 10 min | T1 services | Notify on-call |
| `critical_t2_latency` | critical | p99 > 2s for 10 min | T2 services | Page on-call |

#### Availability Alerts

| Alert | Severity | Condition | For | Action |
|-------|----------|-----------|-----|--------|
| `critical_service_down` | critical | `/health` non-200 for 2 min | Any service | Page on-call |
| `warning_service_degraded` | warning | `/health` 200 but error rate > 3% | Any service | Notify on-call |

#### Resource Alerts

| Alert | Severity | Condition | For | Action |
|-------|----------|-----------|-----|--------|
| `critical_db_connections` | critical | DB connections > 80% of limit | Supabase | Page on-call |
| `warning_db_slow` | warning | Avg query time > 1s for 5 min | Supabase | Notify on-call |

#### SLO Burn Rate Alerts

| Alert | Severity | Condition | Action |
|-------|----------|-----------|--------|
| `slo_burn_rate_2x` | warning | Error budget burn > 2x normal | Notify on-call |
| `slo_burn_rate_10x` | critical | Error budget burn > 10x normal | Page on-call |

### Prometheus Alert Rules (YAML)

```yaml
groups:
  - name: wasla_slo
    rules:
      - alert: critical_t1_error_rate
        expr: |
          sum(rate(http_requests_total{service=~"orders|billing|dispatch|identity",status=~"5.."}[5m]))
          /
          sum(rate(http_requests_total{service=~"orders|billing|dispatch|identity"}[5m]))
          > 0.01
        for: 5m
        labels:
          severity: critical
          tier: "1"
        annotations:
          summary: "T1 service error rate above 1%"
          description: "{{ $labels.service }} error rate is {{ $value | humanizePercentage }}"
          runbook: "docs/08-infrastructure/runbooks/error-rate.md"

      - alert: critical_service_down
        expr: up{job="wasla"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Service {{ $labels.instance }} is down"
          runbook: "docs/08-infrastructure/runbooks/service-down.md"

      - alert: critical_t1_latency
        expr: |
          histogram_quantile(0.99,
            rate(http_request_duration_seconds_bucket{service=~"orders|billing|dispatch|identity"}[5m]))
          > 0.5
        for: 5m
        labels:
          severity: critical
          tier: "1"
        annotations:
          summary: "T1 service p99 latency above 500ms"
          runbook: "docs/08-infrastructure/runbooks/latency.md"
```

---

## 3. Runbooks

### RB-01: Service Down

**Symptoms:** `critical_service_down` alert fires. `/health` returns non-200.  
**Impact:** Service unavailable for all routes.  
**Steps:**
1. Check Render dashboard for service status
2. If crashed: wait for auto-restart (typically <30s)
3. If not restarting: manually restart via Render dashboard or `render restart <id>`
4. Check logs for crash cause
5. If database-related: check Supabase dashboard for DB status
6. If cascading: verify circuit breakers are tripping (M6-18A)
7. Post-incident: file incident report, update runbook if needed

### RB-02: High Error Rate

**Symptoms:** `critical_t1_error_rate` or `warning_t1_error_rate` fires.  
**Impact:** User-facing errors on affected service.  
**Steps:**
1. Check `/metrics` for error breakdown by route and status code
2. Check logs for error messages and stack traces
3. If downstream failure: verify circuit breaker state
4. If DB issue: check Supabase dashboard for slow queries or connection limits
5. If deploy-related: consider rollback
6. Post-incident: file incident report

### RB-03: High Latency

**Symptoms:** `critical_t1_latency` fires. p99 above SLO target.  
**Impact:** Slow responses for users.  
**Steps:**
1. Check `/metrics` for latency breakdown by route
2. Check if timeout is firing (M6-18A `withTimeout`)
3. Check DB query performance (Supabase dashboard)
4. Check if bulkhead is rejecting requests (M6-18A `createBulkhead`)
5. If resource exhaustion: consider scaling up (Render Starter tier)
6. Post-incident: file incident report

### RB-04: Database Issues

**Symptoms:** `critical_db_connections` or `warning_db_slow` fires.  
**Impact:** All services depending on the database are affected.  
**Steps:**
1. Check Supabase dashboard for connection pool status
2. If connections exhausted: check for connection leaks in service code
3. If slow queries: identify and optimize the query
4. If DB is down: follow DR procedure (M6-18B, HA_CAPACITY_DR.md §6)
5. If circuit breakers tripping: verify they recover after DB is restored
6. Post-incident: file incident report

### RB-05: SLO Burn Rate

**Symptoms:** `slo_burn_rate_2x` or `slo_burn_rate_10x` fires.  
**Impact:** Error budget being consumed faster than allowed.  
**Steps:**
1. Identify which SLO is burning (check alert labels)
2. Determine root cause from error/latency metrics
3. If burn rate > 10x: freeze deployments until resolved
4. Follow relevant runbook (RB-02 or RB-03)
5. Post-incident: review SLO targets if burn rate is consistently high

---

## 4. On-Call Procedures

### On-Call Rotation

| Role | Schedule | Contact |
|------|----------|---------|
| Primary on-call | Weekly rotation | Telegram bot (driver) |
| Secondary on-call | Weekly rotation | Telegram bot (rider) |
| Owner escalation | When primary unavailable | Telegram bot (partner) |

### Escalation Path

1. Alert fires → Prometheus → Alertmanager → Telegram notification
2. Primary on-call acknowledges within 5 minutes
3. If not acknowledged in 5 min → Secondary on-call paged
4. If not acknowledged in 15 min → Owner escalated
5. If critical and unresolved in 30 min → Declare incident

### Incident Severity

| Severity | Definition | Response |
|----------|------------|----------|
| SEV-1 | T1 service down, data loss | Page all hands, war room |
| SEV-2 | T1 degraded, T2 down | Page on-call, notify team |
| SEV-3 | T2 degraded, T3 down | Notify on-call during business hours |
| SEV-4 | Minor issues, cosmetic | Ticket only |

---

## 5. Dashboards

### Service Health Dashboard

Metrics displayed per service:
- Request rate (req/s)
- Error rate (%)
- p50, p95, p99 latency
- In-progress requests
- Circuit breaker state (when available)
- Bulkhead utilization (when available)

### SLO Dashboard

- Error budget burn rate per tier
- SLO compliance (30-day window)
- Availability percentage
- Latency percentiles vs targets

---

## 6. Live-Fire Evidence

**Status:** Procedure defined. Live-fire testing requires a deployed
Prometheus + Alertmanager stack, which is not available in the sandbox.

The alert rules and runbooks are defined as Prometheus-compatible YAML
and can be deployed when a monitoring infrastructure is provisioned.

### Verification Steps (for live-fire)

1. Deploy Prometheus + Alertmanager (e.g., on Render or external)
2. Configure scrape targets for all 16 services' `/metrics` endpoints
3. Load alert rules from this document
4. Simulate each alert condition:
   - Stop a service → `critical_service_down`
   - Inject errors → `critical_t1_error_rate`
   - Add latency → `critical_t1_latency`
5. Verify Alertmanager routes to Telegram
6. Verify runbook steps resolve the issue
