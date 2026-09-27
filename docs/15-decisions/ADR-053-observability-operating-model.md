# ADR-053: Observability Operating Model

**Status:** Accepted  
**Date:** 2026-09-28  
**Authority:** M6-18C (CLM-0382)  
**Supersedes:** None  
**Related:** ADR-051 (Resilience), ADR-052 (HA/DR)

---

## Context

The WASLA platform has Prometheus metrics and OpenTelemetry tracing via
`@wasla/observability`, but no defined alert rules, runbooks, on-call
procedures, or escalation paths. The LAUNCH_EXECUTION_BOARD requires
"alert/live-fire evidence" and "runbook review" for M6-18C.

The SLOs from M6-18A define availability, latency, and error budget
targets. The resilience patterns from M6-18A provide circuit breaker
state and bulkhead utilization. The HA/DR architecture from M6-18B
defines RTO/RPO targets. This ADR ties them together into an operating
model.

## Decision

### 1. Alert Rules

Define Prometheus-compatible alert rules based on SLO tiers:
- Error rate: 5xx percentage above threshold per tier
- Latency: p99 above SLO target per tier
- Availability: health check failures
- Resource: DB connections, slow queries
- SLO burn rate: error budget consumption speed

### 2. Runbooks

Create 5 runbooks covering the most common incidents:
- RB-01: Service down
- RB-02: High error rate
- RB-03: High latency
- RB-04: Database issues
- RB-05: SLO burn rate

Each runbook has symptoms, impact, step-by-step resolution, and
post-incident actions.

### 3. On-Call Procedures

- Weekly rotation with primary/secondary
- Escalation via Telegram bots (driver=rider=partner)
- 5-minute acknowledgement SLA
- Incident severity levels (SEV-1 through SEV-4)

### 4. Dashboards

- Service health dashboard (per-service metrics)
- SLO dashboard (error budget burn, compliance)

### 5. Live-Fire Testing

The alert rules are defined as Prometheus YAML and ready for deployment.
Live-fire testing requires a deployed Prometheus + Alertmanager stack,
which will be provisioned when the platform moves to production.

## Consequences

- Alert rules are defined but not yet deployed (requires Prometheus)
- Runbooks are documented and ready for use
- On-call procedures use Telegram bots for notification (already provisioned)
- The operating model is reviewable and executable when monitoring is deployed
