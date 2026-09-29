# M6-18B — live DR drill on Render + Supabase (first execution)

**Claim:** CLM-0401 · **Measured:** 2026-09-29T12:59Z–13:09Z · **Live commit on the drilled services:** `a6bf604` (verified by `render-sync.py --verify-only`, see [`../2026-09-29T124500Z-m6-18b-render-deploy-sync/`](../2026-09-29T124500Z-m6-18b-render-deploy-sync/README.md))
**Procedure:** [`M6-18B_DRILL.md`](../../M6-18B_DRILL.md) · **Driver:** [`scripts/deploy/dr-drill.py`](../../../../scripts/deploy/dr-drill.py) (1 s probe interval, every probe logged as raw JSON)

Targets (ADR-052): T1 RTO 15 min / RPO 5 min.

## 1. Results

| # | Scenario (as executed) | Measured | vs T1 target | Raw |
|---|---|---|---|---|
| 1a | `wasla-audit` Render **restart** | 147 probes over 180 s, **0 non-200**: Render restarts with zero observed downtime | RTO 0 s ✅ | [`drill-s1-restart-audit.jsonl`](drill-s1-restart-audit.jsonl) |
| 1b | `wasla-orders` full **outage** (suspend, then resume) | down confirmed 0.7 s after suspend; **RTO 37.6 s** from resume to first `/health` 200; total observed outage **47.6 s** | RTO ✅ (≪ 15 min) | [`drill-s1b-outage-orders.jsonl`](drill-s1b-outage-orders.jsonl) |
| 1-RPO | Data retained across 1a/1b/4 | all 5 live tables (`audit_events` 10 · `channel_outbox` 2 · `channel_deliveries` 1 · `channel_updates` 1 · `wasla_service_token_replay` 1) have the **identical row count and SHA-256** before and after | process-level RPO **0** ✅ | [`rpo.jsonl`](rpo.jsonl) |
| 4 | Dependency isolation: `wasla-marketplace` suspended, observer `wasla-delivery` | delivery kept answering throughout (6 samples during the outage). Its dependency state moved `marketplace_degraded` → `marketplace_error_status` → back, with `gates_readiness:false`. **Marketplace RTO 36.2 s** from resume | isolation ✅ · RTO ✅ | [`drill-s4-isolate-marketplace.jsonl`](drill-s4-isolate-marketplace.jsonl) |
| DB-RPO | Database loss (Supabase) | `pitr_enabled: false` · `backups: []` · `walg_enabled: true` — **no restorable backup and no point-in-time recovery is exposed for this project** | RPO 5 min **❌ not met / unbounded** | [`supabase-backups-raw.json`](supabase-backups-raw.json) |
| 2 | Database unavailable | **NOT EXECUTED** — see §2 | — | — |
| 3 | Outbox replay after restart | **NOT EXECUTED as designed** — `channel_outbox` held 2 rows with nothing pending, and the domain outboxes do not exist (§2). Nothing was in flight to replay | — | [`rpo.jsonl`](rpo.jsonl) |
| 5 | Slow database query | **NOT EXECUTED** — see §2 | — | — |

In 1b the 503/0 codes during the outage (`Counter({0:3, 503:1, 200:1})` over the
await windows) are the Render edge answering for a suspended service. They are real
non-200 observations, not a probe fault.

Deviation from the procedure: the procedure names `billing` as the drilled T1
service. `services/billing` exists in the repository but **is not deployed on
Render** (24 Render services, none named billing). The T1 service drilled instead is
`orders`.

## 2. What the drill exposed (not claimed PASS)

1. **Domain schemas are not applied to the live database.** `pg_tables` shows only
   `public` = 5 tables (audit + channel runtime). None of the ~13 services' Drizzle
   migrations (`services/*/drizzle/`) are applied. `wasla-delivery` itself reports
   `{"name":"database","ok":false,"detail":"schema_missing"}`
   ([`delivery-ready-raw.json`](delivery-ready-raw.json) ·
   [`schema-inventory-raw.txt`](schema-inventory-raw.txt)). The "44 tables" in the
   M6-19B baseline is the total across *all* schemas (auth 27 + storage 8 + public 5 +
   realtime 3 + vault 1). It is consistent with this measurement, but it was never
   44 domain tables.
   ⇒ The deployed services are up, but they are not a working marketplace. A
   domain-data RPO cannot be measured on data that does not exist.
2. **Database RPO has no mechanism.** With PITR off and no listed backups, losing the
   Supabase project loses everything since creation. The T1 RPO of 5 min requires
   Supabase PITR, which is a paid plan/add-on and needs an owner decision.
3. **Scenarios 2 and 5 need fault injection into the only live database or a
   `DATABASE_URL` change on a live service.** The M6-18 scope forbids changing
   infrastructure or secrets without a documented reason. On a shared database that
   also holds the audit log, these scenarios also need an owner decision and, first,
   the schemas from item 1. They were not simulated, and they are not written as PASS.

## 3. Verdict

- **RTO: measured and met** for process restart (0 s) and full service outage
  (37.6 s / 36.2 s against 15 min).
- **RPO: met at process level (0 rows lost); not met at database level** (no
  backup/PITR).
- **M6-18B exit criterion ("RTO/RPO drill") is not satisfied**, so the item is **not
  Completed**. Board status is set to `Blocked` on the three owner decisions in §2.
