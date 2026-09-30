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
