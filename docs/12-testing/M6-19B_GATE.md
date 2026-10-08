# M6-19B Gate Readiness Audit — access/secret/audit review

- **Audited at (UTC):** 2026-09-28T05:50Z · **Claim:** CLM-0391 (audit + gap fixes) · implementation claim CLM-0389
- **Main at audit:** `751b60e` (PR #529) · implementation merged in PR #528 (`0f2c848`)
- **Board exit criterion:** "periodic evidence"
- **Verdict:** **BLOCKED — not ready for gate.** Board status corrected `Ready for Gate → Blocked` by addition (no history erased).
- This audit does **not** move anything to `Completed`. Only the owner can (board §9).

## 1. Audit matrix

| Dimension | Result | Evidence / reason |
|-----------|--------|-------------------|
| IMPLEMENTATION | **PASS** (after fix) | [`ACCESS_SECRET_AUDIT_REVIEW.md`](../07-security/ACCESS_SECRET_AUDIT_REVIEW.md) · [`validate-secret-rotation.sh`](../../scripts/checks/validate-secret-rotation.sh). The PR #528 guard swallowed interpreter errors (`2>/dev/null`) so a malformed entry printed PASS, and its "secret count" gate only warned. Rewritten fail-closed under CLM-0391. |
| LOCAL VERIFICATION | **PASS** | guard: 7/7 gates pass on the real inventory (26 secrets · 19 active · 7 BLOCKED); 8 mutation cases in `test-governance.sh` (1 pass + 7 must-fail) all behave as expected. |
| DOCUMENTATION | **FAIL → partially fixed** | Fixed: this gate file (was a dead link from `WORK_INDEX.md`); the "Check 24" label collided with governance check 24 (M3-08) — renamed. Corrected by addendum in the review doc (§9 there): the "Current State (Measured 2026-09-28)" table for service identity was **copied from existing docs, not measured**; "Replay store PostgreSQL (active)" has no deployment evidence. |
| CI EVIDENCE | **PASS** (for the implementation PR) · **PENDING** (for this fix) | PR #528 run: 42/42 green. On `main` after merge, `Roadmap freshness` **failed** on `0f2c848` (run [36382018096](https://github.com/skyosv10-art/wasla/actions/runs/36382018096)): `ROADMAP.md was not updated alongside implementation changes: scripts/checks/validate-secret-rotation.sh, scripts/verify.sh`. `main` returned green at `751b60e` only because the next diff had no implementation file. ROADMAP.md is updated in this cycle. |
| SECURITY EVIDENCE | **FAIL** | Of the 5 review areas, only **repository access** has a raw live baseline (collaborators, protection, CODEOWNERS). Secret rotation has a *policy* baseline only — rotation **age** is not measurable (no `last_rotated` in the inventory). Service identity, database access and audit-log integrity have **no measured baseline** (need live Supabase/Render or a code-derived measurement). |
| OWNER AUTHORIZATION | **NOT VERIFIED** | No owner gate decision recorded. Reviewer column names `@uxxxu`, who cannot review (GOV-002 BLOCKED). |
| GATE REQUIREMENTS | **FAIL** | "Periodic evidence" requires at least one complete baseline across all declared review areas and a second cycle to show periodicity. Neither exists yet. |
| DEPENDENCIES | **FAIL** | Depends on M6-19A, which is `Ready for Gate` (pentest not executed; owner procurement). M6-19B cannot be `Completed` before M6-19A is. |

## 2. What unblocks the gate

1. **DONE (CLM-0394):** Measured baseline for service identity: TOKEN_BOUND_OPERATION_COUNT=44, TENANT_BOUND_OPERATION_COUNT=8, UNCLASSIFIED_OPERATION_COUNT=105 — derived from `packages/authz-policy/src/bindings.ts` source code, not copied. Evidence: [`ci-evidence/2026-09-28T130000Z-m6-19b-baseline-remediation/`](ci-evidence/2026-09-28T130000Z-m6-19b-baseline-remediation/README.md).
2. **DONE (CLM-0394):** Measured baseline for database access (30 roles, 394 grants, 44 tables, RLS enabled on 25) and audit-log integrity (wasla-audit deployed, service identity enforced). Evidence: same directory.
3. **DONE (CLM-0394):** `last_rotated` (date) per secret in `infra/secrets/secret-inventory.json` (19 active secrets with dates), and the guard extended to fail on overdue rotation (9 gates, all pass).
4. M6-19A completed by the owner (external blocker — independent pentest procurement).
5. Owner gate decision (§9).

### Remediation status (CLM-0394)

| Dimension | Before (CLM-0391 audit) | After (CLM-0394) |
|-----------|------------------------|-------------------|
| Service identity | Copied from docs | **Measured** from source code (TOKEN_BOUND=44, TENANT_BOUND=8, UNCLASSIFIED=105) |
| Database access | Unmeasured | **Measured** against live Supabase (30 roles, 394 grants, 25/44 RLS) |
| Audit integrity | Unmeasured | **Measured** (wasla-audit deployed, service identity enforced) |
| Rotation age | Unmeasurable (no last_rotated) | **Measurable** (19 secrets with last_rotated, 9 gates pass, 0 overdue) |
| Remaining blockers | — | M6-19A (external), owner gate decision |

## 3. Not claimed

No claim that any secret was rotated, that any production role was reviewed, or that audit logs are intact. The guard proves
declared policy completeness only.

## Addendum 2026-09-28 (R54 · after PR #530)

- "Reviewer column names `@uxxxu`" is superseded: CODEOWNERS now names `@skyosv10-art` (PR #530), the sole PR author, who
  cannot review their own PRs. OWNER AUTHORIZATION stays **NOT VERIFIED**.
- The access baseline row "PR reviews required (count=1)" is a REST sub-endpoint reading; R54 measured that approvals are
  **not** required (RISK-0054, root cause CONFIGURATION DEFECT). That row is not evidence of review enforcement.
- Verdict unchanged: **BLOCKED**.


---

## Owner gate decision — 2026-10-08 (CLM-0497)

**Owner gate decision (2026-10-08, CLM-0497):** the Program Owner approved the M6-19B gate («وافق على بوابات M6-18C وM6-19B وM6-19C»). Status stays `Ready for Gate`: the board dependency **M6-19A is not Completed** (independent pentest not performed) and the same owner message keeps M6-19A blocked. Promotion to `Completed` takes effect when M6-19A completes, without a new gate decision (STATUS_MODEL §2.1 — no jump past a dependency).

Evidence: [`ci-evidence/2026-10-08T021500Z-clm-0497-bot-preflight-e2e-owner-decisions/`](ci-evidence/2026-10-08T021500Z-clm-0497-bot-preflight-e2e-owner-decisions/README.md) §8.
