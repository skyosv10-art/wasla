# CLM-0392 — Branch Freshness Guard (check 23) repair · evidence

Measured 2026-09-28T06:39:21Z (UTC, real) on branch `fix/m0-44-branch-freshness-guard`, base `origin/main` = `ae5646e`.
Local measurement only; the verdict belongs to CI once a PR is opened.

## Two measured defects (both on `main`)

| # | Defect | Evidence |
|---|---|---|
| A | Claims reader took status from `parts[7]` = **Expires** column, not Status (`parts[8]`). No Active claim ever counted as owning its branch. A second reader of the same register (the canonical one is `lib/claims_rows.sh`, M0-38). | `before-old-guard-ci-mode-live.txt` (old guard, live, flags 7 stale incl. `feat/m6-19b-…` and `feat/m6-19c-…` which have Active claims CLM-0389/0390) vs `after-new-guard-ci-mode-live.txt` (5 stale — those two now owned) |
| B | Unreadable platform ⇒ "declared skip", exit 0 — **also in CI**. The CI job had no `GH_TOKEN`, so check 23 skipped on every run. | `ci-main-governance-guard-check23.txt` (run 36385042314 on `ae5646e`: `⊘ تعذّرَ قراءةُ الفروعِ … ✓ نجاحٌ (بتخطٍّ مُعلَنٍ)` → `✓ نجح 23)`) · `before-old-guard-ci-no-gh.txt` (CI=true, no gh → exit 0) |

## Repair

- Reader: `claims_active_rows` from `lib/claims_rows.sh` (single reader; Active|Paused exact; branch = column 4). No second parser.
- In CI (`CI=true` / `GITHUB_ACTIONS=true`) unreadable branches **or** open PRs ⇒ FAIL. Outside CI ⇒ declared skip (unchanged; CI is the judge).
- Open-PR read failure is no longer swallowed.
- Injection for tests only: `WASLA_BRANCHES_FILE`, `WASLA_PRS_FILE`, `WASLA_CLAIMS_FILE`, `WASLA_GH_BIN`; injection mode never calls `gh`.
- `ci.yml` governance-guard: job-level `permissions: {contents: read, pull-requests: read}` + `GH_TOKEN: ${{ github.token }}` on the verify-governance step. No `continue-on-error`, no gate removed.

## Regression cases (`scripts/checks/lib/gov-cases-branch-freshness.sh`, ج1–ج9)

`regression-cases-new-vs-old.txt`: new guard 16/16; the same cases against the old guard: 4 wrong
(ج1 Active claim, ج2 Paused claim, ج5 open PR head — old guard ignores injection / mis-parses; ج8 old guard ignores `WASLA_GH_BIN`).
Direct proof of defect B on the old guard is `before-old-guard-ci-no-gh.txt` (exit 0 in CI mode).

## Known consequence (not hidden)

With the repair, check 23 **will fail in CI** until these 5 platform branches (all merged PRs, no Active claim, no open PR)
are deleted or declared with a written reason in `BRANCH_EVIDENCE.md`:
`fix/gov-002-codeowner-eligibility-report` (#527) · `fix/gov-005-live-protection-measurement` (#526) ·
`fix/roadmap-freshness-tier1` (#525) · `fix/tier1-governance-remediation` (#524) · `skyosv10-art-patch-1` (#530).
They are **not** added to `BRANCH_EVIDENCE.md` here: declaring merged branches as "evidence" to turn the gate green would be
hiding the finding. Deleting them is an external GitHub change and is held under the current owner decision.

M0-44 is `Completed` on the board and RISK-0045 is `closed`, both on the basis of a guard that never enforced in CI.
Neither status is changed here; recorded as RISK-0055 for owner decision.
