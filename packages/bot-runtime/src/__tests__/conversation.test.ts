/**
 * The conversation seam — the boundary a *domain* flow attaches to.
 *
 * What is asserted here is not a domain: no customer, no order, no zone appears
 * in this file, which is the whole claim. The seam is exercised with a recording
 * handler, so what the suite proves is the neutrality of the boundary (what
 * crosses it, in which direction, and when it is not called at all) rather than
 * any single bot's behaviour.
 */

import { WEBHOOK_SECRET_HEADER } from "@wasla/contracts-channel";
import { describe, expect, it } from "vitest";

import { buildConversationReply, type ConversationEvent } from "../conversation.js";

import {
  authHeaders,
  botAddedUpdate,
  groupStartUpdate,
  harnessFor,
  startUpdate,
  textUpdate,
} from "./harness.js";

/** A Telegram command update in a private chat, for a command we registered. */
function commandUpdate(updateId: number, command: string): Record<string, unknown> {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_770_000_000,
      chat: { id: 4001, type: "private" },
      from: { id: 900123, first_name: "مستخدم", language_code: "ar" },
      text: `/${command}`,
    },
  };
}

/** A handler that records what it saw and answers what it was told to. */
function recorder(
  reply: { text: string; withMiniApp?: boolean; step?: string } | null,
  options: { readonly resolveIdentity?: boolean; readonly throws?: Error } = {},
) {
  const seen: ConversationEvent[] = [];
  const identities: string[] = [];
  const handler = async (event: ConversationEvent) => {
    seen.push(event);
    if (options.throws) throw options.throws;
    if (options.resolveIdentity) {
      const identity = await event.resolveIdentity();
      identities.push(identity.waslaPublicId);
      // Twice on purpose: the second call must not cost a second round-trip.
      identities.push((await event.resolveIdentity()).waslaPublicId);
    }
    return reply;
  };
  return { handler, seen, identities };
}

describe("conversation seam", () => {
  it("delivers what a flow answered, with the key derived from the update", async () => {
    const { handler } = recorder({ text: "أماكنك المحفوظة: البيت", step: "places" });
    const { app, channel } = harnessFor("customer", {
      onConversation: handler,
      supportedCommands: ["start", "places"],
    });

    const response = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: commandUpdate(51, "places"),
    });

    expect(response.statusCode).toBe(202);
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]).toMatchObject({
      kind: "text",
      text: "أماكنك المحفوظة: البيت",
      idempotencyKey: "flow:customer:51:places",
    });
    await app.close();
  });

  it("adds the bot's own Mini App button when a flow asks for it", async () => {
    const { handler } = recorder({ text: "افتح التطبيق", withMiniApp: true });
    const { app, channel, presence } = harnessFor("customer", {
      onConversation: handler,
      supportedCommands: ["start", "places"],
    });

    await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: commandUpdate(52, "places"),
    });

    expect(channel.sent[0]?.buttons?.[0]).toMatchObject({
      type: "mini_app",
      miniApp: presence.miniApp,
      label: presence.miniAppLabel,
    });
    await app.close();
  });

  it("passes a neutral event only — no raw payload, no channel-native id", async () => {
    const { handler, seen } = recorder(null);
    const { app } = harnessFor("customer", {
      onConversation: handler,
      supportedCommands: ["start", "places"],
    });

    await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: commandUpdate(53, "places"),
    });

    const event = seen[0];
    expect(event).toBeDefined();
    expect(Object.keys(event ?? {}).sort()).toEqual([
      "bot",
      "channel",
      "channelUpdateId",
      "chatRef",
      "command",
      "displayName",
      "kind",
      "languageCode",
      "resolveIdentity",
      "scope",
      "traceId",
    ]);
    expect(event?.displayName).toBe("مستخدم");
    expect(event?.languageCode).toBe("ar");
    expect(event?.scope).toBe("private");
    await app.close();
  });

  it("says nothing when a flow answers nothing", async () => {
    const { handler, seen } = recorder(null);
    const { app, channel } = harnessFor("customer", {
      onConversation: handler,
      supportedCommands: ["start", "places"],
    });

    await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: commandUpdate(54, "places"),
    });

    expect(seen).toHaveLength(1);
    expect(channel.sent).toHaveLength(0);
    await app.close();
  });

  it("reuses the identity the update bootstrapped, and resolves it once otherwise", async () => {
    const { handler, seen, identities } = recorder(null, { resolveIdentity: true });
    const { app, identity } = harnessFor("customer", {
      onConversation: handler,
      supportedCommands: ["start", "places"],
    });

    await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: startUpdate(55),
    });
    const afterStart = identity.calls.length;

    await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: commandUpdate(56, "places"),
    });

    // `/start`: the core bootstrapped it, the flow paid nothing extra.
    expect(afterStart).toBe(1);
    expect(seen[0]?.identity).toBeDefined();
    // `/places`: no identity on the update, exactly one lookup for two asks.
    expect(seen[1]?.identity).toBeUndefined();
    expect(identity.calls).toHaveLength(2);
    expect(identities).toEqual([
      identities[0],
      identities[0],
      identities[2],
      identities[2],
    ]);
    await app.close();
  });

  it("is not called for a duplicate update", async () => {
    const { handler, seen } = recorder({ text: "مرة واحدة" });
    const { app, channel } = harnessFor("customer", {
      onConversation: handler,
      supportedCommands: ["start", "places"],
    });

    const first = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: commandUpdate(57, "places"),
    });
    const replay = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: commandUpdate(57, "places"),
    });

    expect(first.json().status).toBe("accepted");
    expect(replay.json().status).toBe("duplicate");
    expect(seen).toHaveLength(1);
    expect(channel.sent).toHaveLength(1);
    await app.close();
  });

  it("is not called in a group this deployment does not operate", async () => {
    const { handler, seen } = recorder({ text: "لن تُرسل" });
    const { app, channel } = harnessFor("customer", { onConversation: handler });

    const response = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: groupStartUpdate(58),
    });

    expect(response.statusCode).toBe(202);
    expect(seen).toHaveLength(0);
    expect(channel.sent).toHaveLength(0);
    await app.close();
  });

  it("keeps the webhook successful when a flow fails", async () => {
    const { handler } = recorder(null, { throws: new Error("الاعتماد غير متاح") });
    const { app, channel } = harnessFor("customer", {
      onConversation: handler,
      supportedCommands: ["start", "places"],
    });

    const response = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: commandUpdate(59, "places"),
    });

    // A non-2xx would make Telegram replay an update already recorded as
    // processed: the reply would be lost *and* the retry budget spent.
    expect(response.statusCode).toBe(202);
    expect(channel.sent).toHaveLength(0);
    await app.close();
  });

  it("sees a text message and a group event too, not only commands", async () => {
    const { handler, seen } = recorder(null);
    const { app } = harnessFor("customer", {
      onConversation: handler,
      groups: [
        {
          chatRef: "-1001",
          role: "support",
          label: "دعم المدينة",
        },
      ],
    });

    await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: textUpdate(60, "مرحباً"),
    });
    await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: botAddedUpdate(61),
    });

    expect(seen.map((event) => event.kind)).toEqual(["text_message", "group_event"]);
    expect(seen[1]?.scope).toBe("group");
    await app.close();
  });

  it("still answers /start with the welcome, flow or no flow", async () => {
    const { handler } = recorder(null);
    const { app, channel } = harnessFor("customer", { onConversation: handler });

    await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: startUpdate(62),
    });

    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]?.idempotencyKey).toBe("start:customer:62");
    await app.close();
  });

  it("rejects an unregistered command before any flow runs", async () => {
    const { handler, seen } = recorder({ text: "لن يصل" });
    const { app } = harnessFor("customer", { onConversation: handler });

    const response = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: { [WEBHOOK_SECRET_HEADER]: "test-webhook-secret-value", "content-type": "application/json" },
      payload: commandUpdate(63, "places"),
    });

    expect(response.json().code).toBe("CHANNEL_UNSUPPORTED_COMMAND");
    expect(seen).toHaveLength(0);
    await app.close();
  });
});

describe("buildConversationReply", () => {
  it("keys a reply by update and step, so two answers are two messages", () => {
    const one = buildConversationReply({
      bot: "customer",
      channel: "telegram",
      chatRef: "4001",
      channelUpdateId: "71",
      reply: { text: "أ", step: "places" },
    });
    const two = buildConversationReply({
      bot: "customer",
      channel: "telegram",
      chatRef: "4001",
      channelUpdateId: "71",
      reply: { text: "ب", step: "orders" },
    });

    expect(one.idempotencyKey).toBe("flow:customer:71:places");
    expect(two.idempotencyKey).toBe("flow:customer:71:orders");
    expect(one.kind).toBe("text");
  });

  it("falls back to text when a Mini App reply has no launch descriptor", () => {
    const reply = buildConversationReply({
      bot: "customer",
      channel: "telegram",
      chatRef: "4001",
      channelUpdateId: "72",
      reply: { text: "افتح التطبيق", withMiniApp: true },
    });

    // A missing descriptor must not fail the reply: an answer without a button is
    // still an answer, and the misconfiguration is the root's to fix.
    expect(reply.kind).toBe("text");
    expect(reply.buttons).toBeUndefined();
  });
});
