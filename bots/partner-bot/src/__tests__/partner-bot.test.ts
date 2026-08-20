/**
 * Composition-root test of the partner bot.
 *
 * One question only, and it is the Phase 03 Exit Gate question: does *this*
 * deployable open *its own* Mini App and refuse the other two? The runtime's own
 * suite covers behaviour; this file covers identity.
 */

import { FakeIdentityBootstrap, MockChannelAdapter } from "@wasla/channel-core";
import { BOT_MINI_APP, WEBHOOK_SECRET_HEADER } from "@wasla/contracts-channel";
import { describe, expect, it } from "vitest";

import { BOT, buildApp } from "../server.js";

const SECRET = "partner-bot-test-webhook-secret";
const MINI_APP_URL = "https://apps.wasla.test/partner";

const ENV = {
  PARTNER_BOT_TOKEN: "token-value",
  PARTNER_BOT_WEBHOOK_SECRET: SECRET,
  PARTNER_BOT_MINI_APP_URL: MINI_APP_URL,
  IDENTITY_SERVICE_URL: "http://identity:8080",
};

function build() {
  const channel = new MockChannelAdapter();
  const { app } = buildApp({
    env: ENV,
    channel,
    identity: new FakeIdentityBootstrap(),
    logger: false,
  });
  return { app, channel };
}

describe("partner bot", () => {
  it("serves the partner bot", () => {
    expect(BOT).toBe("partner");
    expect(BOT_MINI_APP[BOT]).toBe("partner");
  });

  it("exposes its own Mini App from the environment", async () => {
    const { app } = build();

    const response = await app.inject({ method: "GET", url: "/channel/partner/mini-app" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ bot: "partner", mini_app: "partner", url: MINI_APP_URL });
    await app.close();
  });

  it.each(["customer", "driver"])("refuses to serve the %s bot", async (other) => {
    const { app } = build();

    const miniApp = await app.inject({ method: "GET", url: `/channel/${other}/mini-app` });
    const webhook = await app.inject({
      method: "POST",
      url: `/channel/${other}/webhook`,
      headers: { [WEBHOOK_SECRET_HEADER]: SECRET, "content-type": "application/json" },
      payload: { update_id: 1, message: { chat: { id: 5 }, from: { id: 6 }, text: "/start" } },
    });

    expect(miniApp.statusCode).toBe(404);
    expect(miniApp.json().code).toBe("CHANNEL_UNKNOWN_BOT");
    expect(webhook.statusCode).toBe(404);
    expect(webhook.json().code).toBe("CHANNEL_UNKNOWN_BOT");
    await app.close();
  });

  it("answers /start with a button that opens its own Mini App", async () => {
    const { app, channel } = build();

    const response = await app.inject({
      method: "POST",
      url: "/channel/partner/webhook",
      headers: { [WEBHOOK_SECRET_HEADER]: SECRET, "content-type": "application/json" },
      payload: {
        update_id: 7,
        message: { chat: { id: 5, type: "private" }, from: { id: 6, first_name: "مستخدم" }, text: "/start" },
      },
    });

    expect(response.statusCode).toBe(202);
    expect(channel.last()?.buttons?.[0]).toMatchObject({ type: "mini_app", miniApp: "partner" });
    await app.close();
  });

  it("rejects a webhook call without the secret", async () => {
    const { app } = build();

    const response = await app.inject({
      method: "POST",
      url: "/channel/partner/webhook",
      headers: { "content-type": "application/json" },
      payload: { update_id: 8, message: { chat: { id: 5 }, from: { id: 6 }, text: "/start" } },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("CHANNEL_UNAUTHORIZED_WEBHOOK");
    await app.close();
  });
});
