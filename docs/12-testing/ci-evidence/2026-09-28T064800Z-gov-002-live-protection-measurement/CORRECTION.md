# Correction by addition (2026-09-28 · CLM-0391 · R54)

`README.md` in this directory is kept unchanged. Two statements in it are corrected here:

1. §5 "PR reviews required — PASS (count=1)": the value comes from `GET /protection/required_pull_request_reviews`.
   R54 measured that the effective rule has approvals **disabled** (GraphQL `requiresApprovingReviews:false`) and that a
   0-review PR is mergeable (`mergeStateStatus:CLEAN`). Correct verdict for that row: **FAIL — approvals not required**.
2. §4 "count was added AFTER PR #525 merge": an inference from review counts, not a measurement. The time the stored
   count appeared is **NOT VERIFIED**; this directory's label `064800Z` is local time (real ≈03:48Z UTC).

Evidence: `../2026-09-28T063026Z-risk-0054-r54-review-enforcement/README.md` · RISK-0054.
