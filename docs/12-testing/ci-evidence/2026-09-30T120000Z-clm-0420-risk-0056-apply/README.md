# CLM-0420: RISK-0056 production apply workflow (§24-A, §24-K)

**Date:** 2026-09-30 · **Authority:** written mandate "MASTER REPAIR & MERGE", 2026-09-30 · **Production:** *not run* (§19)

## What was built

`.github/workflows/risk-0056-apply.yml` runs on `workflow_dispatch` only.

**Inputs**
- `mode`: `preflight` or `apply`.
- `confirm_sha`: the full 40-character SHA, which must equal `github.sha`.
- `schema_manifest_sha256`: sha256 of `scripts/ops/risk-0056/schema-sha256.txt`.

**Jobs**
1. **guard** (no secret). Checks the SHA, then the manifest hash, then `sha256sum -c` of the manifest against the 14 `contracts/schema.sql`.
2. **backup** (mode `apply` only). Calls `db-backup.yml` with `pre_migration: true` (90-day retention) and `expect_project_ref: snlpxywskyqrjattbpgn`. That backup is fail-closed: dump, encrypt, decrypt the uploaded file, run `pg_restore --exit-on-error`, then compare tables and rows exactly.
3. **apply**. `needs: [guard, backup]` and `if` require `needs.backup.result == 'success'` in apply mode. The job runs in Environment `production-migration` (required reviewer, `main` only), which holds the secret **`PRODUCTION_MIGRATION_DB_URL`**. `scripts/ops/risk-0056/apply.sh` then runs in this order:
   - the target guard (`guard-target.py`: the project ref must be production);
   - the manifest check;
   - the read-only inventory (`inventory.mjs`). In mode `preflight`, the run stops here (§24-K);
   - the 14 migrations. `lock-timeout-preload.mjs` sets `lock_timeout` on **the same connection** and records the backend pid at start and at end. Each migration must show one session with the same pid and `5s`, and the run stops at the first failure;
   - the postflight: all 107 declared tables exist.

`scripts/ops/risk-0056/check-apply-workflow.py` checks the workflow's shape statically. Six mutations are each caught.

## Proof: run [36686757623](https://github.com/skyosv10-art/wasla/actions/runs/36686757623) at `70f8bab`, all jobs success

| case | where | result |
|---|---|---|
| P1 | fresh PostgreSQL 17 service | 14/14 migrations, each with 1 session, `lock_timeout` 5s at start and end, same pid; postflight 107/107 |
| P1 re-run | same DB | 14/14 again; postflight 107/107 (re-running is safe) |
| N3 | same DB, ACCESS EXCLUSIVE held on a search table | search stops with `55P03` after 12 s; later services **not attempted** |
| N2 | tampered `audit/contracts/schema.sql` | refused at the manifest step; step 3 was never reached |
| S | static | the real workflow passes; 6 of 6 mutations are caught |
| P2 backup | TEST project, via `db-backup.yml` `workflow_call` | ref `obeptvwpvqbduwkahorq` as expected; 107 tables, `restore_all_match: true`, verify+restore 14.3 s |
| N1 | TEST URL with target=production | refused at the guard: "project ref is 'obeptvwpvqbduwkahorq'" |
| P2 apply | TEST project | 14/14 migrations; postflight 107/107 |

The same cases (P1, the P1 re-run, N2, N3, N1) were also run first on local PostgreSQL 17.11: `local-pg17-*.txt`/`.jsonl`.

## Superseded and kept

This supersedes #549 (CLM-0410) and #550 (CLM-0413). Their scripts and evidence directories are carried here. Their heads are tagged as recorded in `docs/16-progress/BRANCH_EVIDENCE.md`, and retrieval from a tag was confirmed.

`schema-sha256.txt` was regenerated because CLM-0416 (RISK-0012) changed the delivery, dispatch, marketplace and search schemas. The earlier manifest stays on the tag.

## Not claimed

- The workflow has **not** run on production. It cannot yet: `PRODUCTION_MIGRATION_DB_URL` is not in the environment. Adding it is the user's step.
- The TEST apply is a re-run, because TEST was migrated in CLM-0410. The fresh-database path is P1 on PG17, not on Supabase.
- There is no production RTO. The 14.3 s figure is the verify+restore of a small TEST backup on a runner.
