# GOV-002 — CODEOWNER Eligibility Report

**Measured at:** 2026-09-28T07:45:00Z
**Measured from:** GitHub REST API (4 endpoints)
**Commit:** `f5efafa` (main HEAD at measurement time)

## Verdict: BLOCKED

Policy can be enabled, but current CODEOWNER is not eligible.
Owner action required: assign a valid collaborator/team as CODEOWNER.

## Report

```text
CURRENT CODEOWNER:      @uxxxu
GITHUB ID/TYPE:         User (id: 24187768) — valid GitHub user account
COLLABORATOR STATUS:    NOT a collaborator on skyosv10-art/wasla (HTTP 404)
TEAM STATUS:            N/A — skyosv10-art is a User account (not Organization). No teams exist.
CODEOWNER REVIEW ELIGIBILITY: NOT ELIGIBLE — @uxxxu cannot submit reviews on this repository
BLOCKING CONDITION:     @uxxxu is not a collaborator; GitHub requires Write+ permission to review PRs
REQUIRED OWNER ACTION:  Either:
  (a) Invite @uxxxu as a collaborator with Write+ permission AND have them accept the invitation,
      then enable require_code_owner_reviews=true
  (b) Update CODEOWNERS to list a valid collaborator (e.g. @skyosv10-art) — but note that
      single-owner repos cannot self-review, so this requires a second collaborator
  (c) Convert the repo account to an Organization and create a Team for CODEOWNER review
```

## API Evidence

| Endpoint | Result |
|---|---|
| `GET /users/uxxxu` | 200 — valid user (login: uxxxu, type: User, id: 24187768) |
| `GET /repos/skyosv10-art/wasla/collaborators` | 200 — only `skyosv10-art` (admin) |
| `GET /repos/skyosv10-art/wasla/collaborators/uxxxu` | 404 — not a collaborator |
| `GET /repos/skyosv10-art/wasla/branches/main/protection/required_pull_request_reviews` | 200 — count=1, code_owner=false |

## Current Branch Protection State (unchanged)

```text
enforce_admins:                    true  (UNCHANGED — per owner directive)
required_approving_review_count:    1
require_code_owner_reviews:         false (NOT ENABLED — would block all PRs)
dismiss_stale_reviews:              false
require_last_push_approval:         false
```

## Governance Status

```text
GOV-002 = BLOCKED
NO-GO remains in force
enforce_admins = true (unchanged)
```

## Raw Evidence

All raw API responses saved in this directory:
- `raw-uxxxu-user.json` — @uxxxu user profile
- `raw-collaborators.json` — repo collaborators list
- `raw-uxxxu-collaborator-check.json` — 404 (not a collaborator)
- `raw-pr-reviews.json` — current PR review requirements
- `raw-repo-owner.json` — repo owner info
