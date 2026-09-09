/**
 * Delegation wire integration tests (review 4/N, ADR-026 §2.4/§4.6-2). Real
 * PostgreSQL: the command side of the boundary — delegateToDispatch driving
 * the PostgresTaskMirrorStore's delegation methods.
 *
 * These prove what the in-memory fake CANNOT:
 *   • BIND ATOMICITY — a failure injected MID-transaction (between the task
 *     UPDATE and the outbox INSERT, via an abort trigger) leaves NOTHING:
 *     no ref, no state move, no ledger row, no event. The bind is all-or-
 *     nothing on the real database, not on a promise;
 *   • the CONDITIONAL edge is enforced by the row the transaction locked —
 *     a task that is not `eligible` anymore is refused with the contract
 *     code, and a DIFFERENT ref on a bound task is a coded contradiction;
 *   • the ledger row the bind writes is readable with actor `system` and
 *     reason `dispatch_delegated`, and the delivery.dispatch_requested
 *     payload carries the ref (§2.4 — delegation by reference);
 *   • the §4.6-2 ordering invariant, end to end on one database: the outcome
 *     event for an unbound task is terminally consumed `ignored_foreign`
 *     (no way back), while the SAME outcome after the bind applies.
 *
 * SKIPS when DATABASE_URL is unset (docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md).
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { PG_ENABLED, setupPostgres, resetData, seedTask, type PgFixture } from "./pg-harness.js";
import { PostgresTaskMirrorStore } from "../infrastructure/task-mirror-store.js";
import { delegateToDispatch } from "../use-cases/delegate-to-dispatch.js";
import { deriveDelegationIdempotencyKey } from "../domain/delegation.js";
import { FakeDispatchJobRequester } from "./mirror-fakes.js";
import { runRelayBatch, DEFAULT_RELAY_CONFIG, type RelayDeps } from "../relay.js";
import { PostgresDispatchEventSource } from "../infrastructure/dispatch-event-source.js";
import { seedDispatchEvent } from "./pg-harness.js";

const T0 = "2026-09-09T12:00:00.000Z";

/** Fresh ids/clock per call — the wire asks for a new event id per bind. */
function liveIds() {
  return {
    ids: { uuid: () => crypto.randomUUID() },
    clock: { now: () => new Date().toISOString() },
  };
}

(PG_ENABLED ? describe : describe.skip)("delegation integration — PostgreSQL bind", () => {
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
    await pool.query(`DROP TRIGGER IF EXISTS abort_delegation ON delivery_outbox`).catch(() => undefined);
    await close();
  });

  it("binds atomically: ref + eligible→dispatch_requested + ledger (system/dispatch_delegated) + event, all visible after commit", async () => {
    const seeded = await seedTask(pool, { state: "eligible", dispatchJobRef: null });
    const result = await delegateToDispatch(
      { requester: new FakeDispatchJobRequester(), store, ...liveIds() },
      { taskId: seeded.taskId },
    );
    expect(result).toEqual({ outcome: "delegated", jobRef: "job-1" });

    const task = await pool.query<{ state: string; dispatch_job_ref: string }>(
      `SELECT state, dispatch_job_ref FROM delivery_tasks WHERE task_id = $1::uuid`,
      [seeded.taskId],
    );
    expect(task.rows[0]).toMatchObject({ state: "dispatch_requested", dispatch_job_ref: "job-1" });

    const ledger = await pool.query<{ from_state: string; to_state: string; reason_code: string; actor_type: string }>(
      `SELECT from_state, to_state, reason_code, actor_type FROM delivery_task_transitions WHERE task_id = $1::uuid`,
      [seeded.taskId],
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({
      from_state: "eligible",
      to_state: "dispatch_requested",
      reason_code: "dispatch_delegated",
      actor_type: "system",
    });

    const outbox = await pool.query<{ event_type: string; payload: { dispatch_job_ref: string } }>(
      `SELECT event_type, payload FROM delivery_outbox WHERE aggregate_id = $1::text`,
      [seeded.taskId],
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0].event_type).toBe("delivery.dispatch_requested");
    expect(outbox.rows[0].payload.dispatch_job_ref).toBe("job-1");
  });

  it("a mid-transaction failure leaves NOTHING — the bind is all-or-nothing on the real database", async () => {
    const seeded = await seedTask(pool, { state: "eligible", dispatchJobRef: null });
    // Abort AFTER the task UPDATE + ledger insert, BEFORE commit — the exact
    // point where a non-atomic implementation would leak a bound task with
    // no event (or an event with no bind).
    await pool.query(
      `CREATE OR REPLACE FUNCTION abort_delegation() RETURNS trigger AS $$
         BEGIN RAISE EXCEPTION 'injected mid-transaction failure'; END;
       $$ LANGUAGE plpgsql`,
    );
    await pool.query(
      `CREATE TRIGGER abort_delegation BEFORE INSERT ON delivery_outbox
         FOR EACH ROW EXECUTE FUNCTION abort_delegation()`,
    );

    const requester = new FakeDispatchJobRequester();
    requester.script.push({ jobRef: "job-leak", replayed: false });
    await expect(
      delegateToDispatch({ requester, store, ...liveIds() }, { taskId: seeded.taskId }),
    ).rejects.toThrowError(/injected mid-transaction failure/);

    const task = await pool.query<{ state: string; dispatch_job_ref: string | null }>(
      `SELECT state, dispatch_job_ref FROM delivery_tasks WHERE task_id = $1::uuid`,
      [seeded.taskId],
    );
    expect(task.rows[0]).toMatchObject({ state: "eligible", dispatch_job_ref: null });
    const ledger = await pool.query(`SELECT count(*)::int AS n FROM delivery_task_transitions WHERE task_id = $1::uuid`, [seeded.taskId]);
    expect(ledger.rows[0].n).toBe(0);
    const outbox = await pool.query(`SELECT count(*)::int AS n FROM delivery_outbox`);
    expect(outbox.rows[0].n).toBe(0);

    // And the wire heals on retry — SAME deterministic key, same job, binds cleanly.
    await pool.query(`DROP TRIGGER abort_delegation ON delivery_outbox`);
    const result = await delegateToDispatch({ requester, store, ...liveIds() }, { taskId: seeded.taskId });
    expect(result).toEqual({ outcome: "delegated", jobRef: "job-leak" });
    const keysAfter = requester.commands.map((c) => c.idempotencyKey);
    expect(keysAfter).toHaveLength(2);
    expect(keysAfter[0]).toBe(keysAfter[1]);
    expect(keysAfter[0]).toBe(deriveDelegationIdempotencyKey(seeded.taskId));
  });

  it("refuses a task that left `eligible` (checked by the locked row, contract-coded)", async () => {
    const seeded = await seedTask(pool, { state: "driver_assigned", dispatchJobRef: null });
    await expect(
      store.bindDispatchJob(seeded.taskId, "job-x", { eventId: crypto.randomUUID(), occurredAt: T0, traceId: null }),
    ).rejects.toMatchObject({ code: "DELIVERY_TRANSITION_NOT_ALLOWED", httpStatus: 409 });
    const task = await pool.query<{ state: string }>(`SELECT state FROM delivery_tasks WHERE task_id = $1::uuid`, [seeded.taskId]);
    expect(task.rows[0].state).toBe("driver_assigned");
  });

  it("a DIFFERENT jobRef on a bound task is DELIVERY_CONCURRENT_UPDATE — coded contradiction, nothing rewritten", async () => {
    const seeded = await seedTask(pool, { state: "eligible", dispatchJobRef: null });
    await store.bindDispatchJob(seeded.taskId, "job-first", { eventId: crypto.randomUUID(), occurredAt: T0, traceId: null });
    await expect(
      store.bindDispatchJob(seeded.taskId, "job-second", { eventId: crypto.randomUUID(), occurredAt: T0, traceId: null }),
    ).rejects.toMatchObject({ code: "DELIVERY_CONCURRENT_UPDATE", httpStatus: 409 });
    const task = await pool.query<{ dispatch_job_ref: string }>(
      `SELECT dispatch_job_ref FROM delivery_tasks WHERE task_id = $1::uuid`,
      [seeded.taskId],
    );
    expect(task.rows[0].dispatch_job_ref).toBe("job-first");
  });

  it("the SAME jobRef rebind is already_bound — idempotent, no duplicate ledger row", async () => {
    const seeded = await seedTask(pool, { state: "eligible", dispatchJobRef: null });
    const first = await store.bindDispatchJob(seeded.taskId, "job-same", { eventId: crypto.randomUUID(), occurredAt: T0, traceId: null });
    const second = await store.bindDispatchJob(seeded.taskId, "job-same", { eventId: crypto.randomUUID(), occurredAt: T0, traceId: null });
    expect([first, second]).toEqual(["bound", "already_bound"]);
    const ledger = await pool.query(`SELECT count(*)::int AS n FROM delivery_task_transitions WHERE task_id = $1::uuid`, [seeded.taskId]);
    expect(ledger.rows[0].n).toBe(1);
  });

  it("the §4.6-2 invariant, end to end: an outcome for an UNBOUND task is terminally ignored_foreign; the SAME outcome after the bind applies", async () => {
    // One unbound task and one outcome event, on the same real database.
    const seeded = await seedTask(pool, { state: "eligible", dispatchJobRef: null });
    const outcomeId = await seedDispatchEvent(pool, {
      event_type: "dispatch.offer_accepted",
      aggregate_id: "job-late",
      payload: { job_id: "job-late", driver_public_id: "WS-0000000123", accepted_at: T0 },
      occurred_at: T0,
    });

    // (1) The outcome BEFORE the bind: ignored_foreign, terminally consumed —
    // the exact failure mode §4.6-2 exists to prevent, proven, not asserted.
    const relayDeps: RelayDeps = {
      events: new PostgresDispatchEventSource(pool),
      store,
      config: { ...DEFAULT_RELAY_CONFIG, batchSize: 10 },
    };
    await runRelayBatch(relayDeps);
    const consumed = await pool.query<{ consumed_status: string }>(
      `SELECT consumed_status FROM delivery_relay_consumed_events WHERE event_id = $1::uuid`,
      [outcomeId],
    );
    expect(consumed.rows[0].consumed_status).toBe("ignored_foreign");
    const task = await pool.query<{ state: string }>(`SELECT state FROM delivery_tasks WHERE task_id = $1::uuid`, [seeded.taskId]);
    expect(task.rows[0].state).toBe("eligible");

    // (2) Now the wire runs — bind + state move, and the invariant's shape is
    // visible: the ONLY legal join is the ref the wire wrote.
    await delegateToDispatch(
      { requester: new FakeDispatchJobRequester(), store, ...liveIds() },
      { taskId: seeded.taskId },
    );
    const bound = await pool.query<{ state: string; dispatch_job_ref: string }>(
      `SELECT state, dispatch_job_ref FROM delivery_tasks WHERE task_id = $1::uuid`,
      [seeded.taskId],
    );
    expect(bound.rows[0]).toMatchObject({ state: "dispatch_requested", dispatch_job_ref: "job-1" });

    // (3) A FRESH outcome for the bound job applies cleanly through the mirror.
    const appliedId = await seedDispatchEvent(pool, {
      event_type: "dispatch.offer_accepted",
      aggregate_id: "job-1",
      payload: { job_id: "job-1", driver_public_id: "WS-0000000123", accepted_at: new Date(Date.parse(T0) + 60_000).toISOString() },
      occurred_at: new Date(Date.parse(T0) + 60_000).toISOString(),
    });
    await runRelayBatch(relayDeps);
    const after = await pool.query<{ state: string; courier_ref: string }>(
      `SELECT state, courier_ref FROM delivery_tasks WHERE task_id = $1::uuid`,
      [seeded.taskId],
    );
    expect(after.rows[0]).toMatchObject({ state: "driver_assigned", courier_ref: "WS-0000000123" });
    const applied = await pool.query<{ consumed_status: string }>(
      `SELECT consumed_status FROM delivery_relay_consumed_events WHERE event_id = $1::uuid`,
      [appliedId],
    );
    expect(applied.rows[0].consumed_status).toBe("applied");
  });
});
