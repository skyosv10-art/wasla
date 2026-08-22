/**
 * Creating a dispatch job.
 *
 * Assertions name error `code`s, never messages: the messages are Arabic operator text
 * and rewording one must not break a test, while a changed code breaks a client.
 */
import { describe, expect, it } from "vitest";

import { isDispatchError } from "../domain/errors.js";
import { createDispatchJob } from "../use-cases/create-job.js";
import { ZONE_ID, createHarness, orderRef, type Harness } from "./harness.js";

const KEY = "create-key-0001";

function input(harness: Harness, index = 1, overrides: Record<string, unknown> = {}) {
  const ref = orderRef(index);
  harness.orders.seedOrder(ref.orderId);
  return {
    orderId: ref.orderId,
    orderPublicId: ref.orderPublicId,
    zoneId: ZONE_ID,
    orderType: "ride" as const,
    vehicleClass: "sedan" as const,
    idempotencyKey: KEY,
    ...overrides,
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (isDispatchError(error)) return error.code;
    throw error;
  }
  throw new Error("expected a DispatchError, but the call succeeded");
}

describe("createDispatchJob", () => {
  it("creates the job in pending and opens no wave", async () => {
    const harness = createHarness();
    const { job } = await createDispatchJob(harness.deps, input(harness));

    expect(job.status).toBe("pending");
    expect(job.statusReasonCode).toBeNull();
    // Opening wave 1 here is the tempting shortcut that would make an HTTP retry able
    // to produce a second wave, since a wave is not covered by the create key.
    expect(await harness.waves.countForJob(job.id)).toBe(0);
    expect(await harness.offers.listForJob(job.id)).toHaveLength(0);
  });

  it("freezes the rules snapshot onto the job", async () => {
    const harness = createHarness();
    const { job } = await createDispatchJob(harness.deps, input(harness));
    harness.rules.replace({
      rulesetVersion: 2,
      waveSize: 9,
      offerTimeoutSeconds: 5,
      maxWaves: 9,
      escalationTimeoutSeconds: 9,
    });

    const reread = await harness.jobs.find(job.id);
    // A live rules lookup would move a deadline a driver is already counting against.
    expect(reread?.rules.waveSize).toBe(2);
    expect(reread?.rules.rulesetVersion).toBe(1);
  });

  it("stores both deadlines in the order the schema demands", async () => {
    const harness = createHarness();
    const { job } = await createDispatchJob(harness.deps, input(harness));
    expect(job.expiresAt).toBe("2026-01-01T00:01:30.000Z");
    expect(job.escalationExpiresAt).toBe("2026-01-01T00:03:30.000Z");
  });

  it("moves the order into searching before writing the job", async () => {
    const harness = createHarness();
    const request = input(harness);
    await createDispatchJob(harness.deps, request);
    expect(harness.orders.statusOf(request.orderId)).toBe("searching");
  });

  it("does not create a job when the engine refuses the order", async () => {
    const harness = createHarness();
    const request = input(harness);
    // An order that is not in a searchable status: the engine's real table refuses it.
    harness.orders.seedOrder(request.orderId, "completed");

    expect(await codeOf(createDispatchJob(harness.deps, request))).toBe(
      "DISPATCH_ORDER_ENGINE_REJECTED",
    );
    // A job for an order the engine will not search for is a promise nobody can keep.
    expect(await harness.jobs.findByOrderId(request.orderId)).toBeNull();
  });

  it("reports an unreachable engine as retryable, and remembers nothing", async () => {
    const harness = createHarness();
    const request = input(harness);
    harness.orders.failNext("unavailable");

    expect(await codeOf(createDispatchJob(harness.deps, request))).toBe(
      "DISPATCH_ENGINE_UNAVAILABLE",
    );
    // The key must NOT be remembered: a remembered key with no job would turn the
    // caller's retry into a replay of something that does not exist.
    expect(await harness.deps.idempotency.find(KEY)).toBeNull();

    harness.orders.seedOrder(request.orderId);
    const { job, replayed } = await createDispatchJob(harness.deps, request);
    expect(replayed).toBe(false);
    expect(job.status).toBe("pending");
  });

  it("reports a timeout distinctly from an outage", async () => {
    const harness = createHarness();
    const request = input(harness);
    harness.orders.failNext("timeout");
    // Different code because the write may have landed — the retry must reuse the same
    // deterministic key rather than mint a new one.
    expect(await codeOf(createDispatchJob(harness.deps, request))).toBe(
      "DISPATCH_ORDER_ENGINE_TIMEOUT",
    );
  });

  it("replays a retry with the same key and payload", async () => {
    const harness = createHarness();
    const request = input(harness);
    const first = await createDispatchJob(harness.deps, request);
    const second = await createDispatchJob(harness.deps, request);

    expect(second.replayed).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(await harness.outbox.unread()).toHaveLength(1);
  });

  it("refuses the same key with a different payload", async () => {
    const harness = createHarness();
    await createDispatchJob(harness.deps, input(harness, 1));
    const other = input(harness, 2, { idempotencyKey: KEY });

    // Silently returning the first job would tell the caller order #2 is being
    // dispatched while nobody is looking for a driver for it.
    expect(await codeOf(createDispatchJob(harness.deps, other))).toBe(
      "DISPATCH_IDEMPOTENCY_KEY_REUSED",
    );
  });

  it("refuses a second job for the same order", async () => {
    const harness = createHarness();
    await createDispatchJob(harness.deps, input(harness, 1));
    const again = input(harness, 1, { idempotencyKey: "another-key-0002" });
    expect(await codeOf(createDispatchJob(harness.deps, again))).toBe(
      "DISPATCH_JOB_ALREADY_EXISTS",
    );
  });

  it("validates the payload shape before touching any state", async () => {
    const harness = createHarness();
    expect(await codeOf(createDispatchJob(harness.deps, input(harness, 1, { orderId: "nope" })))).toBe(
      "DISPATCH_VALIDATION_FAILED",
    );
    expect(
      await codeOf(createDispatchJob(harness.deps, input(harness, 1, { orderPublicId: "ORD-1" }))),
    ).toBe("DISPATCH_VALIDATION_FAILED");
    expect(
      await codeOf(createDispatchJob(harness.deps, input(harness, 1, { orderType: "flight" }))),
    ).toBe("DISPATCH_VALIDATION_FAILED");
    expect(
      await codeOf(createDispatchJob(harness.deps, input(harness, 1, { idempotencyKey: "short" }))),
    ).toBe("DISPATCH_VALIDATION_FAILED");
    // Nothing was written and the engine was never called.
    expect(harness.orders.calls).toHaveLength(0);
  });

  it("emits exactly one job_created event, carrying no driver identity", async () => {
    const harness = createHarness();
    const { job } = await createDispatchJob(harness.deps, input(harness));
    const events = await harness.outbox.unread();
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.event_type).toBe("dispatch.job_created");
    expect(event.aggregate).toEqual({ type: "dispatch_job", id: job.id });
    expect(JSON.stringify(event)).not.toContain("WS-");
  });

  it("carries the trace id onto the error it throws", async () => {
    const harness = createHarness();
    try {
      await createDispatchJob(harness.deps, input(harness, 1, { orderId: "nope", traceId: "trace-9" }));
      throw new Error("expected a rejection");
    } catch (error) {
      expect(isDispatchError(error) && error.traceId).toBe("trace-9");
    }
  });
});
