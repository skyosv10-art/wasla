/**
 * Webhook route tests — the unauthenticated perimeter.
 *
 * Cases are chosen for what actually breaks in production: a forged call, a
 * forgotten secret variable, Telegram replaying an update it thinks failed, a
 * path naming a bot this process does not serve, and a command nobody
 * registered. Assertions are on stable error *codes* and status, never on the
 * Arabic message text (DEFINITION_OF_DONE).
 */

import { describe, expect, it } from "vitest";

import { BOT_KINDS, WEBHOOK_SECRET_HEADER } from "@wasla/contracts-channel";

import { SECRET, authHeaders, harnessFor, startUpdate, textUpdate } from "./harness.js";

describe("POST /channel/:bot/webhook — authentication", () => {
  it("rejects a wrong secret with 401 and processes nothing", async () => {
    const { app, channel, outbox } = harnessFor("customer");

    const response = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: { [WEBHOOK_SECRET_HEADER]: "wrong-secret-value-x", "content-type": "application/json" },
      payload: startUpdate(1),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("CHANNEL_UNAUTHORIZED_WEBHOOK");
    // Nothing was parsed, stored, or answered.
    expect(channel.sent).toHaveLength(0);
    expect(outbox.types()).toHaveLength(0);
  });

  it("rejects a missing header with 401", async () => {
    const { app } = harnessFor("driver");

    const response = await app.inject({
      method: "POST",
      url: "/channel/driver/webhook",
      headers: { "content-type": "application/json" },
      payload: startUpdate(2),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("CHANNEL_UNAUTHORIZED_WEBHOOK");
  });

  it("fails closed when the deployment forgot to configure a secret", async () => {
    const { app } = harnessFor("partner", { withoutSecret: true });

    const response = await app.inject({
      method: "POST",
      url: "/channel/partner/webhook",
      headers: authHeaders(),
      payload: startUpdate(3),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("CHANNEL_UNAUTHORIZED_WEBHOOK");
  });
});

describe("POST /channel/:bot/webhook — /start", () => {
  it.each(BOT_KINDS)("bot %s answers /start by opening its own Mini App", async (bot) => {
    const { app, channel, identity, presence } = harnessFor(bot);

    const response = await app.inject({
      method: "POST",
      url: `/channel/${bot}/webhook`,
      headers: authHeaders(),
      payload: startUpdate(10),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: "accepted",
      channel: "telegram",
      bot,
      kind: "command",
    });

    // Identity bootstrap ran exactly once, for this bot.
    expect(identity.calls).toHaveLength(1);
    expect(identity.calls[0]?.bot).toBe(bot);

    // The reply carries one Mini App button, pointing at this bot's own app.
    const dispatch = channel.last();
    expect(dispatch?.kind).toBe("text_with_buttons");
    expect(dispatch?.buttons).toHaveLength(1);
    expect(dispatch?.buttons?.[0]).toMatchObject({
      type: "mini_app",
      miniApp: presence.miniApp,
      label: presence.miniAppLabel,
    });
  });

  it("keeps the welcome copy overridable by the composition root", async () => {
    const { app, channel } = harnessFor("customer", { welcomeText: "نص ترحيب مخصص" });

    await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: startUpdate(11),
    });

    expect(channel.last()?.text).toBe("نص ترحيب مخصص");
  });

  it("answers a replayed update with 202 duplicate and sends nothing twice", async () => {
    const { app, channel } = harnessFor("customer");
    const update = startUpdate(12);

    const first = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: update,
    });
    const second = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: update,
    });

    expect(first.json().status).toBe("accepted");
    // 202, not an error: Telegram retries anything that is not 2xx.
    expect(second.statusCode).toBe(202);
    expect(second.json().status).toBe("duplicate");
    expect(channel.sent).toHaveLength(1);
  });

  it("still answers 202 when the welcome reply cannot be sent", async () => {
    // A permanently rejected reply must not turn into a webhook error: the update
    // is already recorded, so an error would only trigger a replay we would then
    // reject as a duplicate — losing the reply entirely.
    const { app, channel } = harnessFor("customer", {
      script: [{ ok: false, errorCode: "CHANNEL_CHAT_UNREACHABLE" }],
    });

    const response = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: startUpdate(13),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe("accepted");
    expect(channel.sent).toHaveLength(1);
  });
});

describe("POST /channel/:bot/webhook — rejections", () => {
  it("returns 404 for a bot this process does not serve", async () => {
    const { app } = harnessFor("customer");

    const response = await app.inject({
      method: "POST",
      url: "/channel/driver/webhook",
      headers: authHeaders(SECRET),
      payload: startUpdate(20),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("CHANNEL_UNKNOWN_BOT");
  });

  it("returns 400 for a body that is not a channel update", async () => {
    const { app } = harnessFor("customer");

    const response = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: { nothing: "useful" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("CHANNEL_INVALID_UPDATE");
  });

  it("returns 422 for an unregistered command", async () => {
    const { app, channel } = harnessFor("customer");

    const response = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: {
        update_id: 21,
        message: {
          message_id: 21,
          chat: { id: 4001, type: "private" },
          from: { id: 900123, first_name: "مستخدم" },
          text: "/unknown_command",
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("CHANNEL_UNSUPPORTED_COMMAND");
    expect(channel.sent).toHaveLength(0);
  });

  it("accepts a plain text message without answering it", async () => {
    const { app, channel, outbox } = harnessFor("customer");

    const response = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: textUpdate(22),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: "accepted", kind: "text_message" });
    // Only `/start` gets an automatic reply in Phase 03.
    expect(channel.sent).toHaveLength(0);
    expect(outbox.types()).toContain("channel.update.received");
  });
});

describe("GET /health", () => {
  it("reports the running channel", async () => {
    const { app } = harnessFor("partner");

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", channel: "telegram" });
  });
});
