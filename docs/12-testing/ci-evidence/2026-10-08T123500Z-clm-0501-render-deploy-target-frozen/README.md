# CLM-0501 — INC-0005: main → Render auto-deploy hit the frozen legacy workspace; deploy target now declared `frozen`

**Date:** 2026-10-08T12:22–12:40Z · **Work item:** M6-18B · **Incident:** INC-0005 (`docs/07-security/INCIDENTS.md`)

## Measured (read-only Render API with both keys, GitHub API)

| Item | Value |
|---|---|
| Trigger | merge of PR #655 → main `a02a5b8` (first non-docs merge of the blue/green window) |
| Workflow run | [37776416388](https://github.com/skyosv10-art/wasla/actions/runs/37776416388) `Render deploy (main → Render, commit-pinned)` — cancelled by the agent at 12:25Z, final `completed/cancelled` |
| Deploys created on legacy `tea-damm8atbedkc73ca3ahg` | **24** (all 24 services, 12:22:46–12:23:24Z, trigger `api`, commit `a02a5b8`) — **24/24 `build_failed`** |
| Deploys created on new `tea-db0vtkpsrm7s739dm5c0` | **0** |
| Legacy live commit after the event | `93a4e33` on 24/24 (unchanged) |
| Legacy `/health` after the event | identity 200 · orders 200 · customer-bot 200 · partner-bot 200 |
| Legacy env / suspension | unchanged / none suspended |

## Root cause

`scripts/deploy/render-sync.py` defaulted to `OWNER = os.environ.get("RENDER_OWNER_ID", "tea-damm8atbedkc73ca3ahg")`. The workflow runs on every non-docs push to main with the repository secret `RENDER_API_KEY` (legacy key). The Phase 4 inventory of automation listed scheduled workflows, not push-triggered ones.

## Fix

| File | Change |
|---|---|
| `infra/render/deploy-target.json` | new — the single source of the deploy workspace; `mode: frozen`, `frozen_owners: [legacy]` |
| `scripts/deploy/render-sync.py` | no built-in workspace. `frozen` → FROZEN report, exit 0, no network. `deploy` → non-frozen `owner_id` required, and every service must carry it |
| `scripts/checks/validate-render-deploy-target.sh` · `scripts/verify.sh` · `docs/00-rules/VERIFY_COMMAND.md` | mandatory guard with 6 mutation self-tests |
| `docs/07-security/INCIDENTS.md` · `RISK_REGISTER.md` | INC-0005; RISK-0063 note (status unchanged) |

## Results (local; CI is the verdict)

```
  ✓ Render deploy target declared (frozen); render-sync.py has no built-in workspace; frozen mode deploys nothing without network
  ✓ self-test: 6/6 mutations caught
render-sync.py a02a5b8 (no RENDER_API_KEY) → ::notice:: FROZEN — nothing deployed · rc=0 · report verdict FROZEN, deployed 0
```

Merging this PR triggers the same workflow. It checks out the merge commit, which contains `mode: frozen`, so it deploys nothing. The run is recorded in the CLM-0500 report.

## Unfreezing (Phase 5, owner-approved)

A reviewed PR sets `mode: deploy` and `owner_id` to the new workspace, and the owner replaces the repository secret `RENDER_API_KEY` with the new workspace key. The script refuses a key that does not see the declared owner's services.
