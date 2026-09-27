# ADR-052: HA, Capacity, and Disaster Recovery Architecture

**Status:** Accepted  
**Date:** 2026-09-28  
**Authority:** M6-18B (CLM-0381)  
**Supersedes:** None  
**Related:** ADR-038 (Platform), ADR-051 (Resilience Patterns)

---

## Context

WASLA operates 16 microservices on Render Free tier with Supabase managed
PostgreSQL. The platform provides auto-restart and managed backups, but
there is no documented HA, capacity, or DR strategy. The LAUNCH_EXECUTION_BOARD
requires an "RTO/RPO drill" and "architecture review" for M6-18B.

Key constraints:
- Free tier: no multi-instance, no private networking, daily backups only
- Supabase: managed PostgreSQL with PITR on Pro tier
- Single region (ap-northeast-2)
- 16 services with inter-service dependencies via public URLs

## Decision

### 1. RTO/RPO Targets by Service Tier

Define RTO/RPO targets aligned with the SLO tiers from M6-18A:
- T1 (revenue-critical): RTO 15 min, RPO 5 min
- T2 (core business): RTO 30 min, RPO 15 min
- T3 (supporting): RTO 1 hour, RPO 1 hour

### 2. Recovery Strategy

- **Service crash:** Render auto-restart + circuit breaker isolation (M6-18A)
- **Database failure:** Supabase managed recovery (daily backup on Free, PITR on Pro)
- **Event recovery:** Outbox replay + consumed-event ledger (existing from M5-17P/Q)
- **Data loss:** Bounded by RPO (daily backup on Free = up to 24h; PITR on Pro = seconds)

### 3. Capacity Planning

- Current: 16 services on Free tier, <10 RPS, <50 MB DB
- 6-month projection: ~50 RPS, ~200 MB DB — within Free tier with headroom
- Scaling path: Starter tier per service ($7/mo) → Pro Supabase ($25/mo) → Kubernetes (Stage D)

### 4. DR Drill

A documented DR drill procedure that simulates service crash, verifies health
check, circuit breaker isolation, recovery, outbox replay, and measures RTO.
The drill evidence is recorded in M6-18B_DRILL.md.

### 5. Upgrade Path

- **Free → Pro (Supabase):** Enables PITR, managed HA, more connections
- **Free → Starter (Render):** Dedicated CPU/RAM, multi-instance scaling
- **Render → Kubernetes:** Deferred to Stage D, justified by traffic

## Consequences

- RTO/RPO targets are defined but not yet met on Free tier (RPO up to 24h)
- Upgrading to Supabase Pro reduces RPO from 24h to seconds (PITR)
- The DR drill procedure provides repeatable verification
- Capacity planning identifies when to upgrade before hitting limits
- The architecture is documented and reviewable
