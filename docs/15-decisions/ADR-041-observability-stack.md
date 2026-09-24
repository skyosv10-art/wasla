# ADR-041: Observability Stack — Logs, Metrics, Traces

**Status:** Accepted (2026-09-24, CLM-0333) — Stage A + Stage B complete; metrics live on 14 staging services, SLI alerts defined, OTLP collector configured. Render Docker build for observability services pending (known issue: free plan limitation).
**Date:** 2026-09-19
**Decision Owner:** Program Owner
**Supersedes:** None
**Superseded by:** None
**Related:** ADR-038 (Platform Provider — Supabase), ADR-039 (Render Free Compute)

## Context

M2-08 requires logs/metrics/traces/alerts with a "synthetic trace/dashboard" acceptance criterion. The WASLA platform has 13 Fastify services using pino for structured logging, but no metrics, tracing, or alerting infrastructure.

## Decision

### Logging (already in place)

- **pino** (built into Fastify via `logger: true`) — structured JSON logging
- Each service logs request/response lifecycle events
- No change needed — pino is the standard

### Metrics

- **`prom-client`** — Prometheus-compatible metrics library for Node.js
- A shared `@wasla/observability` package provides a Fastify plugin that instruments:
  - `http_requests_total` (counter) — labeled by method, route, status
  - `http_request_duration_seconds` (histogram) — labeled by method, route, status
  - `http_requests_in_progress` (gauge) — labeled by method
- Each service exposes a `/metrics` endpoint in Prometheus text format
- No external metrics backend required for Stage A — the `/metrics` endpoint is scrapeable by any Prometheus-compatible collector

### Tracing

- **OpenTelemetry** (`@opentelemetry/api` + `@opentelemetry/sdk-node`) — vendor-neutral tracing
- The `@wasla/observability` package provides a `startTracing()` function that initializes the Node SDK with:
  - `@opentelemetry/sdk-node` — auto-instrumentation for HTTP, Fastify, pg
  - `@opentelemetry/exporter-trace-otlp-http` — OTLP exporter (configurable endpoint)
  - `@opentelemetry/instrumentation-fastify` — Fastify request spans
  - `@opentelemetry/instrumentation-http` — HTTP client/server spans
  - `@opentelemetry/instrumentation-pg` — PostgreSQL query spans
- Tracing is opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable
- When no exporter is configured, tracing is a no-op (zero overhead)

### Alerting

- Alert rules are defined as PromQL expressions against the metrics above
- SLI-based alerts:
  - Availability: `1 - (rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]))` < 0.99
  - Latency p95: `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))` > 2s
  - Error rate: `rate(http_requests_total{status=~"4..|5.."}[5m]) / rate(http_requests_total[5m])` > 0.05
- Alert manager integration is deferred to Stage B (requires deployed Prometheus instance)

### SLI Baseline

| SLI | Target | Measurement |
|---|---|---|
| Availability | ≥ 99% | 2xx+3xx / total requests |
| Latency p95 | ≤ 500ms | histogram_quantile(0.95, ...) |
| Error rate | ≤ 5% | 4xx+5xx / total requests |
| Throughput | ≥ 100 req/s | rate(http_requests_total[1m]) |

These are Stage A targets — development-grade, not production SLAs.

## Consequences

- **Positive:** Standard observability stack — Prometheus metrics, OpenTelemetry traces, pino logs
- **Positive:** Vendor-neutral — any Prometheus/OTLP-compatible backend can consume the output
- **Positive:** Zero-overhead when disabled (tracing no-op, metrics are lightweight)
- **Negative:** Additional dependencies per service (prom-client, @opentelemetry/*)
- **Negative:** Alert manager integration deferred — metrics are exposed but not yet alerting

## Risks

- `RISK-0053` (new): Alert manager not deployed — metrics are exposed via `/metrics` but no active alerting until a Prometheus instance is deployed (Stage B).

## References

- [ADR-038: Platform Provider & IaC Toolchain](ADR-038-platform-provider-iac-toolchain.md)
- [ADR-039: Render Free Experimental Compute](ADR-039-render-experimental-compute.md)
- [M2-08 Observability Evidence](../12-testing/observability-evidence/2026-09-19-m2-08-synthetic-trace.md)
- [SLI Baseline](../12-testing/observability-evidence/SLI_BASELINE.md)
