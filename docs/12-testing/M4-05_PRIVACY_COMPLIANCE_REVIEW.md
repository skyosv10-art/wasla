# M4-05: Privacy/Compliance Review

**Status:** Ready for Gate
**Work Item:** M4-05
**Claim:** CLM-0346
**Date:** 2026-09-24

## Overview

Privacy and compliance review for the WASLA platform against the Saudi Arabia Personal Data Protection Law (PDPL, Royal Decree M/19, 2021, effective September 2023).

## Applicable Law

### Saudi Arabia PDPL
- **Law:** Personal Data Protection Law (PDPL)
- **Decree:** Royal Decree M/19, 2021
- **Effective:** September 2023
- **Regulator:** Saudi Data and Artificial Intelligence Authority (SDAIA)
- **Scope:** All processing of personal data in Saudi Arabia or by entities established in Saudi Arabia

## Data Categories

### Sensitive Data (Art. 23)
- Customer location data (lat/long)
- Driver location data (lat/long)
- Driver license information
- Payment information

### Personal Data (Art. 5)
- Customer phone numbers
- Order history
- Bot chat messages
- Search queries
- Reputation scores

### Non-Personal Data
- Audit logs (pseudonymized)
- System metrics

## Compliance Requirements

| ID | Article | Requirement | Status |
|---|---|---|---|
| PDPL-001 | Art. 5 | Lawful basis for processing | Compliant |
| PDPL-002 | Art. 8 | Consent management | Partial |
| PDPL-003 | Art. 9 | Privacy notice | Partial |
| PDPL-004 | Art. 12 | Right to access (DSAR) | Not Implemented |
| PDPL-005 | Art. 13 | Right to correction | Not Implemented |
| PDPL-006 | Art. 14 | Right to deletion | Not Implemented |
| PDPL-007 | Art. 23 | Sensitive data protection | Partial |
| PDPL-008 | Art. 24 | Breach notification (72h) | Partial |
| PDPL-009 | Art. 27 | Records of processing (ROPA) | Compliant |
| PDPL-010 | Art. 28 | Data protection by design | Compliant |
| PDPL-011 | Art. 33 | Cross-border transfer | Partial |
| PDPL-012 | Art. 36 | DPIA for high-risk processing | Partial |

## Data Subject Rights

| Right | Article | Status |
|---|---|---|
| Access | Art. 12 | Not Implemented |
| Correction | Art. 13 | Not Implemented |
| Deletion | Art. 14 | Not Implemented |
| Objection | Art. 15 | Partial |
| Portability | Art. 16 | Not Implemented |

## Remediation Plan

1. **DSAR endpoint** (PDPL-004): Add to identity service with 30-day response window
2. **Data correction** (PDPL-005): Add to customers service
3. **Data deletion** (PDPL-006): Add with legal hold exception for audit logs
4. **Consent management** (PDPL-002): Formalize consent flow with audit trail
5. **Privacy notice** (PDPL-003): Publish in Arabic and English before pilot
6. **Breach notification** (PDPL-008): Add to incident-ops runbooks
7. **Cross-border DPA** (PDPL-011): Sign DPAs with Supabase and Render
8. **DPIA** (PDPL-012): Conduct formal DPIA before pilot launch

## Test Package

```
packages/compliance-review/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── harness.ts           — Data inventory, PDPL requirements, data subject rights
    └── __tests__/
        └── compliance-review.test.ts  — 15 tests
```

## Dependencies

- M1-05/M1-05B (security controls) — service auth enforcement
- M2-08 (observability) — audit logging
- M4-04 (incident ops) — breach notification procedures
- Saudi PDPL (Royal Decree M/19, 2021)
