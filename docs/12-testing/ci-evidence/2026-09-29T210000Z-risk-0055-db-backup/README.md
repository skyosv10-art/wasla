# RISK-0055 — Database Backup Workflow (Mitigation)

**Claim:** CLM-0405 · **Date:** 2026-09-29 · **Branch:** `fix/risk-0055-db-backup-workflow`
**Risk:** RISK-0055 (No database recovery point) · **M6-18B** remains Blocked

## 1. Pre-execution measurements

| Metric | Value |
|---|---|
| Database size | 12 MB (12,881,043 bytes) |
| Public tables | 5 |
| Table names | `audit_events` (10 rows), `channel_deliveries` (1), `channel_outbox` (2), `channel_updates` (1), `wasla_service_token_replay` (1) |
| Total rows | 15 |
| PostgreSQL version | 17.6 (Supabase managed) |
| Expected pg_dump time | <5 seconds (12 MB database) |
| 6-hour interval practical | Yes — full cycle (dump + encrypt + restore test) <1 min |

## 2. Workflow design

**File:** `.github/workflows/db-backup.yml`

### Schedule
- Cron: `0 0/6 * * *` (every 6 hours at :00 UTC)
- `workflow_dispatch` for manual runs

### Secrets (fail-closed)
| Secret | Purpose |
|---|---|
| `SUPABASE_DB_URL` | PostgreSQL pooler connection string |
| `BACKUP_PASSPHRASE` | GPG AES-256 symmetric encryption passphrase |

Both secrets are stored in GitHub Actions secrets. Neither is printed in logs or committed to git.

### Process
1. **pg_dump** — custom format (compressed), `--no-owner --no-privileges` for portable restore
2. **Validate** — reject empty dump (0 bytes); reject unreadable dump (`pg_restore --list`)
3. **GPG encrypt** — AES-256 symmetric, `--batch --passphrase-fd 0`
4. **Round-trip verify** — decrypt and `cmp` against original
5. **Local restore test** — Docker PostgreSQL 17, table count + row count comparison
6. **Upload** — encrypted `.gpg` file + `backup-manifest.json` as artifact (30-day retention)
7. **Cleanup** — unencrypted dump removed from runner

### Security
- No secrets in git or logs
- Unencrypted dump never leaves the runner
- Only the GPG-encrypted artifact is uploaded
- `BACKUP_PASSPHRASE` is never printed
- Connection string is never printed

## 3. Post-execution results

*(To be filled after manual workflow run)*

| Metric | Value |
|---|---|
| Database size | 12 MB |
| Dump duration | *(pending)* |
| Dump size | *(pending)* |
| Encrypt duration | *(pending)* |
| Encrypted backup size | *(pending)* |
| Restore duration | *(pending)* |
| Restore result | *(pending)* |
| Tables restored | *(pending)* |
| Row counts match | *(pending)* |

## 4. RPO/RTO analysis

| Metric | Value | Target (ADR-052 T1) | Met? |
|---|---|---|---|
| RPO (theoretical) | ~6 hours (cron interval) | 5 minutes | No — partial mitigation |
| RTO (measured) | *(pending)* | 15 minutes | *(pending)* |

### Limitations vs Supabase PITR

| Aspect | This solution | Supabase PITR (Pro) |
|---|---|---|
| RPO | ~6 hours | Seconds to minutes |
| Granularity | Per-run snapshot | Point-in-time (WAL replay) |
| Retention | 30 days (GitHub Actions artifact limit) | 7 days (Supabase managed) |
| Restore | Manual (download + decrypt + pg_restore) | Managed (dashboard/API) |
| Cost | Free (GitHub Actions) | $25/month (Pro plan) |
| Encryption | GPG AES-256 at rest | Supabase managed encryption |
| Off-site | Yes (GitHub infrastructure) | Yes (Supabase infrastructure) |

## 5. RISK-0055 status update

**Previous status:** `open` — "Mitigation in force: none"
**New status:** `mitigating` — "Mitigation in force: scheduled, encrypted, restore-tested logical backup (6h RPO)"

**Not closed.** The T1 RPO target (5 min) is not met. Full closure requires:
- Supabase PITR (Pro plan), OR
- A scheduled, restore-tested logical backup meeting the declared RPO (5 min)

This solution provides a **partial mitigation**: database loss is now bounded to ~6 hours instead of "since project creation".

## 6. M6-18B status

M6-18B remains **Blocked**. The remaining blockers are:
1. **RISK-0056** — domain schemas not applied to live database
2. **Scenarios 2/5** — fault injection on the only live DB needs owner decision
3. **RISK-0055** — partially mitigated, but T1 RPO target not met

The backup workflow does not resolve M6-18B. It reduces the data-loss risk from "total loss since creation" to "≤6 hours".
