# CLM-0392 — reconciliation of `main` (b4dcf2f, PR #531) into PR #532 (2026-09-28)

Addendum. Nothing earlier is edited. Method: `git merge --no-ff origin/main` into `fix/m0-44-branch-freshness-guard`
(merge commit `2d6be59`) — no rebase, no force push, no `-X ours/theirs`, no wholesale side selection. One conflict hunk per file.

## 0. What landed on `main` (read-only, measured 2026-09-28T11:00Z)

| Field | Value |
|---|---|
| PR | #531 `fix/gov-002-owner-dependency-gate-audit` (CLM-0391) |
| Author | `skyosv10-art` |
| Merged by | `xuuux-voox` |
| Merged at | 2026-09-28T10:56:34Z |
| Merge commit | `b4dcf2ff15a7baad23b1700e828dbde4e3f028a4` (true merge; parents `ae5646e`, `3a06b2f`) |
| Reviews on #531 | **0** (`GET /pulls/531/reviews` → `[]`) |
| CODEOWNERS on `main` after merge | 69 entries, all `@skyosv10-art`; `@xuuux-voox` **not** listed; `codeowners/errors` = 0 |
| PRs authored by `xuuux-voox` | none |

Recorded as fact, not interpreted: this was not the CODEOWNERS bootstrap PR. It is a 0-review merge by a Write (non-admin)
collaborator under `enforce_admins=true` and REST `required_approving_review_count=1` — consistent with RISK-0054
(GraphQL `requiresApprovingReviews=false`). RISK-0054 status not changed.

## 1. Per-file reconciliation

| File | Conflict | `main` version | PR #532 version | Resolution | Why | Evidence |
|---|---|---|---|---|---|---|
| `docs/07-security/RISK_REGISTER.md` | both appended one row after RISK-0053 | adds RISK-0054 (open) | adds RISK-0055 (open) | both rows, RISK-0054 then RISK-0055 | independent risks; neither may disappear | `grep -c '^RISK-005[45]'` = 2 |
| `docs/16-progress/WORK_CLAIMS.md` | both appended one claim row | adds CLM-0391 (Active) | adds CLM-0392 (Active) | both rows unchanged, 0391 then 0392 | no claim lost, no claim released or closed | both rows present; statuses unchanged |
| `ROADMAP.md` | both appended a 2026-09-28 section | CLM-0391 sections (GOV-002 owner dependency; R54 classification) | CLM-0392 section | both, chronological (0391 at 05:45Z/06:30Z, then 0392 from 06:39Z) | Phase 2 history kept in full | both headings present |
| `docs/16-progress/TASK_LOG.md` | both prepended an entry at top | two CLM-0391 entries | CLM-0392 entry | all three, newest first, `---` separator restored | no log entry dropped | three headings present |
| `docs/16-progress/LAUNCH_EXECUTION_BOARD.md` | both extended the M0-45 evidence cell | GOV-002/RISK-0054/PR #530 text | CLM-0392 text | shared prefix + `main` text + PR text; the PR's own sentence "Fails until 5 stale … branches are resolved" replaced by the recorded fact (deleted 09:10Z; check 23 PASS, run 36404639360) | keep latest documented fact; no status regressed — M0-45 `In Progress`, M6-19B/M6-19C stay `Blocked` (from `main`) | board rows |
| `docs/12-testing/BASELINE.json` | header block (`generated_at`, `repo.*`) | generated on `8f9f752` | generated on `565600c` | regenerated from measurement (`scripts/baseline.sh`, commit `5d5bda2`); `dynamic` kept exactly as committed on both sides | each side counted `risks_not_closed=33`; merged tree measures **34** (0054 + 0055). Door 2 requires committed = live; counts were measured, not chosen | `validate-baseline.sh`: doors 1–4 pass |

## 2. Local verification on `5d5bda2` (pnpm 9.15.9, node 20.20.1, frozen lockfile)

`pnpm run governance:verify` rc=0 (check 23 executed, 0 stale) · `pnpm run typecheck` rc=0 · `pnpm run test` rc=0
(57 parallel · 14 serial) · `pnpm run verify` rc=0 (governance suite 537 pass · 0 fail). Local green is not the CI verdict; CI on the pushed head decides.
