# CLM-0499 — Observability targets per environment (blue/green monitoring fix)

**Date:** 2026-10-08T11:41–11:50Z · **Work item:** M6-18B · **Decision:** [ADR-068](../../../15-decisions/ADR-068-observability-targets-per-environment.md) (Proposed)
**Render:** no change (no env, no deploy, no Prometheus/Alertmanager created). Repository only.

## Measured problem

- `GET https://wasla-observability-kmxe.onrender.com/api/v1/targets` (new Singapore collector) at 2026-10-08T11:41:37Z listed the **legacy** hosts (`https://wasla-dispatch.onrender.com/metrics`, `…wasla-search…`, `…wasla-reputation…`, …), `health: down`, label `environment: staging`. Cause: the 14 hosts were hard-coded in `services/observability/src/config.ts`.
- `infra/observability/prometheus.yml` hard-coded the same 14 legacy hosts and the legacy Alertmanager. Any new Prometheus would scrape the old stack and page through the old Alertmanager, duplicating alerts.
- Read-only. The collector only sends `GET /metrics`, and its alert states are only logged. **No duplicate paging has happened.**

## Fix

| File | Change |
|---|---|
| `infra/observability/targets/render-oregon-legacy.targets` | new — 14 legacy hosts; `alertmanager wasla-alertmanager.onrender.com` (current paging owner) |
| `infra/observability/targets/render-singapore.targets` | new — 14 new hosts (Render API, CLM-0498); `alertmanager none` (shadow mode) |
| `infra/observability/prometheus.yml` | template; no hosts |
| `infra/observability/prometheus-entrypoint.sh` | renders from `WASLA_OBS_ENVIRONMENT` (required, no default); AM password only when owning paging; `WASLA_OBS_RENDER_ONLY=1` for the guard |
| `infra/observability/Dockerfile.prometheus` | `COPY targets/` |
| `services/observability/src/config.ts` · `scraper.ts` · `index.ts` | load the same file; fail closed at boot; `environment` label from the file |
| `services/observability/src/__tests__/config.test.ts` | tests per environment, plus fail-closed and parser tests |
| `scripts/ops/health/check-health.py` · `.github/workflows/service-health.yml` | the 6-hourly health probe, which also opens GitHub issues, reads the same registry; the workflow pins `WASLA_OBS_ENVIRONMENT` to the paging owner (guard-enforced) |
| `scripts/checks/validate-observability-targets.sh` · `scripts/verify.sh` · `docs/00-rules/VERIFY_COMMAND.md` | new mandatory guard, with 10 mutation self-tests |

## Results (local; CI is the verdict)

```
services/observability vitest:  Test Files 1 passed (1)
 Tests 11 passed (11)
typecheck: 0 errors
  ✓ targets per environment: template and collector host-free; every environment renders through the real entrypoint; no shared host; ≤1 paging owner; fail closed without environment
  ✓ self-test: 10/10 mutations caught
collector, WASLA_OBS_ENVIRONMENT=render-singapore → "14 services", scraped wasla-delivery-3rm5 (152 lines)
collector, no WASLA_OBS_ENVIRONMENT → exit 1 "WASLA_OBS_ENVIRONMENT is not set"
prometheus entrypoint, render-singapore → alertmanagers: [] · 14 suffixed hosts · environment=render-singapore
prometheus entrypoint, render-oregon-legacy → legacy Alertmanager · 14 legacy hosts
prometheus entrypoint, no environment → exit 2
check-health.py, WASLA_OBS_ENVIRONMENT=render-singapore → healthy 14/14 (new stack, GET /health only)
check-health.py, no environment → exit 1
```

## Activation (not done here — Phase 4 report §2)

New `wasla-observability`: add the single key `WASLA_OBS_ENVIRONMENT=render-singapore` and only then deploy this commit. Legacy services: no change. A future legacy deploy needs `WASLA_OBS_ENVIRONMENT=render-oregon-legacy` first.
