import { describe, expect, it } from "vitest";

import { IMPLEMENTED_CHANNEL, MAX_DELIVERY_ATTEMPTS } from "@wasla/contracts-channel";

import {
  FixedClock,
  InMemoryDeliveryStore,
  InMemoryOutbox,
  MockChannelAdapter,
  SequentialIdGenerator,
  type MockSendOutcome,
} from "../infrastructure/in-memory.js";
import {
  NO_JITTER,
  PUBLISHED_BACKOFF_SCHEDULE_MS,
  exponentialBackoffPolicy,
} from "../domain/retry.js";
import { retryDueDeliveries } from "../use-cases/retry-due-deliveries.js";
import { sendMessage } from "../use-cases/send-message.js";
import type { OutboundDeps } from "../use-cases/deps.js";

interface Harness extends OutboundDeps {
  channel: MockChannelAdapter;
  deliveries: InMemoryDeliveryStore;
  outbox: InMemoryOutbox;
  clock: FixedClock;
}

function harness(script: MockSendOutcome[]): Harness {
  return {
    channel: new MockChannelAdapter(script),
    deliveries: new InMemoryDeliveryStore(),
    outbox: new InMemoryOutbox(),
    retry: exponentialBackoffPolicy({ jitter: NO_JITTER }),
    clock: new FixedClock(),
    ids: new SequentialIdGenerator(),
  };
}

const COMMAND = {
  channel: IMPLEMENTED_CHANNEL,
  chatRef: "chat-1",
  kind: "text" as const,
  text: "تحديث الطلب",
  idempotencyKey: "order-1-updated",
};

describe("retry policy", () => {
  it("computes the published backoff schedule without jitter", () => {
    const policy = exponentialBackoffPolicy({ jitter: NO_JITTER });

    const delays = [1, 2, 3, 4, 5].map(
      (attempts) =>
        policy.decide({ attempts, retryable: true, maxAttempts: 99 }).delayMs,
    );

    expect(delays).toEqual([...PUBLISHED_BACKOFF_SCHEDULE_MS]);
  });

  it("never retries a non-retryable error", () => {
    const policy = exponentialBackoffPolicy({ jitter: NO_JITTER });

    expect(policy.decide({ attempts: 1, retryable: false, maxAttempts: 5 })).toMatchObject({
      shouldRetry: false,
      source: "none",
    });
  });

  it("stops at the attempt ceiling", () => {
    const policy = exponentialBackoffPolicy({ jitter: NO_JITTER });

    expect(
      policy.decide({ attempts: MAX_DELIVERY_ATTEMPTS, retryable: true, maxAttempts: MAX_DELIVERY_ATTEMPTS }),
    ).toMatchObject({ shouldRetry: false });
  });

  it("prefers a channel cooldown when it is longer than the backoff", () => {
    const policy = exponentialBackoffPolicy({ jitter: NO_JITTER });

    expect(
      policy.decide({ attempts: 1, retryable: true, maxAttempts: 5, retryAfterSeconds: 10 }),
    ).toMatchObject({ shouldRetry: true, delayMs: 10_000, source: "channel_cooldown" });
  });
});

describe("retryDueDeliveries", () => {
  it("ignores a delivery whose backoff has not elapsed", async () => {
    const deps = harness([{ ok: false, errorCode: "CHANNEL_TRANSPORT_ERROR" }, { ok: true }]);
    await sendMessage(deps, { message: COMMAND });

    const sweep = await retryDueDeliveries(deps);

    expect(sweep.attempted).toBe(0);
    expect(deps.channel.sent).toHaveLength(1);
  });

  it("re-sends the same message once the backoff elapses and marks it sent", async () => {
    const deps = harness([{ ok: false, errorCode: "CHANNEL_TRANSPORT_ERROR" }, { ok: true }]);
    const first = await sendMessage(deps, { message: COMMAND });
    deps.clock.advance(1_000);

    const sweep = await retryDueDeliveries(deps);

    expect(sweep).toMatchObject({ attempted: 1, sent: 1, requeued: 0, failed: 0 });
    expect(deps.channel.sent).toHaveLength(2);
    expect(deps.channel.sent[1]?.idempotencyKey).toBe(COMMAND.idempotencyKey);
    const stored = deps.deliveries.get(first.deliveryId);
    expect(stored).toMatchObject({ status: "sent", attempts: 2 });
    expect(deps.outbox.types()).toEqual(["channel.message.delivered"]);
  });

  it("gives up after the attempt ceiling and emits exactly one failed event", async () => {
    const deps = harness([{ ok: false, errorCode: "CHANNEL_TRANSPORT_ERROR" }]);
    const first = await sendMessage(deps, { message: COMMAND });

    for (let sweep = 0; sweep < MAX_DELIVERY_ATTEMPTS + 2; sweep += 1) {
      deps.clock.advance(60_000);
      await retryDueDeliveries(deps);
    }

    const stored = deps.deliveries.get(first.deliveryId);
    expect(stored).toMatchObject({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS });
    expect(deps.channel.sent).toHaveLength(MAX_DELIVERY_ATTEMPTS);
    expect(deps.outbox.ofType("channel.message.failed")).toHaveLength(1);
  });

  it("fails a queued delivery whose stored body vanished instead of inventing one", async () => {
    const deps = harness([{ ok: false, errorCode: "CHANNEL_TRANSPORT_ERROR" }]);
    const first = await sendMessage(deps, { message: COMMAND });
    deps.deliveries.forgetDispatch(first.deliveryId);
    deps.clock.advance(1_000);

    const sweep = await retryDueDeliveries(deps);

    expect(sweep).toMatchObject({ attempted: 1, failed: 1 });
    expect(sweep.outcomes[0]?.errorCode).toBe("CHANNEL_INTERNAL_ERROR");
    expect(deps.channel.sent).toHaveLength(1);
  });

  it("rejects a non-positive batch size", async () => {
    const deps = harness([{ ok: true }]);

    await expect(retryDueDeliveries(deps, { limit: 0 })).rejects.toMatchObject({
      code: "CHANNEL_INVALID_MESSAGE",
    });
  });
});
