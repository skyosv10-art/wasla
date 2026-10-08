# ADR-068: Observability targets are per environment, selected explicitly, with one paging owner

**Status:** Proposed — technical decision under the Program Owner's executive delegation; submitted with the Phase 4 review of the blue/green migration (CLM-0499/CLM-0500).
**Date:** 2026-10-08
**Decider:** Program Owner (@skyosv10-art), executed by agent:perplexity-computer (CLM-0499)
**Related:** M6-18B (blue/green migration) · M6-18C (CLM-0403 alerting pipeline) · [ADR-041](ADR-041-observability-stack.md) · CLM-0498 evidence

---

## Context

The Render blue/green migration (CLM-0498) runs two stacks at once: the legacy
workspace (`oregon`, hosts `wasla-<svc>.onrender.com`) and the new workspace
(`singapore`, hosts `wasla-<svc>-<suffix>.onrender.com`). Scrape targets were
hard-coded in two places:

- `infra/observability/prometheus.yml` — 14 legacy hosts + the legacy Alertmanager;
- `services/observability/src/config.ts` — the same 14 legacy hosts.

Measured 2026-10-08T11:41Z: the **new** `wasla-observability` (Singapore) reports
`/api/v1/targets` = the 14 **legacy** hosts, all `down`. It watched the wrong
stack. A Prometheus built from the same file would also scrape the legacy stack
and page the on-call chat through the legacy Alertmanager, duplicating the
legacy Prometheus's alerts.

## Decision

1. **One registry per environment:** `infra/observability/targets/<environment>.targets`
   (`environment` · `alertmanager <host|none>` · `service <name> <https url>`). This
   is the only place that lists scrape hosts.
2. **Explicit selection, no default:** `WASLA_OBS_ENVIRONMENT` selects the file in both
   consumers (Prometheus entrypoint, Node collector). If it is missing, unknown, or
   names a file that declares a different environment, the process fails closed at
   boot. A later deploy cannot silently bring the old host set back.
3. **Template, not hosts:** `prometheus.yml` holds placeholders only.
4. **Single paging owner:** at most one environment has a non-`none`
   `alertmanager`. Every other environment runs in **shadow mode**
   (`alertmanagers: []`): rules are evaluated and visible, and nothing is sent.
5. **Enforced, not described:** `scripts/checks/validate-observability-targets.sh`
   (in `scripts/verify.sh`) renders every environment through the **real**
   entrypoint. It fails on a hostname in the template or collector, a host shared
   by two environments, more than one paging owner, diverging service sets,
   `targets/` missing from the image, or a start without an environment. It
   It also fails when the 6-hourly `service-health` probe (`scripts/ops/health/check-health.py`)
   carries a hostname or watches an environment other than the paging owner. It
   mutates a copy of the tree for each rule and requires a failure (10 mutations).
   Unit tests cover the collector parser (`services/observability`).

## Consequences

- **Legacy keeps monitoring now:** the running legacy Prometheus, Alertmanager and
  collector use their baked images and are not redeployed (old workspace frozen).
  A future legacy deploy of these services needs one env key added first
  (`WASLA_OBS_ENVIRONMENT=render-oregon-legacy`), so it fails visibly instead of
  guessing. The legacy label changes from `environment=staging` to
  `environment=render-oregon-legacy` on that deploy; no alert rule reads this label.
- **New stack:** `wasla-observability` (Singapore) needs
  `WASLA_OBS_ENVIRONMENT=render-singapore` **before** its next deploy.
- **Ownership transfer** is a one-line, reviewed change: set the new environment's
  `alertmanager` to the new host and the legacy one to `none` in the same PR. The
  guard rejects any state with two owners (Phase 4 report §3).
- Tooling that still derives hosts by convention (`infra/terraform/apps`,
  `infra/terraform/cron`, `infra/terraform/observability` outputs, `scripts/ops/*`,
  `scripts/deploy/dr-drill.py`, test harnesses) is **not** a runtime source of
  targets. It is listed in the Phase 4 report as Phase 5 acceptance work, to be
  migrated to this registry without a mass replace.
