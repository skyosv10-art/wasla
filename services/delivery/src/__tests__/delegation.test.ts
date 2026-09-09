/**
 * Delegation wire unit tests (review 4/N — ADR-026 §2.4/§4.6).
 *
 * Every guarantee of the wire is tested against the fakes, mirroring what the
 * Postgres adapter must do atomically (integration tests prove the SQL side):
 *   - happy path: eligible → dispatch_requested, bound, ledger + event written;
 *   - idempotent replay: a bound task returns already_delegated, no new command;
 *   - crash-heal: requester fails, ZERO state changes; retry with the SAME
 *     deterministic key returns the SAME job and binds it (never a second one);
 *   - different jobRef on a bound task → DELIVERY_CONCURRENT_UPDATE, nothing written;
 *   - non-eligible state → DELIVERY_TRANSITION_NOT_ALLOWED, no external call;
 *   - unknown task → DELIVERY_TASK_NOT_FOUND;
 *   - malformed jobRef from the bridge → DELIVERY_DISPATCH_UNAVAILABLE, bind nothing.
 */

import { describe, expect, it } from "vitest";

import { delegateToDispatch } from "../use-cases/delegate-to-dispatch.js";
import {
  DELEGATION_SOURCE_STATE,
  DELEGATION_TARGET_STATE,
  deriveDelegationIdempotencyKey,
} from "../domain/delegation.js";
import { DeliveryError } from "../domain/errors.js";
import {
  deterministicIds,
  FakeDispatchJobRequester,
  InMemoryDelegationStore,
} from "./mirror-fakes.js";
import type { DelegatableTask } from "../domain/delegation.js";

function eligibleTask(overrides: Partial<DelegatableTask> = {}): DelegatableTask {
  return {
    taskId: "11111111-0000-0000-0000-000000000001",
    orderId: "22222222-0000-0000-0000-000000000002",
    state: DELEGATION_SOURCE_STATE,
    dispatchJobRef: null,
    ...overrides,
  };
}

function wire() {
  return {
    store: new InMemoryDelegationStore(),
    requester: new FakeDispatchJobRequester(),
    ...deterministicIds(),
  };
}

describe("delegateToDispatch — happy path", () => {
  it("binds the job, moves eligible→dispatch_requested, writes ledger (system/dispatch_delegated) and the outbox event id", async () => {
    const d = wire();
    d.store.bindTask(eligibleTask());
    const result = await delegateToDispatch(d, { taskId: eligibleTask().taskId });
    expect(result.outcome).toBe("delegated");
    const task = d.store.tasks.get(eligibleTask().taskId)!;
    expect(task.state).toBe(DELEGATION_TARGET_STATE);
    expect(task.dispatchJobRef).toBe("job-1");
    expect(task.ledger).toHaveLength(1);
    expect(task.ledger[0]).toMatchObject({
      from: DELEGATION_SOURCE_STATE,
      to: DELEGATION_TARGET_STATE,
      reason: "dispatch_delegated",
      actor: "system",
    });
    expect(task.outbox).toHaveLength(1);
  });

  it("sends the deterministic idempotency key and delivery-owned refs only", async () => {
    const d = wire();
    const task = eligibleTask();
    d.store.bindTask(task);
    await delegateToDispatch(d, { taskId: task.taskId, traceId: "trace-1" });
    expect(d.requester.commands).toHaveLength(1);
    expect(d.requester.commands[0]).toMatchObject({
      taskId: task.taskId,
      orderId: task.orderId,
      idempotencyKey: deriveDelegationIdempotencyKey(task.taskId),
      traceId: "trace-1",
    });
  });
});

describe("delegateToDispatch — idempotent replay", () => {
  it("returns already_delegated for a bound task WITHOUT a new external command", async () => {
    const d = wire();
    const task = eligibleTask({ dispatchJobRef: "job-abc", state: DELEGATION_TARGET_STATE });
    d.store.bindTask(task);
    const result = await delegateToDispatch(d, { taskId: task.taskId });
    expect(result).toEqual({ outcome: "already_delegated", jobRef: "job-abc" });
    expect(d.requester.commands).toHaveLength(0);
    // and nothing changed locally
    const stored = d.store.tasks.get(task.taskId)!;
    expect(stored.ledger).toHaveLength(0);
    expect(stored.outbox).toHaveLength(0);
  });

  it("replay answers even when the mirror has moved the task past dispatch_requested", async () => {
    const d = wire();
    // A bound task the mirror advanced to driver_assigned — the wire's business is done.
    d.store.bindTask(eligibleTask({ dispatchJobRef: "job-abc", state: "driver_assigned" }));
    const result = await delegateToDispatch(d, { taskId: eligibleTask().taskId });
    expect(result).toEqual({ outcome: "already_delegated", jobRef: "job-abc" });
  });
});

describe("delegateToDispatch — crash-heal (§4.6-2's retry shape)", () => {
  it("requester failure leaves ZERO state: task stays eligible, no ledger, no event", async () => {
    const d = wire();
    d.store.bindTask(eligibleTask());
    d.requester.failFirstNKeys = 1;
    await expect(delegateToDispatch(d, { taskId: eligibleTask().taskId })).rejects.toMatchObject({
      code: "DELIVERY_DISPATCH_UNAVAILABLE",
      httpStatus: 503,
    });
    const task = d.store.tasks.get(eligibleTask().taskId)!;
    expect(task.state).toBe(DELEGATION_SOURCE_STATE);
    expect(task.dispatchJobRef).toBeNull();
    expect(task.ledger).toHaveLength(0);
    expect(task.outbox).toHaveLength(0);
  });

  it("retry after requester failure uses the SAME key and binds the SAME job — never a second one", async () => {
    const d = wire();
    const task = eligibleTask();
    d.store.bindTask(task);
    d.requester.failFirstNKeys = 1;
    await expect(delegateToDispatch(d, { taskId: task.taskId })).rejects.toBeInstanceOf(DeliveryError);
    d.requester.script.push({ jobRef: "job-original", replayed: false });
    const result = await delegateToDispatch(d, { taskId: task.taskId });
    expect(result).toEqual({ outcome: "delegated", jobRef: "job-original" });
    // SAME key both times — dispatch's idempotency is what heals the crash.
    const keys = d.requester.commands.map((c) => c.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(d.store.tasks.get(task.taskId)!.dispatchJobRef).toBe("job-original");
  });

  it("a replayed outcome from dispatch binds the original ref (already_bound is a success, not an error)", async () => {
    const d = wire();
    const task = eligibleTask();
    d.store.bindTask(task);
    d.requester.script.push({ jobRef: "job-x", replayed: false }, { jobRef: "job-x", replayed: true });
    const first = await delegateToDispatch(d, { taskId: task.taskId });
    expect(first).toEqual({ outcome: "delegated", jobRef: "job-x" });
    // A concurrent second wire run raced past the local read: dispatch says the
    // same job, the bind says already_bound — the wire answers replay, idempotent.
    const second = await delegateToDispatch(d, { taskId: task.taskId });
    expect(second).toEqual({ outcome: "already_delegated", jobRef: "job-x" });
    expect(d.store.tasks.get(task.taskId)!.ledger).toHaveLength(1);
  });
});

describe("delegateToDispatch — refusals", () => {
  it("non-eligible state → DELIVERY_TRANSITION_NOT_ALLOWED and NO external call", async () => {
    const d = wire();
    d.store.bindTask(eligibleTask({ state: "pending_eligibility" }));
    await expect(delegateToDispatch(d, { taskId: eligibleTask().taskId })).rejects.toMatchObject({
      code: "DELIVERY_TRANSITION_NOT_ALLOWED",
      details: { from: "pending_eligibility", to: DELEGATION_TARGET_STATE },
    });
    expect(d.requester.commands).toHaveLength(0);
  });

  it("unknown task → DELIVERY_TASK_NOT_FOUND", async () => {
    const d = wire();
    await expect(delegateToDispatch(d, { taskId: "99999999-0000-0000-0000-000000000009" })).rejects.toMatchObject({
      code: "DELIVERY_TASK_NOT_FOUND",
    });
  });

  it("a DIFFERENT jobRef on a bound task is DELIVERY_CONCURRENT_UPDATE — contradiction, not silent replay", async () => {
    const d = wire();
    d.store.bindTask(eligibleTask({ dispatchJobRef: "job-first", state: DELEGATION_TARGET_STATE }));
    // The store's bindDispatchJob raises directly when the ref differs.
    await expect(
      d.store.bindDispatchJob(eligibleTask().taskId, "job-second", {
        eventId: "e1", occurredAt: "2026-09-09T12:00:00.000Z", traceId: null,
      }),
    ).rejects.toMatchObject({ code: "DELIVERY_CONCURRENT_UPDATE" });
    const stored = d.store.tasks.get(eligibleTask().taskId)!;
    expect(stored.dispatchJobRef).toBe("job-first");
  });

  it("malformed jobRef from the bridge → DELIVERY_DISPATCH_UNAVAILABLE, nothing bound", async () => {
    const d = wire();
    d.store.bindTask(eligibleTask());
    d.requester.script.push({ jobRef: "", replayed: false });
    await expect(delegateToDispatch(d, { taskId: eligibleTask().taskId })).rejects.toMatchObject({
      code: "DELIVERY_DISPATCH_UNAVAILABLE",
    });
    const stored = d.store.tasks.get(eligibleTask().taskId)!;
    expect(stored.state).toBe(DELEGATION_SOURCE_STATE);
    expect(stored.dispatchJobRef).toBeNull();
  });
});
