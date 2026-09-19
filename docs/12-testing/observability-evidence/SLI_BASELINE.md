# SLI Baseline — WASLA Services (Stage A)

**Date:** 2026-09-19
**ADR:** [ADR-041](../../15-decisions/ADR-041-observability-stack.md)
**Scope:** Stage A (development-grade, not production SLAs)

## Service Level Indicators

| SLI | Metric | Target | Measurement |
|---|---|---|---|
| Availability | `1 - (rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]))` | ≥ 99% | 2xx+3xx / total requests |
| Latency p95 | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))` | ≤ 500ms | 95th percentile response time |
| Error rate | `rate(http_requests_total{status=~"4..|5.."}[5m]) / rate(http_requests_total[5m])` | ≤ 5% | 4xx+5xx / total requests |
| Throughput | `rate(http_requests_total[1m])` | ≥ 100 req/s | Requests per second |

## Alert Rules (PromQL)

### Availability Alert
```promql
# Fires when availability drops below 99% over 5 minutes
1 - (rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])) < 0.99
```

### Latency Alert
```promql
# Fires when p95 latency exceeds 500ms over 5 minutes
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 0.5
```

### Error Rate Alert
```promql
# Fires when error rate exceeds 5% over 5 minutes
rate(http_requests_total{status=~"4..|5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
```

## Metrics Exposed

| Metric | Type | Labels | Description |
|---|---|---|---|
| `http_requests_total` | Counter | method, route, status, service | Total HTTP requests |
| `http_request_duration_seconds` | Histogram | method, route, status, service | Request duration in seconds |
| `http_requests_in_progress` | Gauge | method, service | In-flight requests |
| `nodejs_*` | Various | service | Default Node.js metrics |

## Notes

- Targets are Stage A (development-grade) — production SLAs will be defined in M2-09
- Alert manager integration deferred to Stage B (requires deployed Prometheus)
- Tracing via OpenTelemetry is opt-in (`OTEL_EXPORTER_OTLP_ENDPOINT`)
