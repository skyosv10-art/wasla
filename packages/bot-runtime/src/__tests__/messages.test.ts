/**
 * `POST /channel/messages` — the single outbound exit point.
 *
 * The route's own job is small (contract snake_case → neutral command) and the
 * tests reflect that: the mapping, the statuses the contract allows, and the
 * refusal to invent a status for a delivery the channel permanently rejected.
 */

import { describe, expect, it } from "vitest";

import { authHeaders, harnessFor } from "./harness.js";

const message = {
  channel: "telegram",
  chat_ref: "4001",
  kind: "text",
  text: "طلبك قيد التنفيذ",
  idempotency_key: "order-1-status-1",
};

describe("POST /channel/messages", () => {
  it("accepts a text message and reports the delivery", async () => {
    const { app, channel } = harnessFor("customer");

    const response = await app.inject({
      method: "POST",
      url: "/channel/messages",
      headers: authHeaders(),
      payload: message,
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: "sent",
      channel: "telegram",
      chat_ref: "4001",
      attempts: 1,
    });
    expect(channel.last()?.text).toBe("طلبك قيد التنفيذ");
  });

  it("maps a Mini App button from the contract shape", async () => {
    const { app, channel, presence } = harnessFor("driver");

    const response = await app.inject({
      method: "POST",
      url: "/channel/messages",
      headers: authHeaders(),
      payload: {
        ...message,
        kind: "text_with_buttons",
        idempotency_key: "trip-1-assigned",
        buttons: [{ type: "mini_app", label: "افتح الرحلة", mini_app: "driver", path: "/trips/1" }],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(channel.last()?.buttons?.[0]).toEqual({
      type: "mini_app",
      label: "افتح الرحلة",
      miniApp: presence.miniApp,
      path: "/trips/1",
    });
  });

  it("maps a deep-link button from the contract shape", async () => {
    const { app, channel } = harnessFor("customer");

    await app.inject({
      method: "POST",
      url: "/channel/messages",
      headers: authHeaders(),
      payload: {
        ...message,
        kind: "text_with_buttons",
        idempotency_key: "support-1-escalated",
        buttons: [
          { type: "deep_link", label: "تواصل مع الدعم", action: "join_support", params: { ticket: "T-1" } },
        ],
      },
    });

    expect(channel.last()?.buttons?.[0]).toEqual({
      type: "deep_link",
      label: "تواصل مع الدعم",
      action: "join_support",
      params: { ticket: "T-1" },
    });
  });

  it("answers `duplicate` for a repeated idempotency key without sending again", async () => {
    const { app, channel } = harnessFor("customer");

    await app.inject({ method: "POST", url: "/channel/messages", headers: authHeaders(), payload: message });
    const second = await app.inject({
      method: "POST",
      url: "/channel/messages",
      headers: authHeaders(),
      payload: message,
    });

    expect(second.statusCode).toBe(202);
    expect(second.json().status).toBe("duplicate");
    expect(channel.sent).toHaveLength(1);
  });

  it("queues a retryable failure instead of failing the request", async () => {
    const { app } = harnessFor("customer", {
      script: [{ ok: false, errorCode: "CHANNEL_RATE_LIMITED", retryAfterSeconds: 30 }],
    });

    const response = await app.inject({
      method: "POST",
      url: "/channel/messages",
      headers: authHeaders(),
      payload: message,
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe("queued");
  });

  it("reports a permanently rejected delivery with the channel's code", async () => {
    const { app } = harnessFor("customer", {
      script: [{ ok: false, errorCode: "CHANNEL_CHAT_UNREACHABLE" }],
    });

    const response = await app.inject({
      method: "POST",
      url: "/channel/messages",
      headers: authHeaders(),
      payload: message,
    });

    // `failed` is not a contract status — the caller is told why, with the code.
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("CHANNEL_CHAT_UNREACHABLE");
  });

  it("rejects a body missing idempotency_key", async () => {
    const { app } = harnessFor("customer");

    const response = await app.inject({
      method: "POST",
      url: "/channel/messages",
      headers: authHeaders(),
      payload: { channel: "telegram", chat_ref: "4001", kind: "text", text: "مرحباً" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("CHANNEL_INVALID_MESSAGE");
  });

  it("rejects a message for a channel this process does not implement", async () => {
    const { app } = harnessFor("customer");

    const response = await app.inject({
      method: "POST",
      url: "/channel/messages",
      headers: authHeaders(),
      payload: { ...message, channel: "whatsapp" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("CHANNEL_INVALID_MESSAGE");
  });
});
