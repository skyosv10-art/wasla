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
import { NO_JITTER, exponentialBackoffPolicy } from "../domain/retry.js";
import { sendMessage } from "../use-cases/send-message.js";
import type { OutboundDeps } from "../use-cases/deps.js";
import type { OutboundMessageCommand } from "../domain/model.js";

interface Harness extends OutboundDeps {
  channel: MockChannelAdapter;
  deliveries: InMemoryDeliveryStore;
  outbox: InMemoryOutbox;
  clock: FixedClock;
}

function harness(script: MockSendOutcome[] = [{ ok: true }]): Harness {
  return {
    channel: new MockChannelAdapter(script),
    deliveries: new InMemoryDeliveryStore(),
    outbox: new InMemoryOutbox(),
    retry: exponentialBackoffPolicy({ jitter: NO_JITTER }),
    clock: new FixedClock(),
    ids: new SequentialIdGenerator(),
  };
}

function message(overrides: Partial<OutboundMessageCommand> = {}): OutboundMessageCommand {
  return {
    channel: IMPLEMENTED_CHANNEL,
    chatRef: "chat-1",
    kind: "text",
    text: "شحنتك في الطريق",
    idempotencyKey: "order-1-dispatched",
    ...overrides,
  };
}

describe("sendMessage", () => {
  it("sends once and appends a delivered event", async () => {
    const deps = harness();

    const outcome = await sendMessage(deps, { message: message({ channel: deps.channel.channel }) });

    expect(outcome.status).toBe("sent");
    expect(outcome.attempts).toBe(1);
    expect(deps.channel.sent).toHaveLength(1);
    expect(deps.outbox.types()).toEqual(["channel.message.delivered"]);
  });

  it("reports a repeated idempotency key as duplicate without sending again", async () => {
    const deps = harness();
    const command = message({ channel: deps.channel.channel });
    await sendMessage(deps, { message: command });

    const again = await sendMessage(deps, { message: command });

    expect(again.status).toBe("duplicate");
    expect(deps.channel.sent).toHaveLength(1);
    expect(deps.outbox.events).toHaveLength(1);
  });

  it("emits a mini app launched event when the message carries a mini app button", async () => {
    const deps = harness();

    await sendMessage(deps, {
      bot: "customer",
      message: message({
        channel: deps.channel.channel,
        kind: "text_with_buttons",
        buttons: [{ type: "mini_app", label: "تتبّع", miniApp: "customer", path: "/orders/9" }],
      }),
    });

    expect(deps.outbox.types()).toEqual([
      "channel.message.delivered",
      "channel.mini_app.launched",
    ]);
    expect(deps.outbox.ofType("channel.mini_app.launched")[0]?.payload).toMatchObject({
      bot: "customer",
      mini_app: "customer",
      path: "/orders/9",
    });
  });

  it("requeues a retryable failure on the same delivery with a backoff instant", async () => {
    const deps = harness([{ ok: false, errorCode: "CHANNEL_TRANSPORT_ERROR" }]);

    const outcome = await sendMessage(deps, { message: message({ channel: deps.channel.channel }) });

    expect(outcome.status).toBe("queued");
    expect(outcome.attempts).toBe(1);
    const stored = deps.deliveries.get(outcome.deliveryId);
    expect(stored?.nextAttemptAt).toBe("2026-08-20T12:00:01.000Z");
    expect(stored?.lastErrorCode).toBe("CHANNEL_TRANSPORT_ERROR");
    expect(deps.outbox.events).toHaveLength(0);
  });

  it("honours a channel cooldown longer than the computed backoff", async () => {
    const deps = harness([
      { ok: false, errorCode: "CHANNEL_RATE_LIMITED", retryAfterSeconds: 30 },
    ]);

    const outcome = await sendMessage(deps, { message: message({ channel: deps.channel.channel }) });

    expect(deps.deliveries.get(outcome.deliveryId)?.nextAttemptAt).toBe(
      "2026-08-20T12:00:30.000Z",
    );
  });

  it("fails a non-retryable error immediately with one failed event", async () => {
    const deps = harness([{ ok: false, errorCode: "CHANNEL_CHAT_UNREACHABLE" }]);

    const outcome = await sendMessage(deps, { message: message({ channel: deps.channel.channel }) });

    expect(outcome.status).toBe("failed");
    expect(outcome.errorCode).toBe("CHANNEL_CHAT_UNREACHABLE");
    expect(deps.outbox.types()).toEqual(["channel.message.failed"]);
    expect(deps.outbox.ofType("channel.message.failed")[0]?.payload.retryable).toBe(false);
  });

  it("writes the contract attempt ceiling on new deliveries", async () => {
    const deps = harness();

    const outcome = await sendMessage(deps, { message: message({ channel: deps.channel.channel }) });

    expect(deps.deliveries.get(outcome.deliveryId)?.maxAttempts).toBe(MAX_DELIVERY_ATTEMPTS);
  });

  describe("validation happens before the adapter is touched", () => {
    const cases: Array<[string, Partial<OutboundMessageCommand>]> = [
      ["empty text", { text: "" }],
      ["oversized text", { text: "ب".repeat(4097) }],
      ["short idempotency key", { idempotencyKey: "short" }],
      ["buttons on a plain text message", {
        buttons: [{ type: "deep_link", label: "x", action: "open_app" }],
      }],
      ["buttons message without buttons", { kind: "text_with_buttons" }],
      ["too many buttons", {
        kind: "text_with_buttons",
        buttons: Array.from({ length: 9 }, (_unused, index) => ({
          type: "deep_link" as const,
          label: `b${index}`,
          action: "open_app" as const,
        })),
      }],
      ["empty button label", {
        kind: "text_with_buttons",
        buttons: [{ type: "mini_app", label: "", miniApp: "customer" }],
      }],
    ];

    for (const [name, override] of cases) {
      it(`rejects ${name}`, async () => {
        const deps = harness();

        await expect(
          sendMessage(deps, { message: message({ channel: deps.channel.channel, ...override }) }),
        ).rejects.toMatchObject({ code: "CHANNEL_INVALID_MESSAGE" });
        expect(deps.channel.sent).toHaveLength(0);
      });
    }
  });
});
