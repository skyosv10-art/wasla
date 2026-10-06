# M6 Gate Readiness Report

**Date:** 2026-10-06
**Author:** @skyosv10-art (agent:perplexity-computer)
**Work Item:** M6-18B (HA/capacity/DR)
**Gate:** M6 closure review

---

## 1. Executive Summary

M6-18B is **NOT ready for gate decision**. Two of four blockers have been resolved this session; two remain open and require owner-level decisions or production verification.

---

## 2. Blockers (from LAUNCH_EXECUTION_BOARD)

### 2.1 RPO not met — RISK-0055 (mitigating)

**Status:** UNRESOLVED — owner decision required

**Current state:**
- Backup workflow (db-backup.yml) was failing since Oct 5 due to SSL error (`ESSLREQUIRED`). Fixed in CLM-0482 (PR #638 merged) — `WASLA_PG_SSL_MODE=require` added to `snapshot-dump.mjs` and workflow env.
- Manual backup trigger after fix: SUCCESS (run 37449007002, artifact `db-backup-20261006T101952Z.zip`, 751KB).
- DR restore drill after fix: PASS (run 37449489524).
- RPO measured from 7-day history: worst 54.72h, median 5.49h, current open gap 0.08h.
- 11 backup failures in 7 days (all from the SSL issue, now fixed).
- ADR-052 T1 target (5 min RPO): NOT MET.
- ADR-058 temporary exception: accepted by Program Owner on 2026-10-02, review 2026-10-13, hard expiry 2026-11-02.

**What prevents closure:** The 6-hour cron interval means median RPO is ~5.5h, not 5 min. Full closure requires PITR (Supabase Pro plan) or equivalent WAL solution. This is a budget/owner decision, not a code fix.

### 2.2 DR scenario 2 — RISK-0058 (mitigating)

**Status:** UNRESOLVED — production verification required

**Current state:**
- DB failure containment code in place (CLM-0438): `guardPgPool` in every runtime pool — connect 5s, query 15s, error listeners, breaker 5 failures/30s cooldown.
- CI scenario 2 PASS: no crash on drop, fast rejection, bounded latency, health 503 during/200 after, 16/16 bootable services recover ~1s.
- Closure requires: CI run of merged code recorded in evidence README + scenario 2 fleet re-run on production.

**What prevents closure:** The CI evidence README needs the run recorded. The production fleet re-run of scenario 2 has not been performed (requires deliberate DB partition on production — owner approval needed).

### 2.3 TLS not configured — RISK-0060 (mitigating)

**Status:** PARTIALLY RESOLVED — backup SSL fixed, production TLS still needs Enforce SSL

**Current state:**
- TLS code support exists (CLM-0453): `WASLA_PG_SSL_MODE` in `pg-guard.ts`, `verify-full` with CA pinning.
- Production Render services deployed with TLS-capable code (CLM-0454, CLM-0457).
- `WASLA_PG_SSL_MODE=verify-full` set on 17/17 Render services (CLM-0457).
- Backup workflow SSL: FIXED (CLM-0482) — `WASLA_PG_SSL_MODE=require` in `snapshot-dump.mjs` + `db-backup.yml`.
- Still open: Supabase "Enforce SSL" on production (`ppixaauyqoykrogwdxtv`) — needs token with `database_ssl_config_write` or owner dashboard toggle.
- Still open: plaintext-refused half of closure condition (4).

**What prevents closure:** Enabling Supabase "Enforce SSL" on production requires either a token with `database_ssl_config_write` permission on the production project, or the owner's dashboard toggle. The only available token sees the test project alone.

### 2.4 Cross-region latency — RISK-0061 (open)

**Status:** UNRESOLVED — owner-level infrastructure decision

**Current state:**
- 21 Render services in `oregon`, production DB pooler in `aws-0-ap-south-1` (Mumbai).
- Every cold connect crosses the Pacific (TCP + TLS + startup/auth).
- Measured: 1/98 false `probe_timeout` 503 at 2.5s probe (orders 2.80s end-to-end).
- Probe cannot grow further without breaking ADR-059 E3 (< 3s under partition).

**What prevents closure:** Compute and DB must be in one region (Render region move or co-located Supabase project). DR, residency and cutover implications make this an owner-level infrastructure decision.

---

## 3. Actions Completed This Session

| Action | Claim | PR | Status |
|---|---|---|---|
| RISK-0060 backup SSL fix | CLM-0482 | #638 | Merged, main CI green (after BASELINE fix) |
| BASELINE repo metadata fix (after #638) | CLM-0483 | #639 | Merged |
| BASELINE repo.commit fix (door 4) | CLM-0484 | #640 | Pending CODEOWNER review |
| Backup workflow manual trigger | — | run 37449007002 | SUCCESS |
| DR restore drill manual trigger | — | run 37449489524 | PASS |
| Stale branch deletion (5 branches) | — | — | DELETED |

### Deleted branches (documented evidence)
1. `docs/m6-18-live-evidence` — PR #542 MERGED, no active claim
2. `ops/risk-0056-pgtrgm-readonly` — no PR, no claim
3. `ops/risk-0056-prod-preflight` — no PR, no claim
4. `ops/risk-0056-readiness-report` — PR #550 CLOSED, no claim
5. `ops/risk-0056-test-db` — PR #549 CLOSED, no claim

---

## 4. Updated Risk Statuses

| Risk | Status | Change this session | Closure requires |
|---|---|---|---|
| RISK-0055 | mitigating | Backup workflow fixed (SSL). RPO still ~6h, not 5min. | PITR or owner decision to accept longer RPO |
| RISK-0058 | mitigating | No change. Code in place, needs production verification. | CI evidence + production scenario 2 re-run |
| RISK-0060 | mitigating | Backup SSL fixed (CLM-0482). Production TLS still needs Enforce SSL. | Supabase Enforce SSL on production |
| RISK-0061 | open | No change. | Owner infrastructure decision (region move) |

---

## 5. What Prevents M6-18B Closure

After the fixes in this session, the remaining blockers are:

1. **RPO target not met** (RISK-0055) — ADR-052 T1 requires 5 min RPO; measured median is 5.49h. This is a budget decision (PITR/Pro plan) or a formal owner decision to amend the target. ADR-058 temporary exception expires 2026-11-02.

2. **DR scenario 2 production verification** (RISK-0058) — Code is in place and CI-passing, but the production fleet re-run has not been performed. This requires deliberate DB partition on production (owner approval).

3. **Supabase Enforce SSL** (RISK-0060) — Production connections use TLS (verify-full), but the server does not refuse plaintext. This needs a token with `database_ssl_config_write` or the owner's dashboard toggle.

4. **Cross-region latency** (RISK-0061) — Compute (Oregon) and DB (Mumbai) on different continents. Owner-level infrastructure decision.

---

## 6. Gate Readiness Verdict

**M6-18B: NOT Ready For Gate Decision**

Two blockers (RISK-0055, RISK-0061) require owner-level decisions that cannot be resolved by code changes. One blocker (RISK-0058) requires production verification that needs owner approval for a deliberate DB partition. One blocker (RISK-0060) requires a Supabase API token with production permissions or the owner's dashboard action.

**Recommended next steps for the Program Owner:**
1. Decide on RPO: accept longer RPO permanently (amend ADR-052), or budget for PITR.
2. Approve production scenario 2 re-run for RISK-0058.
3. Provide a Supabase token with `database_ssl_config_write` on `ppixaauyqoykrogwdxtv`, or toggle "Enforce SSL" from the dashboard.
4. Decide on cross-region latency: accept, or plan a region move.
