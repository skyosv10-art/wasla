# Access, Secret & Audit Review — M6-19B

**Last Updated:** 2026-09-28  
**Authority:** M6-19B  
**ADR:** [ADR-054](../15-decisions/ADR-054-pentest-scope.md) (M6-19A)  
**Depends on:** M6-19A (Ready for Gate)

---

## 1. Overview

This document defines the periodic access review, secret rotation verification, and
audit log integrity procedures for the WASLA MARKET platform. It establishes the
evidence collection schedule required for launch readiness and ongoing compliance.

### Scope

| Area | Controls | Owner |
|------|----------|-------|
| Repository access | GitHub collaborator review | @uxxxu |
| Service identity | Token issuance and enforcement | M1-03, M1-04 |
| Secret management | Rotation, inventory, storage | M2-03A |
| Audit log integrity | Append-only verification | M3-04 |
| Database access | Connection string rotation | @uxxxu |
| Infrastructure access | Render, Supabase admin | @uxxxu |

---

## 2. Access Review Procedure

### 2.1 Repository Access Review (Quarterly)

**Frequency:** Every 90 days  
**Reviewer:** Program Owner (@uxxxu)

#### Checklist

1. List all GitHub collaborators via `gh api repos/skyosv10-art/wasla/collaborators`
2. Verify each collaborator still needs access
3. Remove collaborators who no longer require access
4. Verify CODEOWNERS file reflects current ownership
5. Verify branch protection settings match `MERGE_BLOCKING.json`
6. Record evidence in `docs/12-testing/ci-evidence/<timestamp>-m6-19b-access-review/`

#### Current State (Measured 2026-09-28)

| Check | Result |
|-------|--------|
| Collaborators | 1 (skyosv10-art, admin) |
| CODEOWNERS | All paths → @uxxxu (placeholder) |
| Branch protection | enforced, strict, 40 contexts |
| enforce_admins | true |
| require_code_owner_reviews | false (GOV-002 BLOCKED — @uxxxu not collaborator) |

### 2.2 Service Identity Review (Quarterly)

**Frequency:** Every 90 days  
**Reviewer:** Program Owner (@uxxxu)

#### Checklist

1. Audit `PRODUCTION_GRANTS` in `packages/service-auth/src/token.ts`
2. Verify each service role has minimum required scopes
3. Check `TOKEN_BOUND_OPERATION_COUNT` trend (target: all owned operations)
4. Review `INGRESS_BOUNDARY_INVENTORY` (§5.10 of SERVICE_AUTH_ENFORCEMENT.md)
5. Verify replay store is active on PostgreSQL
6. Record token-bound and tenant-bound operation counts

#### Current State (Measured 2026-09-28)

| Metric | Value | Target |
|--------|-------|--------|
| TOKEN_BOUND_OPERATION_COUNT | 10 | All owned operations |
| TENANT_BOUND_OPERATION_COUNT | 8 | All tenant-scoped routes |
| UNCLASSIFIED_OPERATION_COUNT | 63 | 0 (with documented exceptions) |
| Unenforced ingress boundaries | 4 (43 routes) | 0 |
| Replay store | PostgreSQL (active) | PostgreSQL |

### 2.3 Database Access Review (Quarterly)

**Frequency:** Every 90 days  
**Reviewer:** Program Owner (@uxxxu)

#### Checklist

1. List all database connection strings in `infra/secrets/secret-inventory.json`
2. Verify each is rotated per its rotation policy
3. Check Supabase dashboard for unused databases
4. Verify connection pooling configuration
5. Review query logs for anomalous access patterns

---

## 3. Secret Rotation Verification

### 3.1 Secret Inventory

The secret inventory is maintained at `infra/secrets/secret-inventory.json` and
contains 26 secrets across 5 categories. Each secret has a defined rotation policy.

#### Rotation Schedule

| Type | Frequency | Count | Next Review |
|------|-----------|-------|-------------|
| postgres_url | Quarterly | 12 | 2026-12-28 |
| telegram_bot_token | On compromise or quarterly | 3 | 2026-12-28 |
| webhook_secret | On compromise or semi-annually | 3 | 2027-03-28 |
| service_auth_key_material | Quarterly | 2 | 2026-12-28 |
| api_key | Quarterly | 1 | 2026-12-28 |
| kms_key_id/arn | Annual | 2 | 2027-09-28 |
| tls_certificate/key | Auto | 2 | Auto |
| dns_api_token | Quarterly | 1 | 2026-12-28 |

### 3.2 Rotation Verification Script

A verification script (`scripts/checks/validate-secret-rotation.sh`) checks that:

1. Every secret in the inventory has a `rotation_frequency` field
2. No secret has exceeded its rotation period without documented exception
3. Secrets marked as `BLOCKED` have a documented reason
4. The inventory file matches `infra/secrets/secret-inventory.json` schema

### 3.3 Rotation Procedure

For each secret type:

#### Database URLs (postgres_url)
1. Generate new password in Supabase dashboard
2. Update environment variables on Render
3. Verify service starts with new connection string
4. Revoke old password after 24h grace period
5. Update `last_rotated` date in inventory

#### Telegram Bot Tokens
1. Revoke token via @BotFather
2. Generate new token
3. Update environment variables on Render
4. Verify webhook registration with new token
5. Update `last_rotated` date in inventory

#### Service Auth Keys
1. Generate new key pair
2. Add new `kid` to `WASLA_SERVICE_AUTH_KEYS`
3. Update `WASLA_SERVICE_AUTH_ACTIVE_KID` to new `kid`
4. Wait for token expiry (15 min)
5. Remove old key from `WASLA_SERVICE_AUTH_KEYS`
6. Update `last_rotated` date in inventory

---

## 4. Audit Log Integrity

### 4.1 Audit Service

The audit service (`services/audit/`) provides an append-only event log for
administrative actions. The design guarantees:

- **No update:** Repository port exposes only `append` and `list`
- **No delete:** No delete operation in the domain model
- **Immutable:** `createdAt` is set at append time, not modifiable
- **PostgreSQL-backed:** Drizzle schema enforces append-only at database level

### 4.2 Integrity Verification Procedure

**Frequency:** Monthly  
**Reviewer:** Program Owner (@uxxxu)

#### Checklist

1. Query `SELECT COUNT(*) FROM audit_events` — record count
2. Compare with previous month's count — verify monotonic increase
3. Query `SELECT MIN(created_at), MAX(created_at) FROM audit_events` — verify time range
4. Spot-check 5 random events — verify metadata integrity
5. Check for gaps in `id` sequence (indicates deletion)
6. Record evidence in `docs/12-testing/ci-evidence/<timestamp>-m6-19b-audit-integrity/`

### 4.3 Tamper Detection

The audit table uses a PostgreSQL `SERIAL` primary key. Gaps in the sequence
indicate potential tampering (deletion). The verification script checks:

```sql
-- Detect gaps in audit event sequence
SELECT expected.gap_start, expected.gap_end
FROM (
  SELECT id + 1 AS gap_start,
         next_id - 1 AS gap_end
  FROM (
    SELECT id,
           LEAD(id) OVER (ORDER BY id) AS next_id
    FROM audit_events
  ) t
  WHERE next_id > id + 1
) expected;
```

---

## 5. Evidence Collection Schedule

### 5.1 Quarterly Evidence (Every 90 days)

| Evidence | Source | Storage |
|----------|--------|---------|
| GitHub collaborator list | `gh api .../collaborators` | `ci-evidence/<ts>-m6-19b-access-review/` |
| Branch protection config | `gh api .../protection` | Same dir |
| CODEOWNERS file | Repository | Same dir |
| Secret inventory snapshot | `infra/secrets/secret-inventory.json` | Same dir |
| Service auth grants | `packages/service-auth/src/token.ts` | Same dir |
| Token-bound operation count | `scripts/checks/validate-service-auth-coverage.sh` | Same dir |
| Audit event count | `SELECT COUNT(*) FROM audit_events` | Same dir |
| Audit sequence gaps | Gap detection query | Same dir |

### 5.2 Monthly Evidence

| Evidence | Source | Storage |
|----------|--------|---------|
| Audit event count | Database query | `ci-evidence/<ts>-m6-19b-audit-monthly/` |
| Audit time range | Database query | Same dir |
| CI verdict audit | `scripts/checks/audit-ci-verdicts.sh` | Same dir |

### 5.3 Continuous Evidence

| Evidence | Source | Storage |
|----------|--------|---------|
| CI green on main | GitHub Actions runs | `CI_VERDICT_AUDIT.md` |
| Governance suite | `scripts/verify.sh` | `BASELINE.json` |
| Risk register | `docs/07-security/RISK_REGISTER.md` | In-repo |
| Dependency audit | `scripts/checks/validate-dependency-audit.sh` | In-repo |

---

## 6. Review Schedule

| Review | Frequency | Next Due | Status |
|--------|-----------|----------|--------|
| Repository access | Quarterly | 2026-12-28 | Initial baseline done 2026-09-28 |
| Service identity | Quarterly | 2026-12-28 | Initial baseline done 2026-09-28 |
| Database access | Quarterly | 2026-12-28 | Initial baseline done 2026-09-28 |
| Secret rotation | Quarterly | 2026-12-28 | Initial baseline done 2026-09-28 |
| Audit integrity | Monthly | 2026-10-28 | Initial baseline done 2026-09-28 |
| CI verdict audit | Continuous | Ongoing | M0-40 (active) |
| Risk register | Continuous | Ongoing | M0-07 (active) |

---

## 7. Exit Criteria

The exit criteria for M6-19B is **periodic evidence** — meaning:

1. This document exists and is maintained
2. The evidence collection schedule is defined
3. The initial baseline evidence has been collected
4. A rotation verification script exists and is wired into the governance suite
5. The audit integrity check procedure is documented
6. The next review dates are set and tracked

### Current Status

| Criterion | Met | Evidence |
|-----------|-----|----------|
| Access review document | Yes | This document |
| Evidence collection schedule | Yes | §5 |
| Initial baseline | Yes | §2.1, §2.2 (measured 2026-09-28) |
| Rotation verification script | Yes | `scripts/checks/validate-secret-rotation.sh` |
| Audit integrity procedure | Yes | §4 |
| Review schedule tracked | Yes | §6 |

---

## 8. References

- [RISK_REGISTER.md](RISK_REGISTER.md) — Risk register (M0-07)
- [SERVICE_AUTH_ENFORCEMENT.md](SERVICE_AUTH_ENFORCEMENT.md) — Service auth (M1-03, M1-04)
- [AUTHORIZATION_POLICY_MATRIX.md](AUTHORIZATION_POLICY_MATRIX.md) — Authz matrix (M1-05)
- [PENTEST_PLAN.md](PENTEST_PLAN.md) — Pentest plan (M6-19A)
- [THREAT_MODEL.md](THREAT_MODEL.md) — Threat model
- [SECRET_INVENTORY.md](../08-infrastructure/SECRET_INVENTORY.md) — Secret inventory (M2-03A)
- [CI_VERDICT_AUDIT.md](../12-testing/CI_VERDICT_AUDIT.md) — CI verdict audit (M0-40)
