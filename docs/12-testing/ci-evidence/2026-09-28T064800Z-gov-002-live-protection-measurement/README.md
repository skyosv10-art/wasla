# GOV-002 Live Branch Protection Measurement

**Measurement timestamp:** 2026-09-28T06:48:00Z (+03)
**Measured by:** @uxxxu (agent:perplexity-computer)
**Head SHA on main:** `814706a`
**API endpoints called:**
1. `GET /repos/skyosv10-art/wasla/branches/main` → `protected: true`
2. `GET /repos/skyosv10-art/wasla/branches/main/protection` → full protection config
3. `GET /repos/skyosv10-art/wasla/branches/main/protection/required_pull_request_reviews` → PR review config
4. `GET /repos/skyosv10-art/wasla/rulesets` → `[]` (empty — no rulesets)

## Evidence Chain

```
commit SHA (814706a) → GitHub API call → raw JSON response → field extraction → verdict
```

**Chain integrity:** Each API call returns live data from GitHub's servers at measurement
time. No cached snapshots. No document-based claims.

---

## 1. Branch Protection Status

| Field | Live Value | Policy Requirement | Verdict |
|---|---|---|---|
| `protected` | `true` | must be `true` | PASS |
| `enforce_admins.enabled` | `true` | must be `true` | PASS |
| `required_status_checks.strict` | `true` | must be `true` | PASS |
| `required_status_checks.contexts` | 40 contexts | must match ci.yml jobs | PASS |
| `allow_force_pushes.enabled` | `false` | must be `false` | PASS |
| `allow_deletions.enabled` | `false` | must be `false` | PASS |
| `required_linear_history.enabled` | `false` | not specified in policy | N/A |
| `required_conversation_resolution.enabled` | `false` | not specified in policy | N/A |
| `required_signatures.enabled` | `false` | not specified in policy | N/A |
| `lock_branch.enabled` | `false` | not specified in policy | N/A |
| `block_creations.enabled` | `false` | not specified in policy | N/A |
| Rulesets | `[]` (empty) | not used | N/A |

---

## 2. Required Pull Request Reviews

| Field | Live Value | Policy Requirement (GIT_RULES.md §149-153) | Verdict |
|---|---|---|---|
| `required_approving_review_count` | `1` | must be ≥ 1 | PASS |
| `require_code_owner_reviews` | `false` | must be `true` (CODEOWNERS §6) | **FAIL** |
| `dismiss_stale_reviews` | `false` | not in policy — correctly absent | PASS |
| `require_last_push_approval` | `false` | not in policy | N/A |

---

## 3. Required Status Checks (40 contexts)

All 40 contexts from `ci.yml` are registered in `required_status_checks.contexts`:

repo-structure, doc-coverage, governance-guard, verify, typecheck, test,
db-integration (channel), db-integration (customer), db-integration (dispatch),
db-integration (drivers), db-integration (geography), db-integration (identity),
db-integration (marketplace), db-integration (matching), db-integration (negotiations),
db-integration (order), db-integration (reputation), db-integration (subscriptions),
db-integration-shared, exit-gate-e2e (channel), exit-gate-e2e (customer),
exit-gate-e2e (dispatch), exit-gate-e2e (driver), exit-gate-e2e (search),
db-integration (delivery), exit-gate-e2e (delivery), image-supply-chain,
db-integration (service-auth), customer-mini-app-e2e, db-integration (search),
exit-gate-e2e (marketplace), exit-gate-e2e (negotiation), exit-gate-e2e (order),
exit-gate-e2e (subscription), db-integration (partners), db-integration (billing),
driver-mini-app-e2e, admin-portal-e2e, exit-gate-e2e (partners), exit-gate-e2e (billing)

**Count: 40 contexts.** All match ci.yml job names.

---

## 4. Merge Enforcement Evidence

All 8 recent PRs (#518-#525) merged with 0 reviews. This means the
`required_approving_review_count: 1` was added AFTER PR #525 merge
(2026-09-28T03:35:34Z) and before this measurement (2026-09-28T06:48:00Z).

The owner updated branch protection between Phase 1 audit and this measurement.

---

## 5. GOV-002 Verdict

| Check | Result |
|---|---|
| Branch protected | PASS |
| Status checks required | PASS (40/40, strict) |
| enforce_admins | PASS |
| Force pushes blocked | PASS |
| Deletions blocked | PASS |
| PR reviews required | PASS (count=1) |
| CODEOWNERS enforcement | **FAIL** (require_code_owner_reviews=false) |
| dismiss_stale_reviews | PASS (not in policy, correctly absent) |

### GOV-002 Overall: **PARTIAL PASS — FAIL on CODEOWNERS enforcement**

The branch protection configuration is mostly aligned with policy, but
`require_code_owner_reviews` is `false` despite CODEOWNERS §6 requiring
code owner approval. The minimal delta needed:

```json
{
  "required_pull_request_reviews": {
    "require_code_owner_reviews": true
  }
}
```

This is the exact minimal delta from the Phase 1 supplement report.
`dismiss_stale_reviews` is correctly absent (not in any policy document).

---

## 6. GOV-005 Evidence Chain Verdict

**Previous status:** BROKEN (NOT VERIFIED) — evidence_dir referenced
non-existent directory, no raw API response.

**Current status:** This document IS the raw evidence. The chain is now:

```
commit 814706a → GitHub API (4 endpoints) → raw JSON saved to evidence dir →
field extraction (this document) → verdict
```

**GOV-005: PASS** — Evidence chain is complete and traceable to a live API
measurement at a specific commit SHA.

---

## Raw API Responses

Raw JSON responses from all 4 API calls are saved in this directory:
- `raw-branch-protection.json` — full /branches/main/protection response
- `raw-pr-reviews.json` — /branches/main/protection/required_pull_request_reviews
- `raw-branch-status.json` — /branches/main (protected field)
- `raw-rulesets.json` — /rulesets
