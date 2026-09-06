/**
 * Composition-root test of the driver bot.
 *
 * One question only, and it is the Phase 03 Exit Gate question: does *this*
 * deployable open *its own* Mini App and refuse the other two? The runtime's own
 * suite covers behaviour; this file covers identity.
 */

import { FakeIdentityBootstrap, MockChannelAdapter } from "@wasla/channel-core";
import { BOT_MINI_APP, WEBHOOK_SECRET_HEADER } from "@wasla/contracts-channel";
import { describe, expect, it } from "vitest";

import { BOT, buildApp } from "../server.js";

const SECRET = "driver-bot-test-webhook-secret";
const MINI_APP_URL = "https://apps.wasla.test/driver";

const ENV = {
  DRIVER_BOT_TOKEN: "token-value",
  DRIVER_BOT_WEBHOOK_SECRET: SECRET,
  DRIVER_BOT_MINI_APP_URL: MINI_APP_URL,
  IDENTITY_SERVICE_URL: "http://identity:8080",
  // M1-04: عنوانُ الهويّةِ بلا مادّةِ مفاتيحَ يُرفَضُ عندَ الإقلاعِ عمداً،
  // لأنّ حدَّ الهويّةِ يفرضُ التوقيعَ. فتُسلَّمُ المادّةُ هنا كما في النشرِ.
  WASLA_SERVICE_AUTH_KEYS: "test-active:active:bots-test-secret-0123456789ab",
  WASLA_SERVICE_AUTH_ACTIVE_KID: "test-active",
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

describe("driver bot", () => {
  it("serves the driver bot", () => {
    expect(BOT).toBe("driver");
    expect(BOT_MINI_APP[BOT]).toBe("driver");
  });

  it("exposes its own Mini App from the environment", async () => {
    const { app } = build();

    const response = await app.inject({ method: "GET", url: "/channel/driver/mini-app" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ bot: "driver", mini_app: "driver", url: MINI_APP_URL });
    await app.close();
  });

  it.each(["customer", "partner"])("refuses to serve the %s bot", async (other) => {
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
      url: "/channel/driver/webhook",
      headers: { [WEBHOOK_SECRET_HEADER]: SECRET, "content-type": "application/json" },
      payload: {
        update_id: 7,
        message: { chat: { id: 5, type: "private" }, from: { id: 6, first_name: "مستخدم" }, text: "/start" },
      },
    });

    expect(response.statusCode).toBe(202);
    expect(channel.last()?.buttons?.[0]).toMatchObject({ type: "mini_app", miniApp: "driver" });
    await app.close();
  });

  it("rejects a webhook call without the secret", async () => {
    const { app } = build();

    const response = await app.inject({
      method: "POST",
      url: "/channel/driver/webhook",
      headers: { "content-type": "application/json" },
      payload: { update_id: 8, message: { chat: { id: 5 }, from: { id: 6 }, text: "/start" } },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("CHANNEL_UNAUTHORIZED_WEBHOOK");
    await app.close();
  });
});
