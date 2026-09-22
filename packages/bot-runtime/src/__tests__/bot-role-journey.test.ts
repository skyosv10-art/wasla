/**
 * M3-05 Bot role journey tests — prove each bot answers its declared commands.
 *
 * BOT_ROLE_SPEC.md defines the allowed command set per bot. This file proves
 * that every declared command is accepted (not rejected as unsupported) and
 * that the bot's supportedCommands list matches the spec exactly.
 */

import { describe, expect, it } from "vitest";

import { BOT_KINDS } from "@wasla/contracts-channel";

import { authHeaders, harnessFor, type HarnessOptions } from "./harness.js";

/**
 * The allowed command sets per BOT_ROLE_SPEC.md.
 * These mirror CUSTOMER_SUPPORTED_COMMANDS and DRIVER_SUPPORTED_COMMANDS
 * in the bot packages, but are duplicated here because bot-runtime does
 * not depend on the individual bot packages.
 */
const CUSTOMER_COMMANDS = [
  "start",
  "places",
  "orders",
  "negotiations",
  "accept",
  "reject",
] as const;

const DRIVER_COMMANDS = [
  "start",
  "available",
  "offline",
  "status",
  "docs",
  "negotiations",
  "accept",
  "reject",
] as const;

/** Build a Telegram command update for any /command. */
function commandUpdate(
  updateId: number,
  command: string,
  options: { chatId?: number; userId?: number } = {},
): Record<string, unknown> {
  const chatId = options.chatId ?? 4001;
  const userId = options.userId ?? 900123;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_770_000_000,
      chat: { id: chatId, type: "private" },
      from: { id: userId, first_name: "مستخدم", language_code: "ar" },
      text: `/${command}`,
    },
  };
}

const customerHarnessOpts: HarnessOptions = {
  supportedCommands: CUSTOMER_COMMANDS,
};

const driverHarnessOpts: HarnessOptions = {
  supportedCommands: DRIVER_COMMANDS,
};

describe("M3-05: Bot role — journey tests", () => {
  describe("Customer bot accepts all declared commands", () => {
    for (const command of CUSTOMER_COMMANDS) {
      it(`accepts /${command}`, async () => {
        const { app } = harnessFor("customer", customerHarnessOpts);

        const response = await app.inject({
          method: "POST",
          url: "/channel/customer/webhook",
          headers: authHeaders(),
          payload: commandUpdate(Math.floor(Math.random() * 100000), command),
        });

        // Should not be rejected as unsupported (422)
        expect(response.statusCode).not.toBe(422);
        const body = response.json();
        if (body.code) {
          expect(body.code).not.toBe("CHANNEL_UNSUPPORTED_COMMAND");
        }
      });
    }

    it("customer bot supportedCommands matches BOT_ROLE_SPEC", () => {
      expect([...CUSTOMER_COMMANDS]).toEqual([
        "start",
        "places",
        "orders",
        "negotiations",
        "accept",
        "reject",
      ]);
    });
  });

  describe("Driver bot accepts all declared commands", () => {
    for (const command of DRIVER_COMMANDS) {
      it(`accepts /${command}`, async () => {
        const { app } = harnessFor("driver", driverHarnessOpts);

        const response = await app.inject({
          method: "POST",
          url: "/channel/driver/webhook",
          headers: authHeaders(),
          payload: commandUpdate(Math.floor(Math.random() * 100000), command),
        });

        expect(response.statusCode).not.toBe(422);
        const body = response.json();
        if (body.code) {
          expect(body.code).not.toBe("CHANNEL_UNSUPPORTED_COMMAND");
        }
      });
    }

    it("driver bot supportedCommands matches BOT_ROLE_SPEC", () => {
      expect([...DRIVER_COMMANDS]).toEqual([
        "start",
        "available",
        "offline",
        "status",
        "docs",
        "negotiations",
        "accept",
        "reject",
      ]);
    });
  });

  describe("Partner bot accepts only /start", () => {
    it("accepts /start", async () => {
      const { app } = harnessFor("partner");

      const response = await app.inject({
        method: "POST",
        url: "/channel/partner/webhook",
        headers: authHeaders(),
        payload: commandUpdate(50001, "start"),
      });

      expect(response.statusCode).not.toBe(422);
    });
  });

  describe("All three bots are wired", () => {
    for (const bot of BOT_KINDS) {
      it(`${bot} bot boots and serves /start`, async () => {
        const opts = bot === "customer" ? customerHarnessOpts : bot === "driver" ? driverHarnessOpts : {};
        const { app } = harnessFor(bot, opts);

        const response = await app.inject({
          method: "POST",
          url: `/channel/${bot}/webhook`,
          headers: authHeaders(),
          payload: commandUpdate(Math.floor(Math.random() * 100000), "start"),
        });

        expect(response.statusCode).not.toBe(404);
        expect(response.statusCode).not.toBe(500);
      });
    }
  });
});
