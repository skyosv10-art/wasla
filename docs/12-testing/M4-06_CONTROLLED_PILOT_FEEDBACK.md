# M4-06: Controlled Pilot and Feedback Triage

**Status:** Ready for Gate
**Work Item:** M4-06
**Claim:** CLM-0348
**Date:** 2026-09-24

## Overview

Controlled pilot execution and feedback triage framework for the WASLA platform beta. Implements the beta charter (M4-01) with structured participant management, feedback collection, metric monitoring, and beta decision gate evaluation.

## Pilot Structure

- **Duration:** 14 days (staging environment)
- **Location:** Jeddah, Saudi Arabia
- **Environment:** Render staging (14 services + observability)
- **Participants:** 40 total (25 customers, 10 drivers, 5 partners)

## Success Metrics

| Metric | Target | Source |
|---|---|---|
| Golden journey completion | >=80% | golden-e2e package |
| Availability | >=99% | observability metrics |
| p95 latency | <=500ms | load-testing SLOs |
| Error rate | <=5% | observability metrics |
| Bot completion rate | >=70% | bot analytics |
| Audit completeness | 100% | audit service |

## Stop Conditions

1. Security incident detected
2. Data corruption detected
3. Unauthorized access detected
4. Service downtime > 30 minutes
5. p95 latency > 2000ms sustained
6. Error rate > 20% sustained
7. Rollback procedure failure

## Feedback Categories

| Category | Description |
|---|---|
| Bug | Functional defect or error |
| UX Issue | User experience friction point |
| Performance | Latency, throughput, or resource issue |
| Missing Feature | Feature gap identified during pilot |
| Integration Issue | Service-to-service or third-party problem |
| Safety Concern | Safety or security concern |
| Compliance Concern | Privacy or regulatory concern |
| Positive Feedback | Feature appreciation or positive experience |

## Beta Decision Gate

The decision gate evaluates:
- All 6 success metrics passing
- No open critical feedback items
- No stop conditions triggered

### Decision Outcomes
- **Go:** All metrics pass, no critical issues, no stop conditions
- **Conditional Go:** Some metrics pending or critical issues open — conditions documented
- **No Go:** Stop conditions triggered

## Test Package

```
packages/pilot-feedback/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── harness.ts           — Participants, feedback, metrics, decision gate
    └── __tests__/
        └── pilot-feedback.test.ts  — 16 tests
```

## Dependencies

- M4-01 (beta charter) — success/stop metrics definitions
- M4-02 (golden E2E) — journey completion measurement
- M4-03 (load testing) — SLO baselines
- M4-04 (incident ops) — rollback procedures for stop conditions
- M4-05 (compliance review) — PDPL compliance during pilot
