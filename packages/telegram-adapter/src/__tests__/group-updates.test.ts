import { describe, expect, it } from "vitest";

import { isChannelError, type BotPresence } from "@wasla/channel-core";

import { buildInlineKeyboard, isGroupChatRef } from "../keyboard.js";
import { TelegramUpdateParser } from "../update-parser.js";

const parser = new TelegramUpdateParser();

const PRESENCE: BotPresence = {
  bot: "customer",
  miniApp: "customer",
  miniAppUrl: "https://app.example.test/customer",
  miniAppLabel: "افتح تطبيق وصلة",
  deepLinkTemplate: "https://t.example.test/bot?start={payload}",
};

function groupChat(id = -100100): Record<string, unknown> {
  return { id, type: "supergroup", title: "دعم المدينة" };
}

describe("membership updates", () => {
  it("parses my_chat_member in a group as a group event, not as unsupported", () => {
    const update = parser.parse(
      {
        update_id: 41,
        my_chat_member: {
          chat: groupChat(),
          from: { id: 7, first_name: "مشرف" },
          old_chat_member: { status: "left" },
          new_chat_member: { status: "member" },
        },
      },
      "customer",
    );

    expect(update.kind).toBe("group_event");
    expect(update.chatRef).toBe("-100100");
    expect(update.isGroup).toBe(true);
    expect(update.text).toBe("bot_status:member");
    expect(update.actor?.channelUserRef).toBe("7");
  });

  it("distinguishes the bot's own membership from another member's", () => {
    const other = parser.parse(
      {
        update_id: 42,
        chat_member: {
          chat: groupChat(),
          from: { id: 7 },
          new_chat_member: { status: "kicked" },
        },
      },
      "customer",
    );

    expect(other.kind).toBe("group_event");
    expect(other.text).toBe("member_status:kicked");
  });

  it("reports an unrecognised status as unknown instead of passing it through", () => {
    const update = parser.parse(
      {
        update_id: 43,
        my_chat_member: {
          chat: groupChat(),
          new_chat_member: { status: "sudo" },
        },
      },
      "customer",
    );

    expect(update.text).toBe("bot_status:unknown");
  });

  it("does not misfile a private membership change as a group event", () => {
    const update = parser.parse(
      {
        update_id: 44,
        my_chat_member: {
          chat: { id: 555, type: "private" },
          new_chat_member: { status: "kicked" },
        },
      },
      "customer",
    );

    expect(update.kind).toBe("unsupported");
    expect(update.isGroup).toBeUndefined();
  });

  it("still refuses a membership update with no chat", () => {
    expect(() => parser.parse({ update_id: 45, my_chat_member: { from: { id: 7 } } }, "customer"))
      .toThrow();
  });
});

describe("service event markers", () => {
  const cases: readonly [string, Record<string, unknown>, string][] = [
    ["a join", { new_chat_members: [{ id: 1 }, { id: 2 }] }, "joined:2"],
    ["a leave", { left_chat_member: { id: 1 } }, "left:1"],
    ["a migration", { migrate_to_chat_id: -1001 }, "migrated"],
    ["a creation", { group_chat_created: true }, "created"],
  ];

  for (const [name, fields, expected] of cases) {
    it(`marks ${name} as ${expected}`, () => {
      const update = parser.parse(
        { update_id: 50, message: { message_id: 1, chat: groupChat(), ...fields } },
        "customer",
      );

      expect(update.kind).toBe("group_event");
      expect(update.text).toBe(expected);
    });
  }
});

describe("group targets and launch-surface buttons", () => {
  it("recognises a group conversation reference by its sign", () => {
    expect(isGroupChatRef("-100100")).toBe(true);
    expect(isGroupChatRef(" -100100 ")).toBe(true);
    expect(isGroupChatRef("100100")).toBe(false);
    expect(isGroupChatRef("chat-1")).toBe(false);
  });

  it("refuses a launch-surface button when the target is a group", () => {
    let thrown: unknown;
    try {
      buildInlineKeyboard(
        [{ type: "mini_app", label: "افتح التطبيق", miniApp: "customer" }],
        PRESENCE,
        "-100100",
      );
    } catch (error) {
      thrown = error;
    }

    expect(isChannelError(thrown)).toBe(true);
    expect(isChannelError(thrown) ? thrown.code : undefined).toBe("CHANNEL_INVALID_MESSAGE");
  });

  it("renders a link button for the same group", () => {
    const markup = buildInlineKeyboard(
      [{ type: "deep_link", label: "افتح المحادثة الخاصة", action: "open_app" }],
      PRESENCE,
      "-100100",
    );

    expect(markup.inline_keyboard).toHaveLength(1);
    expect(markup.inline_keyboard[0]?.[0]).toMatchObject({ text: "افتح المحادثة الخاصة" });
  });

  it("still renders a launch-surface button for a private target", () => {
    const markup = buildInlineKeyboard(
      [{ type: "mini_app", label: "افتح التطبيق", miniApp: "customer" }],
      PRESENCE,
      "555",
    );

    expect(markup.inline_keyboard[0]?.[0]).toMatchObject({ text: "افتح التطبيق" });
  });
});
