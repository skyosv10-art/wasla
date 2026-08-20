/**
 * Keyboard tests — the Exit Gate surface.
 *
 * "Each bot opens the right Mini App" is asserted end to end in MR 7, but the
 * button that does it is built here, so the wrong-app and wrong-origin cases are
 * caught at this level where the failure is unambiguous.
 */

import { describe, expect, it } from "vitest";

import { ChannelError, decodeDeepLinkPayload, type BotPresence } from "@wasla/channel-core";

import { buildInlineKeyboard } from "../keyboard.js";

const driver: BotPresence = {
  bot: "driver",
  miniApp: "driver",
  miniAppUrl: "https://app.example.test/driver",
  miniAppLabel: "تطبيق السائق",
  deepLinkTemplate: "https://t.example.test/driver?start={payload}",
};

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ChannelError);
    expect((error as ChannelError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code} to be thrown`);
}

describe("buildInlineKeyboard · mini app buttons", () => {
  it("renders a mini app intent as a web app button, one per row", () => {
    const markup = buildInlineKeyboard(
      [
        { type: "mini_app", label: "افتح التطبيق", miniApp: "driver" },
        { type: "deep_link", label: "شارك", action: "open_app" },
      ],
      driver,
    );
    expect(markup.inline_keyboard).toHaveLength(2);
    expect(markup.inline_keyboard[0]).toHaveLength(1);
    expect(markup.inline_keyboard[0]?.[0]).toEqual({
      text: "افتح التطبيق",
      web_app: { url: "https://app.example.test/driver" },
    });
  });

  it("resolves a path against the configured base", () => {
    const markup = buildInlineKeyboard(
      [{ type: "mini_app", label: "الرحلة", miniApp: "driver", path: "/trips/42" }],
      driver,
    );
    const button = markup.inline_keyboard[0]?.[0] as { web_app: { url: string } };
    expect(button.web_app.url).toBe("https://app.example.test/trips/42");
  });

  it("refuses a path that would point the button at another origin", () => {
    // Without this check an attacker-supplied path would turn our own button
    // into a link to their host, inside a message the user trusts.
    expectCode(
      () =>
        buildInlineKeyboard(
          [{ type: "mini_app", label: "خارج", miniApp: "driver", path: "https://evil.test/steal" }],
          driver,
        ),
      "CHANNEL_INVALID_MESSAGE",
    );
  });

  it("refuses a mini app this bot does not open", () => {
    expectCode(
      () => buildInlineKeyboard([{ type: "mini_app", label: "عميل", miniApp: "customer" }], driver),
      "CHANNEL_MINI_APP_NOT_CONFIGURED",
    );
  });

  it("refuses a non-HTTPS or malformed mini app address", () => {
    expectCode(
      () =>
        buildInlineKeyboard([{ type: "mini_app", label: "س", miniApp: "driver" }], {
          ...driver,
          miniAppUrl: "http://app.example.test/driver",
        }),
      "CHANNEL_MINI_APP_NOT_CONFIGURED",
    );
    expectCode(
      () =>
        buildInlineKeyboard([{ type: "mini_app", label: "س", miniApp: "driver" }], {
          ...driver,
          miniAppUrl: "app.example.test",
        }),
      "CHANNEL_MINI_APP_NOT_CONFIGURED",
    );
  });

  it("refuses an oversized path", () => {
    expectCode(
      () =>
        buildInlineKeyboard(
          [{ type: "mini_app", label: "س", miniApp: "driver", path: `/${"a".repeat(300)}` }],
          driver,
        ),
      "CHANNEL_INVALID_MESSAGE",
    );
  });
});

describe("buildInlineKeyboard · deep link buttons", () => {
  it("substitutes an encoded payload the core can decode back", () => {
    const markup = buildInlineKeyboard(
      [{ type: "deep_link", label: "تابع الطلب", action: "track_order", params: { id: "WSL-1" } }],
      driver,
    );
    const button = markup.inline_keyboard[0]?.[0] as { url: string };
    const payload = decodeURIComponent(new URL(button.url).searchParams.get("start") ?? "");
    expect(decodeDeepLinkPayload(payload)).toEqual({ action: "track_order", params: { id: "WSL-1" } });
  });

  it("refuses when the bot has no link template configured", () => {
    expectCode(
      () =>
        buildInlineKeyboard([{ type: "deep_link", label: "شارك", action: "open_app" }], {
          ...driver,
          deepLinkTemplate: undefined,
        }),
      "CHANNEL_UNKNOWN_BOT",
    );
  });

  it("propagates the contract error for an unknown action", () => {
    expectCode(
      () =>
        buildInlineKeyboard(
          // Deliberately outside the contract: the codec, not the adapter, owns
          // the list of valid actions.
          [{ type: "deep_link", label: "س", action: "delete_everything" as never }],
          driver,
        ),
      "CHANNEL_INVALID_DEEP_LINK",
    );
  });
});

describe("buildInlineKeyboard · limits", () => {
  it("refuses an empty button list on a message that claims to have buttons", () => {
    expectCode(() => buildInlineKeyboard([], driver), "CHANNEL_INVALID_MESSAGE");
  });

  it("refuses more buttons than the contract allows", () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      type: "mini_app" as const,
      label: `زر ${index}`,
      miniApp: "driver" as const,
    }));
    expectCode(() => buildInlineKeyboard(many, driver), "CHANNEL_INVALID_MESSAGE");
  });

  it("refuses an empty or oversized label", () => {
    expectCode(
      () => buildInlineKeyboard([{ type: "mini_app", label: "   ", miniApp: "driver" }], driver),
      "CHANNEL_INVALID_MESSAGE",
    );
    expectCode(
      () => buildInlineKeyboard([{ type: "mini_app", label: "ب".repeat(65), miniApp: "driver" }], driver),
      "CHANNEL_INVALID_MESSAGE",
    );
  });
});
