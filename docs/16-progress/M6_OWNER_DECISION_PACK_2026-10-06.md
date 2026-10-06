# M6-18B Owner Decision Pack

**Date:** 2026-10-06
**Author:** @skyosv10-art (agent:perplexity-computer)
**Work Item:** M6-18B (HA/capacity/DR)
**Purpose:** Convert the 4 remaining M6-18B blockers into clear owner decisions. No implementation. No execution.

---

## Decision 1: RPO Target — RISK-0055

### Current state (measured)
- Backup workflow: GitHub Actions cron every 6h. pg_dump → GPG AES-256 → 30-day artifact retention.
- Backup SSL fixed (CLM-0482). Manual backup SUCCESS (run 37449007002).
- RPO measured (7-day window): median 5.49h, worst 54.72h, current open gap 0.08h.
- ADR-052 T1 target: 5 min RPO. NOT MET.
- ADR-058 temporary exception: accepted 2026-10-02, review 2026-10-13, hard expiry 2026-11-02.

### Option A: PITR / Supabase Pro
- **What:** Enable Supabase PITR (Point-in-Time Recovery) on production project `ppixaauyqoykrogwdxtv`. Requires Supabase Pro plan ($25/month).
- **Effect:** RPO drops from ~6h to ~5 min (PITR retains WAL segments for continuous replay).
- **Cost/risk:** Monthly cost. PITR adds storage and compute overhead. Restore from PITR is more complex than pg_dump restore. Requires Supabase dashboard action or API token with billing permissions.
- **Closure path:** Enable Pro → enable PITR → measure RPO ≤ 5 min → link evidence → close RISK-0055.
- **Rollback:** Disable PITR / downgrade plan. No data loss.

### Option B: Amend RPO target
- **What:** Formally amend ADR-052 to accept a longer RPO (e.g., 6h or 1h) as the operational target.
- **Effect:** RISK-0055 can close with the current backup workflow if the new target is met.
- **Cost/risk:** Accepting longer data loss window. ADR-052 amendment requires ADR. Must be a deliberate risk acceptance, not a silent drift.
- **Closure path:** Draft ADR amendment → Program Owner approves → update RISK_REGISTER → measure RPO meets new target → close RISK-0055.
- **Rollback:** Revert ADR amendment. No data loss.

### Decision required
**A (PITR/Pro) or B (amend RPO)?** If A, owner provides Supabase access or budget. If B, owner approves ADR amendment.

---

## Decision 2: Production DB-Partition Drill — RISK-0058

### Current state (measured)
- DB failure containment code in place (CLM-0438): `guardPgPool` — connect 5s, query 15s, error listeners, breaker 5 failures/30s cooldown.
- CI scenario 2 PASS: no crash on drop, fast rejection, bounded latency, health 503 during/200 after, 16/16 services recover ~1s.
- Production fleet re-run NOT performed.

### What is requested
**Owner approval to perform a deliberate DB partition on production.**

The drill would:
1. Temporarily block the production database connection (e.g., via firewall rule or Supabase pause).
2. Verify that services answer 503 (not crash), breaker trips, and recovery is automatic.
3. Measure RTO.
4. Restore DB connectivity.
5. Verify services recover to 200.

### Impact
- **Services affected:** All 17 DB-backed services.
- **Duration:** ~2-5 minutes of degraded service (503s during partition + recovery).
- **Risk:** Low — code is CI-tested. The drill verifies production behavior matches CI.
- **Data risk:** None — no data is written or deleted. The DB is temporarily unreachable, not modified.

### Closure path
Owner approves → schedule drill window → execute → measure → link evidence → close RISK-0058.

### Rollback
Remove the partition. Services recover automatically (breaker resets).

### Decision required
**Approve production DB-partition drill?** If yes, specify time window.

---

## Decision 3: Supabase Enforce SSL — RISK-0060

### Current state (measured)
- TLS code support exists (CLM-0453): `WASLA_PG_SSL_MODE` in `pg-guard.ts`.
- Production Render services: `WASLA_PG_SSL_MODE=verify-full` on 17/17 services (CLM-0457). Connections use TLS.
- Backup workflow: `WASLA_PG_SSL_MODE=require` (CLM-0482). Fixed.
- Supabase "Enforce SSL" on production `ppixaauyqoykrogwdxtv`: NOT ENABLED.
- Plaintext-refused proof: NOT measured.

### What is requested
**Enable Supabase "Enforce SSL" on production project `ppixaauyqoykrogwdxtv`.**

This can be done by:
- **Option A:** Owner toggles "Enforce SSL" from the Supabase dashboard (Settings → Database → Connection Pooling → Enforce SSL).
- **Option B:** Owner provides a Supabase API token with `database_ssl_config_write` permission on the production project. The agent will call the Supabase API to enable it.

### Impact
- **Services:** All connections already use TLS (verify-full). Enforce SSL refuses plaintext at the server level. No service change needed — connections are already TLS-encrypted.
- **Risk:** If any connection is NOT using TLS, it will be refused. All production services have `WASLA_PG_SSL_MODE=verify-full`. The backup workflow uses `require`. Migrations use `pgSslFromEnv`. No plaintext connections are expected.
- **Verification:** After enabling, measure that a plaintext connection is refused.

### Closure path
Enable Enforce SSL → measure plaintext refused → measure TLS still works → link evidence → close RISK-0060.

### Rollback
Disable Enforce SSL from dashboard. No data loss.

### Decision required
**A (dashboard toggle) or B (provide API token)?**

---

## Decision 4: Cross-Region Latency — RISK-0061

### Current state (measured)
- 21 Render services in `oregon`, production DB pooler in `aws-0-ap-south-1` (Mumbai).
- Every cold connect crosses the Pacific (TCP + verify-full TLS + startup/auth).
- Measured: 1/98 false `probe_timeout` 503 at 2.5s probe (orders 2.80s end-to-end max).
- Probe cannot grow further without breaking ADR-059 E3 (< 3s under partition).

### Option A: Accept cross-region latency
- **What:** Formally accept the measured latency as an operational characteristic.
- **Effect:** RISK-0061 closes (or moves to accepted/deferred). The 1/98 false 503 rate is documented.
- **Cost/risk:** Occasional false 503s on cold connects. No data loss. User-facing impact is rare (1 in 98 idle-spaced probes).
- **Closure path:** Document acceptance in ADR → update RISK_REGISTER → close RISK-0061.
- **Rollback:** Reopen if false 503 rate increases.

### Option B: Move Render services to Mumbai
- **What:** Change Render service regions from `oregon` to `aws-ap-south-1` (Mumbai).
- **Effect:** Eliminates cross-Pacific latency. Cold connects become local. False 503 rate drops to 0.
- **Cost/risk:** Render region change requires redeploying all 22 services. Brief downtime during region migration. Render pricing may differ by region. DR implications (Mumbai is a single region — no multi-region HA).
- **Closure path:** Plan region migration → execute → re-measure → link evidence → close RISK-0061.
- **Rollback:** Move back to Oregon. Significant operational cost.

### Option C: Move Supabase to Oregon
- **What:** Create a new Supabase project in `us-west-2` (Oregon) and migrate.
- **Effect:** Eliminates cross-Pacific latency. Both compute and DB in the same region.
- **Cost/risk:** Full database migration. Supabase project creation, data migration, DNS/env var updates, verification. Highest cost and risk of all options. DR/residency implications.
- **Closure path:** Plan DB migration → execute → re-measure → link evidence → close RISK-0061.
- **Rollback:** Point services back to old DB. Data divergence risk.

### Decision required
**A (accept), B (move Render to Mumbai), or C (move Supabase to Oregon)?** Or defer with a documented reason.

---

## Summary

| # | Risk | Decision type | Options | Action required from owner |
|---|---|---|---|---|
| 1 | RISK-0055 | Cost / RPO target | A: PITR/Pro · B: amend ADR-052 | Choose A or B; provide budget or approve ADR |
| 2 | RISK-0058 | Production test approval | Approve / defer | Approve DB-partition drill or defer |
| 3 | RISK-0060 | Supabase admin action | A: dashboard · B: API token | Toggle Enforce SSL or provide token |
| 4 | RISK-0061 | Infrastructure decision | A: accept · B: move Render · C: move DB | Choose option or defer with reason |

**No implementation will begin before explicit owner decisions.**
