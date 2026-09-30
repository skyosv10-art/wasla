# ADR-057: Commit-ordered outbox consumption (`commit_sequence`)

**Status:** Accepted · **Date:** 2026-09-30 · **Decider:** @skyosv10-art (agent:perplexity-computer, CLM-0416)
**Amends:** [ADR-037](ADR-037-outbox-monotonic-sequence-number.md) (the relay cursor only; `sequence_number` stays)
**Closes:** RISK-0012 · **Authority:** written mandate "MASTER REPAIR & MERGE", 2026-09-30

## Context

ADR-037 gave the seven outbox tables `sequence_number BIGINT GENERATED ALWAYS AS IDENTITY`
and ordered the *publisher's* claim query by it. Three **cursor consumers** kept a
different key, and one relay a different table key:

| Consumer (service) | Reads | Cursor before |
| --- | --- | --- |
| dispatch relay (delivery) | `dispatch_outbox` | `(occurred_at, event_id UUID)` |
| inventory relay (delivery) | `marketplace_outbox` | `(occurred_at, outbox_id UUID)` |
| search relay (search) | `marketplace_outbox` | `(created_at, outbox_id UUID)` |
| billing relay (billing) | `delivery_outbox` | `(occurred_at, event_id UUID)` |

Two independent defects, both measured on PostgreSQL 17:

1. **Intra-transaction tie.** `now()` is the transaction start, so every event of one
   transaction ties on the timestamp and falls to a random UUID. Two events of one
   decision are read in either order.
2. **Insert order ≠ commit order.** *Any* value fixed at INSERT — a timestamp, an IDENTITY,
   a BIGSERIAL — is allocated before commit. If T1 inserts first and commits last, the
   cursor has already passed T1's value when T1 becomes visible, and T1's event is **never
   read**. Switching the cursors to `sequence_number` would have fixed (1) and not (2).
   Measured: `relay-commit-order.integration.test.ts` in delivery, search and billing
   (T1 open → T2 commits → relay reads T2 → T1 commits: `T1.sequence_number < T2.sequence_number`
   and `T1.commit_sequence > T2.commit_sequence`).

A third defect was found while fixing these: the delivery dispatch relay, the inventory
relay and the search relay `continue`d past a retryable (`pending`) row and then wrote
the checkpoint past it, so the retry never happened and later events overtook it.

## Decision

### Producers — `commit_sequence`, assigned at COMMIT

On `dispatch_outbox`, `marketplace_outbox` and `delivery_outbox` (block
`-- >>> RISK-0012 commit_sequence (<table>)` in each `contracts/schema.sql`, and migrations
dispatch `0003`, marketplace `0003`, delivery `0006`):

- `commit_sequence BIGINT NOT NULL DEFAULT nextval('<table>_commit_seq')`, `UNIQUE`.
- `CREATE CONSTRAINT TRIGGER trg_<table>_commit_sequence AFTER INSERT … DEFERRABLE
  INITIALLY DEFERRED FOR EACH ROW`: at COMMIT it takes
  `pg_advisory_xact_lock(10012, hashtext('<table>'))` and re-assigns
  `commit_sequence = nextval(...)`. Deferred row triggers fire in insertion order, so
  intra-transaction order is preserved; the lock serialises the re-assignment across
  transactions in commit order.
- Backfill of existing rows in append order (`sequence_number`, or `outbox_id` for
  delivery), then `setval` — under the same advisory lock, so a producer committing during
  the migration cannot interleave.

**Why this is commit order and not just "later than insert":** the advisory lock is
released at transaction end, after the commit is recorded and visible. So when T2 obtains
the lock and draws its number, T1 (which held it) is already visible. Any snapshot that
sees T2's row therefore sees T1's row, and T1's number is lower. There is no window in
which a higher number is visible and a lower one is not. Numbers of transactions that fail
after the trigger are gaps; the cursor is `>` and gaps are harmless.

### Consumers — cursor on `commit_sequence`

- Checkpoints gain `last_commit_sequence BIGINT NOT NULL DEFAULT 0`
  (`delivery_relay_checkpoint`, `delivery_inventory_relay_checkpoint`,
  `search_relay_checkpoint`, `billing_relay_checkpoint`); `delivery_tasks` gains
  `dispatch_last_commit_sequence` for its per-task watermark.
- Sources read `WHERE commit_sequence > $1 ORDER BY <table>.commit_sequence`. The
  `ORDER BY` is **table-qualified**: the unqualified name bound to the
  `commit_sequence::text` output alias and sorted as text (`'10' < '2'`) — caught by the
  search integration leg before merge; the 12-event tests guard it.
- The delivery publisher (`claimUnpublished`) also orders by `commit_sequence`.
- The three relays `break` at the first `pending` row; the checkpoint never passes it.
- Values cross the TypeScript boundary as decimal strings and are compared as `BigInt`.

### Migration behaviour for consumers

Existing checkpoints get `last_commit_sequence = 0`: each consumer re-reads its source
once from the beginning. This is safe **because** every consumer already has a per-event
ledger (`*_consumed_events`) and per-aggregate stale guards; the re-read is a sequence of
no-ops (measured: "replay" in `relay-commit-order.integration.test.ts` — task version and
outbox unchanged). Its cost is one pass over the source table per consumer.

## Rejected alternatives

- **Switch cursors to `sequence_number`.** Fixes the tie, not the late commit (measured).
- **Statement-level `LOCK`/advisory lock at INSERT, held to COMMIT.** Gives commit order
  but holds a table-wide lock from the first outbox append to commit. The dispatch tick
  appends to its outbox and *then* locks other offer rows; two ticks would take
  {outbox lock, row locks} in opposite orders → deadlock. The deferred trigger takes the
  lock only in pre-commit, after all row locks are held, so it adds no new lock-order edge
  (measured: "no insert-time lock" test — a second producer commits while the first is open).
- **Logical decoding / LSN as the cursor.** Correct, but needs replication slots and a
  different read path per consumer; out of proportion (budget ZERO, §27).
- **Poll with a "safety window" (`occurred_at < now() - interval`).** Probabilistic; a
  long transaction beats any window.

## Consequences and limits (stated, not hidden)

- **Commit serialisation per table.** Transactions that append to the same outbox
  serialise their commit step on one advisory lock (held for the WAL flush). Current
  volume is far below the limit; if it is ever reached the answer is logical decoding.
- **`SET CONSTRAINTS ALL IMMEDIATE`** fires the trigger at statement end and holds the
  lock until commit — still correct, but reintroduces the lock-order risk above. No code
  in the repository does this; a reviewer must reject it on these tables.
- **`session_replication_role = replica`** (e.g. `pg_restore` with triggers disabled, or
  logical replication) skips the trigger: rows keep their insert-time default, which is
  still unique and monotonic by insertion. Restores are single-writer, so this is safe; a
  multi-writer path with triggers disabled is not. The delivery test harness uses this
  mode deliberately to seed a "pre-migration" row (`legacy_commit_sequence`).
- **Other deferred triggers** on these tables would run in name order around this one; none
  exist today. Adding one that can block while this lock is held needs its own review.
- The support relay reads `order_outbox` only through `InMemoryOrderEventSource`; its
  Postgres adapter is not built and its `processEvent` never returns `pending`. When the
  adapter is built it must use this pattern (a trigger on `order_outbox` and a
  `commit_sequence` cursor) and stop at the first `pending` row.
- The remaining outboxes (subscriptions, matching, negotiations, orders, reputation, and the other producers) have
  **no cursor consumer** today — only the published-flag publisher, which cannot skip. If a
  cursor consumer is added for them, it must use this pattern.

## Evidence

- Local PostgreSQL 17 — `int:dispatch 56/56`, `int:marketplace 138/138`, `int:search 55/55`,
  `int:delivery 161/161`, `int:billing 12/12`; unit dispatch 263, marketplace 399,
  delivery 582, search 137, billing 116; `tsc` clean in all five.
- CI on the PR is the verdict; the run id is recorded in the RISK-0012 register entry.
