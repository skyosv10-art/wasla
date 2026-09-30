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
