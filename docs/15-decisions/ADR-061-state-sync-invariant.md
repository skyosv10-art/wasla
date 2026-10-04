# ADR-061 — STATE-SYNC: project state travels with the change, and the merge is the release

- **Status:** Accepted (Program Owner decision, 2026-10-04)
- **Claim / Work item:** CLM-0467 · M0-52
- **Rule:** [`docs/00-rules/STATE_SYNC_RULE.md`](../00-rules/STATE_SYNC_RULE.md)
- **Guards:** `scripts/checks/validate-state-sync.sh` (check 26), `scripts/checks/validate-merged-branches.sh` (check 27), `.github/workflows/merged-branch-cleanup.yml`

## Context

Agents work in sequence. When one stops (often because its credit runs out), the next one reads `main`. Measured on `main` `4cafdc6` (2026-10-04):

- 20 TASK_LOG entries still said "PR pending" for merged work.
- `CLM-0461` was `Active` although PR #610 had merged, and its branch was never deleted.
- Every implementation PR was followed by a separate "release" PR (#612, #614, #616, #618, #620). The first merge turned `main` red (check 4) until the second one landed.

Root cause: state was written in the future tense ("Active", "PR pending") and corrected in a second PR. If an agent stopped between the two, the false state stayed on `main`. The existing checks (check 3, Roadmap freshness) asked whether a ledger was touched, not whether it described the change and its state after merge.

## Decision

1. **One complete change.** A PR that changes the project carries its implementation, tests, evidence and project-state updates. All state in a PR is written as it will be true at merge.
2. **The merge is the release.** The claim row is added and closed (`Released`) in the same PR. `validate-work-claims.sh` accepts a branch row closed within the PR's own range, so no release PR is needed. In this model a claim is not a lock against parallel work.
3. **A mapped, measurable guard (check 26).** `state-sync-map.json` maps path categories to the records they require. `state_sync.py` checks content, not file touches:
   - claim closed, entry names the claim, work item and changed units
   - status not stale
   - board row and roadmap line updated
   - tests changed, or a stated reason
   - risk statuses equal the register
   - evidence paths exist, and deployment evidence is present
   - new guards are documented
   - deleted files are not still referenced

   An unmapped path is BLOCKED, never PASS. A ledger-only PR is BLOCKED unless it declares `**Kind:** state-correction|owner-decision` with a reason.
4. **Merge closes the cycle (check 27).** No merged branch may remain without a reason in `BRANCH_EVIDENCE.md`, and no `Active` claim may remain for merged work. The repository setting `delete_branch_on_merge` deletes branches at merge, and `merged-branch-cleanup.yml` deletes leftovers and verifies the deletion.
5. **The repository is the single source of truth.** `scripts/state/current-state.sh` derives the current state from the records on `main` and stores nothing.

## Consequences

- Release PRs disappear, and `main` no longer turns red after every merge.
- Checks 26 and 27 run inside `verify-governance.sh`, so they are part of the required contexts `governance-guard` and `verify`. No required context, branch-protection setting or existing guard is removed or weakened.
- The existing debt is corrected by addition in the same PR: the 20 stale statuses gain a measured "→ merged in PR #N" suffix, `CLM-0461` is released, and its branch is deleted.
- The guard measures linkage and consistency, not truth. Declared escape fields (`Kind`, `No-Test-Reason`, `Risk(s): none`) need a written reason that the code owner reviews.

## Alternatives rejected

- **Require every ledger in every PR.** This produces noise and empty edits, and does not prove the records describe the change.
- **A bot that writes the release after merge.** That is the catch-up PR again, and it fails the same way when the bot or the agent stops.
- **Use claims as parallel-work locks.** That does not address the problem: the failure is the handoff between sequential agents, not contention.
