import { describe, expect, it } from "vitest";

import { IMPLEMENTED_CHANNEL, type BotKind } from "@wasla/contracts-channel";

import {
  FakeIdentityBootstrap,
  FakeUpdateParser,
  FixedClock,
  InMemoryOutbox,
  InMemoryProcessedUpdateStore,
  SequentialIdGenerator,
} from "../infrastructure/in-memory.js";
import { encodeDeepLinkPayload } from "../domain/deep-link.js";
import { isChannelError } from "../domain/errors.js";
import { receiveUpdate } from "../use-cases/receive-update.js";
import type { InboundDeps } from "../use-cases/deps.js";

function makeDeps(): InboundDeps & {
  processedUpdates: InMemoryProcessedUpdateStore;
  outbox: InMemoryOutbox;
  identity: FakeIdentityBootstrap;
  clock: FixedClock;
} {
  return {
    parser: new FakeUpdateParser(),
    processedUpdates: new InMemoryProcessedUpdateStore(),
    outbox: new InMemoryOutbox(),
    identity: new FakeIdentityBootstrap(),
    clock: new FixedClock(),
    ids: new SequentialIdGenerator(),
  };
}

const BOT: BotKind = "customer";

function startUpdate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channelUpdateId: "u-1",
    chatRef: "chat-1",
    kind: "command",
    command: "start",
    actor: { channelUserRef: "user-1", locale: "ar" },
    ...overrides,
  };
}

describe("receiveUpdate", () => {
  it("accepts a first update, appends exactly one received event and bootstraps identity", async () => {
    const deps = makeDeps();

    const result = await receiveUpdate(deps, { bot: BOT, raw: startUpdate() });

    expect(result.status).toBe("accepted");
    expect(result.channel).toBe(IMPLEMENTED_CHANNEL);
    expect(result.identity).toEqual({ waslaPublicId: "WSL-000001", created: true });
    expect(deps.outbox.types()).toEqual(["channel.update.received"]);
    expect(deps.identity.calls).toHaveLength(1);
  });

  it("hands the neutral actor to the caller, on a first update and on a replay", async () => {
    const deps = makeDeps();

    const first = await receiveUpdate(deps, { bot: BOT, raw: startUpdate() });
    const replay = await receiveUpdate(deps, { bot: BOT, raw: startUpdate() });

    // The composition root needs it to resolve «who is this» for a command other
    // than start; it is the parser's neutral shape, so no channel-native
    // identifier travels with it (ADR-007 rule 2).
    expect(first.actor).toEqual({ channelUserRef: "user-1", locale: "ar" });
    expect(replay.actor).toEqual(first.actor);
    expect(deps.identity.calls).toHaveLength(1);
  });

  it("omits the actor when the update carried none", async () => {
    const deps = makeDeps();

    const result = await receiveUpdate(deps, {
      bot: BOT,
      raw: { channelUpdateId: "u-9", chatRef: "chat-1", kind: "text_message" },
    });

    expect(result.actor).toBeUndefined();
  });

  it("treats a replayed update id as a duplicate: no event, no second identity call", async () => {
    const deps = makeDeps();
    await receiveUpdate(deps, { bot: BOT, raw: startUpdate() });

    const replay = await receiveUpdate(deps, { bot: BOT, raw: startUpdate() });

    expect(replay.status).toBe("duplicate");
    expect(deps.outbox.events).toHaveLength(1);
    expect(deps.identity.calls).toHaveLength(1);
  });

  it("scopes de-duplication per bot, so two bots may see the same update id", async () => {
    const deps = makeDeps();
    await receiveUpdate(deps, { bot: "customer", raw: startUpdate() });

    const other = await receiveUpdate(deps, { bot: "driver", raw: startUpdate() });

    expect(other.status).toBe("accepted");
    expect(deps.outbox.events).toHaveLength(2);
  });

  it("decodes a deep-link payload carried by the start command", async () => {
    const deps = makeDeps();
    const payload = encodeDeepLinkPayload("track_order", { order: "ORD-9" });

    const result = await receiveUpdate(deps, {
      bot: BOT,
      raw: startUpdate({ commandArgument: payload }),
    });

    expect(result.deepLink).toEqual({ action: "track_order", params: { order: "ORD-9" } });
  });

  it("rejects an unsupported command before recording it, so a fixed retry still works", async () => {
    const deps = makeDeps();

    await expect(
      receiveUpdate(deps, { bot: BOT, raw: startUpdate({ command: "selfdestruct" }) }),
    ).rejects.toMatchObject({ code: "CHANNEL_UNSUPPORTED_COMMAND" });
    expect(deps.processedUpdates.records()).toHaveLength(0);
    expect(deps.outbox.events).toHaveLength(0);
  });

  it("rejects an unsupported update kind", async () => {
    const deps = makeDeps();

    await expect(
      receiveUpdate(deps, { bot: BOT, raw: startUpdate({ kind: "payment", command: undefined }) }),
    ).rejects.toMatchObject({ code: "CHANNEL_UNSUPPORTED_UPDATE" });
  });

  it("rejects a malformed update through the parser", async () => {
    const deps = makeDeps();

    await expect(receiveUpdate(deps, { bot: BOT, raw: { kind: "text_message" } })).rejects.toMatchObject(
      { code: "CHANNEL_INVALID_UPDATE" },
    );
  });

  it("maps an identity outage to CHANNEL_IDENTITY_BOOTSTRAP_FAILED and keeps it retryable", async () => {
    const deps = makeDeps();
    deps.identity.failNext();

    try {
      await receiveUpdate(deps, { bot: BOT, raw: startUpdate() });
      expect.unreachable("expected identity bootstrap to fail");
    } catch (error) {
      expect(isChannelError(error)).toBe(true);
      expect(error).toMatchObject({ code: "CHANNEL_IDENTITY_BOOTSTRAP_FAILED", retryable: true });
    }
    expect(deps.outbox.events).toHaveLength(0);
  });

  it("does not call identity for a plain text message", async () => {
    const deps = makeDeps();

    await receiveUpdate(deps, {
      bot: BOT,
      raw: { channelUpdateId: "u-2", chatRef: "chat-1", kind: "text_message", text: "مرحبا" },
    });

    expect(deps.identity.calls).toHaveLength(0);
    expect(deps.outbox.events).toHaveLength(1);
  });

  it("carries the trace id into the stored record and the event", async () => {
    const deps = makeDeps();

    await receiveUpdate(deps, { bot: BOT, raw: startUpdate(), traceId: "trace-abc" });

    expect(deps.processedUpdates.records()[0]?.traceId).toBe("trace-abc");
    expect(deps.outbox.events[0]?.trace_id).toBe("trace-abc");
  });
});
