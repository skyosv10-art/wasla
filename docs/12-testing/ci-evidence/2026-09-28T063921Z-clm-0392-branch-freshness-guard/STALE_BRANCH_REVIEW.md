# Stale branch review — branches the repaired check 23 flags (2026-09-28, read-only)

Measured via GitHub API (GET only) against `origin/main` = `ae5646e`. No branch was deleted or changed.
"Tree diff" = `git diff <squash commit on main> <branch head>`; empty means every file on the branch is on `main`.
`refs/pull/N/head` is kept by GitHub for every PR independently of the branch, so the exact pre-squash commits
stay retrievable after a branch deletion; CI run logs are not tied to the branch either.

| PR | BRANCH | MERGED? | BRANCH EXISTS? | ACTIVE WORK? | EVIDENCE RETENTION NEEDED? | RECOMMENDED ACTION |
|---|---|---|---|---|---|---|
| #524 | `fix/tier1-governance-remediation` | yes · 03:10:48Z · squash `1d0adf5` | yes · `55593c3` (= PR head) | no — CLM-0385 Released · no open PR · tree diff empty | no — `refs/pull/524/head` = `55593c3` | delete branch (owner) |
| #525 | `fix/roadmap-freshness-tier1` | yes · 03:35:34Z · squash `814706a` | yes · `1568eec` (= PR head) | no — CLM-0386 Released · no open PR · tree diff empty | no — `refs/pull/525/head` = `1568eec` | delete branch (owner) |
| #526 | `fix/gov-005-live-protection-measurement` | yes · 04:16:39Z · squash `f5efafa` | yes · `dcb0b8a` (= PR head) | no — CLM-0387 Released · no open PR · tree diff empty | no — `refs/pull/526/head` = `dcb0b8a` | delete branch (owner) |
| #527 | `fix/gov-002-codeowner-eligibility-report` | yes · 04:56:57Z · squash `30da701` | yes · `3512624` (= PR head) | no — CLM-0388 Released · no open PR · tree diff empty | no — `refs/pull/527/head` = `3512624` | delete branch (owner) |
| #530 | `skyosv10-art-patch-1` | yes · 06:09:09Z · squash `ae5646e` | yes · `7e3943f` (= PR head) | no — owner web-edit branch, no claim · no open PR · tree diff empty | no — `refs/pull/530/head` = `7e3943f` | delete branch (owner) |

None is declared in `BRANCH_EVIDENCE.md`: there is no operational or evidentiary reason to keep them, and declaring them
would only make the guard ignore them. The guard is not changed to pass them.

Branches **not** flagged (owned, for the record): `feat/m6-19b-access-secret-audit-review` (CLM-0389 Active/HOLD),
`feat/m6-19c-supply-chain-hardening` (CLM-0390 Active/HOLD), `fix/gov-002-owner-dependency-gate-audit` (open PR #531),
`fix/m0-44-branch-freshness-guard` (this PR). If CLM-0389/0390 are released later, their branches must be deleted in the same
step or the guard will — correctly — flag them.

Consequence: check 23 in this PR's CI is expected to **fail** until the owner deletes the five branches. That failure is the
guard working, not a defect of this PR; no merge is requested while it is red.
