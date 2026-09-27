# WASLA HA, Capacity, and Disaster Recovery Architecture

**Last Updated:** 2026-09-28  
**Authority:** M6-18B (CLM-0381)  
**ADR:** [ADR-052](../15-decisions/ADR-052-ha-capacity-dr.md)  
**Related:** [SLO](SLO.md), [Render Service Inventory](RENDER_SERVICE_INVENTORY.md), [Platform](PLATFORM.md)

---

## 1. Overview

This document defines the High Availability (HA), capacity planning, and
Disaster Recovery (DR) architecture for all WASLA services. It is the
executable plan for achieving the RTO/RPO targets defined in the SLOs and
verified by the DR drill in [M6-18B_DRILL.md](../12-testing/M6-18B_DRILL.md).

### Current Infrastructure

| Component | Platform | Tier | HA Status |
|-----------|----------|------|-----------|
| 16 HTTP services | Render Free | — | Auto-restart, no HA |
| Database | Supabase managed PG | — | Managed, PITR available |
| Static apps | Render static sites | — | CDN-backed |
| CI/CD | GitHub Actions | — | Platform-managed |

---

## 2. RTO/RPO Targets

Recovery Time Objective (RTO) = how long until service is restored.  
Recovery Point Objective (RPO) = how much data loss is acceptable.

### Per-Tier Targets

| Tier | RTO | RPO | Rationale |
|------|-----|-----|-----------|
| T1 (orders, billing, dispatch) | 15 min | 5 min | Revenue-critical; outbox + PITR |
| T2 (marketplace, matching, delivery) | 30 min | 15 min | Core business; outbox replay |
| T3 (search, reputation, notifications) | 1 hour | 1 hour | Supporting; eventual consistency |

### Service-Level RTO/RPO

| Service | Tier | RTO | RPO | Recovery Method |
|---------|------|-----|-----|------------------|
| orders | T1 | 15 min | 5 min | Render restart + Supabase PITR |
| billing | T1 | 15 min | 5 min | Render restart + outbox replay + PITR |
| dispatch | T1 | 15 min | 5 min | Render restart + outbox replay + PITR |
| customers | T2 | 30 min | 15 min | Render restart + PITR |
| marketplace | T2 | 30 min | 15 min | Render restart + outbox replay + PITR |
| matching | T2 | 30 min | 15 min | Render restart + PITR |
| delivery | T2 | 30 min | 15 min | Render restart + outbox replay + PITR |
| identity | T1 | 15 min | 5 min | Render restart + PITR (auth-critical) |
| geography | T3 | 1 hour | 1 hour | Render restart (read-mostly) |
| search | T3 | 1 hour | 1 hour | Render restart (rebuildable from source) |
| reputation | T3 | 1 hour | 1 hour | Render restart + outbox replay |
| notifications | T3 | 1 hour | 1 hour | Render restart (best-effort delivery) |

---

## 3. Capacity Planning

### Current Capacity (Free Tier)

| Resource | Limit | Current Usage | Headroom |
|----------|-------|---------------|----------|
| Render services | 16/16 | 16 deployed | 0 (at capacity) |
| Render RAM per service | 512 MB | <100 MB typical | ~80% |
| Render CPU per service | Shared | Low | Adequate |
| Supabase DB connections | 60 (direct) / 200 (pooler) | <10 per service | ~85% |
| Supabase DB storage | 500 MB | <50 MB | ~90% |
| GitHub Actions minutes | 2,000/mo | ~500/mo | ~75% |

### Projected Capacity (6 months)

| Metric | Current | Projected | Action Required |
|--------|---------|-----------|-----------------|
| Services | 16 | 16 (stable) | None |
| Peak RPS | <10 | ~50 | Upgrade to Starter tier |
| DB connections | <10/svc | ~15/svc | Use pooler exclusively |
| DB storage | <50 MB | ~200 MB | Within Free tier |
| CI minutes | ~500/mo | ~800/mo | Within Free tier |

### Scaling Strategy

1. **Vertical (Render Starter):** Upgrade individual services to Starter ($7/mo)
   for dedicated CPU/RAM when a service exceeds Free tier limits.
2. **Horizontal (Render instances):** Render supports scaling to N instances
   on paid plans. The circuit breaker + bulkhead patterns from M6-18A enable
   safe horizontal scaling without cascading failures.
3. **Database (Supabase Pro):** Upgrade to Pro ($25/mo) for PITR, more
   connections, and larger storage when the Free tier is exceeded.
4. **Kubernetes:** Deferred to Stage D per PLATFORM.md. Not needed at current
   scale.

---

## 4. Backup Strategy

### Database Backups (Supabase)

| Type | Frequency | Retention | Method |
|------|-----------|-----------|--------|
| Daily backup | Every 24h | 7 days | Supabase managed (Free tier) |
| PITR (Point-in-Time Recovery) | Continuous | 7 days | Supabase Pro required |
| Manual backup | On-demand | 30 days | `pg_dump` to external storage |

### Application State Backups

| Component | Backup Method | Frequency | Retention |
|-----------|--------------|-----------|-----------|
| Outbox tables | Supabase backup | Daily | 7 days |
| Consumed event ledgers | Supabase backup | Daily | 7 days |
| Service token replay stores | Supabase backup | Daily | 7 days |
| Relay checkpoints | Supabase backup | Daily | 7 days |

### Configuration Backups

| Component | Backup Method | Location |
|-----------|--------------|----------|
| Terraform state | Remote backend (Render) | `infra/terraform/` |
| Environment configs | Git (encrypted secrets) | `infra/environments/` |
| Service inventory | Git | `docs/08-infrastructure/` |

---

## 5. Failover Strategy

### Service-Level Failover

Each Render service has:
- **Health check:** `GET /health` endpoint (Fastify, returns 200 when healthy)
- **Auto-restart:** Render restarts crashed services automatically
- **Circuit breaker:** Prevents cascading failures to downstream services (M6-18A)
- **Bulkhead:** Limits concurrent in-flight operations (M6-18A)

### Database Failover

Supabase provides:
- **Managed HA:** Automatic failover for database instances (Pro tier)
- **Read replicas:** Available on Pro tier for read scaling
- **PITR:** Point-in-time recovery to any second within retention window (Pro)

For Free tier:
- **Manual recovery:** Restore from daily backup via Supabase dashboard
- **RPO:** Up to 24 hours (daily backup only)
- **Upgrade path:** Pro tier for PITR and managed HA

### Regional Failover

Current: Single-region (Supabase ap-northeast-2, Render same region).  
Future: Multi-region deployment when traffic justifies (Stage D/Kubernetes).

---

## 6. DR Drill Procedure

### Drill Scope

The DR drill verifies that:
1. A service can be restored from crash within RTO
2. Database state can be recovered from backup within RTO
3. Outbox replay recovers in-flight events after service restart
4. Circuit breaker prevents cascading failures during outage

### Drill Steps

1. **Simulate service crash:** Stop a T1 service (e.g., billing)
2. **Verify health check:** Confirm `/health` returns non-200
3. **Verify circuit breaker:** Confirm downstream services reject calls (M6-18A)
4. **Restart service:** `render restart <service-id>` or Render auto-restart
5. **Verify recovery:** Confirm `/health` returns 200
6. **Verify outbox replay:** Confirm pending outbox events are delivered
7. **Measure RTO:** Record time from crash to recovery
8. **Verify data integrity:** Confirm no data loss within RPO

### Drill Evidence

See [M6-18B_DRILL.md](../12-testing/M6-18B_DRILL.md) for the recorded drill results.

---

## 7. Dependency Failure Behavior

The resilience patterns from M6-18A provide the following failure behavior:

| Dependency | Failure Mode | System Behavior | Recovery |
|------------|-------------|-----------------|----------|
| Supabase DB | Connection timeout | Circuit breaker trips after 5 failures | Half-open probe after 30s cooldown |
| Supabase DB | Slow query | Timeout fires at configured deadline | Retry with backoff |
| Downstream service | Unavailable | Circuit breaker rejects calls | Half-open probe after cooldown |
| Downstream service | Slow response | Timeout fires | Retry with backoff |
| Render platform | Service crash | Auto-restart | Health check recovery |
| Network | Partition | Circuit breaker isolates | Probe-based recovery |
| Process restart | State loss | Circuit breaker can be reset | Outbox replay recovers events |

### Outbox Recovery

The outbox pattern (packages/outbox) ensures:
- Events are persisted to the database before being published
- A relay loop drains the outbox and publishes events
- If the relay crashes, it resumes from the last checkpoint
- Duplicate events are tolerated via consumed-event ledgers

### Duplicate Event Tolerance

Each consumer maintains a consumed-event ledger:
- Events are idempotent (same event processed twice = same result)
- The ledger records which events have been consumed
- On restart, the consumer skips already-consumed events
