/**
 * M3-05 — the runtime refuses to boot a bot outside its role.
 *
 * `buildBotRuntime` is the one composition every deployable bot passes through
 * (`buildBotApp` → `buildBotRuntime`). If a root registers a command that
 * BOT_ROLE_SPEC.md §2 (mirrored by `BOT_ALLOWED_COMMANDS`) does not allow, the
 * process must fail at startup, not answer it in production.
 */

import { BOT_ALLOWED_COMMANDS, BOT_KINDS } from "@wasla/contracts-channel";
import { describe, expect, it } from "vitest";

import { envNames, loadBotConfig, type EnvBag } from "../config.js";
import { assertCommandsWithinRole, buildBotRuntime } from "../runtime.js";

function envFor(bot: "customer" | "driver" | "partner"): EnvBag {
  const names = envNames(bot);
  return {
    [names.token]: "token-value",
    [names.webhookSecret]: "a-sufficiently-long-secret",
    [names.miniAppUrl]: `https://apps.wasla.test/${bot}`,
  };
}

describe("M3-05 · runtime role guard", () => {
  for (const bot of BOT_KINDS) {
    it(`${bot}: boots with exactly its allowed commands`, () => {
      const config = loadBotConfig(bot, envFor(bot));
      const runtime = buildBotRuntime(config, { supportedCommands: BOT_ALLOWED_COMMANDS[bot] });
      expect(runtime.inbound.supportedCommands).toEqual(BOT_ALLOWED_COMMANDS[bot]);
    });

    it(`${bot}: boots with no explicit list (channel-core default: /start)`, () => {
      const config = loadBotConfig(bot, envFor(bot));
      expect(() => buildBotRuntime(config)).not.toThrow();
    });

    it.each(["admin", "suspend", "approve", "delete", "help", "create_order"])(
      `${bot}: refuses to boot when /%s is registered`,
      (extra) => {
        const config = loadBotConfig(bot, envFor(bot));
        expect(() =>
          buildBotRuntime(config, { supportedCommands: [...BOT_ALLOWED_COMMANDS[bot], extra] }),
        ).toThrow(new RegExp(`BOT_COMMAND_OUTSIDE_ROLE_SPEC: ${bot} bot registers /${extra}\\b`));
      },
    );
  }

  it("a command allowed for one bot is not smuggled into another", () => {
    // `/places` is a customer command; the partner bot may not answer it.
    expect(() => assertCommandsWithinRole("partner", ["start", "places"])).toThrow(
      /partner bot registers \/places/,
    );
    // `/available` is a driver command; the customer bot may not answer it.
    expect(() => assertCommandsWithinRole("customer", ["start", "available"])).toThrow(
      /customer bot registers \/available/,
    );
  });

  it("an undefined list is the default and passes", () => {
    expect(() => assertCommandsWithinRole("partner", undefined)).not.toThrow();
  });
});
