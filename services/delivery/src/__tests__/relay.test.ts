/**
 * Relay engine tests (review 2/N — ADR-026 §2.4, guarantees per §2.4/GAP-3
 * and the search-relay precedent of ADR-025 §2.3).
 *
 * In-memory fakes only — the Postgres adapters are the declared deferral of
 * ADR-026 §4.2/§4.3. Every guarantee is tested against the SAME atomicity
 * contract a pg adapter must implement (task + ledger + outbox + consumed +
 * watermark in one transaction — see mirror-fakes.ts).
 */

import { describe, expect, it } from "vitest";
import type { RelayLogEntry } from "../relay.js";
import { rebuildAll, runRelayBatch } from "../relay.js";
import type { DispatchOutboxRow } from "../domain/consumed-events.js";
import { dispatchRow, InMemoryMirrorStore, ScriptedEventSource } from "./mirror-fakes.js";

const JOB = "11111111-1111-1111-1111-111111111111";
const T = (n: number) => `2026-09-09T10:00:${String(n).padStart(2, "0")}.000Z`;

function makeStore() {
  const store = new InMemoryMirrorStore();
  store.bindTask({ taskId: "t-1", orderId: "WS-0000000001", state: "dispatch_requested", courierRef: null, assignedAt: null, dispatchJobRef: JOB });
  return store;
}

function makeDeps(rows: readonly DispatchOutboxRow[], store = makeStore(), logs?: RelayLogEntry[]) {
  return {
    events: new ScriptedEventSource(rows),
    store,
    log: logs ? (e: RelayLogEntry) => logs.push(e) : undefined,
  };
}

describe("happy path — the coarse mirror lands a real transition", () => {
  it("offer_accepted drives dispatch_requested → driver_assigned, atomically", async () => {
    const store = makeStore();
    const deps = makeDeps([
      dispatchRow({ event_id: "e-1", event_type: "dispatch.offer_accepted", occurred_at: T(1), data: { job_id: JOB, offer_id: "of-1", driver_public_id: "WS-0123456789", reason_code: "OFFER_ACCEPTED", accepted_at: T(1) } }),
    ], store);
    const out = await runRelayBatch(deps);
    expect(out).toMatchObject({ processed: 1, applied: 1, poisoned: 0 });
    const task = store.tasks.get("t-1")!;
    expect(task.state).toBe("driver_assigned");
    expect(task.courierRef).toBe("WS-0123456789");
    expect(store.transitions).toHaveLength(1);
    expect(store.transitions[0]).toMatchObject({ from: "dispatch_requested", to: "driver_assigned", actorType: "dispatch", reasonCode: "dispatch_offer_accepted" });
    expect(store.outbox).toHaveLength(1);
    const evt = store.outbox[0] as unknown as { event_type: string; payload: Record<string, unknown> };
    expect(evt.event_type).toBe("delivery.driver_assigned");
    expect(evt.payload).toMatchObject({ to_state: "driver_assigned", courier_ref: "WS-0123456789", reason_code: "dispatch_offer_accepted" });
    expect(store.checkpoints.get("delivery-dispatch-relay-v1")).toEqual({ last_occurred_at: T(1), last_event_id: "e-1" });
  });

  it("the reassignment cycle: timed_out → wave_opened → reassigned → offer_accepted", async () => {
    const store = makeStore();
    store.bindTask({ taskId: "t-1", orderId: "WS-0000000001", state: "timed_out", courierRef: "WS-0123456789", assignedAt: T(1), dispatchJobRef: JOB });
    const deps = makeDeps([
      dispatchRow({ event_id: "e-2", event_type: "dispatch.wave_opened", occurred_at: T(2), data: { job_id: JOB, wave_id: "w-2", wave_number: 2, offer_count: 3, expires_at: T(9) } }),
      dispatchRow({ event_id: "e-3", event_type: "dispatch.offer_accepted", occurred_at: T(3), data: { job_id: JOB, offer_id: "of-9", driver_public_id: "WS-0987654321", reason_code: "OFFER_ACCEPTED", accepted_at: T(3) } }),
    ], store);
    const out = await runRelayBatch(deps);
    expect(out.applied).toBe(2);
    const task = store.tasks.get("t-1")!;
    expect(task.state).toBe("driver_assigned");
    expect(task.courierRef).toBe("WS-0987654321"); // reassigned to the NEW courier
    expect(store.outbox.map((e) => `${e.event_type}:${(e.payload as Record<string, unknown>).reason_code}`)).toEqual([
      "delivery.status_changed:reassignment_cycle",
      "delivery.driver_assigned:reassignment_cycle",
    ]);
  });
});

describe("idempotency — a terminally-consumed event is a no-op", () => {
  it("a lost checkpoint write redelivers the event: skipped, no duplicate outbox append", async () => {
    const store = makeStore();
    const deps = makeDeps([
      dispatchRow({ event_id: "e-1", event_type: "dispatch.offer_accepted", occurred_at: T(1), data: { job_id: JOB, driver_public_id: "WS-0123456789", accepted_at: T(1) } }),
    ], store);
    await runRelayBatch(deps);
    // Crash simulation: the checkpoint write is lost — the row is redelivered.
    store.checkpoints.delete("delivery-dispatch-relay-v1");
    const second = await runRelayBatch(deps);
    expect(second).toMatchObject({ processed: 1, applied: 0, skipped: 1 });
    expect(store.transitions).toHaveLength(1);
    expect(store.outbox).toHaveLength(1); // duplicate consumed row => no duplicate event
    expect(store.consumed.get("e-1")!.status).toBe("applied");
  });
});

describe("foreign jobs — dispatch serves the whole platform", () => {
  it("an unbound job's event is terminally ignored_foreign and the checkpoint advances", async () => {
    const store = makeStore();
    const logs: RelayLogEntry[] = [];
    const deps = makeDeps([
      dispatchRow({ event_id: "e-9", event_type: "dispatch.offer_accepted", occurred_at: T(1), data: { job_id: "99999999-9999-9999-9999-999999999999", driver_public_id: "WS-0123456789", accepted_at: T(1) } }),
    ], store, logs);
    const out = await runRelayBatch(deps);
    expect(out).toMatchObject({ skipped: 1, applied: 0 });
    expect(store.consumed.get("e-9")!.status).toBe("ignored_foreign");
    expect(store.tasks.get("t-1")!.state).toBe("dispatch_requested"); // untouched
    expect(store.checkpoints.get("delivery-dispatch-relay-v1")).toEqual({ last_occurred_at: T(1), last_event_id: "e-9" });
    expect(logs[0]).toMatchObject({ status: "ignored_foreign" });
  });
});

describe("ordering — no regression, ever", () => {
  it("an older redelivered event is skipped_stale", async () => {
    const store = makeStore();
    const deps = makeDeps([
      dispatchRow({ event_id: "e-3", event_type: "dispatch.offer_accepted", occurred_at: T(3), data: { job_id: JOB, driver_public_id: "WS-0123456789", accepted_at: T(3) } }),
    ], store);
    await runRelayBatch(deps); // applied — the task's watermark is now (T3, e-3)
    // Checkpoint loss redelivers BOTH rows; the old one is caught by the
    // per-task watermark even though the global checkpoint is gone:
    store.checkpoints.delete("delivery-dispatch-relay-v1");
    const late = makeDeps([
      dispatchRow({ event_id: "e-1", event_type: "dispatch.job_exhausted", occurred_at: T(1), data: { job_id: JOB, exhausted_at: T(1) } }),
      dispatchRow({ event_id: "e-3", event_type: "dispatch.offer_accepted", occurred_at: T(3), data: { job_id: JOB, driver_public_id: "WS-0123456789", accepted_at: T(3) } }),
    ], store);
    const out = await runRelayBatch(late);
    expect(out).toMatchObject({ applied: 0, skipped: 2 });
    expect(store.tasks.get("t-1")!.state).toBe("driver_assigned"); // not regressed to exhausted
    expect(store.consumed.get("e-1")!.status).toBe("skipped_stale");
  });

  it("an ignored event still advances the task watermark — a LATER stale outcome is caught", async () => {
    const store = makeStore();
    const deps = makeDeps([
      dispatchRow({ event_id: "e-5", event_type: "dispatch.offer_sent", occurred_at: T(5), data: { job_id: JOB, offer_id: "of-1", wave_id: "w-1", driver_public_id: "WS-0123456789", expires_at: T(9) } }),
    ], store);
    await runRelayBatch(deps); // ignored — but the watermark advances to (T5, e-5)
    // A late acceptance predating the ignored event cannot regress state:
    store.checkpoints.delete("delivery-dispatch-relay-v1");
    const late = makeDeps([
      dispatchRow({ event_id: "e-2", event_type: "dispatch.offer_accepted", occurred_at: T(2), data: { job_id: JOB, driver_public_id: "WS-0123456789", accepted_at: T(2) } }),
      dispatchRow({ event_id: "e-5", event_type: "dispatch.offer_sent", occurred_at: T(5), data: { job_id: JOB, offer_id: "of-1", wave_id: "w-1", driver_public_id: "WS-0123456789", expires_at: T(9) } }),
    ], store);
    const out = await runRelayBatch(late);
    expect(out.skipped).toBe(2);
    expect(store.tasks.get("t-1")!.state).toBe("dispatch_requested");
    expect(store.consumed.get("e-5")!.status).toBe("ignored");
    expect(store.consumed.get("e-2")!.status).toBe("skipped_stale");
  });

  it("a terminal task refuses every further dispatch event", async () => {
    const store = makeStore();
    store.bindTask({ taskId: "t-1", orderId: "WS-0000000001", state: "exhausted", courierRef: null, assignedAt: null, dispatchJobRef: JOB });
    const deps = makeDeps([
      dispatchRow({ event_id: "e-1", event_type: "dispatch.offer_accepted", occurred_at: T(1), data: { job_id: JOB, driver_public_id: "WS-0123456789", accepted_at: T(1) } }),
    ], store);
    const out = await runRelayBatch(deps);
    expect(out.skipped).toBe(1);
    expect(store.consumed.get("e-1")!.status).toBe("skipped_stale");
    expect(store.tasks.get("t-1")!.state).toBe("exhausted");
  });
});

describe("poison — a wrong mirror must never advance quietly", () => {
  it("an unsupported event version is poisoned", async () => {
    const deps = makeDeps([
      dispatchRow({ event_id: "e-1", event_type: "dispatch.offer_accepted", event_version: "v2", occurred_at: T(1), data: { job_id: JOB, driver_public_id: "WS-0123456789", accepted_at: T(1) } }),
    ]);
    const out = await runRelayBatch(deps);
    expect(out.poisoned).toBe(1);
    expect(deps.store.consumed.get("e-1")!.status).toBe("poisoned");
    expect(deps.store.tasks.get("t-1")!.state).toBe("dispatch_requested");
  });

  it("an invalid payload is poisoned", async () => {
    const deps = makeDeps([
      dispatchRow({ event_id: "e-1", event_type: "dispatch.offer_accepted", occurred_at: T(1), data: { job_id: JOB, driver_public_id: "ORD-1234567890", accepted_at: T(1) } }),
    ]);
    const out = await runRelayBatch(deps);
    expect(out.poisoned).toBe(1);
  });

  it("a bound outcome with no legal edge is poisoned (exhaustion after assignment)", async () => {
    const store = makeStore();
    store.bindTask({ taskId: "t-1", orderId: "WS-0000000001", state: "driver_assigned", courierRef: "WS-0123456789", assignedAt: T(1), dispatchJobRef: JOB });
    const logs: RelayLogEntry[] = [];
    const deps = makeDeps([
      dispatchRow({ event_id: "e-2", event_type: "dispatch.job_exhausted", occurred_at: T(2), data: { job_id: JOB, exhausted_at: T(2) } }),
    ], store, logs);
    const out = await runRelayBatch(deps);
    expect(out.poisoned).toBe(1);
    expect(store.tasks.get("t-1")!.state).toBe("driver_assigned");
    expect(store.consumed.get("e-2")!.lastError).toContain("no legal edge");
    expect(logs[0]).toMatchObject({ status: "poisoned" });
  });

  it("a poisoned row never blocks the stream — the checkpoint advances past it", async () => {
    const deps = makeDeps([
      dispatchRow({ event_id: "e-1", event_type: "dispatch.offer_accepted", event_version: "v9", occurred_at: T(1), data: { job_id: JOB, driver_public_id: "WS-0123456789", accepted_at: T(1) } }),
      dispatchRow({ event_id: "e-2", event_type: "dispatch.offer_accepted", occurred_at: T(2), data: { job_id: JOB, driver_public_id: "WS-0123456789", accepted_at: T(2) } }),
    ]);
    const out = await runRelayBatch(deps);
    expect(out.poisoned).toBe(1);
    expect(out.applied).toBe(1); // e-2 still processed
    expect(deps.store.checkpoints.get("delivery-dispatch-relay-v1")).toEqual({ last_occurred_at: T(2), last_event_id: "e-2" });
  });
});

describe("retry — pending failures do not advance the checkpoint", () => {
  it("a transient store failure retries and eventually applies", async () => {
    const store = makeStore();
    store.failApplyNTimes = 2;
    const deps = makeDeps([
      dispatchRow({ event_id: "e-1", event_type: "dispatch.offer_accepted", occurred_at: T(1), data: { job_id: JOB, driver_public_id: "WS-0123456789", accepted_at: T(1) } }),
    ], store);
    const first = await runRelayBatch(deps);
    expect(first.applied).toBe(0);
    expect(first.advancedTo).toBeNull(); // checkpoint did NOT advance
    expect(store.consumed.get("e-1")).toMatchObject({ status: "pending", attemptCount: 1 });
    await runRelayBatch(deps); // still failing (2nd injected failure)
    expect(store.consumed.get("e-1")).toMatchObject({ status: "pending", attemptCount: 2 });
    const third = await runRelayBatch(deps); // injected failures exhausted
    expect(third.applied).toBe(1);
    expect(store.tasks.get("t-1")!.state).toBe("driver_assigned");
    expect(store.consumed.get("e-1")!.status).toBe("applied");
  });

  it("after maxAttempts the row is poisoned and the stream moves on", async () => {
    const store = makeStore();
    store.failApplyNTimes = 99;
    const deps = { events: new ScriptedEventSource([dispatchRow({ event_id: "e-1", event_type: "dispatch.offer_accepted", occurred_at: T(1), data: { job_id: JOB, driver_public_id: "WS-0123456789", accepted_at: T(1) } })]), store, config: { maxAttempts: 2 } };
    await runRelayBatch(deps); // attempt 1 → pending
    await runRelayBatch(deps); // attempt 2 → pending
    const third = await runRelayBatch(deps); // attempt 3 → poison
    expect(third.poisoned).toBe(1);
    expect(store.consumed.get("e-1")).toMatchObject({ status: "poisoned", attemptCount: 3 });
    expect(third.advancedTo).toEqual({ last_occurred_at: T(1), last_event_id: "e-1" });
  });
});

describe("replay and rebuild", () => {
  const rows = [
    dispatchRow({ event_id: "e-1", event_type: "dispatch.offer_accepted", occurred_at: T(1), data: { job_id: JOB, driver_public_id: "WS-0123456789", accepted_at: T(1) } }),
  ];

  it("replayFrom is safe: idempotency makes already-applied events no-ops", async () => {
    const store = makeStore();
    const deps = makeDeps(rows, store);
    await runRelayBatch(deps);
    const before = store.outbox.length;
    const { replayFrom } = await import("../relay.js");
    await replayFrom(deps, null); // checkpoint to zero
    const out = await runRelayBatch(deps);
    expect(out.applied).toBe(0); // duplicate — skipped
    expect(store.outbox).toHaveLength(before); // no duplicate delivery events
  });

  it("rebuildAll clears the mirror and re-applies from zero", async () => {
    const store = makeStore();
    const deps = makeDeps(rows, store);
    await runRelayBatch(deps);
    expect(store.tasks.get("t-1")!.state).toBe("driver_assigned");
    await rebuildAll(deps);
    expect(store.tasks.get("t-1")!.state).toBe("dispatch_requested"); // reset
    expect(store.consumed.size).toBe(0);
    const out = await runRelayBatch(deps);
    expect(out.applied).toBe(1);
    expect(store.tasks.get("t-1")!.state).toBe("driver_assigned");
  });
});

describe("observability", () => {
  it("every processed event produces a structured log line", async () => {
    const store = makeStore();
    const logs: RelayLogEntry[] = [];
    const deps = makeDeps([
      dispatchRow({ event_id: "e-1", event_type: "dispatch.offer_sent", occurred_at: T(1), data: { job_id: JOB, offer_id: "of-1", wave_id: "w-1", driver_public_id: "WS-0123456789", expires_at: T(9) } }),
    ], store, logs);
    await runRelayBatch(deps);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event_id: "e-1", event_type: "dispatch.offer_sent", status: "ignored", attempt: 1 });
    expect(typeof logs[0].ts).toBe("string");
  });
});
