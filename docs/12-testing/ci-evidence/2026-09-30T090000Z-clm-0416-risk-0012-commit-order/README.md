# CLM-0416 — RISK-0012: commit-ordered outbox consumption

**Date:** 2026-09-30 · **Branch:** `fix/clm-0416-risk-0012-relay-sequence` · **Base:** `gov/clm-0414-unblock-main`
**Decision:** [ADR-057](../../../15-decisions/ADR-057-commit-ordered-outbox-consumption.md) · **Authority:** written mandate "MASTER REPAIR & MERGE", 2026-09-30

## What was wrong (measured, not read)

| # | Defect | Measured by |
| --- | --- | --- |
| 1 | Cursor `(occurred_at, random UUID)` ties inside one transaction | 12-event intra-transaction tests (delivery, search) |
| 2 | Any insert-time key (timestamp, IDENTITY, BIGSERIAL) skips a transaction that inserted first and committed last | "late commit" tests (delivery, search, billing): `T1.sequence_number < T2.sequence_number` and `T1.commit_sequence > T2.commit_sequence`; T1's event is read on the next batch |
| 3 | Dispatch, inventory and search relays `continue`d past a `pending` row and wrote the checkpoint past it | unit "a retryable row stops the batch" (delivery, search) — fails on the old loop (measured by reverting it), passes on the new one |
| 4 | Found during the fix: an unqualified `ORDER BY commit_sequence` bound to the `::text` output alias and sorted as text (`'10' < '2'`) | search integration leg: 6 failures before, 0 after; guarded by the 12-event tests |
| 5 | Found during the fix: the search exit-gate harness kept a hand copy of `marketplace_outbox` DDL (no `sequence_number`, no `commit_sequence`) | e2e search: `42703` before, 22/22 after (now cut from the contract at runtime) |

## Local PostgreSQL 17.11 (`pg17-local-summary.txt`)

Every CI `db-integration` leg, every `exit-gate-e2e` leg and `db-integration-shared`, one DB per leg as CI does.
All `rc=0`. Unit: dispatch 263 · marketplace 399 · delivery 582 · search 137 · billing 116; `tsc --noEmit` 0 errors in all five.

Local green is not the verdict (mandate): the CI run on this PR is. Its run id is recorded here and in the RISK-0012 register entry when it completes.

## Migrations

| Service | Migration | Up on populated data | Down on populated data |
| --- | --- | --- | --- |
| dispatch | `0003_outbox_commit_sequence` | existing row backfilled to 1; new row > 1 | column gone, row kept |
| marketplace | `0003_outbox_commit_sequence` | existing upgrade suite | existing rollback suite |
| delivery | `0006_relay_commit_sequence` | 2 rows backfilled 1, 2 in append order; checkpoint cursor 0; new row > 2 | column gone, 2 rows kept |
| search | `0005_relay_commit_sequence` | parity suite | parity suite |
| billing | `0003_relay_commit_sequence` | applied after a checkpoint row exists → cursor 0 | column gone, checkpoint row kept |

Production was not touched (§19). These migrations reach production only through the RISK-0056 apply path.
