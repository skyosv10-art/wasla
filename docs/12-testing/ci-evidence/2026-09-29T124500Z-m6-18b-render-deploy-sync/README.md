# M6-18B — Render deploy drift: root cause, fix, and commit-pinned sync

**Claim:** CLM-0401 · **Work item:** M6-18B · **Branch:** `fix/m6-18-deploy-sync-health` · **Measured:** 2026-09-29

## 1. What was measured before any change

| Measurement | Value | Raw evidence |
|---|---|---|
| `main` HEAD | `a6bf604` (2026-09-29T12:14Z) | `git log -1 origin/main` |
| Live commit on 18 app services | `4894f39` (2026-09-21) — **195 commits behind** `main` | [`deploy-history-raw.txt`](deploy-history-raw.txt) |
| Live commit on the 3 bots | `90910dc` (2026-09-21) | same |
| `autoDeploy` setting on all 24 services | `yes` / trigger `commit` | same |
| Deploys ever triggered by a commit (`new_commit`) | **0** — every trigger is `api` or `manual` | same (`grep -c new_commit` = 0) |
| GitHub webhooks on the repo | `[]` | `gh api repos/skyosv10-art/wasla/hooks` |
| GitHub deployments created by Render | none | `gh api repos/skyosv10-art/wasla/deployments` |
| Render build log | `It looks like we don't have access to your repo, but we'll try to clone it anyway.` | [`build-log-no-repo-access.txt`](build-log-no-repo-access.txt) |

## 2. Root cause

Every Render service was created from the **public repository URL**, not through a
connected Git provider. Render clones the public repo on demand but receives no push
events. Render's documentation states that for this linking method it "does not support
auto-deploys" ([Render — Web Services](https://render.com/docs/web-services)). So
`autoDeploy: yes` never did anything. Every deploy since creation was triggered by hand
or by a script, and production stopped moving when that stopped on 2026-09-21.

This was not a failed build. The last manual deploy of `56016a0` (2026-09-21T06:58) did end
`update_failed`, but the later `api` deploy of `4894f39` went live. After that, nothing
asked Render to deploy again.

## 3. Fix (two parts)

1. **Repo-side, commit-pinned deploy** — [`.github/workflows/render-deploy.yml`](../../../../.github/workflows/render-deploy.yml)
   runs on every push to `main` (docs-only pushes excluded). It calls
   [`scripts/deploy/render-sync.py`](../../../../scripts/deploy/render-sync.py) with the
   pushed SHA. The script then:
   - triggers `POST /services/{id}/deploys` with `commitId=<sha>`;
   - polls each deploy until it finishes;
   - reads the latest **live** deploy of each service and compares its commit to the target;
   - exits non-zero if any service is not live on that commit.

   The workflow **fails loudly** if the `RENDER_API_KEY` secret is missing. It never skips
   silently.
2. **Platform-side (owner decision)** — connect Render's GitHub integration and relink
   the services. That would make the native `autoDeploy` work. It can only be done from
   the Render dashboard with the owner's GitHub OAuth. Until then, part 1 is the mechanism
   that keeps Render on `main`.

No Render service setting, environment variable or secret was changed in this item.

## 4. Pre-flight sync (before this PR merges)

This sync proved that current `main` builds and runs on Render, so drift is not hiding a
build break. The 20 app, bot and static services were deployed at `a6bf604`:

- Result: **20/20 live on `a6bf604`**, verdict `PASS` — [`preflight-a6bf604-verify.json`](preflight-a6bf604-verify.json).
- `/health` after the sync: [`health-a6bf604.txt`](health-a6bf604.txt). 15 units answer `200`. **`delivery` and `search` answer `401`**. Their liveness route is prefixed (`/delivery/health`, `/search/health`), so a bare `/health` falls into the service-identity hook.

The 4 observability units (`prometheus`, `alertmanager`, `otel-collector`,
`observability`) are out of scope here. Their failure is a separate defect with its own
evidence, owned by M6-18C.

## 5. `/health` fix (same PR)

- `services/delivery/src/http/app.ts` and `services/search/src/http/app.ts` gain
  `GET /health` as `OPEN`. The body is the same dependency-free `{status:"ok"}` as the
  prefixed route. It carries no store, order or product data.
- Tests: `delivery` `service-identity.test.ts` and `search` `service-identity.test.ts`
  assert that `/health` returns 200, not 401. **Mutation check:** renaming the delivery
  route makes the test fail with `expected 401 not to be 401`. So the test bites.
- Guard 16 (authz matrix) re-measured `OPEN_ROUTES` as 19 ⇒ 21, and the matrix document
  was updated by addition.

## 6. After merge (appended when measured)

The post-merge sync to the merge commit and the `/health` re-measurement are appended
below. They are not claimed before they are measured.

### 6.1 Measured 2026-09-29T13:39Z–14:05Z — merge commit `871a3b77cadb274809bef7fe6ef2e3852550de82` (PR #541)

- **Sync:** 23 selected services = 20 app/bot/static + prometheus, alertmanager and otel-collector. All 23 triggered and live at `871a3b7`, verdict PASS ([`sync-871a3b7.json`](sync-871a3b7.json)). `wasla-observability` (root Dockerfile, previously `b94747a`) was synced separately, PASS ([`sync-observability-871a3b7.json`](sync-observability-871a3b7.json)).
- **Verify-only across all 24 `wasla-*` services:** every latest live deploy = `871a3b7`, verdict PASS ([`verify-all-871a3b7.json`](verify-all-871a3b7.json)).
- **/health after sync:** 20/20 app services **200, including `wasla-delivery` and `wasla-search`** (401 before the fix). Alertmanager: no credentials → 401, with credentials → 200. Prometheus and the collector have no `/health` (404 by design). Prometheus `/-/ready` → 200 ([`health-871a3b7.txt`](health-871a3b7.txt)).
- **The pipeline is no longer manual.** The repo secret `RENDER_API_KEY` was set on 2026-09-29. Documented reason: it is the only missing input of `render-deploy.yml`, and without it every main push leaves Render drifting again (the root cause of this item). The `render-deploy.yml` run on the merge push (`36576647803`) failed closed on attempt 1 (no secret), as designed. Attempt 2, re-run after the secret was set, went **success: 24 services PASS from GitHub Actions** ([`gha-render-deploy-run-36576647803-attempt2.txt`](gha-render-deploy-run-36576647803-attempt2.txt)). From now on every push to main that touches code deploys that exact commit and fails red on any mismatch.
