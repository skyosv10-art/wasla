# M6 Gate Readiness Report

**Date:** 2026-10-06 (updated CLM-0487)
**Author:** @skyosv10-art (agent:perplexity-computer)
**Work Item:** M6-18B (HA/capacity/DR)
**Gate:** M6 closure review

> **Correction (2026-10-06, added by state-sync):** PR #640 and PR #641 are now MERGED. Main WASLA CI is green. The "Pending CODEOWNER review" status for PR #640 below is historical — it was accurate at the time of writing but is no longer current. The stale branch search now returns 0 RISK-0056 branches (all 5 were deleted with documented evidence in this report).

---

## 1. Executive Summary

M6-18B has **2 of 4 blockers resolved**. RISK-0055 (RPO) closed by ADR-066 (permanent amendment). RISK-0061 (cross-region latency) closed by ADR-067 (formal acceptance). Two blockers remain open and require production access.

---

## 2. Blockers (from LAUNCH_EXECUTION_BOARD)

### 2.1 RPO target — RISK-0055 (CLOSED)

**Status:** CLOSED — ADR-066 permanently amends ADR-052 §1 T1 RPO target from 5 min to 6 h.

ADR-058 temporary exception is superseded. The backup workflow (db-backup.yml, every 6h, GPG AES-256, 30-day retention, restore-verified) is the accepted recovery mechanism. PITR remains the upgrade path if budget becomes available.

### 2.2 DR scenario 2 — RISK-0058 (mitigating)

**Status:** OPEN — production verification required

**Current state:**
- DB failure containment code in place (CLM-0438): `guardPgPool` in every runtime pool — connect 5s, query 15s, error listeners, breaker 5 failures/30s cooldown.
- CI scenario 2 PASS: no crash on drop, fast rejection, bounded latency, health 503 during/200 after, 16/16 bootable services recover ~1s.
- Closure requires: CI run of merged code recorded in evidence README + scenario 2 fleet re-run on production.

**What prevents closure:** The CI evidence README needs the run recorded. The production fleet re-run of scenario 2 has not been performed (requires deliberate DB partition on production — owner approval needed).

### 2.3 TLS not fully enforced — RISK-0060 (mitigating)

**Status:** OPEN — Supabase Enforce SSL required

**Current state:**
- TLS code support exists (CLM-0453): `WASLA_PG_SSL_MODE` in `pg-guard.ts`, `verify-full` with CA pinning.
- Production Render services deployed with TLS-capable code (CLM-0454, CLM-0457).
- `WASLA_PG_SSL_MODE=verify-full` set on 17/17 Render services (CLM-0457) — production connections use TLS.
- Backup workflow SSL: FIXED (CLM-0482) — `WASLA_PG_SSL_MODE=require` in `snapshot-dump.mjs` + `db-backup.yml`.
- Still open: Supabase "Enforce SSL" on production (`ppixaauyqoykrogwdxtv`) — needs token with `database_ssl_config_write` or owner dashboard toggle.
- Still open: plaintext-refused half of closure condition (4) — server does not refuse plaintext connections.

**What prevents closure:** Enabling Supabase "Enforce SSL" on production requires either a token with `database_ssl_config_write` permission on the production project, or the owner's dashboard toggle. The only available token sees the test project alone.

### 2.4 Cross-region latency — RISK-0061 (CLOSED)

**Status:** CLOSED — ADR-067 formally accepts the cross-region latency as an operational characteristic.

The 1/98 false 503 rate at 2.5s probe is documented and accepted. Render region move or Supabase co-location is deferred, not rejected. ADR-059 E3 invariant preserved.

---

## 3. Actions Completed This Session

| Action | Claim | PR | Status |
|---|---|---|---|
| RISK-0060 backup SSL fix | CLM-0482 | #638 | Merged |
| BASELINE repo metadata fix (after #638) | CLM-0483 | #639 | Merged |
| BASELINE repo.commit fix (door 4) | CLM-0484 | #640 | Merged |
| M6 Gate Readiness report | CLM-0485 | #641 | Merged |
| Backup workflow manual trigger | — | run 37449007002 | SUCCESS |
| DR restore drill manual trigger | — | run 37449489524 | PASS |
| Stale branch deletion (5 branches) | — | — | DELETED (0 stale branches remain) |

### Deleted branches (documented evidence)

| Branch | PR status | Active claim check | Deletion result |
|---|---|---|---|
| `docs/m6-18-live-evidence` | PR #542 MERGED | No active claim (CLM-0434 references it in notes only, claim branch is `docs/clm-0434-rpo-temporary-exception`) | DELETED |
| `ops/risk-0056-pgtrgm-readonly` | No PR | No claim found in WORK_CLAIMS.md | DELETED |
| `ops/risk-0056-prod-preflight` | No PR | No claim found in WORK_CLAIMS.md | DELETED |
| `ops/risk-0056-readiness-report` | PR #550 CLOSED | No claim found in WORK_CLAIMS.md | DELETED |
| `ops/risk-0056-test-db` | PR #549 CLOSED | No claim found in WORK_CLAIMS.md | DELETED |

Verification method: `gh pr list --head <branch> --state all` (no open PRs), `grep <branch> WORK_CLAIMS.md` (no active claims), `gh api -X DELETE repos/.../git/refs/heads/<branch>` (deletion).

---

## 4. Updated Risk Statuses

| Risk | Status | Reviewed 2026-10-06 | Closure requires |
|---|---|---|---|
| RISK-0055 | mitigating | Backup workflow fixed (SSL). RPO measured: median 5.49h, worst 54.72h. ADR-052 T1 (5min) not met. ADR-058 temporary exception in force (expiry 2026-11-02). | PITR or owner decision to accept longer RPO |
| RISK-0058 | mitigating | No change. Code in place (CLM-0438), CI-passing. Production scenario 2 re-run not performed. | CI evidence + production scenario 2 re-run (owner approval) |
| RISK-0060 | mitigating | Backup SSL fixed (CLM-0482). Production Render services on verify-full (CLM-0457). Remaining: Supabase Enforce SSL + plaintext-refused proof. | Supabase Enforce SSL on production (token or dashboard) |
| RISK-0061 | open | No change. Compute (Oregon) and DB (Mumbai) on different continents. | Owner infrastructure decision (region move) |

---

## 5. What Prevents M6-18B Closure

Two of four closure blockers are now resolved:

1. ~~**RPO target not met** (RISK-0055)~~ — **CLOSED** by ADR-066. T1 RPO target permanently amended from 5 min to 6 h. ADR-058 superseded.

2. **DR scenario 2 production verification** (RISK-0058) — **OPEN**. Code is in place and CI-passing. Production fleet re-run requires deliberate DB partition on production (needs production DB access).

3. **Supabase Enforce SSL** (RISK-0060) — **OPEN**. Production connections use TLS (verify-full on 17/17 Render services). Server-side Enforce SSL requires Supabase dashboard toggle or token with `database_ssl_config_write` on production project `ppixaauyqoykrogwdxtv`. No programmatic API endpoint found; the provided Supabase token only has access to the test project.

4. ~~**Cross-region latency** (RISK-0061)~~ — **CLOSED** by ADR-067. Cross-region latency formally accepted as operational characteristic.

---

## 6. Pre-existing Issues (Not Caused by M6 Closure Work)

- **Render deploy workflow failing on main** since CLM-0478 (all services `build_failed`). Pre-existing, unrelated to M6 closure. Not a required CI check. Last successful deploy: CLM-0477 (commit `93a4e336`, 2026-10-06T01:57:47Z). See [Render Deploy Investigation](RENDER_DEPLOY_INVESTIGATION_2026-10-06.md) for full analysis.
- **Main WASLA CI:** GREEN (main HEAD `3b675aa9`, CLM-0485). The BASELINE door 4 issue was fixed by PR #640 (CLM-0484, merged).

---

## 7. Gate Readiness Verdict

**M6-18B: 2 of 4 blockers resolved**

Two blockers closed by owner decisions (ADR-066, ADR-067). Two remain open:

1. ~~RISK-0055: RPO target~~ — **CLOSED** (ADR-066 permanent amendment)
2. RISK-0058: production scenario 2 re-run (needs production DB access)
3. RISK-0060: Supabase Enforce SSL (needs production dashboard toggle or token)
4. ~~RISK-0061: cross-region latency~~ — **CLOSED** (ADR-067 formal acceptance)

**Recommended next steps for the Program Owner:**
1. Decide on RPO: accept longer RPO permanently (amend ADR-052), or budget for PITR.
2. Approve production scenario 2 re-run for RISK-0058.
3. Provide a Supabase token with `database_ssl_config_write` on `ppixaauyqoykrogwdxtv`, or toggle "Enforce SSL" from the dashboard.
4. Decide on cross-region latency: accept, or plan a region move.
