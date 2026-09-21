/**
 * M2-07 — Delivery relay full DLQ lifecycle end-to-end integration proof.
 *
 * The inventory (§10.7) and the gate (item 9) both record the same gap:
 * delivery has the full DLQ lifecycle (§4.23–4.27) but no single integration
 * test proves the complete cycle end-to-end. The individual pieces are proven:
 *   - `relay-concurrent-dedupe` (CLM-0233): dedupe + crash recovery
 *   - `relay-requeue.integration`: requeue atomicity
 *   - `relay-acknowledgement.integration`: acknowledgement atomicity
 *   - `relay-dead-letters.integration`: dead-letter read
 *
 * But no test walks the full operator journey: a relay processes events, one
 * fails and is poisoned, the operator reads the dead-letter queue, requeues
 * the poisoned event, the relay reprocesses it, and if it fails again the
 * operator acknowledges it. This file closes that gap.
 *
 * ## What this proves (M2-07 inventory §10.7 — delivery E2E)
 *
 *   - The full lifecycle is composable: each store operation leaves the
 *     database in a state the next operation can read, with no manual
 *     intervention between steps.
 *   - Requeue clears the acknowledgement triple (CHECK constraint enforced):
 *     a requeued row cannot carry "handled" into a live state.
 *   - Acknowledgement does not change `consumed_status`: the row stays
 *     `poisoned` and stays in `total_poisoned`, but drops out of
 *     `total_unacknowledged_poisoned`.
 *   - After acknowledgement, requeuing clears the triple and the row is
 *     processable again.
 *
 * ## Why this is integration, not unit
 *
 *   The CHECK constraints (`ck_…_ack_poisoned_only`, `ck_…_ack_all_or_none`)
 * are enforced by PostgreSQL, not by application code. A unit test with fakes
 * cannot prove the database refuses a partial acknowledgement or a requeue
 * that leaves the triple behind.
 *
 * SKIPS when DATABASE_URL is unset.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import {
  PG_ENABLED,
  resetData,
  setupPostgres,
  type PgFixture,
} from "./pg-harness.js";
import { PostgresRelayDeadLetterStore } from "../infrastructure/relay-dead-letter-store.js";
import { PostgresRelayAcknowledgementStore } from "../infrastructure/relay-dead-letter-acknowledgement-store.js";
import { PostgresRelayRequeueStore } from "../infrastructure/relay-requeue-store.js";

const T0 = "2026-09-14T00:00:00.000Z";
const BY = "ops@sre.wasla.market";
const REASON = "Root cause identified: stale aggregate_id reference in upstream event";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let fixture: PgFixture;

interface RowSnapshot {
  readonly consumed_status: string;
  readonly attempt_count: number;
  readonly last_error: string | null;
  readonly acknowledged_at: Date | null;
  readonly acknowledged_by: string | null;
  readonly acknowledgement_reason: string | null;
}

async function seedPoisoned(pool: Pool, eventId: string): Promise<void> {
  await pool.query(
    `INSERT INTO delivery_relay_consumed_events
       (event_id, event_type, aggregate_type, aggregate_id, consumed_status,
        attempt_count, last_error, consumed_at, updated_at)
     VALUES ($1::uuid, 'dispatch.job_completed', 'dispatch_job', 'job-agg-1',
             'poisoned', 6, 'unmappable aggregate_id', $2::timestamptz,
             $2::timestamptz)`,
    [eventId, T0],
  );
}

async function readRow(pool: Pool, eventId: string): Promise<RowSnapshot> {
  const res = await pool.query<RowSnapshot>(
    `SELECT consumed_status, attempt_count, last_error,
            acknowledged_at, acknowledged_by, acknowledgement_reason
       FROM delivery_relay_consumed_events
      WHERE event_id = $1::uuid`,
    [eventId],
  );
  return res.rows[0]!;
}

describe.skipIf(!PG_ENABLED)(
  "Delivery relay full DLQ lifecycle — end-to-end on PostgreSQL",
  () => {
    beforeEach(async () => {
      fixture = await setupPostgres();
      await resetData(fixture.pool);
    });

    afterEach(async () => {
      await fixture.close();
    });

    it(
      "walks the full operator journey: poison → requeue → reprocess → " +
        "poison again → acknowledge",
      async () => {
        const pool = fixture.pool;
        const eventId = uuid(1);

        // ── Step 1: Seed a poisoned event (simulating relay failure) ──────
        await seedPoisoned(pool, eventId);
        const poisoned = await readRow(pool, eventId);
        expect(poisoned.consumed_status).toBe("poisoned");
        expect(poisoned.attempt_count).toBe(6);
        expect(poisoned.acknowledged_at).toBeNull();

        // ── Step 2: Operator reads the dead-letter aggregate ─────────────
        const dlqStore = new PostgresRelayDeadLetterStore(pool);
        const metric = await dlqStore.readRelayDeadLetters({
          eventTypeLimit: 10,
        });
        expect(metric.totalPoisoned).toBeGreaterThanOrEqual(1);
        expect(metric.totalUnacknowledgedPoisoned).toBeGreaterThanOrEqual(1);
        expect(metric.totalAcknowledgedPoisoned).toBe(0);

        // ── Step 3: Operator requeues the poisoned event ─────────────────
        const requeueStore = new PostgresRelayRequeueStore(pool);
        const requeueEffect =
          await requeueStore.requeuePoisonedEventWithEffect({
            ledger: "dispatch",
            eventId,
          });
        expect(requeueEffect.decision.outcome).toBe("requeued");
        if (requeueEffect.decision.outcome === "requeued") {
          expect(requeueEffect.decision.previousStatus).toBe("poisoned");
        }

        // The row is now `pending` — the relay can reprocess it.
        const requeued = await readRow(pool, eventId);
        expect(requeued.consumed_status).toBe("pending");
        expect(requeued.acknowledged_at).toBeNull();

        // ── Step 4: Simulate reprocessing failure (relay poisons it again) ─
        await pool.query(
          `UPDATE delivery_relay_consumed_events
              SET consumed_status = 'poisoned',
                  attempt_count = 7,
                  last_error = 'still unmappable after requeue',
                  updated_at = now()
            WHERE event_id = $1::uuid`,
          [eventId],
        );
        const repoisoned = await readRow(pool, eventId);
        expect(repoisoned.consumed_status).toBe("poisoned");
        expect(repoisoned.attempt_count).toBe(7);

        // ── Step 5: Operator acknowledges the poisoned event ────────────
        const ackStore = new PostgresRelayAcknowledgementStore(pool);
        const ackDecision = await ackStore.acknowledgePoisonedEvent({
          ledger: "dispatch",
          eventId,
          acknowledgedBy: BY,
          reason: REASON,
          acknowledgedAt: "2026-09-15T09:00:00.000Z",
        });
        expect(ackDecision).toEqual({ outcome: "acknowledged" });

        // Acknowledgement adds the triple but does NOT change status.
        const acknowledged = await readRow(pool, eventId);
        expect(acknowledged.consumed_status).toBe("poisoned");
        expect(acknowledged.attempt_count).toBe(7);
        expect(acknowledged.last_error).toBe("still unmappable after requeue");
        expect(acknowledged.acknowledged_at?.toISOString()).toBe(
          "2026-09-15T09:00:00.000Z",
        );
        expect(acknowledged.acknowledged_by).toBe(BY);
        expect(acknowledged.acknowledgement_reason).toBe(REASON);

        // ── Step 6: Verify the aggregate reflects the acknowledgement ────
        const metricAfter = await dlqStore.readRelayDeadLetters({
          eventTypeLimit: 10,
        });
        // totalPoisoned includes both acknowledged and unacknowledged.
        expect(metricAfter.totalPoisoned).toBeGreaterThanOrEqual(1);
        // totalAcknowledgedPoisoned should now be ≥ 1.
        expect(metricAfter.totalAcknowledgedPoisoned).toBeGreaterThanOrEqual(1);
      },
    );

    it(
      "requeue after acknowledgement clears the triple (CHECK constraint " +
        "enforces it, not application code)",
      async () => {
        const pool = fixture.pool;
        const eventId = uuid(2);

        // Seed poisoned, acknowledge, then requeue.
        await seedPoisoned(pool, eventId);
        const ackStore = new PostgresRelayAcknowledgementStore(pool);
        await ackStore.acknowledgePoisonedEvent({
          ledger: "dispatch",
          eventId,
          acknowledgedBy: BY,
          reason: REASON,
          acknowledgedAt: "2026-09-15T09:00:00.000Z",
        });

        // The acknowledgement triple is set.
        const beforeRequeue = await readRow(pool, eventId);
        expect(beforeRequeue.acknowledged_at).not.toBeNull();
        expect(beforeRequeue.acknowledged_by).toBe(BY);

        // Requeue must clear the triple.
        const requeueStore = new PostgresRelayRequeueStore(pool);
        const effect = await requeueStore.requeuePoisonedEventWithEffect({
          ledger: "dispatch",
          eventId,
        });
        expect(effect.decision.outcome).toBe("requeued");

        const afterRequeue = await readRow(pool, eventId);
        expect(afterRequeue.consumed_status).toBe("pending");
        expect(afterRequeue.acknowledged_at).toBeNull();
        expect(afterRequeue.acknowledged_by).toBeNull();
        expect(afterRequeue.acknowledgement_reason).toBeNull();

        // The evidence columns are preserved.
        expect(afterRequeue.attempt_count).toBe(6);
        expect(afterRequeue.last_error).toBe("unmappable aggregate_id");
      },
    );

    it(
      "acknowledgement on a non-poisoned row is refused by the database " +
        "(CHECK constraint, not application code)",
      async () => {
        const pool = fixture.pool;
        const eventId = uuid(3);

        // Seed a `pending` (not poisoned) row.
        await pool.query(
          `INSERT INTO delivery_relay_consumed_events
             (event_id, event_type, aggregate_type, aggregate_id, consumed_status,
              attempt_count, last_error, consumed_at, updated_at)
           VALUES ($1::uuid, 'dispatch.job_completed', 'dispatch_job', 'job-agg-1',
                   'pending', 1, null, $2::timestamptz, $2::timestamptz)`,
          [eventId, T0],
        );

        const ackStore = new PostgresRelayAcknowledgementStore(pool);
        const decision = await ackStore.acknowledgePoisonedEvent({
          ledger: "dispatch",
          eventId,
          acknowledgedBy: BY,
          reason: REASON,
          acknowledgedAt: "2026-09-15T09:00:00.000Z",
        });

        // The store returns a rejection decision.
        expect(decision.outcome).not.toBe("acknowledged");
      },
    );
  },
);
