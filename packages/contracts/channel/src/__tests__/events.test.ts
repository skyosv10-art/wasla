import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ChannelEvent,
  ChannelEventType,
  ChannelEventByType,
  UpdateReceivedV1,
  MessageDeliveredV1,
  MessageFailedV1,
  MiniAppLaunchedV1,
} from "../index.js";
import { CHANNEL_EVENT_TYPES } from "../index.js";

/**
 * Drift-guard tests for the hand-derived channel event types.
 *
 * The event types are hand-authored from events.json (codegen produces an
 * unusable generic type for the $defs-only root schema). These tests read the
 * canonical events.json and assert the hand-written types stay in sync with
 * the contract's event_type literals, producer, aggregate and payload shapes.
 */

const eventsContract = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../../channel-core/contracts/events.json"),
    "utf8",
  ),
) as { $defs: Record<string, any> };

/** Extract the `const` event_type literal from a $def (or null). */
function eventTypeOf(def: any): string | null {
  const allOf = Array.isArray(def?.allOf) ? def.allOf : [];
  for (const part of allOf) {
    const et = part?.properties?.event_type?.const;
    if (typeof et === "string") return et;
  }
  return null;
}

/** Find the $def whose event_type literal matches. */
function defFor(eventType: string): any {
  const found = Object.values(eventsContract.$defs).find(
    (def) => eventTypeOf(def) === eventType,
  );
  expect(found, `no $def found for ${eventType}`).toBeDefined();
  return found;
}

/** Extract the payload sub-schema of a $def. */
function payloadOf(def: any): any {
  const allOf = Array.isArray(def?.allOf) ? def.allOf : [];
  for (const part of allOf) {
    const payload = part?.properties?.payload;
    if (payload) return payload;
  }
  return null;
}

describe("@wasla/contracts-channel — event types drift guard", () => {
  it("CHANNEL_EVENT_TYPES matches the event_type literals in events.json", () => {
    const schemaTypes = Object.values(eventsContract.$defs)
      .map(eventTypeOf)
      .filter((t): t is string => typeof t === "string")
      .sort();
    const codeTypes = [...CHANNEL_EVENT_TYPES].sort();
    expect(codeTypes).toEqual(schemaTypes);
  });

  it("declares exactly four v1 events", () => {
    expect(CHANNEL_EVENT_TYPES).toHaveLength(4);
  });

  it("pins the producer to channel-adapter (channel-agnostic envelope)", () => {
    expect(eventsContract.$defs.EventEnvelope.properties.producer.const).toBe(
      "channel-adapter",
    );
  });

  it("pins the aggregate to channel_chat (chat_ref, never an identity ref)", () => {
    const aggregate = eventsContract.$defs.EventEnvelope.properties.aggregate;
    expect(aggregate.properties.type.const).toBe("channel_chat");
    expect(aggregate.required).toEqual(["type", "id"]);
  });

  it("never leaks a telegram-specific field name into the event contract", () => {
    const raw = readFileSync(
      resolve(__dirname, "../../../../channel-core/contracts/events.json"),
      "utf8",
    );
    // "telegram" may appear only as an allowed *value* of `channel`, never as
    // part of a property name (e.g. telegram_chat_id).
    expect(raw).not.toMatch(/"telegram_[a-z_]+"\s*:/);
  });

  it("every event payload requires the channel discriminator", () => {
    for (const eventType of CHANNEL_EVENT_TYPES) {
      const payload = payloadOf(defFor(eventType));
      expect(payload.required, `${eventType} payload.required`).toContain("channel");
    }
  });

  it("update.received payload matches UpdateReceivedV1", () => {
    const payload = payloadOf(defFor("channel.update.received"));
    expect([...payload.required].sort()).toEqual(
      ["bot", "channel", "channel_update_id", "kind"].sort(),
    );
    const event: UpdateReceivedV1 = {
      event_id: "6f1c1a2e-0000-4000-8000-000000000001",
      event_type: "channel.update.received",
      event_version: "v1",
      occurred_at: "2026-08-20T12:00:00Z",
      producer: "channel-adapter",
      aggregate: { type: "channel_chat", id: "chat-123" },
      payload: {
        channel: "telegram",
        bot: "customer",
        channel_update_id: "9001",
        kind: "command",
        command: "start",
      },
    };
    expect(event.payload.command).toBe("start");
    // channel_update_id is a string in both contract and types (never numeric)
    expect(payload.properties.channel_update_id.type).toBe("string");
  });

  it("message.delivered payload matches MessageDeliveredV1", () => {
    const payload = payloadOf(defFor("channel.message.delivered"));
    expect([...payload.required].sort()).toEqual(
      ["attempts", "channel", "delivery_id", "idempotency_key"].sort(),
    );
    const event: MessageDeliveredV1 = {
      event_id: "6f1c1a2e-0000-4000-8000-000000000002",
      event_type: "channel.message.delivered",
      event_version: "v1",
      occurred_at: "2026-08-20T12:00:01Z",
      producer: "channel-adapter",
      aggregate: { type: "channel_chat", id: "chat-123" },
      payload: {
        channel: "telegram",
        delivery_id: "8f1c1a2e-0000-4000-8000-000000000001",
        idempotency_key: "order-4711-assigned",
        attempts: 1,
      },
    };
    expect(event.payload.attempts).toBeGreaterThanOrEqual(1);
  });

  it("message.failed payload carries the mapped error code + retryable flag", () => {
    const payload = payloadOf(defFor("channel.message.failed"));
    expect([...payload.required].sort()).toEqual(
      [
        "attempts",
        "channel",
        "delivery_id",
        "error_code",
        "idempotency_key",
        "retryable",
      ].sort(),
    );
    const event: MessageFailedV1 = {
      event_id: "6f1c1a2e-0000-4000-8000-000000000003",
      event_type: "channel.message.failed",
      event_version: "v1",
      occurred_at: "2026-08-20T12:00:02Z",
      producer: "channel-adapter",
      aggregate: { type: "channel_chat", id: "chat-123" },
      payload: {
        channel: "telegram",
        delivery_id: "8f1c1a2e-0000-4000-8000-000000000002",
        idempotency_key: "order-4711-assigned",
        attempts: 5,
        error_code: "CHANNEL_TRANSPORT_ERROR",
        retryable: true,
      },
    };
    expect(event.payload.retryable).toBe(true);
  });

  it("mini_app.launched payload proves which app a bot opens", () => {
    const payload = payloadOf(defFor("channel.mini_app.launched"));
    expect([...payload.required].sort()).toEqual(
      ["bot", "channel", "mini_app"].sort(),
    );
    expect(payload.properties.mini_app.enum).toEqual([
      "customer",
      "driver",
      "partner",
    ]);
    const event: MiniAppLaunchedV1 = {
      event_id: "6f1c1a2e-0000-4000-8000-000000000004",
      event_type: "channel.mini_app.launched",
      event_version: "v1",
      occurred_at: "2026-08-20T12:00:03Z",
      producer: "channel-adapter",
      aggregate: { type: "channel_chat", id: "chat-123" },
      payload: { channel: "telegram", bot: "driver", mini_app: "driver" },
    };
    expect(event.payload.mini_app).toBe("driver");
  });

  it("narrows a ChannelEvent union by event_type", () => {
    const events: ChannelEvent[] = [
      {
        event_id: "6f1c1a2e-0000-4000-8000-000000000005",
        event_type: "channel.update.received",
        event_version: "v1",
        occurred_at: "2026-08-20T12:00:04Z",
        producer: "channel-adapter",
        aggregate: { type: "channel_chat", id: "chat-9" },
        payload: {
          channel: "telegram",
          bot: "partner",
          channel_update_id: "42",
          kind: "text_message",
        },
      },
    ];
    for (const event of events) {
      if (event.event_type === "channel.update.received") {
        const narrowed: ChannelEventByType["channel.update.received"] = event;
        expect(narrowed.payload.bot).toBe("partner");
      }
    }
    const key: ChannelEventType = "channel.message.failed";
    expect(CHANNEL_EVENT_TYPES).toContain(key);
  });
});
