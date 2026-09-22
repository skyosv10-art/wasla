/**
 * M3-05 — the deployable partner bot answers `/start` only (BOT_ROLE_SPEC.md
 * §2.3, ADR-046), through the real composition root (`buildApp` → `buildBotApp`
 * → `buildBotRuntime`). The allowed set is `BOT_ALLOWED_COMMANDS.partner`,
 * which a contract test binds to the spec; nothing here restates it.
 */

import { DEFAULT_SUPPORTED_COMMANDS, FakeIdentityBootstrap, MockChannelAdapter } from "@wasla/channel-core";
import { BOT_ALLOWED_COMMANDS, WEBHOOK_SECRET_HEADER } from "@wasla/contracts-channel";
import { describe, expect, it } from "vitest";

import { buildApp } from "../server.js";

const SECRET = "partner-bot-test-webhook-secret";

const ENV = {
  PARTNER_BOT_TOKEN: "token-value",
  PARTNER_BOT_WEBHOOK_SECRET: SECRET,
  PARTNER_BOT_MINI_APP_URL: "https://apps.wasla.test/partner",
  IDENTITY_SERVICE_URL: "http://identity:8080",
  WASLA_SERVICE_AUTH_KEYS: "test-active:active:bots-test-secret-0123456789abcdef",
  WASLA_SERVICE_AUTH_ACTIVE_KID: "test-active",
  WASLA_SERVICE_TOKEN_REPLAY_MODE: "memory",
};

function build(supportedCommands?: readonly string[]) {
  return buildApp({
    env: ENV,
    channel: new MockChannelAdapter(),
    identity: new FakeIdentityBootstrap("WS-3000"),
    logger: false,
    ...(supportedCommands === undefined ? {} : { supportedCommands }),
  }).app;
}

let nextUpdate = 1;
async function send(app: ReturnType<typeof build>, text: string) {
  const id = nextUpdate++;
  return app.inject({
    method: "POST",
    url: "/channel/partner/webhook",
    headers: { [WEBHOOK_SECRET_HEADER]: SECRET, "content-type": "application/json" },
    payload: {
      update_id: id,
      message: { message_id: id, chat: { id: 7, type: "private" }, from: { id: 8, first_name: "شريك" }, text },
    },
  });
}

describe("M3-05 · partner bot role (real composition root)", () => {
  it("the default the partner bot ships with is exactly its allowed set", () => {
    // The partner root registers no list, so channel-core's default applies.
    expect([...DEFAULT_SUPPORTED_COMMANDS].sort()).toEqual([...BOT_ALLOWED_COMMANDS.partner].sort());
  });

  for (const command of BOT_ALLOWED_COMMANDS.partner) {
    it(`answers /${command}`, async () => {
      const app = build();
      const response = await send(app, `/${command}`);
      expect(response.statusCode).toBe(202);
      await app.close();
    });
  }

  it.each(["places", "orders", "available", "admin", "suspend", "approve", "help"])(
    "rejects /%s as CHANNEL_UNSUPPORTED_COMMAND",
    async (command) => {
      const app = build();
      const response = await send(app, `/${command}`);
      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("CHANNEL_UNSUPPORTED_COMMAND");
      await app.close();
    },
  );

  it("refuses to boot when an override registers a command outside the spec", () => {
    expect(() => build(["start", "orders"])).toThrow(
      /BOT_COMMAND_OUTSIDE_ROLE_SPEC: partner bot registers \/orders/,
    );
  });
});
