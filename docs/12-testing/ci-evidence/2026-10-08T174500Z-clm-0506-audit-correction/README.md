# CLM-0506 — M6-18B: audit correction to the CLM-0503..0505 execution record

**Date:** 2026-10-08T17:45Z · **Work item:** M6-18B · **main at start:** `17fb3a3c`
**Nature:** corrections by addition to the execution record — no production change, no code. The migration's measured outcomes stand; the corrections below fix claims that overstated what was measured, and record procedural deviations instead of presenting them as compliance.

## 1. Claims corrected

| # | Original claim (where) | Correction |
|---|---|---|
| 1 | CLM-0503 §1 "env key parity old→new 22/22 identical key sets" — later prose drifted to "env parity" | What was measured is **key-set** parity (same env var names per service). **Values were not compared** by this executor. The prometheus/alertmanager env values were copied verbatim from the legacy services via the Render API at creation; the other 22 services were created by CLM-0498's process. Value equivalence is plausible but **not re-measured** |
| 2 | CLM-0504 §4 / CLM-0505 §3 "P5-4 PASS" | Measured: a **snapshot** — 15 active targets all `up` (17:05Z) and again at 17:10Z. The gate's **≥ 1 h continuous** requirement was **not satisfied** within the session. P5-4 = snapshot-PASS, continuous-PASS **not proven** |
| 3 | CLM-0505 §5 "no secret was printed or stored" | **Inaccurate.** (a) The three `*_BOT_WEBHOOK_SECRET` values were written to a session temp file (`/tmp/wh_secrets.json`, deleted, never in git). (b) A production `DATABASE_URL` (Supabase pooler, password included) was printed in the executor's session log during a URL audit. **No secret entered the git tree** (scan-secrets + verify green on every PR). Owner action recommended: rotate the production DB password and the three bot webhook secrets |
| 4 | CLM-0505 §5 "recovery path … redeploy from main via render-sync.py" | `render-sync.py` deploys to **existing** services; it cannot recreate the deleted legacy services, their hosts, or their env. Recovery from the deletion = **recreate** the services from the repo definitions + re-register the webhooks. There is no rollback of S12 (CLM-0502 §11.7 already said so; this correction aligns the text) |
| 5 | "health 24/24" (CLM-0505 §3) | The 404s on `/health` for `wasla-otel-collector` and `wasla-observability` are their normal public behaviour (no `/health` route) — **their readiness is not proven by that probe**; the collector's function was not directly verified this session (its config source is the targets registry). Completed measurement: the Alertmanager answers **200 authenticated** on `/-/ready` and `/-/healthy` (17:40Z) — readiness now properly proven, not just the 401 fail-closed |

## 2. Gates not satisfied (recorded as unmet, not exempted)

- **D-5 stabilization timings:** ≥ 24 h after the last bot cutover and ≥ 14-day freeze before deletion were **not satisfied**. The deletion was executed on the owner's explicit written order in this session («تحقق من النقل ثم احذف كل خدمات القديمة»), which conflicted with the recorded D-5 conditions. This is recorded as an **owner-instructed deviation**, not as an approved amendment of D-5. The consequences are real: the legacy stack no longer exists as a rollback path, and the stabilization window was never observed.
- **P5-3 (authenticated probes):** still DEFER (D-3), unresolved by the migration.
- **ADR-068 ratification:** the CLM-0503 record assumed execution approval covered it; explicit ADR-068 ratification by the owner is still not on record (it was *Proposed* at CLM-0502).

## 3. Procedural deviations (recorded, not erased)

1. **Claim scope widened after start (WORK_CLAIM_RULE §6):** CLM-0505's claim row was extended post-start to include `docs/12-testing/BASELINE.json`/`.txt` (the guard demanded coverage for files the register change forced). The guard passed because the row was modified in the same PR; the rule's pre-work declaration was still not followed.
2. **Secondary Owner empty** on all three entries — single-agent execution under the owner's executive delegation; no independent CODEOWNERS review occurred (the Devin review reported "trial expired, review skipped"). Merges were auto-merges on green CI per the owner's standing instruction; `CLEAN`/green is not a substitute for the review the protocol describes.
3. **Two CI reds were fixed on-branch** (CLM-0503: state-anchored guard; CLM-0504: pre-flip test literal) — root-cause fixes, no gate disabled; recorded here for completeness.

## 4. Residual owner actions (carried, unchanged)

- Rotate the production DB password + the 3 bot webhook secrets (§1.3).
- The old Render API key remains valid and the `RENDER_OWNER_ID` repo secret still names the (now empty) legacy workspace — the owner may revoke/rotate both at will; nothing depends on them now.
- Render free-plan sleep risk (CLM-0503 §6) and P5-3 (D-3) remain open owner decisions.

## 5. Verification

`validate-state-sync.sh` + `verify-governance.sh` local run before push; CI on this PR is the merge authority. No deployment effect: docs only.
