# M2-08 — Observability Evidence (CLM-0235)

**Date:** 2026-09-19
**Claim:** CLM-0235
**ADR:** [ADR-041](../../15-decisions/ADR-041-observability-stack.md)
**SLI Baseline:** [SLI_BASELINE.md](SLI_BASELINE.md)

## What Was Built

### `@wasla/observability` Package

A shared observability package providing:

1. **Prometheus Metrics** (`src/metrics.ts`):
   - `http_requests_total` (Counter) — labeled by method, route, status, service
   - `http_request_duration_seconds` (Histogram) — labeled by method, route, status, service
   - `http_requests_in_progress` (Gauge) — labeled by method, service
   - Default Node.js metrics (process, event loop, GC, heap)

2. **Fastify Middleware** (`src/middleware.ts`):
   - `instrumentApp(app, metrics)` — adds `onRequest`/`onResponse` hooks directly
   - `addMetricsEndpoint(app, metrics)` — exposes `/metrics` in Prometheus text format
   - Excludes `/metrics` endpoint from instrumentation (no self-referential metrics)

3. **OpenTelemetry Tracing** (`src/tracing.ts`):
   - `startTracing(serviceName)` — opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT`
   - No-op when no exporter configured (zero overhead)
   - Configurable OTLP HTTP exporter

### Tests (10 tests, 2 files)

- `metrics.test.ts` (6 tests): registry creation, default metrics, request count/duration, in-progress tracking, error status codes, content type
- `synthetic-trace.test.ts` (4 tests): synthetic traffic generation, metrics verification, SLI computation, tracing no-op behavior

### SLI Baseline

| SLI | Target | Measurement |
|---|---|---|
| Availability | ≥ 99% | 2xx+3xx / total requests |
| Latency p95 | ≤ 500ms | histogram_quantile(0.95, ...) |
| Error rate | ≤ 5% | 4xx+5xx / total requests |
| Throughput | ≥ 100 req/s | rate(http_requests_total[1m]) |

## Results

- **10/10 tests pass** (unit + integration)
- **Typecheck clean** (0 errors)
- **Synthetic trace**: 55 requests generated (50 success + 5 errors), all metrics recorded correctly
- **SLI computation**: Availability and error rate computable from exposed metrics
- **Tracing**: No-op behavior verified (no `OTEL_EXPORTER_OTLP_ENDPOINT` set)

## What Was NOT Done

- No service integration (observability package created but not yet wired into the 13 services)
- No alert manager deployment (requires deployed Prometheus instance — Stage B)
- No OTLP collector deployment (requires infrastructure — Stage B)
- No production tracing verification (requires deployed collector)

## Next Steps

- Wire `@wasla/observability` into each service's `server.ts` (M2-08B or follow-up)
- Deploy Prometheus + alert manager (M2-09 staging)
- Deploy OTLP collector for tracing (M2-09 staging)

## References

- [ADR-041: Observability Stack](../../15-decisions/ADR-041-observability-stack.md)
- [SLI Baseline](SLI_BASELINE.md)
- [Package source](../../../packages/observability/)
- [Synthetic trace test](../../../packages/observability/src/__tests__/synthetic-trace.test.ts)
