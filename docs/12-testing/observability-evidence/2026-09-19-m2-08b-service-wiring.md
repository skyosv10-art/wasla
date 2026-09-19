# M2-08b — Observability Service Wiring Evidence

**Date:** 2026-09-19
**Claim:** `CLM-0236`
**Related:** [ADR-041: Observability Stack](../15-decisions/ADR-041-observability-stack.md), [M2-08 synthetic trace evidence](observability-evidence/2026-09-19-m2-08-synthetic-trace.md)

## What this closes

M2-08's declared gap ("الحزمة لم تُوصَل بالخدمات الـ13 بعد" — the package was
built and tested but not wired into any of the 13 Fastify services) is now
closed. All 13 services import `@wasla/observability` and call the same
three functions their bootstrap (`server.ts`) already uses for every other
adapter:

```ts
const stopTracing = startTracing("<service-name>");
// ... app = create<Service>App({ ... });
const metrics = registerMetrics("<service-name>");
instrumentApp(app, metrics);
addMetricsEndpoint(app, metrics);
// ... in the shutdown path (onClose hook or SIGTERM/SIGINT handler):
stopTracing();
```

## Services wired (13/13)

| Service | package.json dep added | server.ts wired | Shutdown hook (`stopTracing`) |
|---|---|---|---|
| customers | ✅ | ✅ | `onClose` (unconditional, added ahead of `if (pool)`) |
| delivery | ✅ | ✅ | `catch` block on listen failure |
| dispatch | ✅ | ✅ | `onClose` (unconditional) |
| drivers | ✅ | ✅ | `onClose` (unconditional) |
| geography | ✅ | ✅ | `SIGTERM`/`SIGINT` handler + `catch` block |
| identity | ✅ | ✅ | `SIGTERM`/`SIGINT` handler + `catch` block |
| marketplace | ✅ | ✅ | both code paths (memory mode + postgres mode) — `SIGTERM`/`SIGINT` for memory, `onClose` for postgres |
| matching | ✅ | ✅ | `onClose` (unconditional) |
| negotiations | ✅ | ✅ | `onClose` (unconditional) |
| orders | ✅ | ✅ | `onClose` (unconditional) |
| reputation | ✅ | ✅ | `onClose` (unconditional) |
| search | ✅ | ✅ | `catch` block on listen failure |
| subscriptions | ✅ | ✅ | both code paths (memory mode + postgres mode) — `SIGTERM`/`SIGINT` for memory, `onClose` for postgres |

Two services (`geography`, `identity`) previously had no `SIGTERM`/`SIGINT`
handler at all — a bare `try/listen/catch` with no graceful shutdown. Adding
tracing cleanup required adding that handler, which is a net improvement
(the process now closes the Fastify instance on signal instead of relying on
the runtime to kill it).

Two services (`marketplace`, `subscriptions`) have two code paths (in-memory
mode when `DATABASE_URL` is unset, Postgres mode otherwise). `startTracing`
is now called once, unconditionally, before the branch — both paths share
the same tracer and stop it in their own shutdown path.

## Fix required in `@wasla/observability` itself

Wiring surfaced a real defect: `addMetricsEndpoint` registered the `/metrics`
route with no `config.serviceIdentity`. The M1-04 central service-auth guard
(`packages/service-auth/src/fastify.ts`) throws at route-registration time
for any route missing that classification — so every service would have
**failed to boot** the moment `addMetricsEndpoint` ran, in production and in
this evidence run alike. Fixed by registering the route as
`{ config: { serviceIdentity: "open" } }` (same classification `/health`
uses) — `/metrics` exposes only aggregate Prometheus counters/histograms,
never request bodies or user data, so open access matches the boundary the
other open route (`/health`) already establishes.

## Proof

New integration test
[`services/customers/src/__tests__/observability-wiring.test.ts`](../../services/customers/src/__tests__/observability-wiring.test.ts)
builds the customers app with the exact same wiring call sequence used in
`server.ts`, using the repo's existing signed-app test harness
(`createSignedCustomerApp`), and asserts:

1. `/metrics` returns 200 with `Content-Type: text/plain` and contains the
   `http_requests_total` / `http_request_duration_seconds` series names.
2. Hitting `/health` repeatedly is reflected in the metrics output.
3. `startTracing` returns a working cleanup function with no
   `OTEL_EXPORTER_OTLP_ENDPOINT` set (no-op tracing, as ADR-041 specifies).

Result: **3/3 new tests pass.** The existing `@wasla/observability` package
suite (`metrics.test.ts` + `synthetic-trace.test.ts`, 10 tests) still passes
unchanged — the middleware fix (`serviceIdentity: "open"`) does not touch
those tests' assertions.

`pnpm -r typecheck` / `tsc -b` is clean across all 13 services after the
wiring (verified against the same baseline pre-change to confirm the 5
pre-existing errors in `packages/observability/src/__tests__/synthetic-trace.test.ts`
— a `vitest`-only globals typing gap unrelated to this change — were already
present on `main` before this branch).

## What is still deferred to Stage B (per ADR-041 — unchanged by this claim)

- Alert manager is not deployed; PromQL rules are defined but nothing
  currently evaluates them (`RISK-0053`).
- No OTLP collector is deployed; tracing remains a no-op in every
  environment until `OTEL_EXPORTER_OTLP_ENDPOINT` is set somewhere.

These two gaps require a deployed Prometheus/OTel collector instance and are
explicitly out of scope for Stage A per ADR-041 — they are not part of
M2-08's "wire the package into services" gap that this claim closes.
