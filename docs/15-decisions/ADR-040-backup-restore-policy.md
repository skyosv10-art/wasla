# ADR-040: Backup and Restore Policy (RPO/RTO Targets)

**Status:** Proposed
**Date:** 2026-09-19
**Decision Owner:** Program Owner
**Supersedes:** None
**Superseded by:** None
**Related:** ADR-038 (Platform Provider & IaC Toolchain — Supabase managed PostgreSQL)

## Context

M2-06 requires backup/restore evidence with defined RPO (Recovery Point Objective) and RTO (Recovery Time Objective). ADR-038 established Supabase as the managed PostgreSQL provider. Supabase provides:

- **Automated daily backups** (all plans) — snapshot-based, retained 7 days
- **Point-in-time recovery (PITR)** (Pro plan and above) — WAL-based, ~7 day window
- **Logical backup** via `pg_dump` (any plan, user-initiated)

The WASLA platform has 13 PostgreSQL databases (one per service). Each database is independent — no cross-database transactions. This means backup/restore can be tested per-service.

## Decision

### RPO Target

- **Production:** RPO ≤ 1 hour (via Supabase PITR on Pro plan)
- **Staging:** RPO ≤ 24 hours (via daily automated backups)
- **Development:** RPO ≤ 24 hours (via daily automated backups)

Rationale: The platform is write-append-heavy (event-sourced outbox pattern). Data loss beyond 1 hour in production would mean losing customer orders, delivery state, and payment mirror events. PITR on Pro plan provides sub-hour RPO.

### RTO Target

- **Production:** RTO ≤ 15 minutes (restore from PITR or daily backup)
- **Staging:** RTO ≤ 30 minutes
- **Development:** RTO ≤ 60 minutes

Rationale: Supabase restore is a managed operation (dashboard/API). For logical backup restore (`pg_dump` → `pg_restore`), the time depends on database size. For the current data volume (development), restore takes < 5 minutes.

### Backup Strategy

1. **Primary:** Supabase managed automated daily backups (all environments)
2. **Secondary:** Supabase PITR (production only, Pro plan required)
3. **Tertiary:** Logical `pg_dump` backup (user-initiated, for migration and drill purposes)

### Restore Procedure

1. **Managed restore:** Via Supabase dashboard → Database → Backups → Restore
2. **Logical restore:** `pg_restore` from `pg_dump` output to a new database
3. **Verification:** After restore, verify table counts, row counts, and critical constraints

### Drill

A backup/restore drill script (`scripts/m2-06-backup-restore-drill.mjs`) performs:
1. `pg_dump` of a service database (backup phase — timed)
2. Create a new database and `pg_restore` (restore phase — timed)
3. Verify table catalog equivalence (7 dimensions, same as M2-05C)
4. Verify data integrity (row counts match)
5. Clean up the restored database

The drill uses the Supabase pooler connection and `createdb=true` to create isolated restore-target databases.

## Consequences

- **Positive:** Defined RPO/RTO targets make disaster recovery measurable
- **Positive:** The drill is repeatable and can be run on any environment
- **Negative:** Production PITR requires Supabase Pro plan (cost)
- **Negative:** Logical backup/restore is slower than managed restore for large databases
- **Risk:** Supabase backup retention is 7 days — longer retention requires Supabase add-on or external storage

## Risks

- `RISK-0052` (new): Supabase backup retention is 7 days. For compliance requiring longer retention, external backup storage (S3) must be configured. This is a Stage B concern (M2-06 proves the restore procedure; retention policy is operational).

## References

- [ADR-038: Platform Provider & IaC Toolchain](ADR-038-platform-provider-iac-toolchain.md)
- [M2-06 Backup/Restore Drill Evidence](../12-testing/upgrade-proof-evidence/2026-09-19-m2-06-backup-restore-drill.md)
- [Supabase Backup Documentation](https://supabase.com/docs/guides/platform/backups)
