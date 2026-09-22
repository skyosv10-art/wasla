/**
 * M3-05 Bot role abuse tests — prove the bot refuses what it must not do.
 *
 * BOT_ROLE_SPEC.md §4 defines abuse scenarios. This file proves each one:
 *
 *  4.1 Unsupported commands → CHANNEL_UNSUPPORTED_COMMAND, no reply sent
 *  4.2 Command injection → treated as unsupported command
 *  4.3 Duplicate updates → deduplicated by ProcessedUpdateStore
 *  4.4 Admin commands → not in any bot's supported list
 *  4.5 Unconfigured group → update recorded but no reply
 */

import { describe, expect, it } from "vitest";

import { authHeaders, harnessFor, type HarnessOptions, groupStartUpdate } from "./harness.js";

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

/** Build a Telegram update with arbitrary text (for injection tests). */
function rawTextUpdate(
  updateId: number,
  text: string,
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
      text,
    },
  };
}

const customerHarnessOpts: HarnessOptions = {
  supportedCommands: CUSTOMER_COMMANDS,
};

const driverHarnessOpts: HarnessOptions = {
  supportedCommands: DRIVER_COMMANDS,
};

describe("M3-05: Bot role — abuse tests", () => {
  describe("4.1 Unsupported commands are rejected", () => {
    const UNSUPPORTED = [
      "admin",
      "delete",
      "help",
      "suspend",
      "reinstate",
      "approve",
      "create",
      "edit",
      "update",
      "remove",
      "config",
      "debug",
      "test",
      "execute",
      "shell",
    ];

    for (const command of UNSUPPORTED) {
      it(`customer bot rejects /${command}`, async () => {
        const { app, channel, outbox } = harnessFor("customer", customerHarnessOpts);

        const response = await app.inject({
          method: "POST",
          url: "/channel/customer/webhook",
          headers: authHeaders(),
          payload: commandUpdate(Math.floor(Math.random() * 100000), command),
        });

        expect(response.statusCode).toBe(422);
        expect(response.json().code).toBe("CHANNEL_UNSUPPORTED_COMMAND");
        expect(channel.sent).toHaveLength(0);
        expect(outbox.types()).toHaveLength(0);
      });

      it(`driver bot rejects /${command}`, async () => {
        const { app, channel, outbox } = harnessFor("driver", driverHarnessOpts);

        const response = await app.inject({
          method: "POST",
          url: "/channel/driver/webhook",
          headers: authHeaders(),
          payload: commandUpdate(Math.floor(Math.random() * 100000), command),
        });

        expect(response.statusCode).toBe(422);
        expect(response.json().code).toBe("CHANNEL_UNSUPPORTED_COMMAND");
        expect(channel.sent).toHaveLength(0);
        expect(outbox.types()).toHaveLength(0);
      });
    }

    it("partner bot rejects /orders (not in its command list)", async () => {
      const { app, channel } = harnessFor("partner");

      const response = await app.inject({
        method: "POST",
        url: "/channel/partner/webhook",
        headers: authHeaders(),
        payload: commandUpdate(50010, "orders"),
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("CHANNEL_UNSUPPORTED_COMMAND");
      expect(channel.sent).toHaveLength(0);
    });

    it("partner bot rejects /available (driver-only command)", async () => {
      const { app } = harnessFor("partner");

      const response = await app.inject({
        method: "POST",
        url: "/channel/partner/webhook",
        headers: authHeaders(),
        payload: commandUpdate(50011, "available"),
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("CHANNEL_UNSUPPORTED_COMMAND");
    });
  });

  describe("4.2 Command injection is treated as unsupported or ignored", () => {
    const INJECTIONS = [
      "start; rm -rf /",
      "places\n/admin",
      "orders|whoami",
      "start && cat /etc/passwd",
      "places;DROP TABLE users",
      "start`whoami`",
      "places$(id)",
    ];

    for (const injection of INJECTIONS) {
      it(`customer bot rejects injection: ${injection.slice(0, 30)}`, async () => {
        const { app, channel } = harnessFor("customer", customerHarnessOpts);

        const response = await app.inject({
          method: "POST",
          url: "/channel/customer/webhook",
          headers: authHeaders(),
          payload: rawTextUpdate(Math.floor(Math.random() * 100000), `/${injection}`),
        });

        // Injection attempts are either rejected as unsupported commands (422),
        // rejected as malformed (400), or accepted as plain text without reply (202).
        // In all cases, no reply is sent to the user.
        expect([202, 400, 422]).toContain(response.statusCode);
        expect(channel.sent).toHaveLength(0);
      });
    }
  });

  describe("4.3 Duplicate updates are deduplicated", () => {
    it("customer bot does not process the same update twice", async () => {
      const { app } = harnessFor("customer", customerHarnessOpts);
      const updateId = 60001;

      // First delivery — should be accepted
      const first = await app.inject({
        method: "POST",
        url: "/channel/customer/webhook",
        headers: authHeaders(),
        payload: commandUpdate(updateId, "start"),
      });

      expect(first.statusCode).not.toBe(422);

      // Second delivery of the same update — should be deduplicated
      const second = await app.inject({
        method: "POST",
        url: "/channel/customer/webhook",
        headers: authHeaders(),
        payload: commandUpdate(updateId, "start"),
      });

      // The duplicate is accepted (202) but not re-answered
      expect(second.statusCode).toBe(202);
    });
  });

  describe("4.4 Admin commands are not accepted by partner bot", () => {
    const ADMIN_COMMANDS = [
      "suspend",
      "reinstate",
      "approve",
      "audit",
      "export",
      "import",
      "backup",
      "restore",
      "migrate",
      "deploy",
      "shutdown",
      "restart",
    ];

    for (const command of ADMIN_COMMANDS) {
      it(`partner bot rejects admin command /${command}`, async () => {
        const { app, channel } = harnessFor("partner");

        const response = await app.inject({
          method: "POST",
          url: "/channel/partner/webhook",
          headers: authHeaders(),
          payload: commandUpdate(Math.floor(Math.random() * 100000), command),
        });

        expect(response.statusCode).toBe(422);
        expect(response.json().code).toBe("CHANNEL_UNSUPPORTED_COMMAND");
        expect(channel.sent).toHaveLength(0);
      });
    }
  });

  describe("4.5 Unconfigured group gets no reply", () => {
    it("customer bot in unconfigured group: recorded but silent", async () => {
      const { app, channel } = harnessFor("customer", customerHarnessOpts);

      const response = await app.inject({
        method: "POST",
        url: "/channel/customer/webhook",
        headers: authHeaders(),
        payload: groupStartUpdate(70001, { chatId: -99999 }),
      });

      // The update is accepted (202) but no reply is sent because
      // the group is not configured in the group registry
      expect(response.statusCode).toBe(202);
      expect(channel.sent).toHaveLength(0);
    });
  });
});
