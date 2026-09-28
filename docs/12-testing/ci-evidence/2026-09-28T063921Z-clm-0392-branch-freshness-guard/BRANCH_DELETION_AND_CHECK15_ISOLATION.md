# CLM-0392 — stale branch deletion + check-15 test isolation defect (2026-09-28)

Addendum to [`README.md`](README.md) and [`STALE_BRANCH_REVIEW.md`](STALE_BRANCH_REVIEW.md). Nothing earlier is edited.

## 1. Branch deletion (owner-authorised 2026-09-28, exactly five branches)

Pre-deletion verification, per branch (all four conditions required):

| PR | Branch | Merged | Branch head = PR head | `git diff <squash> <branch>` | Open PR on branch | Claim | `refs/pull/N/head` |
|---|---|---|---|---|---|---|---|
| #524 | `fix/tier1-governance-remediation` | yes | `55593c3` = `55593c3` | empty | 0 | CLM-0385 Released | `55593c3` |
| #525 | `fix/roadmap-freshness-tier1` | yes | `1568eec` = `1568eec` | empty | 0 | CLM-0386 Released | `1568eec` |
| #526 | `fix/gov-005-live-protection-measurement` | yes | `dcb0b8a` = `dcb0b8a` | empty | 0 | CLM-0387 Released | `dcb0b8a` |
| #527 | `fix/gov-002-codeowner-eligibility-report` | yes | `3512624` = `3512624` | empty | 0 | CLM-0388 Released | `3512624` |
| #530 | `skyosv10-art-patch-1` | yes | `7e3943f` = `7e3943f` | empty | 0 | none (owner web edit) | `7e3943f` |

`DELETE /repos/skyosv10-art/wasla/git/refs/heads/<branch>` → `204 No Content` ×5 ([`branch-deletion-responses.txt`](branch-deletion-responses.txt)).
Platform branches 30 → 25 ([`branch-deletion-post-branches.txt`](branch-deletion-post-branches.txt)). No other branch touched.
`refs/pull/N/head` re-read **after** deletion: all five still resolve to the same commits ([`branch-deletion-pr-refs-retained.txt`](branch-deletion-pr-refs-retained.txt)).

## 2. Re-run of PR #532 CI after deletion

Run 36399295229 attempt 2 (head `de31741`): check 23 **executed** in both `governance-guard` and `verify` —
`البائتةُ: 0` · `✓ نجح 23)`. `governance-guard` = success. `verify` = **failure**, for a different reason (§3).

## 3. New finding — check-15 "offline" test cases were never offline on the CI runner

Symptom (verify, attempt 2): three cases in `lib/gov-cases-ci-verdict-audit.sh` expected `pass`, got `fail`:
`3cb44c35: السجلُّ يقولُ «blackout» والقياسُ الحيُّ «real»`.

Root cause: the cases isolate the guard from GitHub with `PATH=/usr/bin:/bin`. On the GitHub runner `gh` **is** `/usr/bin/gh`;
locally it is `/usr/local/bin/gh`. So the isolation was true locally only. The cases were "offline" on CI solely because the
`verify` job had no token. CLM-0392 gave `verify` a least-privilege read token (required by check 23), `gh` then answered, and
the guard correctly compared the synthetic `blackout` row with the real run for `3cb44c35` (`success`).
Same species as M0-38 (`rg` absent) and M0-39 (cwd): a case depending on something in its environment it neither declares nor verifies.

Not a defect of check 15 itself: the live audit (check 15 in `verify-governance.sh`) was green in both jobs.

Reproduced locally with `gh` symlinked into `/usr/bin` and a token set: harness from `main` = 12 pass / **3 fail** (the same three).

Fix (test isolation only; the guard is untouched):
- a tool directory built from `/usr/bin` + `/bin` **excluding `gh`**, `GH_TOKEN`/`GITHUB_TOKEN` unset, empty `GH_CONFIG_DIR`;
- new case (٠) asserts `gh` is not resolvable in that environment — the isolation is measured, not assumed.

Measured: new harness under the same CI-like conditions = 16 pass / 0 fail. Mutation (stop excluding `gh`, bytes differ by `cmp`)
= case (٠) fails plus the original three → the new case bites.

Rejected alternatives: removing the token from `verify` (check 23 would then fail-closed as "unreadable"); unsetting the token only
around check 23 (would move the problem, and hide that three cases were environment-dependent); loosening case expectations.
