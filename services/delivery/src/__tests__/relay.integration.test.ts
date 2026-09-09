/**
 * Relay integration test (review 3/N, ADR-026 §4.2/§4.3). End-to-end with real
 * PostgreSQL: dispatch_outbox event → relay (PostgresDispatchEventSource +
 * PostgresTaskMirrorStore) → delivery task mirror state.
 *
 * These tests prove what the in-memory fakes CANNOT (that is their whole
 * reason to exist):
 *   • ATOMICITY — a mid-transaction failure leaves NOTHING behind (task,
 *     transition ledger, outbox, watermark all roll back together);
 *   • the ISO/watermark contract survives a real timestamptz round-trip
 *     (relay.isAfter compares strings — the adapter must return ISO);
 *   • idempotency after CHECKPOINT LOSS (ledger, not checkpoint, is the guard);
 *   • CHECK constraints actually reject what the domain forbids;
 *   • the schema applied is the CONTRACT file on disk (M0-18: table list
 *     extracted from schema.sql at runtime — a drifted contract fails here).
 *
 * SKIPS when DATABASE_URL is unset (docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md).
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  PG_ENABLED,
  setupPostgres,
  resetData,
  seedTask,
  seedDispatchEvent,
  CONTRACT_TABLES,
  type PgFixture,
} from "./pg-harness.js";
import { PostgresDispatchEventSource } from "../infrastructure/dispatch-event-source.js";
import { PostgresTaskMirrorStore } from "../infrastructure/task-mirror-store.js";
import { runRelayBatch, replayFrom, DEFAULT_RELAY_CONFIG, type RelayDeps } from "../relay.js";

const JOB = "job-agg-1";
const DRIVER = "WS-0000000123";
const T0 = "2026-09-09T10:00:00.000Z";
const ts = (n: number) => new Date(Date.parse(T0) + n * 60_000).toISOString();

async function makeDeps(pool: PgFixture["pool"]): Promise<RelayDeps> {
  return {
    events: new PostgresDispatchEventSource(pool),
    store: new PostgresTaskMirrorStore(pool),
    config: { ...DEFAULT_RELAY_CONFIG, batchSize: 10 },
  };
}

(PG_ENABLED ? describe : describe.skip)("relay integration — PostgreSQL end-to-end", () => {
  let pool: PgFixture["pool"];
  let close: () => Promise<void>;
  let store: PostgresTaskMirrorStore;

  beforeEach(async () => {
    const fixture = await setupPostgres();
    pool = fixture.pool;
    close = fixture.close;
    store = new PostgresTaskMirrorStore(pool);
    await resetData(pool);
  });
  afterEach(async () => {
    await pool.query(`DROP TRIGGER IF EXISTS abort_transition ON delivery_task_transitions`).catch(() => undefined);
    await close();
  });

  /* ── schema: the contract file on disk IS the schema under test ── */

  it("applies every table declared in contracts/schema.sql (no drift, no extras)", async () => {
    const r = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [CONTRACT_TABLES],
    );
    expect(new Set(r.rows.map((x) => x.table_name))).toEqual(new Set(CONTRACT_TABLES));
  });

  it("rejects a consumed-ledger status outside the closed catalog (CHECK is real)", async () => {
    await expect(
      pool.query(
        `INSERT INTO delivery_relay_consumed_events
           (event_id, event_type, aggregate_type, aggregate_id, consumed_status, attempt_count)
         VALUES ('dddddddd-0000-0000-0000-000000000001', 'dispatch.offer_accepted', 'dispatch_job', $1, 'bogus', 1)`,
        [JOB],
      ),
    ).rejects.toThrow(/check/i);
  });

  /* ── the happy path: one event, four writes, all visible ── */

  it("applies offer_accepted: task + transition + outbox + watermark in one transaction", async () => {
    const { taskId } = await seedTask(pool, { dispatchJobRef: JOB });
    const eventId = await seedDispatchEvent(pool, {
      event_type: "dispatch.offer_accepted",
      aggregate_id: JOB,
      occurred_at: ts(0),
      payload: { job_id: JOB, driver_public_id: DRIVER, accepted_at: ts(0) },
    });

    const outcome = await runRelayBatch(await makeDeps(pool));
    expect(outcome.applied).toBe(1);

    const task = (await pool.query(`SELECT state, courier_ref, version, dispatch_last_event_id::text AS wmid
                                      FROM delivery_tasks WHERE task_id = $1::uuid`, [taskId])).rows[0];
    expect(task.state).toBe("driver_assigned");
    expect(task.courier_ref).toBe(DRIVER);
    expect(task.version).toBe(2);
    expect(task.wmid).toBe(eventId);

    const tr = (await pool.query(`SELECT from_state, to_state, reason_code, actor_type, actor_ref
                                    FROM delivery_task_transitions WHERE task_id = $1::uuid`, [taskId])).rows;
    expect(tr).toHaveLength(1);
    expect(tr[0]).toMatchObject({ from_state: "dispatch_requested", to_state: "driver_assigned", reason_code: "dispatch_offer_accepted", actor_type: "dispatch", actor_ref: DRIVER });

    const ob = (await pool.query(`SELECT event_type, aggregate_type, aggregate_id, payload->>'courier_ref' AS courier
                                    FROM delivery_outbox WHERE event_id = $1::uuid`, [eventId])).rows;
    expect(ob).toHaveLength(1);
    expect(ob[0]).toMatchObject({ event_type: "delivery.driver_assigned", aggregate_type: "delivery_task", aggregate_id: taskId, courier: DRIVER });

    expect((await store.getConsumed(eventId))?.status).toBe("applied");
    expect((await store.getCheckpoint(DEFAULT_RELAY_CONFIG.consumerId))).toEqual({ last_occurred_at: ts(0), last_event_id: eventId });
  });

  /* ── atomicity: what memory tests CANNOT prove ── */

  it("rolls back EVERYTHING when the transaction fails mid-flight, then retries clean", async () => {
    const { taskId } = await seedTask(pool, { dispatchJobRef: JOB });
    const eventId = await seedDispatchEvent(pool, {
      event_type: "dispatch.offer_accepted",
      aggregate_id: JOB,
      occurred_at: ts(0),
      payload: { job_id: JOB, driver_public_id: DRIVER, accepted_at: ts(0) },
    });

    // Abort trigger on the transition ledger — fires BETWEEN the task UPDATE
    // and the outbox INSERT, i.e. genuinely mid-transaction.
    await pool.query(
      `CREATE OR REPLACE FUNCTION abort_transition() RETURNS trigger AS $$
         BEGIN RAISE EXCEPTION 'injected mid-transaction failure'; END;
       $$ LANGUAGE plpgsql;
       CREATE TRIGGER abort_transition BEFORE INSERT ON delivery_task_transitions
         FOR EACH ROW EXECUTE FUNCTION abort_transition()`,
    );

    const outcome = await runRelayBatch(await makeDeps(pool));
    expect(outcome.applied).toBe(0);
    expect(outcome.poisoned).toBe(0); // maxAttempts 5: stays pending, checkpoint does NOT advance

    // NOTHING from the failed transaction survived:
    const task = (await pool.query(`SELECT state, courier_ref, version, dispatch_last_event_id
                                      FROM delivery_tasks WHERE task_id = $1::uuid`, [taskId])).rows[0];
    expect(task).toMatchObject({ state: "dispatch_requested", courier_ref: null, version: 1, dispatch_last_event_id: null });
    expect((await pool.query(`SELECT count(*)::int AS n FROM delivery_task_transitions`)).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM delivery_outbox`)).rows[0].n).toBe(0);
    expect(await store.getCheckpoint(DEFAULT_RELAY_CONFIG.consumerId)).toBeNull();
    expect((await store.getConsumed(eventId))?.status).toBe("pending");

    // The connection survived (released) and the retry applies cleanly:
    await pool.query(`DROP TRIGGER abort_transition ON delivery_task_transitions`);
    const retry = await runRelayBatch(await makeDeps(pool));
    expect(retry.applied).toBe(1);
    const after = (await pool.query(`SELECT state, courier_ref FROM delivery_tasks WHERE task_id = $1::uuid`, [taskId])).rows[0];
    expect(after).toMatchObject({ state: "driver_assigned", courier_ref: DRIVER });
  });

  /* ── idempotency when the checkpoint is LOST (the ledger is the guard) ── */

  it("re-delivery after checkpoint loss is a no-op for every terminal row", async () => {
    await seedTask(pool, { dispatchJobRef: JOB });
    await seedDispatchEvent(pool, {
      event_type: "dispatch.offer_accepted",
      aggregate_id: JOB,
      occurred_at: ts(0),
      payload: { job_id: JOB, driver_public_id: DRIVER, accepted_at: ts(0) },
    });
    await runRelayBatch(await makeDeps(pool));

    await pool.query(`DELETE FROM delivery_relay_checkpoint`); // "we lost the checkpoint"

    const again = await runRelayBatch(await makeDeps(pool));
    expect(again.applied).toBe(0);
    expect(again.skipped).toBe(1);

    expect((await pool.query(`SELECT count(*)::int AS n FROM delivery_outbox`)).rows[0].n).toBe(1); // no duplicate event
    expect((await pool.query(`SELECT count(*)::int AS n FROM delivery_task_transitions`)).rows[0].n).toBe(1); // no duplicate transition
    const task = (await pool.query(`SELECT state, version FROM delivery_tasks`)).rows[0];
    expect(task).toMatchObject({ state: "driver_assigned", version: 2 }); // version did not advance twice
  });

  /* ── ordering: an older redelivered event cannot regress state ── */

  it("skips_stale an older redelivered event after a newer one applied (timestamptz round-trip)", async () => {
    const { taskId } = await seedTask(pool, { dispatchJobRef: JOB });
    await seedDispatchEvent(pool, {
      event_type: "dispatch.offer_accepted",
      aggregate_id: JOB,
      occurred_at: ts(2),
      payload: { job_id: JOB, driver_public_id: DRIVER, accepted_at: ts(2) },
    });
    const first = await runRelayBatch(await makeDeps(pool));
    expect(first.applied).toBe(1);

    // An older, NEVER-CONSUMED, projectable event (driver_assigned → timed_out
    // is a legal edge) lands behind the checkpoint. It is only ever read
    // again on replay — and there, only the task's watermark can stop it from
    // regressing state. Checkpoint loss is exactly that scenario.
    const olderId = await seedDispatchEvent(pool, {
      event_type: "dispatch.offer_timed_out",
      aggregate_id: JOB,
      occurred_at: ts(1),
      payload: { job_id: JOB, driver_public_id: DRIVER, timed_out_at: ts(1) },
    });

    const deps = await makeDeps(pool);
    await replayFrom(deps, null); // replay from zero (checkpoint loss / re-consume)
    const outcome = await runRelayBatch(deps);
    expect(outcome.applied).toBe(0);
    expect(outcome.skipped).toBe(2);
    expect((await store.getConsumed(olderId))?.status).toBe("skipped_stale");

    const task = (await pool.query(`SELECT state, dispatch_last_occurred_at FROM delivery_tasks WHERE task_id = $1::uuid`, [taskId])).rows[0];
    expect(task.state).toBe("driver_assigned");
    expect(new Date(task.dispatch_last_occurred_at).toISOString()).toBe(ts(2));
  });

  /* ── foreign job: terminal ignore, stream continues ── */

  it("terminally ignores events of a job no task is bound to", async () => {
    await seedTask(pool, { dispatchJobRef: JOB });
    const foreignId = await seedDispatchEvent(pool, {
      event_type: "dispatch.job_exhausted",
      aggregate_id: "job-nobody-bound",
      occurred_at: ts(0),
      payload: { job_id: "job-nobody-bound", exhausted_at: ts(0) },
    });

    const outcome = await runRelayBatch(await makeDeps(pool));
    expect(outcome.skipped).toBe(1);
    expect((await store.getConsumed(foreignId))?.status).toBe("ignored_foreign");
    const cp = await store.getCheckpoint(DEFAULT_RELAY_CONFIG.consumerId);
    expect(cp?.last_event_id).toBe(foreignId); // ignored_foreign is terminal — the stream advances past it
  });

  /* ── poison: unmappable outcome does not block the stream ── */

  it("poisons a second offer_accepted (no legal edge) and still processes what follows", async () => {
    const { taskId } = await seedTask(pool, { state: "driver_assigned", dispatchJobRef: JOB });
    const badId = await seedDispatchEvent(pool, {
      event_type: "dispatch.offer_accepted",
      aggregate_id: JOB,
      occurred_at: ts(0),
      payload: { job_id: JOB, driver_public_id: "WS-0000000999", accepted_at: ts(0) },
    });
    const goodId = await seedDispatchEvent(pool, {
      event_type: "dispatch.offer_timed_out",
      aggregate_id: JOB,
      occurred_at: ts(1),
      payload: { job_id: JOB, driver_public_id: DRIVER, timed_out_at: ts(1) },
    });

    const outcome = await runRelayBatch(await makeDeps(pool));
    expect(outcome.poisoned).toBe(1);
    expect(outcome.applied).toBe(1);
    expect((await store.getConsumed(badId))?.status).toBe("poisoned");

    const task = (await pool.query(`SELECT state, dispatch_last_event_id::text AS wmid FROM delivery_tasks WHERE task_id = $1::uuid`, [taskId])).rows[0];
    expect(task.state).toBe("timed_out");
    expect(task.wmid).toBe(goodId); // the poison did not block the stream
  });

  /* ── terminal task: no regression out of a terminal state ── */

  it("skips_stale every event once the task is terminal", async () => {
    const { taskId } = await seedTask(pool, { state: "cancelled", dispatchJobRef: JOB });
    const eventId = await seedDispatchEvent(pool, {
      event_type: "dispatch.offer_accepted",
      aggregate_id: JOB,
      occurred_at: ts(0),
      payload: { job_id: JOB, driver_public_id: DRIVER, accepted_at: ts(0) },
    });

    const outcome = await runRelayBatch(await makeDeps(pool));
    expect(outcome.skipped).toBe(1);
    expect((await store.getConsumed(eventId))?.status).toBe("skipped_stale");
    const task = (await pool.query(`SELECT state, version FROM delivery_tasks WHERE task_id = $1::uuid`, [taskId])).rows[0];
    expect(task).toMatchObject({ state: "cancelled", version: 1 });
  });

  /* ── ignored events still advance the task watermark ── */

  it("an ignored wave event advances the watermark (a later older outcome is stale)", async () => {
    const { taskId } = await seedTask(pool, { dispatchJobRef: JOB });
    const waveId = await seedDispatchEvent(pool, {
      event_type: "dispatch.wave_opened",
      aggregate_id: JOB,
      occurred_at: ts(1),
      payload: { job_id: JOB, wave_number: 1 },
    });

    const first = await runRelayBatch(await makeDeps(pool));
    expect(first.applied).toBe(0);
    expect(first.skipped).toBe(1);
    expect((await store.getConsumed(waveId))?.status).toBe("ignored");
    const afterWave = (await pool.query(`SELECT state, dispatch_last_event_id::text AS wmid FROM delivery_tasks WHERE task_id = $1::uuid`, [taskId])).rows[0];
    expect(afterWave.state).toBe("dispatch_requested"); // no state change from a wave
    expect(afterWave.wmid).toBe(waveId); // …but the watermark advanced

    // An OLDER outcome arriving behind the watermark is only ever read again
    // on replay — and is caught as stale BY the ignored wave's watermark.
    // This is exactly why `ignored` still advances the watermark.
    const olderId = await seedDispatchEvent(pool, {
      event_type: "dispatch.offer_accepted",
      aggregate_id: JOB,
      occurred_at: ts(0),
      payload: { job_id: JOB, driver_public_id: DRIVER, accepted_at: ts(0) },
    });

    const deps = await makeDeps(pool);
    await replayFrom(deps, null);
    const outcome = await runRelayBatch(deps);
    expect(outcome.applied).toBe(0);
    expect(outcome.skipped).toBe(2);
    expect((await store.getConsumed(olderId))?.status).toBe("skipped_stale");

    const task = (await pool.query(`SELECT state, dispatch_last_event_id::text AS wmid FROM delivery_tasks WHERE task_id = $1::uuid`, [taskId])).rows[0];
    expect(task.state).toBe("dispatch_requested");
    expect(task.wmid).toBe(waveId);
  });

  /* ── rebuildAll: re-projection without duplicating the outbox ── */

  it("rebuildAll re-projects from zero and the outbox stays append-only-unique", async () => {
    const { taskId } = await seedTask(pool, { dispatchJobRef: JOB });
    const eventId = await seedDispatchEvent(pool, {
      event_type: "dispatch.offer_accepted",
      aggregate_id: JOB,
      occurred_at: ts(0),
      payload: { job_id: JOB, driver_public_id: DRIVER, accepted_at: ts(0) },
    });
    await runRelayBatch(await makeDeps(pool));

    const deps = await makeDeps(pool);
    const { rebuildAll } = await import("../relay.js");
    await rebuildAll(deps); // clears mirror + ledger + checkpoint, NOT delivery_outbox

    const reset = (await pool.query(`SELECT state, courier_ref, dispatch_last_event_id FROM delivery_tasks WHERE task_id = $1::uuid`, [taskId])).rows[0];
    expect(reset).toMatchObject({ state: "dispatch_requested", courier_ref: null, dispatch_last_event_id: null });

    const rebuilt = await runRelayBatch(deps);
    expect(rebuilt.applied).toBe(1);
    const task = (await pool.query(`SELECT state, courier_ref FROM delivery_tasks WHERE task_id = $1::uuid`, [taskId])).rows[0];
    expect(task).toMatchObject({ state: "driver_assigned", courier_ref: DRIVER });

    // The outbox event was NOT duplicated: same event_id, one row (ON CONFLICT DO NOTHING).
    const outboxRows = (await pool.query(`SELECT count(*)::int AS n FROM delivery_outbox WHERE event_id = $1::uuid`, [eventId])).rows[0].n;
    expect(outboxRows).toBe(1);
  });
});
