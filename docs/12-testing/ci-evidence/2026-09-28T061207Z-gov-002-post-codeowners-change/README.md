# GOV-002 — re-measurement after owner PR #530 (CODEOWNERS change)

- **Measured at (UTC):** 2026-09-28T06:12:07Z · **Claim:** CLM-0391 · **Main:** `ae5646e` (PR #530)
- **Method:** read-only `GET` calls. Branch protection **not** changed. No review was posted.

## What the owner did

PR [#530](https://github.com/skyosv10-art/wasla/pull/530) "Update CODEOWNERS" (author `skyosv10-art`, merged by
`skyosv10-art` at 06:09:09Z, **0 reviews** — `raw-pr-530.json`, `raw-pr-530-reviews-count.txt`) replaced every `@uxxxu` with
`@skyosv10-art` (69 entries — `CODEOWNERS-snapshot-ae5646e.txt`). This is owner action **B**.

## Precondition check (runbook §1)

| Check | Result | Raw |
|-------|--------|-----|
| CODEOWNERS parse errors on `main` | **0** (was 68) | `raw-codeowners-errors.json` |
| CODEOWNER is a collaborator | **yes** — `204` | `raw-collaborator-skyosv10-art.txt` |
| CODEOWNER permission Write+ | **admin** | `raw-permission-skyosv10-art.json` |
| Collaborators | only `skyosv10-art` | `raw-collaborators.json` |
| Protection unchanged | `require_code_owner_reviews:false` · `required_approving_review_count:1` · `dismiss_stale_reviews:false` · `enforce_admins:true` · 40 contexts · strict | `raw-required-pr-reviews.json` · `raw-branch-protection.json` |

So the CODEOWNER is now **valid** (the original blocker "not a collaborator" is resolved).

## Why activation is still NOT executed — the CODEOWNER is not usable

- The only CODEOWNER (`@skyosv10-art`) is also the **author of every PR**: 100 of the last 100 closed PRs
  (`raw-pr-authors-last100.json`), and the agent itself operates as `skyosv10-art` (`raw-agent-identity.txt`).
- GitHub does not accept a pull-request author's approval of their own PR (documented platform behaviour). The live probe
  (posting an APPROVE on PR #531) was **not executed** — posting a self-approval would itself be the kind of fabricated
  CODEOWNER approval the owner prohibited. Status of the probe: **NOT VERIFIED (by design)**.
- Therefore with `require_code_owner_reviews=true`, `enforce_admins=true` and no bypass, **no PR could obtain a qualifying
  CODEOWNER approval** → every PR becomes unmergeable. The owner's rule (2026-09-28) forbids enabling it in that case.
- Separately, RISK-0054 is still open: PR #530 itself merged with 0 reviews while `required_approving_review_count=1`.

## Verdict

```
GOV-002 = BLOCKED
BLOCKER: CODEOWNER eligibility — valid but not independent
CURRENT:
  CODEOWNERS → @skyosv10-art (valid collaborator, admin, 0 CODEOWNERS errors)
  @skyosv10-art = author of all PRs (100/100) and the agent's identity → cannot approve its own PRs
  require_code_owner_reviews = false · enforce_admins = true (unchanged)
OWNER ACTION REQUIRED (one of):
  A) Add a second person (e.g. @uxxxu) as collaborator with Write+, who accepts, and list them (or a team containing them) in CODEOWNERS
  B) Keep @skyosv10-art as CODEOWNER but have PRs authored by a different account (e.g. the agent pushes as a separate
     collaborator), so @skyosv10-art can approve them
NO-GO remains.
```
