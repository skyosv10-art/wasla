/**
 * Port conformance — the adapter driven by the real use cases.
 *
 * Everything above is unit-level. Here the Telegram classes are assigned to the
 * *port types* and passed into `receiveUpdate` / `sendMessage` unchanged, with
 * the core's in-memory adapters behind them. Two things are proven:
 *
 * 1. The adapter is substitutable for `MockChannelAdapter` and
 *    `FakeUpdateParser` at both the type and behaviour level — the Phase 03 Exit
 *    Gate axiom, checked here per-package rather than only in the MR 7 E2E.
 * 2. The core keeps deciding policy. It rejects an unsupported update the parser
 *    was happy to describe, and it requeues a rate-limited send using the
 *    cooldown the adapter translated.
 *
 * The webhook secret, the token and the transport are the only Telegram-specific
 * inputs; nothing below the ports is imported from this package by the core.
 */

import { describe, expect, it } from "vitest";

import {
  ChannelError,
  FakeIdentityBootstrap,
  FixedClock,
  InMemoryDeliveryStore,
  InMemoryOutbox,
  InMemoryProcessedUpdateStore,
  NO_JITTER,
  SequentialIdGenerator,
  exponentialBackoffPolicy,
  receiveUpdate,
  retryDueDeliveries,
  sendMessage,
  type BotPresence,
  type ChannelPort,
  type InboundDeps,
  type OutboundDeps,
  type UpdateParserPort,
} from "@wasla/channel-core";
import { IMPLEMENTED_CHANNEL } from "@wasla/contracts-channel";

import { BotApiClient, type FetchLike } from "../bot-api-client.js";
import { TelegramChannelAdapter } from "../channel-adapter.js";
import { TokenBucketRateLimiter } from "../rate-limit.js";
import { TelegramUpdateParser } from "../update-parser.js";

const customer: BotPresence = {
  bot: "customer",
  miniApp: "customer",
  miniAppUrl: "https://app.example.test/customer",
  miniAppLabel: "تطبيق العميل",
  deepLinkTemplate: "https://t.example.test/customer?start={payload}",
};

type Step = { status: number; body: unknown };

function transport(script: readonly Step[]): { fetchImpl: FetchLike; count: () => number } {
  let index = 0;
  const fetchImpl: FetchLike = async (_url, _init) => {
    const step = script[Math.min(index++, script.length - 1)] ?? { status: 200, body: { ok: true } };
    return { status: step.status, json: async () => step.body };
  };
  return { fetchImpl, count: () => index };
}

function inbound(): InboundDeps & { processedUpdates: InMemoryProcessedUpdateStore; outbox: InMemoryOutbox } {
  // `parser` is typed as the port, so this line fails to compile if the Telegram
  // parser ever drifts from the contract the core depends on.
  const parser: UpdateParserPort = new TelegramUpdateParser();
  return {
    parser,
    processedUpdates: new InMemoryProcessedUpdateStore(),
    outbox: new InMemoryOutbox(),
    identity: new FakeIdentityBootstrap(),
    clock: new FixedClock(),
    ids: new SequentialIdGenerator(),
  };
}

function outbound(script: readonly Step[], clock = new FixedClock()): OutboundDeps & {
  deliveries: InMemoryDeliveryStore;
  outbox: InMemoryOutbox;
  clock: FixedClock;
  calls: () => number;
} {
  const { fetchImpl, count } = transport(script);
  const channel: ChannelPort = new TelegramChannelAdapter({
    bot: "customer",
    presence: customer,
    clock,
    api: new BotApiClient({ botToken: "111:token", baseUrl: "https://api.example.test", fetchImpl }),
    rateLimiter: new TokenBucketRateLimiter(clock, { perSecond: 1000, perChatPerSecond: 1000 }),
  });
  return {
    channel,
    deliveries: new InMemoryDeliveryStore(),
    outbox: new InMemoryOutbox(),
    retry: exponentialBackoffPolicy({ jitter: NO_JITTER }),
    clock,
    ids: new SequentialIdGenerator(),
    calls: count,
  };
}

describe("inbound path with the real parser", () => {
  it("accepts /start, bootstraps identity and records exactly one event", async () => {
    const deps = inbound();
    const raw = {
      update_id: 1,
      message: { chat: { id: 7001, type: "private" }, from: { id: 42, first_name: "سارة" }, text: "/start" },
    };

    const result = await receiveUpdate(deps, { bot: "customer", raw });

    expect(result.status).toBe("accepted");
    expect(result.kind).toBe("command");
    expect(result.identity?.waslaPublicId).toBeDefined();
    expect(deps.outbox.ofType("channel.update.received")).toHaveLength(1);
  });

  it("de-duplicates a webhook Telegram delivered twice", async () => {
    const deps = inbound();
    const raw = { update_id: 2, message: { chat: { id: 7001, type: "private" }, text: "مرحبا" } };

    expect((await receiveUpdate(deps, { bot: "customer", raw })).status).toBe("accepted");
    expect((await receiveUpdate(deps, { bot: "customer", raw })).status).toBe("duplicate");
    expect(deps.outbox.ofType("channel.update.received")).toHaveLength(1);
  });

  it("lets the core reject an update the parser merely described as unsupported", async () => {
    const deps = inbound();
    await expect(
      receiveUpdate(deps, { bot: "customer", raw: { update_id: 3, poll: { id: "p" } } }),
    ).rejects.toBeInstanceOf(ChannelError);
    expect(deps.processedUpdates.records()).toHaveLength(0);
  });

  it("carries a deep link from /start through to the caller", async () => {
    const deps = inbound();
    const payload = Buffer.from("track_order?id=WSL-9", "utf8").toString("base64url");
    const result = await receiveUpdate(deps, {
      bot: "customer",
      raw: { update_id: 4, message: { chat: { id: 7001, type: "private" }, text: `/start ${payload}` } },
    });
    expect(result.deepLink).toEqual({ action: "track_order", params: { id: "WSL-9" } });
  });
});

describe("outbound path with the real adapter", () => {
  it("marks a delivery sent and emits the delivered event", async () => {
    const deps = outbound([{ status: 200, body: { ok: true, result: { message_id: 5 } } }]);
    const outcome = await sendMessage(deps, {
      message: {
        channel: IMPLEMENTED_CHANNEL,
        chatRef: "7001",
        kind: "text",
        text: "تم استلام طلبك",
        idempotencyKey: "order-9-received",
      },
    });

    expect(outcome.status).toBe("sent");
    expect(deps.outbox.ofType("channel.message.delivered")).toHaveLength(1);
  });

  it("emits a mini app launch when the adapter renders the app button", async () => {
    const deps = outbound([{ status: 200, body: { ok: true } }]);
    const outcome = await sendMessage(deps, {
      bot: "customer",
      message: {
        channel: IMPLEMENTED_CHANNEL,
        chatRef: "7001",
        kind: "text_with_buttons",
        text: "افتح التطبيق لمتابعة الطلب",
        buttons: [{ type: "mini_app", label: "تطبيق العميل", miniApp: "customer" }],
        idempotencyKey: "order-9-open-app",
      },
    });

    expect(outcome.status).toBe("sent");
    expect(deps.outbox.ofType("channel.mini_app.launched")).toHaveLength(1);
  });

  it("requeues a throttled delivery with the channel cooldown, then sends it on retry", async () => {
    const clock = new FixedClock();
    const deps = outbound(
      [
        { status: 429, body: { ok: false, description: "Too Many Requests", parameters: { retry_after: 9 } } },
        { status: 200, body: { ok: true, result: { message_id: 6 } } },
      ],
      clock,
    );

    const first = await sendMessage(deps, {
      message: {
        channel: IMPLEMENTED_CHANNEL,
        chatRef: "7001",
        kind: "text",
        text: "تحديث الحالة",
        idempotencyKey: "order-9-status",
      },
    });

    expect(first.status).toBe("queued");
    // The cooldown the adapter translated is what the core scheduled with.
    expect(deps.deliveries.get(first.deliveryId)?.nextAttemptAt).toBe(
      new Date(Date.parse(clock.now()) + 9_000).toISOString(),
    );
    expect(deps.outbox.types()).not.toContain("channel.message.failed");

    clock.advance(9_000);
    const summary = await retryDueDeliveries(deps, {});
    expect(summary).toMatchObject({ attempted: 1, sent: 1 });
    expect(deps.calls()).toBe(2);
  });

  it("fails a delivery to a blocked chat without retrying it", async () => {
    const deps = outbound([
      { status: 403, body: { ok: false, description: "Forbidden: bot was blocked by the user" } },
    ]);
    const outcome = await sendMessage(deps, {
      message: {
        channel: IMPLEMENTED_CHANNEL,
        chatRef: "7001",
        kind: "text",
        text: "تنبيه",
        idempotencyKey: "order-9-alert",
      },
    });

    expect(outcome.status).toBe("failed");
    expect(deps.outbox.ofType("channel.message.failed")).toHaveLength(1);
  });
});
