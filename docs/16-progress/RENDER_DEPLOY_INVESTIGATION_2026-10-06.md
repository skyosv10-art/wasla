# Render Deploy Investigation (Read-Only)

**Date:** 2026-10-06
**Author:** @skyosv10-art (agent:perplexity-computer)
**Scope:** Read-only investigation of Render deploy failures on main. No Render changes made.

---

## 1. Summary

The Render deploy workflow (`render-deploy.yml`) has been failing since CLM-0478 (2026-10-06T02:59:44Z). All 22 DB-backed and infrastructure services show `build_failed`. The last successful deploy was CLM-0477 (2026-10-06T01:57:47Z). All services remain live on commit `93a4e336` (CLM-0477).

This is NOT a blocker for M6-18B. Services are healthy and serving traffic. The deploy workflow is not a required CI check.

---

## 2. Timeline

| Run | Commit | Time (UTC) | Status | Duration |
|---|---|---|---|---|
| CLM-0477 (#633) | `93a4e336` | 2026-10-06T01:57:47Z | SUCCESS | ~58s |
| CLM-0478 (#634) | `60018e99` | 2026-10-06T02:59:44Z | FAILURE | ~0.47s |
| CLM-0482 (#638) | `078ad9ac` | 2026-10-06T09:50:32Z | FAILURE | ~0.47s |

---

## 3. Affected Services (22 total)

All services show `live=93a4e33 triggered=build_failed`:

wasla-audit, wasla-customer-app, wasla-customer-bot, wasla-customers, wasla-delivery, wasla-dispatch, wasla-driver-app, wasla-driver-bot, wasla-drivers, wasla-geography, wasla-identity, wasla-marketplace, wasla-matching, wasla-negotiations, wasla-observability, wasla-orders, wasla-otel-collector, wasla-partner-bot, wasla-prometheus, wasla-reputation, wasla-search, wasla-subscriptions

---

## 4. Current Live State

- **Live commit on all services:** `93a4e336` (CLM-0477, 2026-10-06T01:57:47Z)
- **Main HEAD:** `3b675aa9` (CLM-0485)
- **Gap:** 4 commits behind main (CLM-0478, CLM-0482, CLM-0483, CLM-0484, CLM-0485)

---

## 5. Root Cause Analysis

### Key observation
Both failed deploys finished in ~0.47 seconds. A real Render build takes ~58 seconds (CLM-0477). A 0.47-second failure means Render rejected the deploy at the trigger level, before any build step ran.

### Deploy mechanism
The `render-sync.py` script triggers `POST /services/{id}/deploys` with `{"commitId": "<sha>", "clearCache": "do_not_clear"}`. Render then attempts to fetch the commit from the public GitHub repository URL.

### Hypothesis
Render services are linked by public repository URL (`https://github.com/skyosv10-art/wasla`), without a connected Git provider (measured 2026-09-29, documented in `render-deploy.yml`). When Render receives a deploy trigger with a specific commit SHA, it must fetch that commit from GitHub's public API. The immediate `build_failed` response suggests Render cannot fetch the commit.

Possible causes (not verified — requires Render dashboard access):
1. **GitHub public API rate limiting** — unauthenticated requests are rate-limited; Render may hit the limit when fetching commits
2. **Render's Git provider connection expired** — the public repo URL may no longer be accessible from Render's build infrastructure
3. **Render internal cache miss** — the commit may not be in Render's cached clone of the repo

### What changed between success and failure
CLM-0477 (success) → CLM-0478 (failure). Code changes in CLM-0478:
- `packages/authz-policy/src/bindings.ts` — bindings notes updated
- `packages/authz-policy/src/__tests__/policy.test.ts` — test updates
- `package.json` — pnpm overrides for source-map-js and tinypool
- `pnpm-lock.yaml` — lockfile changes

These changes are unlikely to cause a 0.47-second build failure. The failure is at the Git fetch level, not the build level.

### What is NOT the cause
- The `snapshot-dump.mjs` SSL fix (CLM-0482) — this is an ops script, not a service
- The BASELINE.json changes — metadata only
- The docs/governance changes — not deployed to Render

---

## 6. Recommendation

This investigation is read-only. No Render changes were made. To resolve:

1. **Check Render dashboard** — verify the Git provider connection for each service. The workflow comments state "Render's build log states 'It looks like we don't have access to your repo'". This may have been resolved for CLM-0477 but regressed.
2. **Connect Render's GitHub integration** — this would replace the public URL with an authenticated connection, eliminating rate limiting.
3. **Check Render build logs** — the Render API returns no build logs for `build_failed` deploys (the `logs` field is null). Dashboard access is needed to see the actual error.
4. **Do not block M6 on this** — services are live and healthy. The deploy workflow is not a required CI check. Main CI (WASLA CI) is green.
