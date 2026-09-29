# RISK-0055 — Database Backup Workflow (Mitigation)

**Claim:** CLM-0405/0406/0407/0408 · **Date:** 2026-09-29/30 · **Branch:** merged to main (PRs #543, #545, #546, #547)
**Risk:** RISK-0055 (No database recovery point) · **M6-18B** remains Blocked
**Workflow run:** [36643974571](https://github.com/skyosv10-art/wasla/actions/runs/36643974571) — SUCCESS

## 1. Pre-execution measurements

| Metric | Value |
|---|---|
| Database size | 12 MB (12,881,043 bytes) |
| Public tables | 5 |
| Table names | `audit_events` (10 rows), `channel_deliveries` (1), `channel_outbox` (2), `channel_updates` (1), `wasla_service_token_replay` (1) |
| Total rows | 15 |
| PostgreSQL version | 17.6 (Supabase managed) |
| Expected pg_dump time | <60 seconds (12 MB database) |
| 6-hour interval practical | Yes — full cycle (dump + encrypt + restore test) <2 min |

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
1. **Install PostgreSQL 17 client** — via apt.postgresql.org repo, with GITHUB_PATH override to avoid pg_wrapper version mismatch
2. **Measure DB size** — `pg_database_size()` and table count
3. **pg_dump** — custom format (compressed), `--no-owner --no-privileges` for portable restore
4. **Validate** — reject empty dump (0 bytes); reject unreadable dump (`pg_restore --list`)
5. **GPG encrypt** — AES-256 symmetric, `--batch --passphrase-fd 0`
6. **Round-trip verify** — decrypt and `cmp` against original
7. **Local restore test** — Docker PostgreSQL 17, create vault schema, `pg_restore` without `--exit-on-error`, table count + row count comparison
8. **Upload** — encrypted `.gpg` file + `backup-manifest.json` as artifact (30-day retention)
9. **Cleanup** — unencrypted dump removed from runner

### Security
- No secrets in git or logs
- Unencrypted dump never leaves the runner
- Only the GPG-encrypted artifact is uploaded
- `BACKUP_PASSPHRASE` is never printed
- Connection string is never printed

### Supply chain
- Workflow registered in `validate-workflow-supply-chain.sh` DECLARED array (M0-31)
- `secrets=yes`, `write=no` (contents: read only)
- First-party actions only (`actions/checkout@v4`, `actions/upload-artifact@v4`)

## 3. Post-execution results (run 36643974571)

| Metric | Value |
|---|---|
| Database size | 12 MB (12,881,043 bytes) |
| Dump duration | 44 seconds |
| Dump size | 236 KB (240,701 bytes) — custom format compressed |
| Encrypt duration | 1 second |
| Encrypted backup size | 236 KB (240,804 bytes) — GPG AES-256 |
| Decryption round-trip | Verified — `cmp` match |
| Restore duration | ~8 seconds (Docker PostgreSQL 17) |
| Restore result | 5/5 tables, row counts match |
| Artifact | `db-backup-20260929T231321Z.zip` (241,524 bytes) |
| Artifact ID | 11068160584 |
| Artifact URL | [Download](https://github.com/skyosv10-art/wasla/actions/runs/36643974571/artifacts/11068160584) |
| Retention | 30 days |

### Restore test details

| Table | Source rows | Restored rows | Match |
|---|---|---|---|
| audit_events | 10 | 10 | Yes |
| channel_deliveries | 1 | 1 | Yes |
| channel_outbox | 2 | 2 | Yes |
| channel_updates | 1 | 1 | Yes |
| wasla_service_token_replay | 1 | 1 | Yes |

## 4. RPO/RTO analysis

| Metric | Value | Target (ADR-052 T1) | Met? |
|---|---|---|---|
| RPO (theoretical) | ~6 hours (cron interval) | 5 minutes | No — partial mitigation |
| RTO (measured) | ~8 seconds (restore to local PG) | 15 minutes | Yes |

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
