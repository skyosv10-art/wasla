# M2-07 — Crash/Retry/Dedupe Proof

**CLM-0233** · **Date:** 2026-09-19 · **ADR-026** · **ADR-037**

This document maps the existing test suite to the five proof requirements
from the [M2-07 inventory](../08-infrastructure/M2-07_OUTBOX_TICK_DLQ_INVENTORY.md) §11
and records the new concurrent dual-instance test added in CLM-0233.

## 1. Proof requirements and coverage

### 1.1 Crash safety

A relay crash mid-batch leaves consumed-events in `pending` (not `applied`);
checkpoint does not advance; next poll retries.

| Test | File | What it proves |
|---|---|---|
| "rolls back EVERYTHING when the transaction fails mid-flight, then retries clean" | `relay.integration.test.ts` | A mid-transaction failure leaves NOTHING behind — task, transition, outbox, watermark all roll back together |
| "re-delivery after checkpoint loss is a no-op for every terminal row" | `relay.integration.test.ts` | After checkpoint loss, the ledger (not checkpoint) is the guard — re-delivery is a no-op |
| "crash mid-batch: a relay that fails after claiming leaves events in pending — next poll retries" | `relay-concurrent-dedupe.integration.test.ts` (new) | Crash recovery: reset to pending, re-process, no duplicate transitions |

### 1.2 Retry safety

A retried event is idempotent — `applied` status is a no-op. A `poisoned`
event is terminal and does not block the checkpoint.

| Test | File | What it proves |
|---|---|---|
| "re-delivery after checkpoint loss is a no-op for every terminal row" | `relay.integration.test.ts` | Idempotency after checkpoint loss |
| "poisons a second offer_accepted (no legal edge) and still processes what follows" | `relay.integration.test.ts` | Poisoned event is terminal; checkpoint advances past it |
| "skips_stale every event once the task is terminal" | `relay.integration.test.ts` | Terminal task state prevents re-processing |

### 1.3 Dedupe safety

`event_id` / `outbox_id` uniqueness in consumed-events tables prevents
double-processing. `FOR UPDATE SKIP LOCKED` prevents duplicate claims across
concurrent relay instances.

| Test | File | What it proves |
|---|---|---|
| "two concurrent relay instances claim disjoint event sets — no double-processing" | `relay-concurrent-dedupe.integration.test.ts` (new) | Two instances with SKIP LOCKED never claim the same event |
| "dedupe: event_id uniqueness is enforced — duplicate insert is rejected" | `relay-concurrent-dedupe.integration.test.ts` (new) | UNIQUE constraint on event_id prevents duplicate consumed-events rows |
| "THE designed race: a mid-batch requeue waits, the rewind survives" | `relay-advisory-lock.integration.test.ts` | SKIP LOCKED + advisory lock prevents the requeue race |
| "a relay batch waits behind a manually-held session lock, then proceeds" | `relay-advisory-lock.integration.test.ts` | SKIP LOCKED blocks a batch behind a held lock |

### 1.4 DLQ lifecycle (delivery only)

A poisoned event can be acknowledged, reprocessed, or requeued — with
database-enforced atomicity.

| Test | File | What it proves |
|---|---|---|
| "الإقرارُ يُضيفُ ولا يمحو" (acknowledgement adds, doesn't erase) | `relay-acknowledgement.integration.test.ts` | Acknowledgement adds 3 fields atomically — status/attempts/error unchanged |
| "إعادةٌ بعدَ إقرارٍ تمحو الإقرارَ" (reprocess after acknowledgement) | `relay-acknowledgement.integration.test.ts` | Reprocess nulls the acknowledgement — no second life |
| "ثلاثيٌّ ناقصٌ يُرفَضُ من القاعدةِ" (incomplete triple rejected by DB) | `relay-acknowledgement.integration.test.ts` | CHECK constraint enforces all-or-nothing acknowledgement fields |
| "مسمومٌ في دفترِ التوزيعِ: يُرفَعُ إلى pending" (requeue to pending) | `relay-requeue.integration.test.ts` | Requeue moves poisoned → pending, resets checkpoint |
| "الحدثُ المُعادُ يُقرأُ ويُطبَّقُ فعلاً" (requeued event is read and applied) | `relay-requeue.integration.test.ts` | End-to-end: requeue → re-read → re-apply |
| "بعدَ الإعادةِ يخرجُ الصفُّ من عدِّ المسمومِ" (exits poisoned count) | `relay-requeue.integration.test.ts` | Requeued event leaves the dead-letter count |

### 1.5 Tick idempotency

All three ticks are idempotent by construction — a duplicate tick does nothing.

| Test | File | What it proves |
|---|---|---|
| "is idempotent — a second run finds nothing left to do" | `negotiations/src/__tests__/tick.test.ts` | Duplicate tick is a no-op |
| "يثبّت ساعة واحدة لكل المهام ويعيد اللحظة نفسها" (one clock for all tasks) | `dispatch/src/__tests__/run-tick.test.ts` | Tick uses a single clock reading |
| "يثبت معاملة المهمة السابقة عندما يفشل خطأ بنية تحتية" (commits previous task on mid-tick failure) | `dispatch/src/__tests__/run-tick.test.ts` | Mid-tick failure: previous task committed, failure isolated |
| "replays an identical cancel" | `negotiations/src/__tests__/tick.test.ts` | Duplicate tick event is idempotent |

## 2. What was added in CLM-0233

Three new integration tests in `relay-concurrent-dedupe.integration.test.ts`:

1. **Concurrent dual-instance relay** — two relay instances with SKIP LOCKED
   claim disjoint event sets; no double-processing; 4 events → 4 applied
   rows, 4 transitions (not 8).
2. **Crash mid-batch recovery** — events reset to `pending` (simulating
   uncommitted crash); recovery batch re-processes; no duplicate transitions.
3. **Dedupe enforcement** — direct INSERT of a duplicate `event_id` is
   rejected by the UNIQUE constraint.

## 3. What is NOT proven (declared debt)

- **Search relay crash/retry** — search has no integration test for
  crash recovery (only delivery does). Search's relay has the same design
  contract but the proof is delivery-only. (G5 from inventory)
- **Concurrent relay instances for search** — same as above.
- **8 services without drain/publisher** (G1) — events are written to
  outbox but never delivered. This is a platform gap, not a proof gap.
- **6 tables without `sequence_number`** (G2) — ordering is not monotonic
  for same-transaction batches. ADR-037 has not been applied to these
  tables yet.
- **Tick crash-mid-tick integration test** — the tick idempotency proof is
  in unit tests, not against PostgreSQL. The tick's idempotency is by
  construction (no cursor), so a unit test is sufficient.

## 4. Verdict

The crash/retry/dedupe proof is **delivered for delivery** — the service
with the full DLQ lifecycle. The search relay's crash/retry/dedupe is
proven by design contract (uniform relay reliability contract, §2 of the
inventory) but not by an integration test. The 8 drain/publisher gaps and
6 sequence_number gaps are declared debt, not proof gaps.
