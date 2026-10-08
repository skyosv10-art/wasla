# CLM-0508 — Record corrections (owner review 2026-10-08) + free-plan decision pack

**Date:** 2026-10-08T19:00Z · **Work item:** M6-18B · **Base:** main `cb7ba371` (rebased after #664 merged)
**Owner verdict recorded:** `RENDER_MIGRATION = COMPLETE` · `PROGRAM_CLOSEOUT = NOT_COMPLETE` · `M7 = BLOCKED`. No attempt to recreate the legacy environment or to reverse S12.

## 1. Governance review record — correction by addition (to CLM-0506 §3.2)

CLM-0506 §3.2 stated: "no independent CODEOWNERS review occurred". **That statement was incorrect.** Corrected wording:

> **All four PRs received independent CODEOWNER approval from `xuuux-voox` before merge.**

Measured (GitHub API, 2026-10-08T18:25Z):

| PR | Approval | Approved commit | Merged head | Merged at |
|---|---|---|---|---|
| #660 | xuuux-voox APPROVED 15:27:11Z | `a379123f` | `744e099b` (one CI-fix commit pushed 15:46Z after approval) | 16:00:27Z |
| #661 | xuuux-voox APPROVED 16:33:34Z | `8d97443b` | `4fb7319d` (one CI-fix commit pushed 16:44Z after approval) | 16:53:46Z |
| #662 | xuuux-voox APPROVED 17:21:55Z | `2408c046` | `2408c046` | 17:27:03Z |
| #663 | xuuux-voox APPROVED 17:51:32Z | `8a413ac0` | `8a413ac0` | 18:07:26Z |

`xuuux-voox` is listed in `CODEOWNERS`; branch protection: `require_code_owner_reviews=true`, `required_approving_review_count=1`, `dismiss_stale_reviews=false`. For #660/#661 the approval stood on an earlier commit — the pattern already recorded under RISK-0064. **No Secondary Owner added; CODEOWNERS and branch protection unchanged.** The original CLM-0506 text is preserved as history.

## 2. INC-0005 / S12 — deviation retained

Recorded by addition under INC-0005 (`docs/07-security/INCIDENTS.md`): S12 (deletion of the 24 legacy services) was executed **before the D-5 stabilization timings**, on the owner's explicit written order; it is a **documented deviation, not an amendment of D-5**; S12 is **irreversible**; **no rollback or recreation of the legacy environment** is attempted now.

## 3. P5-3 — stays DEFERRED (wording fixed)

- `AUTHENTICATION/REQUEST-BINDING PROVEN` — by the existing read-only negative probe (CLM-0500 phase-4 N1: unsigned request → 401 `AUTHN_UNAUTHENTICATED`).
- `AUTHENTICATED_ROUTE_EXECUTION NOT PROVEN`.
- No replay rows written in production; no authenticated business-flow probe executed.

## 4. Free-plan decision (owner) + decision pack

Owner decision: **the free plan is NOT approved for a field trial / real operation of critical webhook-driven services.** Decision pack: [`RENDER_PLAN_DECISION_PACK_2026-10-08.md`](../../../08-infrastructure/RENDER_PLAN_DECISION_PACK_2026-10-08.md) — critical tiers, options, monthly cost (recommended minimum B = 20 × $7 = $140/month), and the consequence. **New finding opened as RISK-0066:** with 15 targets scraped every 30 s, ~17 free services never sleep, so the workspace's 750 free hours/month are exhausted in ~44 h of wall time, after which Render suspends **all** free services (bots + paging) to month end (estimate; usage not exposed by the API). No billing change made — waits for owner approval.

## 5. Status

- M6-18B: **Blocked** (not Completed) on RISK-0058 (production partition drill) and RISK-0060 (Supabase Enforce SSL); plus RISK-0065 (credential rotation) and RISK-0066 (free-plan suspension).
- M7: not started; blocked until the governing M6 blockers are actually closed.
- Not performed: DNS changes, legacy recreation, infrastructure migration, production business writes, secondary-reviewer addition, billing change.
