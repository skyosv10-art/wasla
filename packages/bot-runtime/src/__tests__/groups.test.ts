/**
 * Group behaviour of a bot process (MR 6).
 *
 * The cases are the ones an operator will actually hit: the bot is added to a
 * room that was configured, added to a room nobody configured, and `/start` is
 * typed in both. What is asserted is *observable* behaviour — the status code, the
 * payload the channel received, whether identity was called — never the Arabic
 * copy (DEFINITION_OF_DONE).
 */

import { describe, expect, it } from "vitest";

import { type GroupPresence } from "@wasla/channel-core";

import {
  GROUP_ENV_NAMES,
  envNames,
  loadBotConfig,
  loadGroupPresences,
  type EnvBag,
} from "../config.js";
import { DEFAULT_GROUP_START_TEXT, buildGroupStartReply } from "../welcome.js";

import { authHeaders, botAddedUpdate, groupStartUpdate, harnessFor, startUpdate } from "./harness.js";

const SUPPORT_GROUP = "-1001";
const UNKNOWN_GROUP = "-1009";

const SUPPORT: readonly GroupPresence[] = [{ chatRef: SUPPORT_GROUP, role: "support" }];

const SECRET_VALUE = "a-sufficiently-long-secret";

function envFor(overrides: EnvBag = {}): EnvBag {
  const names = envNames("customer");
  return {
    [names.token]: "token-value",
    [names.webhookSecret]: SECRET_VALUE,
    [names.miniAppUrl]: "https://apps.wasla.test/customer",
    ...overrides,
  };
}

describe("group configuration", () => {
  it("reads no groups when nothing is declared", () => {
    expect(loadGroupPresences({})).toEqual([]);
    expect(loadBotConfig("customer", envFor()).groups).toEqual([]);
  });

  it("reads a comma-separated list per role and keeps the role", () => {
    const groups = loadGroupPresences({
      [GROUP_ENV_NAMES.support]: " -1001, -1002 ",
      [GROUP_ENV_NAMES.escalation]: "-1003",
      [GROUP_ENV_NAMES.community]: "-1004",
    });

    expect(groups.map((group) => [group.chatRef, group.role])).toEqual([
      ["-1001", "support"],
      ["-1002", "support"],
      ["-1003", "escalation"],
      ["-1004", "community"],
    ]);
  });

  it("refuses one group declared under two roles", () => {
    expect(() =>
      loadGroupPresences({
        [GROUP_ENV_NAMES.support]: "-1001",
        [GROUP_ENV_NAMES.escalation]: "-1001",
      }),
    ).toThrow(/two roles/);
  });

  it("refuses an empty entry left by a stray comma", () => {
    expect(() => loadGroupPresences({ [GROUP_ENV_NAMES.support]: "-1001,," })).toThrow(/empty/);
  });

  it("refuses an over-long reference", () => {
    expect(() =>
      loadGroupPresences({ [GROUP_ENV_NAMES.support]: `-${"1".repeat(200)}` }),
    ).toThrow(/longer than/);
  });

  it("exposes the declared groups on the bot configuration", () => {
    const config = loadBotConfig("customer", envFor({ [GROUP_ENV_NAMES.support]: SUPPORT_GROUP }));

    expect(config.groups).toEqual([{ chatRef: SUPPORT_GROUP, role: "support", label: "support:1" }]);
  });
});

describe("group /start reply", () => {
  it("carries a link button and never a launch surface", () => {
    const reply = buildGroupStartReply({
      bot: "customer",
      channel: "telegram",
      chatRef: SUPPORT_GROUP,
      channelUpdateId: "7",
      role: "support",
    });

    expect(reply.kind).toBe("text_with_buttons");
    expect(reply.buttons?.map((button) => button.type)).toEqual(["deep_link"]);
    expect(reply.text).toBe(DEFAULT_GROUP_START_TEXT.support);
    // Same key as the private reply: one update, one message, whatever the scope.
    expect(reply.idempotencyKey).toBe("start:customer:7");
  });

  it("degrades to a text-only reply when no link template is configured", () => {
    const reply = buildGroupStartReply({
      bot: "driver",
      channel: "telegram",
      chatRef: SUPPORT_GROUP,
      channelUpdateId: "8",
      role: "community",
      withLink: false,
    });

    expect(reply.kind).toBe("text");
    expect(reply.buttons).toBeUndefined();
  });
});

describe("POST /channel/:bot/webhook — groups", () => {
  it("answers /start in a configured group with a link button, in the group", async () => {
    const { app, channel, identity } = harnessFor("customer", { groups: SUPPORT });

    const response = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: groupStartUpdate(11, { chatId: Number(SUPPORT_GROUP) }),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe("accepted");
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]?.chatRef).toBe(SUPPORT_GROUP);
    expect(channel.sent[0]?.buttons?.map((button) => button.type)).toEqual(["deep_link"]);
    // Identity is personal: a shared room must not bootstrap one.
    expect(identity.calls).toHaveLength(0);
  });

  it("stays silent in a group nobody configured, and still answers 202", async () => {
    const { app, channel, outbox } = harnessFor("customer", { groups: SUPPORT });

    const response = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: groupStartUpdate(12, { chatId: Number(UNKNOWN_GROUP) }),
    });

    expect(response.statusCode).toBe(202);
    expect(channel.sent).toHaveLength(0);
    // Recorded all the same, so the room is auditable.
    expect(outbox.types()).toEqual(["channel.update.received"]);
  });

  it("accepts being added to a group instead of rejecting the update", async () => {
    const { app, channel } = harnessFor("customer", { groups: SUPPORT });

    const response = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: botAddedUpdate(13, { chatId: Number(SUPPORT_GROUP) }),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().kind).toBe("group_event");
    // A membership event is recorded, not answered: announcements belong to the
    // support service (Phase 16), not to this layer.
    expect(channel.sent).toHaveLength(0);
  });

  it("does not answer twice when Telegram replays a group /start", async () => {
    const { app, channel } = harnessFor("customer", { groups: SUPPORT });
    const payload = groupStartUpdate(14, { chatId: Number(SUPPORT_GROUP) });

    await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload,
    });
    const replay = await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload,
    });

    expect(replay.json().status).toBe("duplicate");
    expect(channel.sent).toHaveLength(1);
  });

  it("sends a text-only group reply when the bot has no link template", async () => {
    const { app, channel } = harnessFor("customer", {
      groups: SUPPORT,
      withoutGroupLink: true,
    });

    await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: groupStartUpdate(15, { chatId: Number(SUPPORT_GROUP) }),
    });

    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]?.kind).toBe("text");
    expect(channel.sent[0]?.buttons).toBeUndefined();
  });

  it("leaves the private /start path untouched", async () => {
    const { app, channel, identity } = harnessFor("customer", { groups: SUPPORT });

    await app.inject({
      method: "POST",
      url: "/channel/customer/webhook",
      headers: authHeaders(),
      payload: startUpdate(16),
    });

    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]?.buttons?.map((button) => button.type)).toEqual(["mini_app"]);
    expect(identity.calls).toHaveLength(1);
  });
});
