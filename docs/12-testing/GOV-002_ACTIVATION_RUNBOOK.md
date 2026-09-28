# GOV-002 Activation Runbook — CODEOWNER review enforcement

- **Status:** PREPARED · **NOT EXECUTED** · GOV-002 = **BLOCKED**
- **Claim:** CLM-0391 · **Item:** M0-45
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
2. Attempt `gh pr merge N --squash` (no `--admin`) before approval → **must be refused** (this also closes the open question in `RISK-0054`).
3. CODEOWNER approves → `reviewDecision=APPROVED` → merge succeeds.
4. Save all outputs to `$D/`.

Verdict wording (exactly one):

- `PASS CODEOWNER enforcement active and usable` — steps 1–5 all hold.
- `BLOCKED … Owner action required: assign a valid collaborator/team as CODEOWNER` — step 1 fails.
- If step 5.2 is **not** refused: GOV-002 = FAIL (enforcement configured but not effective), NO-GO remains, `RISK-0054` stays open.

## 6. Records to update after execution

`MERGE_BLOCKING.json` (`gov_002_codeowner_eligibility` + `protection` snapshot) · evidence README in `$D` · board M0-45 row ·
`TASK_LOG.md` · `RISK-0054` status · CI must stay green (`validate-merge-blocking.sh` compares the snapshot to the live object).
