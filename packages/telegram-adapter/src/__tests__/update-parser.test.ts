/**
 * Parser tests — the untrusted boundary.
 *
 * Every case here is an input a stranger can send to a public webhook, so the
 * assertions are about *refusing to be surprised*: malformed bodies, oversized
 * fields, hostile characters, group noise. Assertions target error **codes**, not
 * Arabic messages, so wording can be improved without touching tests.
 */

import { describe, expect, it } from "vitest";

import { ChannelError } from "@wasla/channel-core";
import { IMPLEMENTED_CHANNEL } from "@wasla/contracts-channel";

import { TelegramUpdateParser } from "../update-parser.js";

const parser = new TelegramUpdateParser();

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

const privateChat = { id: 7001, type: "private" } as const;
const from = { id: 4242, first_name: "سارة", last_name: "العتيبي", language_code: "ar-SA" } as const;

function message(extra: Record<string, unknown>): Record<string, unknown> {
  return { update_id: 900, message: { chat: privateChat, from, ...extra } };
}

describe("TelegramUpdateParser · structural validation", () => {
  it("rejects a body that is not an object", () => {
    expectCode(() => parser.parse("not-json", "customer"), "CHANNEL_INVALID_UPDATE");
    expectCode(() => parser.parse(null, "customer"), "CHANNEL_INVALID_UPDATE");
    expectCode(() => parser.parse([{ update_id: 1 }], "customer"), "CHANNEL_INVALID_UPDATE");
  });

  it("rejects an update without an update id", () => {
    expectCode(() => parser.parse({ message: { chat: privateChat } }, "customer"), "CHANNEL_INVALID_UPDATE");
  });

  it("rejects a message without a resolvable chat", () => {
    expectCode(() => parser.parse({ update_id: 5, message: { from } }, "customer"), "CHANNEL_INVALID_UPDATE");
    expectCode(
      () => parser.parse({ update_id: 5, message: { chat: { type: "private" } } }, "customer"),
      "CHANNEL_INVALID_UPDATE",
    );
  });

  it("keeps channel identifiers as strings, whatever their magnitude", () => {
    const parsed = parser.parse(
      { update_id: 10_000_000_000_1, message: { chat: { id: -1_002_345_678_901, type: "supergroup" }, text: "hi" } },
      "driver",
    );
    // A supergroup id exceeds the safe range once it grows; the adapter must not
    // hand a lossy number to the core.
    expect(parsed.chatRef).toBe("-1002345678901");
    expect(typeof parsed.channelUpdateId).toBe("string");
  });
});

describe("TelegramUpdateParser · commands", () => {
  it("parses a bare command", () => {
    const parsed = parser.parse(message({ text: "/start" }), "customer");
    expect(parsed).toMatchObject({
      channel: IMPLEMENTED_CHANNEL,
      bot: "customer",
      kind: "command",
      command: "start",
      chatRef: "7001",
    });
    expect(parsed.commandArgument).toBeUndefined();
  });

  it("extracts the deep-link argument", () => {
    const parsed = parser.parse(message({ text: "/start Zm9vPWJhcg" }), "customer");
    expect(parsed.command).toBe("start");
    expect(parsed.commandArgument).toBe("Zm9vPWJhcg");
  });

  it("strips the bot mention a group adds and lowercases the command", () => {
    const parsed = parser.parse(message({ text: "/START@wasla_customer_bot PAYLOAD" }), "customer");
    expect(parsed.command).toBe("start");
    expect(parsed.commandArgument).toBe("PAYLOAD");
  });

  it("treats a lone slash as unsupported rather than an empty command", () => {
    expect(parser.parse(message({ text: "/" }), "customer").kind).toBe("unsupported");
  });
});

describe("TelegramUpdateParser · other supported kinds", () => {
  it("parses plain text", () => {
    const parsed = parser.parse(message({ text: "أين شحنتي؟" }), "customer");
    expect(parsed.kind).toBe("text_message");
    expect(parsed.text).toBe("أين شحنتي؟");
  });

  it("parses a callback and takes the chat from the origin message", () => {
    const parsed = parser.parse(
      { update_id: 11, callback_query: { id: "cb1", from, data: "order:99", message: { chat: privateChat } } },
      "driver",
    );
    expect(parsed).toMatchObject({ kind: "callback", callbackData: "order:99", chatRef: "7001" });
    expect(parsed.actor?.channelUserRef).toBe("4242");
  });

  it("rejects a callback with no origin message or no data", () => {
    expectCode(
      () => parser.parse({ update_id: 12, callback_query: { id: "cb", from, data: "x" } }, "driver"),
      "CHANNEL_INVALID_UPDATE",
    );
    expectCode(
      () => parser.parse({ update_id: 13, callback_query: { id: "cb", from, message: { chat: privateChat } } }, "driver"),
      "CHANNEL_INVALID_UPDATE",
    );
  });

  it("summarises a shared contact", () => {
    const parsed = parser.parse(
      message({ contact: { phone_number: "+966500000000", first_name: "سارة" } }),
      "customer",
    );
    expect(parsed.kind).toBe("contact");
    expect(parsed.text).toContain("+966500000000");
  });

  it("summarises a location and rejects impossible coordinates", () => {
    const parsed = parser.parse(message({ location: { latitude: 24.47, longitude: 39.61 } }), "driver");
    expect(parsed).toMatchObject({ kind: "location", text: "24.47,39.61" });

    const bogus = parser.parse(message({ location: { latitude: 999, longitude: 39.61 } }), "driver");
    expect(bogus.kind).toBe("unsupported");
  });

  it("marks group membership events and flags the conversation as a group", () => {
    const parsed = parser.parse(
      {
        update_id: 14,
        message: { chat: { id: -500, type: "supergroup" }, from, new_chat_members: [{ id: 1 }, { id: 2 }] },
      },
      "partner",
    );
    expect(parsed).toMatchObject({ kind: "group_event", isGroup: true, text: "joined:2" });
  });

  it("does not flag a private chat as a group", () => {
    expect(parser.parse(message({ text: "hi" }), "customer").isGroup).toBeUndefined();
  });
});

describe("TelegramUpdateParser · unsupported but well-formed", () => {
  it("returns kind unsupported instead of throwing, leaving the policy to the core", () => {
    // Rejecting these is CHANNEL_UNSUPPORTED_UPDATE, decided by the core — the
    // parser must not pre-empt that decision.
    expect(parser.parse({ update_id: 15, poll: { id: "p" } }, "customer").kind).toBe("unsupported");
    expect(parser.parse(message({ sticker: { file_id: "s" } }), "customer").kind).toBe("unsupported");
    expect(parser.parse(message({ photo: [{ file_id: "p" }] }), "customer").kind).toBe("unsupported");
  });

  it("reads an edited message with the same rules as a new one", () => {
    const parsed = parser.parse(
      { update_id: 16, edited_message: { chat: privateChat, from, text: "معدّلة" } },
      "customer",
    );
    expect(parsed).toMatchObject({ kind: "text_message", text: "معدّلة" });
  });
});

describe("TelegramUpdateParser · untrusted field normalisation", () => {
  it("strips control and bidirectional characters from a display name", () => {
    const parsed = parser.parse(
      { update_id: 17, message: { chat: privateChat, from: { id: 1, first_name: "س\u202Eارة\u0007" }, text: "hi" } },
      "customer",
    );
    expect(parsed.actor?.displayName).toBe("سارة");
  });

  it("falls back to the username when no name is given", () => {
    const parsed = parser.parse(
      { update_id: 18, message: { chat: privateChat, from: { id: 1, username: "sara" }, text: "hi" } },
      "customer",
    );
    expect(parsed.actor?.displayName).toBe("sara");
  });

  it("drops a malformed language code instead of forwarding it", () => {
    const parsed = parser.parse(
      { update_id: 19, message: { chat: privateChat, from: { id: 1, language_code: "not a locale" }, text: "hi" } },
      "customer",
    );
    expect(parsed.actor?.languageCode).toBeUndefined();
  });

  it("caps inbound text at the contract limit", () => {
    const parsed = parser.parse(message({ text: "ب".repeat(9000) }), "customer");
    expect(parsed.text?.length).toBe(4096);
  });

  it("preserves line breaks in a multi-line address", () => {
    const parsed = parser.parse(message({ text: "المدينة المنورة\nشارع قباء\nمبنى 12" }), "customer");
    expect(parsed.text?.split("\n")).toHaveLength(3);
  });

  it("omits the actor when the sender is missing", () => {
    const parsed = parser.parse({ update_id: 20, message: { chat: privateChat, text: "hi" } }, "customer");
    expect(parsed.actor).toBeUndefined();
  });
});
