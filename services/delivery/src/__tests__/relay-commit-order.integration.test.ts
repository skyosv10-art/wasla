/**
 * RISK-0012 (CLM-0416 · ADR-057): the dispatch relay reads `dispatch_outbox` in
 * COMMIT order, on real PostgreSQL.
 *
 * What the old key got wrong, and what each test below measures:
 *   • (occurred_at, random UUID) tied inside one transaction (`now()` is the
 *     transaction start), so two events of one decision could be read in either
 *     order → «intra-transaction order».
 *   • An insert-time counter (`sequence_number`) is not commit order: a
 *     transaction that inserted first and committed last shows a number the
 *     relay has already passed, and its event is never read → «late commit».
 *   • The fix must not hold a table-wide lock from the insert to the commit,
 *     or every producer transaction would queue behind the slowest one
 *     → «no insert-time lock».
 *   • Replay and duplicates must stay no-ops → «replay» / «duplicate».
 *
 * SKIPS when DATABASE_URL is unset (docs/14-runbooks/LOCAL_POSTGRES_FOR_TESTS.md).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";

import { PG_ENABLED, resetData, seedDispatchEvent, seedTask, setupPostgres, type PgFixture } from "./pg-harness.js";
import { PostgresDispatchEventSource } from "../infrastructure/dispatch-event-source.js";
import { PostgresTaskMirrorStore } from "../infrastructure/task-mirror-store.js";
import { PostgresRelayConsumerLock } from "../infrastructure/relay-advisory-lock.js";
import { DEFAULT_RELAY_CONFIG, replayFrom, runRelayBatch, type RelayDeps } from "../relay.js";

const JOB = "job-agg-1";
const DRIVER = "WS-0000000123";
const T0 = "2026-09-09T10:00:00.000Z";

const INSERT = `INSERT INTO dispatch_outbox (event_id, event_type, event_version, aggregate_type, aggregate_id, payload, occurred_at)
                VALUES ($1::uuid, $2, 'v1', 'dispatch_job', $3, $4::jsonb, $5::timestamptz)
                ON CONFLICT (event_id) DO NOTHING`;

const uuid = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, "0")}`;

function makeDeps(pool: PgFixture["pool"]): RelayDeps {
  return {
    events: new PostgresDispatchEventSource(pool),
    store: new PostgresTaskMirrorStore(pool),
    lock: new PostgresRelayConsumerLock(pool),
    config: { ...DEFAULT_RELAY_CONFIG, batchSize: 50 },
  };
}

(PG_ENABLED ? describe : describe.skip)("RISK-0012 — dispatch relay reads in commit order (PostgreSQL)", () => {
  let fixture: PgFixture;
  let held: PoolClient | null = null;

  beforeEach(async () => {
    fixture = await setupPostgres();
    await resetData(fixture.pool);
  });
  afterEach(async () => {
    if (held) {
      await held.query("ROLLBACK").catch(() => undefined);
      held.release();
      held = null;
    }
    await fixture.close();
  });

  const seqOf = async (id: string) =>
    (
      await fixture.pool.query<{ sequence_number: string; commit_sequence: string }>(
        `SELECT sequence_number::text AS sequence_number, commit_sequence::text AS commit_sequence
           FROM dispatch_outbox WHERE event_id = $1::uuid`,
        [id],
      )
    ).rows[0]!;

  it("intra-transaction order: 12 events of one transaction are read in insertion order (and past the text-sort trap)", async () => {
    const client = await fixture.pool.connect();
    try {
      await client.query("BEGIN");
      // Same `now()` for all twelve — the old key would tie and fall to the UUID.
      // The UUIDs are inserted in DESCENDING order so a UUID tie-break would read them backwards.
      for (let i = 12; i >= 1; i--) {
        await client.query(INSERT, [uuid(i), "dispatch.wave_opened", `job-${i}`, JSON.stringify({ job_id: `job-${i}`, wave_number: 1 }), T0]);
      }
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const rows = await new PostgresDispatchEventSource(fixture.pool).readAfter(null, 50);
    expect(rows.map((r) => r.event_id)).toEqual(Array.from({ length: 12 }, (_, k) => uuid(12 - k)));
    const seqs = rows.map((r) => BigInt(r.commit_sequence));
    for (let k = 1; k < seqs.length; k++) expect(seqs[k]! > seqs[k - 1]!).toBe(true);
  });

  it("late commit: an event inserted first but committed last is read after, not skipped", async () => {
    const { taskId } = await seedTask(fixture.pool, { dispatchJobRef: JOB });
    const early = uuid(1);
    const late = uuid(2);

    // T1 inserts FIRST and stays open.
    held = await fixture.pool.connect();
    await held.query("BEGIN");
    await held.query(INSERT, [early, "dispatch.offer_accepted", JOB, JSON.stringify({ job_id: JOB, driver_public_id: DRIVER, accepted_at: T0 }), T0]);

    // T2 inserts SECOND and commits while T1 is still open. A bounded
    // statement_timeout makes an insert-time lock fail this test instead of hanging it.
    const t2 = await fixture.pool.connect();
    try {
      await t2.query("SET statement_timeout = '5s'");
      await t2.query(INSERT, [late, "dispatch.wave_opened", "job-other", JSON.stringify({ job_id: "job-other", wave_number: 1 }), T0]);
    } finally {
      t2.release();
    }

    // The relay runs now: only T2's event is visible, and the checkpoint moves past it.
    const deps = makeDeps(fixture.pool);
    const first = await runRelayBatch(deps);
    expect(first.processed).toBe(1);
    expect(first.advancedTo?.last_event_id).toBe(late);

    // T1 commits last.
    await held.query("COMMIT");
    held.release();
    held = null;

    // The insert-time counter says «early» is BEHIND the checkpoint — the old
    // cursor would never read it. The commit-time counter says it is AHEAD.
    const e = await seqOf(early);
    const l = await seqOf(late);
    expect(BigInt(e.sequence_number)).toBeLessThan(BigInt(l.sequence_number));
    expect(BigInt(e.commit_sequence)).toBeGreaterThan(BigInt(l.commit_sequence));

    const second = await runRelayBatch(deps);
    expect(second.processed).toBe(1);
    expect(second.applied).toBe(1);
    const task = (await fixture.pool.query(`SELECT state, dispatch_last_event_id::text AS wm FROM delivery_tasks WHERE task_id = $1::uuid`, [taskId])).rows[0];
    expect(task).toMatchObject({ state: "driver_assigned", wm: early });
  });

  it("no insert-time lock: a second producer commits while the first is still open", async () => {
    held = await fixture.pool.connect();
    await held.query("BEGIN");
    await held.query(INSERT, [uuid(1), "dispatch.wave_opened", "job-a", JSON.stringify({ job_id: "job-a", wave_number: 1 }), T0]);
    const other = await fixture.pool.connect();
    try {
      await other.query("SET statement_timeout = '3s'");
      const started = Date.now();
      await other.query(INSERT, [uuid(2), "dispatch.wave_opened", "job-b", JSON.stringify({ job_id: "job-b", wave_number: 1 }), T0]);
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      other.release();
    }
  });

  it("replay: rewinding to zero re-reads everything in commit order and applies nothing twice", async () => {
    const { taskId } = await seedTask(fixture.pool, { dispatchJobRef: JOB });
    await seedDispatchEvent(fixture.pool, {
      event_type: "dispatch.offer_accepted",
      aggregate_id: JOB,
      occurred_at: T0,
      payload: { job_id: JOB, driver_public_id: DRIVER, accepted_at: T0 },
    });
    const deps = makeDeps(fixture.pool);
    expect((await runRelayBatch(deps)).applied).toBe(1);
    const before = (await fixture.pool.query(`SELECT version FROM delivery_tasks WHERE task_id = $1::uuid`, [taskId])).rows[0].version;

    await replayFrom(deps, null);
    const again = await runRelayBatch(deps);
    expect(again.processed).toBe(1);
    expect(again.applied).toBe(0);
    const after = (await fixture.pool.query(`SELECT version FROM delivery_tasks WHERE task_id = $1::uuid`, [taskId])).rows[0].version;
    expect(after).toBe(before);
    const outbox = await fixture.pool.query(`SELECT count(*)::int AS n FROM delivery_outbox`);
    expect(outbox.rows[0].n).toBe(1); // the mirror's own event was not emitted twice
  });

  it("duplicate: re-inserting the same event_id neither adds a row nor moves its commit_sequence", async () => {
    const id = uuid(7);
    await fixture.pool.query(INSERT, [id, "dispatch.wave_opened", "job-a", JSON.stringify({ job_id: "job-a", wave_number: 1 }), T0]);
    const first = await seqOf(id);
    await fixture.pool.query(INSERT, [id, "dispatch.wave_opened", "job-a", JSON.stringify({ job_id: "job-a", wave_number: 1 }), T0]);
    const second = await seqOf(id);
    expect(second.commit_sequence).toBe(first.commit_sequence);
    const n = await fixture.pool.query(`SELECT count(*)::int AS n FROM dispatch_outbox WHERE event_id = $1::uuid`, [id]);
    expect(n.rows[0].n).toBe(1);
  });
});
