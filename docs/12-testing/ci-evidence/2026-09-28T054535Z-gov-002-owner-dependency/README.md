# GOV-002 — Owner Dependency (CODEOWNER eligibility) · live re-measurement

- **Measured at (UTC):** 2026-09-28T05:45:35Z (`date -u`)
- **Claim:** CLM-0391 · **Item:** M0-45 (Governance Remediation Phase 2)
- **Method:** read-only `GET` calls against the GitHub REST API. No write call was made. Branch protection was **not** changed.

## Verdict

```
GOV-002 = BLOCKED
BLOCKER: CODEOWNER eligibility

CURRENT:
  @uxxxu = valid GitHub user            (raw-user-uxxxu.json: id 24187768, type User)
  @uxxxu = not repository collaborator  (raw-collaborator-uxxxu.txt: HTTP 404)
  require_code_owner_reviews = false    (raw-required-pr-reviews.txt)
  enforce_admins = true                 (raw-branch-protection.json)

OWNER ACTION REQUIRED (one of):
  A) Add @uxxxu as a collaborator with Write (or higher) permission, and @uxxxu accepts the invitation
  B) Update CODEOWNERS to a valid collaborator/team with Write+ access
```

GOV-002 is **not closed** by this record. It can only close after the owner action is proven by a new live measurement
(see [`GOV-002_ACTIVATION_RUNBOOK.md`](../../GOV-002_ACTIVATION_RUNBOOK.md)).

> **Superseded in part at 06:12:07Z:** the owner merged PR #530 (CODEOWNERS → `@skyosv10-art`). See [`2026-09-28T061207Z-gov-002-post-codeowners-change`](../2026-09-28T061207Z-gov-002-post-codeowners-change/README.md). This record stays as the 05:45:35Z measurement.

## Raw measurements

| File | Call | Result |
|------|------|--------|
| `raw-user-uxxxu.json` | `GET /users/uxxxu` | `{"id":24187768,"login":"uxxxu","type":"User"}` — valid user |
| `raw-collaborator-uxxxu.txt` | `GET /repos/skyosv10-art/wasla/collaborators/uxxxu` | `HTTP/1.1 404 Not Found` — not a collaborator |
| `raw-collaborators.json` | `GET /repos/.../collaborators` | only `skyosv10-art` (admin) |
| `raw-invitations.txt` | `GET /repos/.../invitations` | `200` · `[]` — no pending invitation |
| `raw-codeowners-errors.json` | `GET /repos/.../codeowners/errors` | **68** errors, all `Unknown owner … make sure @uxxxu exists and has write access` |
| `raw-required-pr-reviews.txt` | `GET /repos/.../branches/main/protection/required_pull_request_reviews` | `required_approving_review_count:1` · `require_code_owner_reviews:false` · `dismiss_stale_reviews:false` · `require_last_push_approval:false` |
| `raw-branch-protection.json` | `GET /repos/.../branches/main/protection` | `enforce_admins.enabled:true` · `strict:true` · 40 contexts · **no `required_pull_request_reviews` key in this response** |
| `raw-rulesets.json` / `raw-effective-rules-main.json` | `GET /repos/.../rulesets` · `GET /repos/.../rules/branches/main` | `[]` · `[]` |
| `raw-merged-prs-reviews.txt` | `GET /pulls/{n}` + `/pulls/{n}/reviews` for #524–#529 | every PR merged by `skyosv10-art` with **0 reviews** |
| `CODEOWNERS-snapshot.txt` | copy of `CODEOWNERS` at `main` `751b60e` | every path → `@uxxxu` |

## New finding — the configured approval requirement is not effective in practice

`required_approving_review_count = 1` is reported by the sub-endpoint, but PRs #524, #525, #526, #527, #528 and #529 were all
merged by the repository admin with **zero reviews**, with `enforce_admins = true` and without `--admin`
(`raw-merged-prs-reviews.txt`). Additionally the top-level `/protection` response omits the `required_pull_request_reviews`
object entirely, while the sub-endpoint returns it.

What this record claims: **the measured merge history contradicts the configured review requirement.**
What it does not claim: the root cause (GitHub-side semantics for a sole-admin repository, or an inconsistent protection
object). That is recorded as **NOT VERIFIED** and as a new blocker (`RISK-0054`), and it means the earlier row
`required_approving_review_count = 1 → PASS` in
[`2026-09-28T064800Z-gov-002-live-protection-measurement/README.md`](../2026-09-28T064800Z-gov-002-live-protection-measurement/README.md)
was a configuration reading, not proof of enforcement. That earlier record is not edited; this one corrects it by addition.

Consequence applied in this cycle: no further PR is merged by the agent while this contradiction is open, because a merge
with 0 approvals against a required count of 1 cannot be distinguished from a bypass.

## Timestamp correction (audit record, no evidence deleted)

Three earlier evidence directories carry a `Z` (UTC) suffix but were named from local time (+03:00):

| Directory label | Actual UTC (from PR merge/commit time) |
|-----------------|----------------------------------------|
| `2026-09-28T064800Z-gov-002-live-protection-measurement` | ≈ 03:48Z (PR #526 merged 04:16:39Z) |
| `2026-09-28T074500Z-gov-002-codeowner-eligibility` | ≈ 04:45Z (PR #527 merged 04:56:57Z) |
| `2026-09-28T080000Z-m6-19b-access-review-baseline` | ≈ 05:00Z (PR #528 merged 05:27:48Z) |

The directories are not renamed (links and the `MERGE_BLOCKING.json` evidence chain point at them). Their content is unaffected;
only the label's time zone is wrong. This directory uses true UTC.
