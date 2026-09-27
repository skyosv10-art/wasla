# M6-19A Pentest Plan — Gate Evidence

**Date:** 2026-09-28  
**Claim:** CLM-0383  
**ADR:** [ADR-054](../15-decisions/ADR-054-pentest-scope.md)  
**Plan:** [PENTEST_PLAN.md](../07-security/PENTEST_PLAN.md)

---

## 1. Implementation Evidence

### Documents Created

| Document | Purpose |
|----------|---------|
| `docs/07-security/PENTEST_PLAN.md` | Pentest scope, methodology, procurement, remediation |
| `docs/15-decisions/ADR-054-pentest-scope.md` | Architecture decision |

### Security Controls Already Implemented

| Control | Milestone | Evidence |
|---------|-----------|----------|
| Service identity enforcement | M1-03, M1-04 | `packages/service-auth` |
| Authorization policy matrix | M1-05, M1-05B | `packages/authz-policy` (80 ops, 10 roles) |
| Token-bound owner binding | M1-05B | ADR-028, ADR-029, ADR-030 |
| Secrets management | M2-03A | `docs/08-infrastructure/SECRET_INVENTORY.md` |
| Container supply chain | M2-01 | SBOM, image signing, CycloneDX |
| Production dependency guard | M0-43 | `validate-production-dependency-guard.sh` |
| CI verdict audit | M0-40 | `audit-ci-verdicts.sh` |
| Resilience patterns | M6-18A | `@wasla/resilience` |
| Risk register | Ongoing | 53 risks, 7 accepted, 0 open critical |

---

## 2. Acceptance Criteria Checklist

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Pentest plan | ✅ | PENTEST_PLAN.md with scope, methodology, procurement |
| Scope defined | ✅ | 16 services + Supabase + Render + GitHub Actions |
| Methodology | ✅ | OWASP Top 10 + API Top 10 + manual exploratory |
| Procurement requirements | ✅ | 2 weeks, 2 testers, $8K–$15K budget |
| Remediation process | ✅ | Critical/High block launch; tracked in RISK_REGISTER.md |
| Exit criteria | ✅ | No critical/high open |
| Pentest execution | ⏳ Pending | Requires external procurement (owner action) |
| Remediation of findings | ⏳ Pending | After pentest execution |

---

## 3. Known Risk Areas for Pentester Focus

From RISK-0042 (M1-05B):

1. **Ownership is caller-asserted** — `X-Customer-Public-Id` header is
   shape-validated but not truth-validated. TOKEN_BOUND_OPERATION_COUNT = 0/80.
2. **Tenant membership not fully enforced** — 5/11 marketplace routes enforce
   tenant binding; 6 have documented reasons for not enforcing.
3. **Actor public ID from request body** — 8 measured fields. `obo` field
   provides counterbalance but is not a guard.

These are documented risks that the pentester should specifically test to
determine if they are exploitable in practice.

---

## 4. Next Steps

1. **Owner action:** Procure pentest engagement based on PENTEST_PLAN.md
2. **After pentest:** Remediate all critical/high findings
3. **After remediation:** Re-test and sign-off
4. **After M6-19A complete:** M6-19B (access/secret/audit review) and
   M6-19C (supply-chain hardening) are unblocked
5. **After M6 complete:** M7 (release) items are unblocked
