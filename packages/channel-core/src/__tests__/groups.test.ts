import { describe, expect, it } from "vitest";

import { IMPLEMENTED_CHANNEL, type BotKind } from "@wasla/contracts-channel";

import {
  FakeIdentityBootstrap,
  FakeUpdateParser,
  FixedClock,
  InMemoryDeliveryStore,
  InMemoryOutbox,
  InMemoryProcessedUpdateStore,
  MockChannelAdapter,
  SequentialIdGenerator,
  StaticGroupRegistry,
  testGroupRegistry,
} from "../infrastructure/in-memory.js";
import { isChannelError } from "../domain/errors.js";
import { exponentialBackoffPolicy } from "../domain/retry.js";
import { receiveUpdate } from "../use-cases/receive-update.js";
import { sendMessage } from "../use-cases/send-message.js";
import type { InboundDeps, OutboundDeps } from "../use-cases/deps.js";

const BOT: BotKind = "customer";
const SUPPORT_GROUP = "-100100";
const ESCALATION_GROUP = "-100200";
const UNKNOWN_GROUP = "-100999";

function makeInbound(groups = testGroupRegistry(SUPPORT_GROUP, ESCALATION_GROUP)): InboundDeps & {
  outbox: InMemoryOutbox;
  identity: FakeIdentityBootstrap;
} {
  return {
    parser: new FakeUpdateParser(),
    processedUpdates: new InMemoryProcessedUpdateStore(),
    outbox: new InMemoryOutbox(),
    identity: new FakeIdentityBootstrap(),
    clock: new FixedClock(),
    ids: new SequentialIdGenerator(),
    groups,
  };
}

function makeOutbound(groups = testGroupRegistry(SUPPORT_GROUP, ESCALATION_GROUP)): OutboundDeps & {
  channel: MockChannelAdapter;
} {
  return {
    channel: new MockChannelAdapter(),
    deliveries: new InMemoryDeliveryStore(),
    outbox: new InMemoryOutbox(),
    retry: exponentialBackoffPolicy(),
    clock: new FixedClock(),
    ids: new SequentialIdGenerator(),
    groups,
  };
}

function groupStart(
  chatRef: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    channelUpdateId: "u-1",
    chatRef,
    kind: "command",
    command: "start",
    isGroup: true,
    actor: { channelUserRef: "user-1" },
    ...overrides,
  };
}

describe("conversation scope", () => {
  it("reports a private chat as private, answerable, with no group role", async () => {
    const deps = makeInbound();

    const result = await receiveUpdate(deps, {
      bot: BOT,
      raw: groupStart("chat-1", { isGroup: false }),
    });

    expect(result.scope).toBe("private");
    expect(result.replyAllowed).toBe(true);
    expect(result.groupRole).toBeUndefined();
    expect(result.channel).toBe(IMPLEMENTED_CHANNEL);
  });

  it("reports a configured group with its role and allows a reply", async () => {
    const deps = makeInbound();

    const result = await receiveUpdate(deps, { bot: BOT, raw: groupStart(SUPPORT_GROUP) });

    expect(result.scope).toBe("group");
    expect(result.groupRole).toBe("support");
    expect(result.replyAllowed).toBe(true);
  });

  it("records an unconfigured group but refuses to answer in it", async () => {
    const deps = makeInbound();

    const result = await receiveUpdate(deps, { bot: BOT, raw: groupStart(UNKNOWN_GROUP) });

    expect(result.status).toBe("accepted");
    expect(result.scope).toBe("group");
    expect(result.groupRole).toBeUndefined();
    expect(result.replyAllowed).toBe(false);
    // Still one received event: silence is a reply policy, not a dropped update.
    expect(deps.outbox.types()).toEqual(["channel.update.received"]);
  });

  it("treats every group as unknown when no registry is wired", async () => {
    const deps = makeInbound();
    delete (deps as { groups?: unknown }).groups;

    const result = await receiveUpdate(deps, { bot: BOT, raw: groupStart(SUPPORT_GROUP) });

    expect(result.scope).toBe("group");
    expect(result.replyAllowed).toBe(false);
  });

  it("never bootstraps identity from a group, even for /start with an actor", async () => {
    const deps = makeInbound();

    const result = await receiveUpdate(deps, { bot: BOT, raw: groupStart(SUPPORT_GROUP) });

    expect(result.identity).toBeUndefined();
    expect(deps.identity.calls).toHaveLength(0);
  });

  it("still bootstraps identity in a private chat", async () => {
    const deps = makeInbound();

    await receiveUpdate(deps, { bot: BOT, raw: groupStart("chat-1", { isGroup: false }) });

    expect(deps.identity.calls).toHaveLength(1);
  });

  it("carries the scope on a duplicate as well, so the reply policy is stable on replay", async () => {
    const deps = makeInbound();
    await receiveUpdate(deps, { bot: BOT, raw: groupStart(ESCALATION_GROUP) });

    const replay = await receiveUpdate(deps, { bot: BOT, raw: groupStart(ESCALATION_GROUP) });

    expect(replay.status).toBe("duplicate");
    expect(replay.scope).toBe("group");
    expect(replay.groupRole).toBe("escalation");
    expect(replay.replyAllowed).toBe(true);
  });

  it("accepts a membership event in a configured group", async () => {
    const deps = makeInbound();

    const result = await receiveUpdate(deps, {
      bot: BOT,
      raw: {
        channelUpdateId: "u-9",
        chatRef: SUPPORT_GROUP,
        kind: "group_event",
        isGroup: true,
        text: "bot_status:member",
      },
    });

    expect(result.status).toBe("accepted");
    expect(result.kind).toBe("group_event");
    expect(result.groupRole).toBe("support");
  });
});

describe("outbound group policy", () => {
  it("refuses a launch-surface button aimed at a group, before any delivery exists", async () => {
    const deps = makeOutbound();

    const attempt = sendMessage(deps, {
      message: {
        channel: IMPLEMENTED_CHANNEL,
        chatRef: SUPPORT_GROUP,
        kind: "text_with_buttons",
        text: "مرحباً",
        buttons: [{ type: "mini_app", label: "افتح التطبيق", miniApp: "customer" }],
        idempotencyKey: "start:customer:u-1",
      },
    });

    await expect(attempt).rejects.toSatisfy(
      (error: unknown) => isChannelError(error) && error.code === "CHANNEL_INVALID_MESSAGE",
    );
    expect(deps.channel.sent).toHaveLength(0);

    // No delivery row was created either: the same key still sends once accepted,
    // which it could not do if the refused attempt had claimed the key.
    const retry = await sendMessage(deps, {
      message: {
        channel: IMPLEMENTED_CHANNEL,
        chatRef: SUPPORT_GROUP,
        kind: "text",
        text: "مرحباً",
        idempotencyKey: "start:customer:u-1",
      },
    });
    expect(retry.status).toBe("sent");
  });

  it("accepts a link button aimed at the same group", async () => {
    const deps = makeOutbound();

    const outcome = await sendMessage(deps, {
      message: {
        channel: IMPLEMENTED_CHANNEL,
        chatRef: SUPPORT_GROUP,
        kind: "text_with_buttons",
        text: "مرحباً",
        buttons: [{ type: "deep_link", label: "افتح المحادثة الخاصة", action: "open_app" }],
        idempotencyKey: "start:customer:u-2",
      },
    });

    expect(outcome.status).toBe("sent");
    expect(deps.channel.sent).toHaveLength(1);
  });

  it("leaves a launch-surface button to a private chat untouched", async () => {
    const deps = makeOutbound();

    const outcome = await sendMessage(deps, {
      message: {
        channel: IMPLEMENTED_CHANNEL,
        chatRef: "chat-1",
        kind: "text_with_buttons",
        text: "مرحباً",
        buttons: [{ type: "mini_app", label: "افتح التطبيق", miniApp: "customer" }],
        idempotencyKey: "start:customer:u-3",
      },
    });

    expect(outcome.status).toBe("sent");
  });
});

describe("StaticGroupRegistry", () => {
  it("resolves a role by reference and answers null for anything else", () => {
    const registry = testGroupRegistry(SUPPORT_GROUP, ESCALATION_GROUP);

    expect(registry.roleFor(SUPPORT_GROUP)).toBe("support");
    expect(registry.roleFor(ESCALATION_GROUP)).toBe("escalation");
    expect(registry.roleFor(UNKNOWN_GROUP)).toBeNull();
  });

  it("lists the groups of one role only", () => {
    const registry = new StaticGroupRegistry([
      { chatRef: "-1", role: "support" },
      { chatRef: "-2", role: "support" },
      { chatRef: "-3", role: "community" },
    ]);

    expect(registry.groupsFor("support").map((group) => group.chatRef)).toEqual(["-1", "-2"]);
    expect(registry.groupsFor("escalation")).toEqual([]);
    expect(registry.all()).toHaveLength(3);
  });

  it("refuses one group declared under two roles", () => {
    expect(
      () =>
        new StaticGroupRegistry([
          { chatRef: "-1", role: "support" },
          { chatRef: "-1", role: "escalation" },
        ]),
    ).toThrow(/two roles|different roles/);
  });

  it("refuses an empty reference", () => {
    expect(() => new StaticGroupRegistry([{ chatRef: "", role: "support" }])).toThrow();
  });

  it("knows nothing when nothing was declared", () => {
    expect(new StaticGroupRegistry().roleFor("-1")).toBeNull();
  });
});
