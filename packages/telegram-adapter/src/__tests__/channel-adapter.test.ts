/**
 * Adapter tests over a fake `fetch`.
 *
 * No network and no bot library, so every branch of the send path is reachable:
 * success, throttling, each failure class, a timeout, and the secret-leak guard.
 * The request body is inspected because that body *is* the contract with
 * Telegram — asserting it here is what makes the wire format reviewable.
 */

import { describe, expect, it } from "vitest";

import { FixedClock, type BotPresence, type ChannelDispatch } from "@wasla/channel-core";
import { IMPLEMENTED_CHANNEL } from "@wasla/contracts-channel";

import { BotApiClient, type FetchLike } from "../bot-api-client.js";
import { TelegramChannelAdapter } from "../channel-adapter.js";
import { TokenBucketRateLimiter } from "../rate-limit.js";

const BOT_TOKEN = "111:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const customer: BotPresence = {
  bot: "customer",
  miniApp: "customer",
  miniAppUrl: "https://app.example.test/customer",
  miniAppLabel: "تطبيق العميل",
  deepLinkTemplate: "https://t.example.test/customer?start={payload}",
};

interface Recorded {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

/** Fake transport that records calls and replays a scripted set of answers. */
function fakeFetch(
  script: readonly (
    | { status: number; body: unknown }
    | { throws: true }
    | { unparsable: true }
  )[],
): { fetchImpl: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let index = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
    const step = script[Math.min(index++, script.length - 1)] ?? { status: 200, body: { ok: true } };
    if ("throws" in step) throw new Error("socket hang up");
    if ("unparsable" in step) {
      return {
        status: 200,
        json: async () => {
          throw new Error("not json");
        },
      };
    }
    return { status: step.status, json: async () => step.body };
  };
  return { fetchImpl, calls };
}

function adapterWith(
  script: readonly ({ status: number; body: unknown } | { throws: true } | { unparsable: true })[],
  overrides: { clock?: FixedClock; limiter?: TokenBucketRateLimiter } = {},
): { adapter: TelegramChannelAdapter; calls: Recorded[]; clock: FixedClock } {
  const clock = overrides.clock ?? new FixedClock();
  const { fetchImpl, calls } = fakeFetch(script);
  const adapter = new TelegramChannelAdapter({
    bot: "customer",
    presence: customer,
    clock,
    api: new BotApiClient({ botToken: BOT_TOKEN, baseUrl: "https://api.example.test", fetchImpl }),
    // Generous budget by default: throttling has its own test and must not
    // interfere with the failure-mapping cases.
    rateLimiter: overrides.limiter ?? new TokenBucketRateLimiter(clock, { perSecond: 1000, perChatPerSecond: 1000 }),
  });
  return { adapter, calls, clock };
}

function dispatch(overrides: Partial<ChannelDispatch> = {}): ChannelDispatch {
  return {
    channel: IMPLEMENTED_CHANNEL,
    chatRef: "7001",
    kind: "text",
    text: "طلبك قيد التنفيذ",
    priority: "normal",
    idempotencyKey: "order-1-status",
    ...overrides,
  };
}

describe("TelegramChannelAdapter · success path", () => {
  it("sends the message and returns the channel-side reference", async () => {
    const { adapter, calls } = adapterWith([{ status: 200, body: { ok: true, result: { message_id: 55 } } }]);
    const result = await adapter.send(dispatch());

    expect(result).toEqual({ ok: true, messageRef: "55" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({ chat_id: "7001", text: "طلبك قيد التنفيذ" });
    expect(calls[0]?.body.reply_markup).toBeUndefined();
  });

  it("succeeds even when the channel returns no message reference", async () => {
    const { adapter } = adapterWith([{ status: 200, body: { ok: true, result: {} } }]);
    expect(await adapter.send(dispatch())).toEqual({ ok: true });
  });

  it("attaches the mini app button for a message with buttons", async () => {
    const { adapter, calls } = adapterWith([{ status: 200, body: { ok: true, result: { message_id: 1 } } }]);
    const result = await adapter.send(
      dispatch({
        kind: "text_with_buttons",
        buttons: [{ type: "mini_app", label: "افتح التطبيق", miniApp: "customer" }],
      }),
    );

    expect(result.ok).toBe(true);
    expect(calls[0]?.body.reply_markup).toEqual({
      inline_keyboard: [[{ text: "افتح التطبيق", web_app: { url: "https://app.example.test/customer" } }]],
    });
  });

  it("suppresses link previews so operational messages stay compact", async () => {
    const { adapter, calls } = adapterWith([{ status: 200, body: { ok: true } }]);
    await adapter.send(dispatch());
    expect(calls[0]?.body.link_preview_options).toEqual({ is_disabled: true });
  });
});

describe("TelegramChannelAdapter · failure translation", () => {
  it("returns a retryable rate-limit result carrying the channel cooldown", async () => {
    const { adapter } = adapterWith([
      { status: 429, body: { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 12 } } },
    ]);
    expect(await adapter.send(dispatch())).toEqual({
      ok: false,
      errorCode: "CHANNEL_RATE_LIMITED",
      retryAfterSeconds: 12,
    });
  });

  it("returns a final failure for a blocked chat", async () => {
    const { adapter } = adapterWith([
      { status: 403, body: { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } },
    ]);
    expect(await adapter.send(dispatch())).toEqual({ ok: false, errorCode: "CHANNEL_CHAT_UNREACHABLE" });
  });

  it("returns a retryable transport error for a 5xx and for a socket failure", async () => {
    const server = adapterWith([{ status: 503, body: { ok: false, description: "Bad Gateway" } }]);
    expect(await server.adapter.send(dispatch())).toEqual({ ok: false, errorCode: "CHANNEL_TRANSPORT_ERROR" });

    const socket = adapterWith([{ throws: true }]);
    expect(await socket.adapter.send(dispatch())).toEqual({ ok: false, errorCode: "CHANNEL_TRANSPORT_ERROR" });
  });

  it("treats an unparsable body as a transport failure, not as a success", async () => {
    const { adapter } = adapterWith([{ unparsable: true }]);
    expect(await adapter.send(dispatch())).toEqual({ ok: false, errorCode: "CHANNEL_TRANSPORT_ERROR" });
  });

  it("treats ok:false with a 200 status as a failure", async () => {
    // Some proxies rewrite the status; the envelope is authoritative.
    const { adapter } = adapterWith([{ status: 200, body: { ok: false, description: "Bad Request: chat not found" } }]);
    expect(await adapter.send(dispatch())).toEqual({ ok: false, errorCode: "CHANNEL_CHAT_UNREACHABLE" });
  });

  it("reports a misconfigured button as a channel error without calling the channel", async () => {
    const { adapter, calls } = adapterWith([{ status: 200, body: { ok: true } }]);
    const result = await adapter.send(
      dispatch({ kind: "text_with_buttons", buttons: [{ type: "mini_app", label: "خطأ", miniApp: "driver" }] }),
    );
    expect(result).toEqual({ ok: false, errorCode: "CHANNEL_MINI_APP_NOT_CONFIGURED" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a dispatch addressed to another channel", async () => {
    const { adapter, calls } = adapterWith([{ status: 200, body: { ok: true } }]);
    const result = await adapter.send({ ...dispatch(), channel: "whatsapp" as never });
    expect(result).toEqual({ ok: false, errorCode: "CHANNEL_INVALID_MESSAGE" });
    expect(calls).toHaveLength(0);
  });

  it("never throws — every failure comes back as a result the core can act on", async () => {
    const { adapter } = adapterWith([{ throws: true }]);
    await expect(adapter.send(dispatch())).resolves.toMatchObject({ ok: false });
  });
});

describe("TelegramChannelAdapter · rate budget", () => {
  it("throttles locally before spending a call", async () => {
    const clock = new FixedClock();
    const { adapter, calls } = adapterWith([{ status: 200, body: { ok: true } }], {
      clock,
      limiter: new TokenBucketRateLimiter(clock, { perSecond: 1, perChatPerSecond: 1 }),
    });

    expect((await adapter.send(dispatch())).ok).toBe(true);
    const throttled = await adapter.send(dispatch());
    expect(throttled).toMatchObject({ ok: false, errorCode: "CHANNEL_RATE_LIMITED" });
    // The point of throttling: the second attempt costs no request at all.
    expect(calls).toHaveLength(1);
  });

  it("applies the cooldown Telegram demanded to the following attempt", async () => {
    const clock = new FixedClock();
    const { adapter, calls } = adapterWith(
      [
        { status: 429, body: { ok: false, description: "Too Many Requests", parameters: { retry_after: 30 } } },
        { status: 200, body: { ok: true } },
      ],
      { clock, limiter: new TokenBucketRateLimiter(clock, { perSecond: 1000, perChatPerSecond: 1000 }) },
    );

    expect(await adapter.send(dispatch())).toMatchObject({ errorCode: "CHANNEL_RATE_LIMITED" });
    clock.advance(1000);
    const tooSoon = await adapter.send(dispatch());
    expect(tooSoon).toMatchObject({ ok: false, errorCode: "CHANNEL_RATE_LIMITED" });
    expect(calls).toHaveLength(1);

    clock.advance(30_000);
    expect((await adapter.send(dispatch())).ok).toBe(true);
  });
});

describe("TelegramChannelAdapter · secret hygiene", () => {
  it("puts the token in the request URL and nowhere else", async () => {
    const { adapter, calls } = adapterWith([{ status: 200, body: { ok: true } }]);
    await adapter.send(dispatch());
    expect(calls[0]?.url).toContain("/sendMessage");
    expect(JSON.stringify(calls[0]?.body)).not.toContain(BOT_TOKEN);
  });

  it("keeps the token out of the client's own description", () => {
    const client = new BotApiClient({ botToken: BOT_TOKEN, baseUrl: "https://api.example.test", fetchImpl: fakeFetch([]).fetchImpl });
    expect(JSON.stringify(client.describe())).not.toContain(BOT_TOKEN);
  });

  it("refuses to be constructed without a token", () => {
    expect(() => new BotApiClient({ botToken: "  ", fetchImpl: fakeFetch([]).fetchImpl })).toThrow();
  });
});
