/**
 * M3-05 — the deployable driver bot answers exactly its role, through the real
 * composition root (`buildApp` → `buildBotApp` → `buildBotRuntime`).
 *
 * The allowed set comes from `BOT_ALLOWED_COMMANDS`, which a contract test binds
 * to docs/01-product/BOT_ROLE_SPEC.md §2.2. Nothing here restates the list.
 */

import { FakeIdentityBootstrap, MockChannelAdapter } from "@wasla/channel-core";
import { BOT_ALLOWED_COMMANDS, WEBHOOK_SECRET_HEADER } from "@wasla/contracts-channel";
import { describe, expect, it } from "vitest";

import { DriverFlowError, DRIVER_SUPPORTED_COMMANDS, type DriverFlowsPort } from "../flows.js";
import { buildApp } from "../server.js";

const SECRET = "driver-bot-test-webhook-secret";

const ENV = {
  DRIVER_BOT_TOKEN: "token-value",
  DRIVER_BOT_WEBHOOK_SECRET: SECRET,
  DRIVER_BOT_MINI_APP_URL: "https://apps.wasla.test/driver",
  IDENTITY_SERVICE_URL: "http://identity:8080",
  WASLA_SERVICE_AUTH_KEYS: "test-active:active:bots-test-secret-0123456789abcdef",
  WASLA_SERVICE_AUTH_ACTIVE_KID: "test-active",
  WASLA_SERVICE_TOKEN_REPLAY_MODE: "memory",
};

/** Flows that answer nothing useful: this file measures routing, not content. */
const unavailable = async (): Promise<never> => {
  throw new DriverFlowError("DRIVER_UNAVAILABLE");
};
const quietFlows: DriverFlowsPort = {
  async ensureRegistered() {
    return { created: false };
  },
  readStatus: unavailable,
  declareAvailability: unavailable,
  async listDocuments() {
    return [];
  },
};

function build() {
  return buildApp({
    env: ENV,
    channel: new MockChannelAdapter(),
    identity: new FakeIdentityBootstrap("WS-1000"),
    logger: false,
    driverFlows: quietFlows,
  }).app;
}

let nextUpdate = 1;
async function send(app: ReturnType<typeof build>, text: string) {
  const id = nextUpdate++;
  return app.inject({
    method: "POST",
    url: "/channel/driver/webhook",
    headers: { [WEBHOOK_SECRET_HEADER]: SECRET, "content-type": "application/json" },
    payload: {
      update_id: id,
      message: { message_id: id, chat: { id: 5, type: "private" }, from: { id: 6, first_name: "سالم" }, text },
    },
  });
}

describe("M3-05 · driver bot role (real composition root)", () => {
  it("ships exactly the commands BOT_ROLE_SPEC §2.2 allows — no more, no fewer", () => {
    expect([...DRIVER_SUPPORTED_COMMANDS].sort()).toEqual([...BOT_ALLOWED_COMMANDS.driver].sort());
  });

  for (const command of BOT_ALLOWED_COMMANDS.driver) {
    it(`answers /${command}`, async () => {
      const app = build();
      const response = await send(app, `/${command}`);
      expect(response.statusCode).toBe(202);
      await app.close();
    });
  }

  it.each(["admin", "suspend", "approve", "delete", "help", "places", "create_order"])(
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
    expect(() =>
      buildApp({
        env: ENV,
        channel: new MockChannelAdapter(),
        identity: new FakeIdentityBootstrap("WS-1000"),
        logger: false,
        driverFlows: quietFlows,
        supportedCommands: [...DRIVER_SUPPORTED_COMMANDS, "admin"],
      }),
    ).toThrow(/BOT_COMMAND_OUTSIDE_ROLE_SPEC: driver bot registers \/admin/);
  });
});
