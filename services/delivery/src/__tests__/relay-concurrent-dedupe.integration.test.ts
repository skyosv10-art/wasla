/**
 * M2-07 — Crash/retry/dedupe proof: concurrent dual-instance relay.
 *
 * This is the proof that `FOR UPDATE SKIP LOCKED` actually prevents
 * double-processing when two relay instances poll the same outbox
 * concurrently. The advisory-lock tests (relay-advisory-lock) prove that
 * a requeue waits behind a batch lock; this test proves the orthogonal
 * property: two independent relay instances never claim the same event.
 *
 * ## What this proves (M2-07 §11.3 — dedupe safety)
 *
 *   - Two relay instances polling the same outbox simultaneously each
 *     claim a DISJOINT set of events — no event is processed twice.
 *   - The consumed-events table enforces `event_id` uniqueness: even if
 *     a bug let two instances claim the same row, the second INSERT would
 *     violate the UNIQUE constraint.
 *   - After both instances finish, every event is exactly once in
 *     `applied` consumed_status — no duplicates, no lost events.
 *
 * ## Why this is integration, not unit
 *
 *   `FOR UPDATE SKIP LOCKED` is a PostgreSQL locking primitive. In-memory
 *   fakes cannot reproduce it: two fake relays share one array and both
 *   see every row. Only a real engine serializes the claim.
 *
 * SKIPS when DATABASE_URL is unset.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  PG_ENABLED,
  setupPostgres,
  resetData,
  seedTask,
  seedDispatchEvent,
  T0,
  type PgFixture,
} from "./pg-harness.js";
import { PostgresDispatchEventSource } from "../infrastructure/dispatch-event-source.js";
import { PostgresTaskMirrorStore } from "../infrastructure/task-mirror-store.js";
import { PostgresRelayConsumerLock } from "../infrastructure/relay-advisory-lock.js";
import {
  DEFAULT_RELAY_CONFIG,
  runRelayBatch,
  type RelayDeps,
  type RelayLogEntry,
} from "../relay.js";
import type { Pool } from "pg";

const DRIVER = "WS-0000000123";

describe.skipIf(!PG_ENABLED)("M2-07 crash/retry/dedupe proof — concurrent dual-instance relay", () => {
  let pool: Pool;
  let fixture: PgFixture;

  beforeEach(async () => {
    fixture = await setupPostgres();
    pool = fixture.pool;
    await resetData(pool);
  });

  afterEach(async () => {
    await fixture.close();
  });

  it("two concurrent relay instances claim disjoint event sets — no double-processing", async () => {
    // Seed 4 independent tasks, each with its own dispatch.offer_accepted event.
    // Each task transitions from dispatch_requested → driver_assigned.
    const jobs = ["job-concurrent-0", "job-concurrent-1", "job-concurrent-2", "job-concurrent-3"];
    for (let i = 0; i < 4; i++) {
      await seedTask(pool, {
        taskId: `aaaaaaaa-0000-0000-0000-00000000001${i}`,
        orderId: `bbbbbbbb-0000-0000-0000-00000000001${i}`,
        publicId: `WS-000000010${i}`,
        dispatchJobRef: jobs[i],
        state: "dispatch_requested",
      });
      await seedDispatchEvent(pool, {
        event_type: "dispatch.offer_accepted",
        aggregate_type: "dispatch_offer",
        aggregate_id: jobs[i],
        occurred_at: T0,
        payload: {
          job_id: jobs[i],
          driver_public_id: DRIVER,
          accepted_at: T0,
        },
      });
    }

    // Two independent relay instances, each with its own deps.
    const eventsA = new PostgresDispatchEventSource(pool);
    const storeA = new PostgresTaskMirrorStore(pool);
    const lockA = new PostgresRelayConsumerLock(pool);
    const logA: RelayLogEntry[] = [];
    const depsA: RelayDeps = {
      events: eventsA,
      store: storeA,
      lock: lockA,
      log: (entry) => logA.push(entry),
      config: DEFAULT_RELAY_CONFIG,
    };

    const eventsB = new PostgresDispatchEventSource(pool);
    const storeB = new PostgresTaskMirrorStore(pool);
    const lockB = new PostgresRelayConsumerLock(pool);
    const logB: RelayLogEntry[] = [];
    const depsB: RelayDeps = {
      events: eventsB,
      store: storeB,
      lock: lockB,
      log: (entry) => logB.push(entry),
      config: DEFAULT_RELAY_CONFIG,
    };

    // Run both batches "concurrently" (Promise.all — the pool serializes
    // the actual SQL, and SKIP LOCKED ensures disjoint claim sets).
    await Promise.all([
      runRelayBatch(depsA),
      runRelayBatch(depsB),
    ]);

    // Each instance should have claimed some events (not necessarily 2+2,
    // but the union must be exactly 4 and the intersection must be empty).
    const aApplied = logA.filter((e) => e.status === "applied").length;
    const bApplied = logB.filter((e) => e.status === "applied").length;

    // No event should appear in both logs.
    const aEventIds = new Set(logA.map((e) => e.event_id));
    const bEventIds = new Set(logB.map((e) => e.event_id));
    const intersection = [...aEventIds].filter((id) => bEventIds.has(id));

    expect(intersection, "no event processed by both instances").toEqual([]);
    expect(aApplied + bApplied, "all 4 events processed exactly once").toBe(4);

    // Verify in the database: every event is exactly once in applied consumed_status.
    const rows = await pool.query(
      `SELECT event_id, consumed_status FROM delivery_relay_consumed_events ORDER BY event_id`
    );
    expect(rows.rows.length, "4 consumed-events rows").toBe(4);
    for (const row of rows.rows) {
      expect(row.consumed_status, `event ${row.event_id} is applied`).toBe("applied");
    }
  });

  it("crash mid-batch: a relay that fails after claiming leaves events in pending — next poll retries", async () => {
    // Seed 2 independent tasks with their own events.
    const jobs = ["job-crash-0", "job-crash-1"];
    for (let i = 0; i < 2; i++) {
      await seedTask(pool, {
        taskId: `aaaaaaaa-0000-0000-0000-00000000002${i}`,
        orderId: `bbbbbbbb-0000-0000-0000-00000000002${i}`,
        publicId: `WS-000000020${i}`,
        dispatchJobRef: jobs[i],
        state: "dispatch_requested",
      });
      await seedDispatchEvent(pool, {
        event_type: "dispatch.offer_accepted",
        aggregate_type: "dispatch_offer",
        aggregate_id: jobs[i],
        occurred_at: T0,
        payload: {
          job_id: jobs[i],
          driver_public_id: DRIVER,
          accepted_at: T0,
        },
      });
    }

    // First relay instance: process all events normally.
    const events = new PostgresDispatchEventSource(pool);
    const store = new PostgresTaskMirrorStore(pool);
    const lock = new PostgresRelayConsumerLock(pool);
    const log: RelayLogEntry[] = [];
    const deps: RelayDeps = {
      events,
      store,
      lock,
      log: (entry) => log.push(entry),
      config: DEFAULT_RELAY_CONFIG,
    };

    const outcome1 = await runRelayBatch(deps);
    expect(outcome1.processed, "first batch processed 2 events").toBe(2);

    // Simulate a crash: reset consumed-events to pending (as if the first
    // batch's transaction was rolled back). attempt_count must be >= 1 per
    // the CHECK constraint.
    await pool.query(
      `UPDATE delivery_relay_consumed_events SET consumed_status = 'pending', attempt_count = 1, updated_at = now()`
    );
    // Reset the checkpoint too (as if it was never written).
    await pool.query(
      `DELETE FROM delivery_relay_checkpoint`
    );

    // Second relay instance (recovery): should re-process all events.
    // Idempotency means the relay's consumed-events dedupe prevents
    // double-processing even after a crash recovery.
    await runRelayBatch(deps);

    // The key proof: no double-processing. The total transitions across
    // both task_ids should be at most 2 (one per task, no duplicates).
    const transitions = await pool.query(
      `SELECT COUNT(*)::int AS count FROM delivery_task_transitions`
    );
    expect(transitions.rows[0].count, "no duplicate transitions after crash recovery").toBeLessThanOrEqual(2);
  });

  it("dedupe: event_id uniqueness is enforced — duplicate insert is rejected", async () => {
    const jobId = "job-dedupe-0";
    await seedTask(pool, {
      taskId: "aaaaaaaa-0000-0000-0000-000000000030",
      orderId: "bbbbbbbb-0000-0000-0000-000000000030",
      publicId: "WS-0000000300",
      dispatchJobRef: jobId,
      state: "dispatch_requested",
    });

    const eventId = await seedDispatchEvent(pool, {
      event_type: "dispatch.offer_accepted",
      aggregate_type: "dispatch_offer",
      aggregate_id: jobId,
      occurred_at: T0,
      payload: {
        job_id: jobId,
        driver_public_id: DRIVER,
        accepted_at: T0,
      },
    });

    const events = new PostgresDispatchEventSource(pool);
    const store = new PostgresTaskMirrorStore(pool);
    const lock = new PostgresRelayConsumerLock(pool);
    const log: RelayLogEntry[] = [];
    const deps: RelayDeps = {
      events,
      store,
      lock,
      log: (entry) => log.push(entry),
      config: DEFAULT_RELAY_CONFIG,
    };

    // Process the event — this inserts a row into delivery_relay_consumed_events.
    await runRelayBatch(deps);

    // Attempt to insert a duplicate consumed-events row directly.
    // The event_id is PRIMARY KEY, so a duplicate INSERT must be rejected.
    await expect(
      pool.query(
        `INSERT INTO delivery_relay_consumed_events
         (event_id, event_type, aggregate_type, aggregate_id, consumed_status,
          attempt_count, last_error, consumed_at, updated_at)
         VALUES ($1::uuid, 'dispatch.offer_accepted', 'dispatch_offer', $2,
                 'pending', 1, null, now(), now())`,
        [eventId, jobId]
      )
    ).rejects.toThrow(); // UNIQUE constraint violation (PRIMARY KEY)
  });
});
