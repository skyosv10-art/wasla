# M6-18C Observability Operating Model — Gate Evidence

**Date:** 2026-09-28  
**Claim:** CLM-0382  
**ADR:** [ADR-053](../15-decisions/ADR-053-observability-operating-model.md)  
**Operating Model:** [OBSERVABILITY_OPERATING_MODEL.md](../08-infrastructure/OBSERVABILITY_OPERATING_MODEL.md)

---

## 1. Implementation Evidence

### Documents Created

| Document | Purpose |
|----------|---------|
| `docs/08-infrastructure/OBSERVABILITY_OPERATING_MODEL.md` | Alert rules, runbooks, on-call, dashboards |
| `docs/15-decisions/ADR-053-observability-operating-model.md` | Architecture decision |

### Existing Observability Stack (from prior milestones)

| Component | Package | Status |
|-----------|---------|--------|
| Prometheus metrics | `@wasla/observability` (metrics.ts) | Implemented |
| /metrics endpoint | `@wasla/observability` (middleware.ts) | Implemented |
| OpenTelemetry tracing | `@wasla/observability` (tracing.ts) | Opt-in |
| Health checks | Per-service `/health` | Implemented (16 services) |

---

## 2. Acceptance Criteria Checklist

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Alert rules | ✅ | 10 alert rules defined (error rate, latency, availability, resource, SLO burn) |
| Runbooks | ✅ | 5 runbooks (RB-01 through RB-05) |
| On-call procedures | ✅ | Weekly rotation, escalation path, severity levels |
| Dashboards | ✅ | Service health + SLO dashboard defined |
| Live-fire evidence | ⏳ Pending | Requires deployed Prometheus + Alertmanager |

---

## 3. Alert Rules Summary

| Alert | Severity | Metric | Threshold |
|-------|----------|--------|-----------|
| critical_t1_error_rate | critical | 5xx rate | > 1% for 5 min |
| warning_t1_error_rate | warning | 5xx rate | > 0.5% for 10 min |
| critical_t2_error_rate | critical | 5xx rate | > 5% for 10 min |
| critical_t1_latency | critical | p99 latency | > 500ms for 5 min |
| critical_t2_latency | critical | p99 latency | > 2s for 10 min |
| critical_service_down | critical | health check | non-200 for 2 min |
| critical_db_connections | critical | DB connections | > 80% of limit |
| warning_db_slow | warning | avg query time | > 1s for 5 min |
| slo_burn_rate_2x | warning | error budget | > 2x normal |
| slo_burn_rate_10x | critical | error budget | > 10x normal |

---

## 4. Runbooks Summary

| Runbook | Scenario | Key Steps |
|---------|----------|-----------|
| RB-01 | Service down | Check Render, auto-restart, logs, DB status |
| RB-02 | High error rate | Check /metrics, logs, circuit breaker, DB |
| RB-03 | High latency | Check /metrics, timeout, DB, bulkhead, scaling |
| RB-04 | Database issues | Check Supabase, connections, slow queries, DR |
| RB-05 | SLO burn rate | Identify SLO, root cause, freeze deploys if 10x |

---

## 5. Live-Fire Plan

**Status:** Alert rules and runbooks are defined. Live-fire testing requires
a deployed Prometheus + Alertmanager stack.

### Prerequisites for Live-Fire

1. Deploy Prometheus + Alertmanager
2. Configure scrape targets for 16 services
3. Load alert rules from OBSERVABILITY_OPERATING_MODEL.md
4. Configure Alertmanager to route to Telegram bots
5. Execute each alert scenario and verify:
   - Alert fires within expected time window
   - Notification reaches Telegram
   - Runbook steps resolve the issue

### Verification of Existing Metrics

The `@wasla/observability` package already provides:
- `http_requests_total` counter (used for error rate alerts)
- `http_request_duration_seconds` histogram (used for latency alerts)
- `http_requests_in_progress` gauge (used for bulkhead saturation)
- `collectDefaultMetrics` (used for resource alerts)

These metrics are the data source for all alert rules defined above.
