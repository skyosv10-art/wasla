# M6-18B — catastrophic DR test on the retired project (CLM-0432)

**Date:** 2026-10-02 09:04–09:18 UTC · **Claim:** CLM-0432.
تم اتخاذ القرار بموجب التفويض الكتابي بتاريخ 2026-09-30 — "MASTER REPAIR & MERGE"، وتفويض المالك لاختبار DR بترتيب الأقل خطرًا (2026-10-02).
No secret values appear here. The dump, the decrypted copy and the ephemeral test passphrase were deleted from the agent workspace after the test.

## Environment (least-risk order)
1. TEST DB `obeptvwpvqbduwkahorq`: **not usable.** There is no connection string (`SUPABASE_TEST_DB_URL` is absent), so a real restore cannot run there.
2. **Chosen: retired production `snlpxywskyqrjattbpgn`** (Supabase, ap-northeast-2, PostgreSQL 17.6). 0 client sessions, no service points to it, and it is a real Supabase project.
3. New production `ppixaauyqoykrogwdxtv`: not needed, not touched. Checked during the test: 120 tables, `audit_events` = 10, delivery readiness `ready`, `database ok`.

Plan recorded before the fault: `artifacts/plan.md` (09:12:28Z).

## Scenario and fault
**Catastrophic loss of the application schema:** `DROP SCHEMA public CASCADE` on database `postgres`. It removed 111 tables, 42 functions, 292 indexes, 830 constraints, 25 triggers, sequences, the `pg_trgm` extension and 777 table grants ("drop cascades to 126 other objects" + tables; `artifacts/run.log`).

## Backup before the fault (fail-closed)
- `pg_dump -Fc -n public` at **2026-10-02T09:04:37Z** → 382,273 bytes → GPG AES256 → decrypt → `cmp` byte-identical → `pg_restore --list`: 111/111 tables (`artifacts/backup.txt`).
- **Restorability check before the fault:** restored into a separate database `dr_verify` on the same project (`--exit-on-error --single-transaction`, 168.7 s). Data fingerprint and schema fingerprint were identical to the source. `dr_verify` was then dropped.

## Recovery (fail-closed; the first error stops it)
1. `pg_restore -L` of the dump's `SCHEMA public` entry.
2. `CREATE EXTENSION pg_trgm WITH SCHEMA public`.
3. `pg_restore --exit-on-error --single-transaction -L` of everything else.
4. The probe query succeeds.
5. Data, schema and ACL fingerprints are compared with the pre-fault capture.

## Measured (`artifacts/run.log`)
| step | time (UTC) | duration |
|---|---|---|
| fault (DROP SCHEMA) | 09:13:19 | 1.9 s |
| detected (probe fails) | 09:13:23 | +1.3 s |
| restore complete | 09:16:25 | 182.5 s |
| application queries succeed again | | 187.2 s after the fault |
| integrity verified | 09:16:35 | +8.1 s |
| **RTO (fault → verified)** | | **195.4 s** |

**RPO of this test:** the backup was taken at 09:04:37 and the fault at 09:13:19, an exposure window of 8 min 42 s. **Rows lost: 0**, because there were no writes in the window and the fingerprints are equal. This bounds the test, not production: under live writes, everything written after the last backup is lost, so the production RPO remains the measured schedule gap (worst **10.21 h**, median 5.21 h).

## Data integrity after recovery
- Data: 111/111 tables, every `count` and content `md5` identical (`pre.data` = `post.data`), 38 rows.
- Schema: columns (1137), constraints (830), indexes (292), function definitions and triggers have identical hashes (`pre.schema` = `post.schema`).
- Grants: 777 table grants, same hash. RLS: 0 tables, 0 policies (as before). Default ACLs: 0 (as before). `pg_trgm@1.6` is back.
- Schema ACL: before = NULL (that is, `acldefault` for owner postgres = `{postgres=UC/postgres}`); after = the explicit `{postgres=UC/postgres}`. The effective privileges are identical and only the stored representation differs. `anon`/`authenticated`/`service_role` lack USAGE before and after.
- The repo's read-only inventory (`scripts/ops/risk-0056/inventory.mjs`): `public_tables=111`; `auth:27 · storage:8 · vault:1` untouched.
- Read/write: INSERT `audit_events` id 12 → SELECT 1 → DELETE 1 → count 10. PASS.

## Proven / not proven
- **Proven:** recovery from a catastrophic loss of the application schema in a **real Supabase project**, from an encrypted, pre-verified backup: fail-closed, measured RTO 195.4 s, 0 rows lost in this window, data, schema and privileges identical.
- **Not proven:**
  - A production RTO: no live services point to this project, so service failover was not part of the test.
  - Creating a new replacement project, or restoring `auth`/`storage`/`vault` (those were not dropped).
  - PITR / RPO 5 min.
  - DR scenario 2 as defined in `M6-18B_DRILL.md` (database unavailable → circuit breaker trips and recovers): not executed.
  - Restore timing from the GitHub-stored artifact into Supabase: this test restored from the agent's workspace, over the pooler from outside the region.
