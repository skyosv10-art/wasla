# GOV-002 Activation Runbook — CODEOWNER review enforcement

- **Status:** PREPARED · **NOT EXECUTED** · GOV-002 = **BLOCKED**
- **Claim:** CLM-0391 · **Item:** M0-45
- **Update 06:12:07Z:** owner merged PR #530 (CODEOWNERS → `@skyosv10-art`). §1 now passes on validity (0 errors, collaborator, admin) but **fails on usability**: the sole CODEOWNER authors every PR and cannot approve its own. Activation stays NOT EXECUTED. Record: [`2026-09-28T061207Z-gov-002-post-codeowners-change`](ci-evidence/2026-09-28T061207Z-gov-002-post-codeowners-change/README.md).
- **Blocker record:** [`2026-09-28T054535Z-gov-002-owner-dependency`](ci-evidence/2026-09-28T054535Z-gov-002-owner-dependency/README.md) · [`RISK-0054`](../07-security/RISK_REGISTER.md)

This runbook exists so that, once the owner completes the CODEOWNER action, GOV-002 can be executed with a clear live
before/after measurement **without reopening the previous audit**. It must not be run before step 1 passes.

## 0. Hard constraints (owner decision, 2026-09-28)

Forbidden at every step: disabling `enforce_admins` · any admin bypass · `gh pr merge --admin` · merging without CODEOWNER
review · a CODEOWNER exception · lowering any protection requirement · changing policy to fit the current permission state ·
treating green CI as a substitute for CODEOWNER approval.

## 1. Precondition — owner action proven (read-only)

One of the two owner actions must be **measured**, not asserted:

| Option | Owner action | Proof required (all must hold) |
|--------|--------------|--------------------------------|
| A | Add `@uxxxu` as collaborator with Write+ and `@uxxxu` accepts | `GET /repos/skyosv10-art/wasla/collaborators/uxxxu` → `204` · `GET .../collaborators/uxxxu/permission` → `permission` ∈ {`write`,`maintain`,`admin`} · `GET .../invitations` → no pending invite for `uxxxu` |
| B | Change `CODEOWNERS` to a valid collaborator/team (via a normal PR) | the new owner passes the same collaborator/permission check (or team has Write+) · the CODEOWNERS PR merged through normal review |

For both, additionally: **at least one CODEOWNER for the changed paths must be a different account from the PR author** (GitHub ignores an author's approval of their own PR). If the only CODEOWNER is the account that opens the PRs, §1 fails.

For both: `GET /repos/skyosv10-art/wasla/codeowners/errors` → `{"errors":[]}` on `main`.
If any check fails → stop; GOV-002 stays BLOCKED; record the measurement.

```bash
TS=$(date -u +%Y-%m-%dT%H%M%SZ); D=docs/12-testing/ci-evidence/${TS}-gov-002-activation; mkdir -p "$D"
gh api -i repos/skyosv10-art/wasla/collaborators/uxxxu              > "$D/pre-collaborator.txt"
gh api    repos/skyosv10-art/wasla/collaborators/uxxxu/permission   > "$D/pre-permission.json"
gh api    repos/skyosv10-art/wasla/invitations                      > "$D/pre-invitations.json"
gh api    repos/skyosv10-art/wasla/codeowners/errors                > "$D/pre-codeowners-errors.json"
```

## 2. Before measurement (read-only)

```bash
gh api repos/skyosv10-art/wasla/branches/main/protection                               > "$D/before-protection.json"
gh api repos/skyosv10-art/wasla/branches/main/protection/required_pull_request_reviews > "$D/before-pr-reviews.json"
```

Expected before: `enforce_admins=true` · `required_approving_review_count=1` · `require_code_owner_reviews=false` ·
`dismiss_stale_reviews=false` · 40 contexts · `strict=true`.

## 3. The only permitted change

```
require_code_owner_reviews: false → true
```

Everything else is sent **unchanged** (the PATCH endpoint replaces the object, so omitted fields must be re-sent with their current values):

```bash
gh api -X PATCH repos/skyosv10-art/wasla/branches/main/protection/required_pull_request_reviews \
  -F required_approving_review_count=1 \
  -F dismiss_stale_reviews=false \
  -F require_code_owner_reviews=true \
  -F require_last_push_approval=false                                     > "$D/patch-response.json"
```

`enforce_admins` is not touched (no call to `/protection/enforce_admins`). Status checks are not touched.

## 4. After measurement (read-only)

```bash
gh api repos/skyosv10-art/wasla/branches/main/protection                               > "$D/after-protection.json"
gh api repos/skyosv10-art/wasla/branches/main/protection/required_pull_request_reviews > "$D/after-pr-reviews.json"
```

Pass condition — the diff between `before-*` and `after-*` is exactly one field:

| Field | Before | After |
|-------|--------|-------|
| `require_code_owner_reviews` | `false` | `true` |
| `required_approving_review_count` | `1` | `1` |
| `dismiss_stale_reviews` | `false` | `false` |
| `enforce_admins.enabled` | `true` | `true` |
| status check contexts | 40 | 40 (same set) |

## 5. Usability probe (proves "active **and** usable")

1. Open a docs-only PR. Measure `gh pr view N --json reviewDecision,mergeStateStatus` → expect `REVIEW_REQUIRED` / `BLOCKED` before approval.
2. ~~Attempt `gh pr merge N --squash` (no `--admin`) before approval → **must be refused**~~ **— WITHDRAWN by §8.2 (live merge attempt; see replacement probe below).** Replacement (read-only): on a docs-only PR with 0 approvals, `reviewDecision=REVIEW_REQUIRED` and `mergeStateStatus=BLOCKED` must be observed.
3. CODEOWNER approves → `reviewDecision=APPROVED` → merge succeeds.
4. Save all outputs to `$D/`.

Verdict wording (exactly one):

- `PASS CODEOWNER enforcement active and usable` — steps 1–5 all hold.
- `BLOCKED … Owner action required: assign a valid collaborator/team as CODEOWNER` — step 1 fails.
- If step 5.2 replacement probe shows `mergeStateStatus` ≠ `BLOCKED`: GOV-002 = FAIL (enforcement configured but not effective), NO-GO remains, `RISK-0054` stays open.

## 6. Records to update after execution

`MERGE_BLOCKING.json` (`gov_002_codeowner_eligibility` + `protection` snapshot) · evidence README in `$D` · board M0-45 row ·
`TASK_LOG.md` · `RISK-0054` status · CI must stay green (`validate-merge-blocking.sh` compares the snapshot to the live object).

## 8. Addendum 2026-09-28 — R54 findings (supersedes parts of §4–§6; nothing above deleted)

**Status: ON HOLD** (owner decision). Nothing in this runbook is to be executed now.

1. **The sub-endpoint is not authoritative.** R54 measured `required_approving_review_count=1` on
   `/protection/required_pull_request_reviews` while GraphQL reports `requiresApprovingReviews:false` and a 0-review PR is
   `CLEAN`. A PATCH to that same endpoint (§4) is therefore **not proven** to turn on enforcement. Authoritative before/after
   readings are GraphQL `branchProtectionRules{requiresApprovingReviews requiredApprovingReviewCount requiresCodeOwnerReviews
   isAdminEnforced}` and `pullRequest{reviewDecision mergeStateStatus}`.
2. **§5 step 2 is withdrawn.** "Attempt `gh pr merge` before approval" is a live merge attempt: with the rule as measured it
   would *merge*. Replacement (read-only): on a docs-only PR with 0 approvals, `reviewDecision=REVIEW_REQUIRED` and
   `mergeStateStatus=BLOCKED` must be observed. No self-approval, no test approval, no merge used as a probe.
3. **Owner dependency (unchanged in substance, restated):**
   - **A)** provide a reviewer or team **independent of the PR author** with Write+ that is valid as CODEOWNER; **or**
   - **B)** redesign `CODEOWNERS` so it names an identity/team that can actually submit a CODEOWNER approval on agent PRs.
   The PR author's own account is never used as its reviewer.
4. Enabling "Require a pull request before merging → Require approvals" in the rule is itself an owner action, and has the same
   precondition as CODEOWNER enforcement: without A or B every PR becomes unmergeable. Order: A/B → enable approvals →
   measure (item 1–2) → then `require_code_owner_reviews`. Evidence: `docs/12-testing/ci-evidence/2026-09-28T063026Z-risk-0054-r54-review-enforcement/`.
