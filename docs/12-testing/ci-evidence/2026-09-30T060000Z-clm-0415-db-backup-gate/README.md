# CLM-0415: `db-backup.yml` fail-closed (RISK-0055), evidence

- **Base:** `main` = `bc5de79e8901523ae400187f95c1824a3c7a013d`
- **Work item:** M6-18B
- **Scope:** TEST database only (`SUPABASE_TEST_DB_URL`). Nothing touches production. The scheduled workflow is not changed on `main` until this PR is merged.

## 1. Defects replaced (measured at `bc5de79`, CLM-0413 r2 §3.1)

| # | Defect | Replacement |
|---|---|---|
| a | The manifest read `RESTORE_ALL_MATCH`/`RESTORE_DURATION`/`RESTORED_TABLES`, but the step wrote lower-case keys, so it always wrote `false`/0/0. Scheduled run 36663646254 shows 5/5 tables "match" alongside `"restore_all_match": false`. | The manifest is written by `backup.sh` only after every stage passes, so `restore_all_match: true` means it was measured. |
| b, c | Row- and table-count mismatches were `::warning::` and the job passed | `verify-backup.sh` stage 6: a different table set or any row-count difference means exit 1 |
| d | `pg_restore … \|\| true` | `pg_restore --exit-on-error --single-transaction --schema=public`; the first error fails the run |
| e | `2>/dev/null \|\| echo ERROR` on both sides counted as a "match" | Count queries use `ON_ERROR_STOP`, and non-numeric results fail |
| f | Source rows were counted from the live DB after the dump | `snapshot-dump.mjs`: one `REPEATABLE READ READ ONLY` snapshot is exported, and both `pg_dump --snapshot` and the counts use it |
| g | The `skip_restore_test` input could skip verification | The input is removed; `workflow_dispatch` has no inputs |
| — | Only a separate round-trip copy was verified | The uploaded `.gpg` itself is decrypted and byte-compared, and those decrypted bytes are what gets restored |

The scripts `snapshot-dump.mjs`, `verify-backup.sh` and `guard-test-db.py` are byte-identical to the versions proven in run 36665158123 (PR #550) and PR #549.

## 2. Declared scope

- The dump is the whole database.
- The restore proof covers schema `public` only, which is where the 14 services write.
- Supabase platform schemas (auth, storage, vault) are in the dump but are **not** restore-tested.
- If production has an extension in `public` that vanilla `postgres:17` lacks, the scheduled backup will **fail** instead of passing silently.

## 3. Proof run (TEST DB)

The result is added below by addition after the run.

### 3.1 Run 36670339832 (`2febffa`): P1 PASS; P2 harness defect found and corrected by addition

- **Guard:** TEST project ref `obeptvwpvqbduwkahorq`, not production.
- **P1 (real TEST backup):**
  - Snapshot: 107 `public` tables, 1 `public` extension, 23 rows in total.
  - Uploaded `.gpg` decrypted and byte-identical.
  - nonempty, list (107/107 in the TOC), gpg, restore (`--exit-on-error --single-transaction`) and compare (107/107 tables, every row count equal): all PASS.
  - Manifest: `restore_all_match: true`, dump 667 697 B, `.gpg` 667 800 B, dump 62.6 s, encrypt 0.8 s, runner-local restore and compare 15.1 s.
- **P2:** the job reported 6/6 faults failed closed, with no manifest and no plaintext left. **But F5 (row removed) and F6 (extra table) failed at `stage=list`, not at `compare`.** The test shim passed `pg_restore --list` through and then exited 1 because no `--dbname` was given. So those two faults proved nothing about the compare stage. F1 to F4 failed at their intended stages: empty passphrase, unreachable source, `stage=list` (1 table absent from the TOC), and `stage=list` (`pg_restore` failure).
- **Correction:** the shim now exits 0 when there is no `--dbname`. `expect_fail` now also requires that the **first** failure matches the stage the fault targets, so failing earlier for another reason is itself a proof failure. The result of the re-run is recorded below.

### 3.2 Run 36670872501 (`436ad9d`): P1 PASS, P2 6/6 at their target stages

- **P1:** 107/107 `public` tables, 23 rows, `restore_all_match: true`. Dump 58.2 s; runner-local restore and compare 14.9 s.
- **P2**, first failure per fault:

| Fault | First failure |
|---|---|
| F1 empty passphrase | refused before any dump |
| F2 unreachable source | stage 1 (no dump) |
| F3 dump missing one table | `stage=list` (1 public table absent from the TOC) |
| F4 `pg_restore` exits 1 | `stage=list` |
| F5 one row removed after restore | list, gpg and restore PASS, then `stage=compare` (1 table with a row-count mismatch) |
| F6 extra table after restore | list, gpg and restore PASS, then `stage=compare` (restored table set differs) |

In all six: exit 1, no manifest, and no unencrypted work directory left behind.

**`WASLA CI` on this PR (run 36670876187)** fails `governance-guard` (checks 4, 9, 10, 23), `verify` and `image-supply-chain`. These are the same failures as on `main` (brace-expansion, fast-uri, expired risks, CLM-0409, stale branches). This PR adds none of them.

## Addendum: MASTER REPAIR & MERGE (2026-09-30)

This section adds to the sections above and replaces nothing in them.

- **§24-E, failure alert (free):**
  - `db-backup.yml` has a job `alert-on-failure` (`needs: backup`, `if: failure()`, `issues: write` only, no database secret).
  - It opens the issue «db-backup failed (RISK-0055)», or comments on it if it is already open.
  - It does not depend on Telegram or Prometheus.
- **§24-F, pre-migration retention (free):**
  - The `pre_migration` input (dispatch, and `workflow_call`, where it defaults to `true`) selects **retention only, never a check**.
  - A pre-migration backup is kept 90 days (the GitHub maximum). The artifact is named `db-backup-pre-migration-<ts>`.
  - A scheduled backup is kept 30 days.
- **RISK-0056 link:**
  - `db-backup.yml` can be called with `workflow_call`, so the production apply workflow puts this same fail-closed backup in `needs`.
  - `expect_project_ref` refuses a backup whose source project ref differs from the one expected.
- **§24-G, service health (free, no Render change):**
  - `service-health.yml` runs every 6 h, plus manual dispatch.
  - It sends `GET /health` to the 14 DB-backed services with `scripts/ops/health/check-health.py`: 3 attempts of 90 s each (free-tier cold start), no credentials, no Render API.
  - On failure it opens or comments on the issue «service-health: /health failed».
  - A local probe on 2026-09-30 gave **14/14 HTTP 200** (`service-health-local-probe.json`). The bodies are recorded, not interpreted: a `200` that reports `schema_missing` is RISK-0056, not a health failure.
- **Supply-chain inventory:**
  - `db-backup.yml` is declared `write=yes` (issues only).
  - `db-backup-proof.yml` and `service-health.yml` are declared.
  - Before this, the PR's CI failed that check because `db-backup-proof.yml` was undeclared.
- **Not claimed:**
  - No production RTO. The 14.9–15.1 s figure is a runner-local restore of a small TEST backup.
  - RPO is not zero; it stays about 6 h.
  - The alert issue has not yet fired, because no backup has failed since the change. Its logic is the same `gh issue` call as in `service-health.yml`.

