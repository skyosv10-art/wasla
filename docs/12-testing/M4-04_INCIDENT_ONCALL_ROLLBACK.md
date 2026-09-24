# M4-04: Incident, On-Call, and Rollback Operations

**Status:** Ready for Gate
**Work Item:** M4-04
**Claim:** CLM-0344
**Date:** 2026-09-24

## Overview

Incident response, on-call rotation, and rollback operations for the WASLA platform. This artifact defines severity levels, on-call roles, rollback runbooks, and tabletop exercise scenarios.

## Incident Severity Levels

| Severity | Description | Response Time | Escalation |
|---|---|---|---|
| SEV-1 | Critical — system down, data loss risk | 15 min | All hands — notify owner |
| SEV-2 | Major — significant degradation | 30 min | On-call SRE + lead |
| SEV-3 | Minor — limited impact | 60 min | On-call engineer |
| SEV-4 | Low — informational | 240 min | Next business day |

## On-Call Roles

### Incident Commander
- **Primary:** @uxxxu (program owner)
- **Responsibilities:** Declare severity, coordinate response, approve rollback, communicate status

### On-Call SRE
- **Primary:** agent:perplexity-computer
- **Responsibilities:** Triage alerts, execute rollback, verify health, document timeline

### On-Call Developer
- **Primary:** TBD
- **Responsibilities:** Investigate root cause, prepare hotfix, review logs/traces

## Rollback Runbooks

Each service on Render supports deployment rollback via the dashboard:

1. Navigate to service in Render dashboard
2. Go to deployment history
3. Select previous stable deployment
4. Click "Rollback to this deploy"
5. Wait for service to become live (2-5 min)
6. Verify health via /health and /metrics endpoints

### Critical Service Runbooks

| Service | Render URL | Est. Time |
|---|---|---|
| identity | wasla-identity.onrender.com | 7 min |
| customers | wasla-customers.onrender.com | 7 min |
| orders | wasla-orders.onrender.com | 7 min |
| search | wasla-search.onrender.com | 7 min |
| observability | wasla-observability.onrender.com | 7 min |

## Tabletop Exercise Scenarios

### 1. Service Degradation (SEV-2)
- **Trigger:** Identity service returning 500 errors
- **Response:** Acknowledge alert, investigate, rollback if needed, verify, document

### 2. Database Corruption (SEV-1)
- **Trigger:** Data integrity check fails
- **Response:** Declare SEV-1, investigate, isolate, restore backup, verify, postmortem

### 3. Observability Outage (SEV-2)
- **Trigger:** Observability collector down
- **Response:** Acknowledge, check Render status, rollback if needed, verify metrics restored

### 4. Cascading Failure (SEV-1)
- **Trigger:** Multiple service alerts simultaneously
- **Response:** Declare SEV-1, identify root cause, rollback, verify downstream, postmortem

## Test Package

```
packages/incident-ops/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── harness.ts           — Incident levels, on-call roles, runbooks, scenarios
    └── __tests__/
        └── incident-ops.test.ts  — 15 tests (skip without GOLDEN_STAGING_BASE)
```

## Dependencies

- M2-08 (observability stack) — for alerting and health verification
- M4-02 (golden E2E) — for staging URL conventions
- Render dashboard — for deployment rollback
- Render API — for service status checks
