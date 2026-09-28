# R54 — RISK-0054 read-only investigation (review-enforcement mismatch)

Measured: 2026-09-28T06:30:26Z (real UTC, `measured_at.txt`); two follow-up reads at ≈06:42Z (`raw-protection-luke-cage.json`,
`raw-branch-main.json`, `raw-rule-suites.txt`, `raw-pr-531-mergeability.json`). Every call was a GET or a GraphQL **query**.
No setting, PR, review or branch was changed. Response headers stripped from `.txt` files (status line kept).

## Four surfaces, one question: are approvals required on `main`?

| Surface | File | Reading |
|---|---|---|
| REST `/branches/main/protection` | `raw-protection.txt`, `raw-protection-luke-cage.json` | **no** `required_pull_request_reviews` key |
| REST `/protection/required_pull_request_reviews` | `raw-required-pr-reviews.json` | 200 · `required_approving_review_count: 1` · `require_code_owner_reviews: false` |
| GraphQL `branchProtectionRules` (pattern `main`) | `raw-graphql-branch-protection-rules.json` | `requiresApprovingReviews: false` · `requiredApprovingReviewCount: null` · `isAdminEnforced: true` · no bypass allowances |
| Behaviour | `raw-pr-52x.json`, `raw-pr-531-mergeability.json` | #524–#530 merged with 0 reviews, `reviewDecision: null`; open #531 with 0 reviews is `mergeStateStatus: CLEAN`, `viewerCanMergeAsAdmin: false` |

Ruled out by evidence: rulesets (`raw-rulesets.json` `[]`, `raw-rules-branch-main.json` `[]`, `raw-rule-suites.txt` `[]`),
admin exemption (`isAdminEnforced: true`, `viewerCanMergeAsAdmin: false`, no bypass lists), merge-path difference (no merge
queue, `allow_auto_merge: false`, every merge is a squash — one parent, committer GitHub, `(#N)` suffix).

## Classification

- **ROOT CAUSE: CONFIGURATION DEFECT** — the effective protection rule does not require approvals.
- **CAUSE OF API DISCREPANCY: NOT VERIFIED** — why the sub-endpoint returns a stored count of 1 while the rule has
  approvals disabled is GitHub-internal and was not measured. No hypothesis is recorded as fact.
- Time `required_approving_review_count=1` first appeared: **NOT VERIFIED** (no audit-log API for a user-owned repo). The first
  sub-endpoint read is the `…T064800Z` directory (label is local time; real ≈03:48Z), after #525 (03:35:34Z) and before #526
  (04:16:39Z). Earlier snapshots read only the top-level `/protection`, which omits the block even today.

## Consequence for earlier evidence (corrected by addition, nothing deleted)

- `…T064800Z-gov-002-live-protection-measurement/README.md` "PR reviews required: PASS (count=1)" and its inference that the
  count "was added after PR #525" are a sub-endpoint reading, not enforcement. The `protection.required_pull_request_reviews`
  object in `MERGE_BLOCKING.json` is the same reading; `review_requirement_effective` records the effective state beside it.
- `GOV-002_ACTIVATION_RUNBOOK.md` activation by PATCH on the sub-endpoint is **not proven effective**; its verification must be
  read from GraphQL and from `mergeStateStatus`, and must not use a live merge attempt (see runbook §8).
