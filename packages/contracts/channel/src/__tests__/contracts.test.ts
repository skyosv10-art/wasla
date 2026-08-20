import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  UpdateAccepted,
  OutboundMessage,
  MiniAppButton,
  DeepLinkButton,
  DeepLinkRequest,
  DeepLinkResponse,
  MiniAppLaunch,
  DeliveryAccepted,
  ChannelErrorResponse,
  BotKind,
  paths,
} from "../index.js";
import {
  BOT_KINDS,
  BOT_MINI_APP,
  IMPLEMENTED_CHANNEL,
  DEEP_LINK_MAX_PAYLOAD_LENGTH,
  WEBHOOK_SECRET_HEADER,
} from "../index.js";

/**
 * Contract First smoke tests (ADR-004) — compile-time type checks confirming
 * the generated types align with the published OpenAPI contract. They run at
 * runtime too (to exercise the vitest pipeline) but their primary value is
 * failing to compile if the contract drifts.
 *
 * Plus a few text-level guards on the OpenAPI source that protect the
 * architectural boundary set by ADR-007 (single entry, single exit,
 * channel-agnostic naming, authenticated webhook).
 */

const openapiPath = resolve(
  __dirname,
  "../../../../channel-core/contracts/api.openapi.yml",
);
const openapi = readFileSync(openapiPath, "utf8");

describe("@wasla/contracts-channel (typed contracts)", () => {
  it("accepts an update once and reports duplicates as accepted-not-error", () => {
    const first: UpdateAccepted = {
      status: "accepted",
      channel: "telegram",
      bot: "customer",
      channel_update_id: "9001",
      kind: "command",
    };
    const replay: UpdateAccepted = { ...first, status: "duplicate" };
    expect(first.status).toBe("accepted");
    expect(replay.status).toBe("duplicate");
  });

  it("models an outbound message with a Mini App button", () => {
    const button: MiniAppButton = {
      type: "mini_app",
      label: "افتح التطبيق",
      mini_app: "driver",
      path: "/orders/4711",
    };
    const message: OutboundMessage = {
      channel: "telegram",
      chat_ref: "chat-123",
      kind: "text_with_buttons",
      text: "لديك طلب جديد",
      buttons: [button],
      priority: "high",
      idempotency_key: "order-4711-assigned",
    };
    expect(message.buttons?.[0]).toEqual(button);
    // The Core declares intent only — no channel button structure here.
    expect(Object.keys(button)).not.toContain("web_app");
  });

  it("models an outbound message with a Deep Link button", () => {
    const button: DeepLinkButton = {
      type: "deep_link",
      label: "تابع طلبك",
      action: "track_order",
      params: { order: "4711" },
    };
    const message: OutboundMessage = {
      channel: "telegram",
      chat_ref: "chat-123",
      kind: "text_with_buttons",
      text: "طلبك قيد التنفيذ",
      buttons: [button],
      idempotency_key: "order-4711-in-progress",
    };
    expect(message.buttons).toHaveLength(1);
  });

  it("models the delivery acknowledgement with attempt count", () => {
    const accepted: DeliveryAccepted = {
      delivery_id: "8f1c1a2e-0000-4000-8000-000000000001",
      status: "queued",
      channel: "telegram",
      chat_ref: "chat-123",
      attempts: 0,
    };
    expect(accepted.status).toBe("queued");
  });

  it("models a Deep Link request/response pair within the channel payload limit", () => {
    const request: DeepLinkRequest = {
      action: "join_support",
      params: { ticket: "T-88" },
    };
    const response: DeepLinkResponse = {
      url: "https://t.me/wasla_customer_bot?start=am9pbl9zdXBwb3J0LlQtODg",
      payload: "am9pbl9zdXBwb3J0LlQtODg",
      bot: "customer",
      action: request.action,
    };
    expect(response.payload.length).toBeLessThanOrEqual(
      DEEP_LINK_MAX_PAYLOAD_LENGTH,
    );
  });

  it("maps each bot to exactly one Mini App (Phase 03 Exit Gate)", () => {
    expect(BOT_KINDS).toEqual(["customer", "driver", "partner"]);
    for (const bot of BOT_KINDS) {
      const launch: MiniAppLaunch = {
        bot,
        mini_app: BOT_MINI_APP[bot],
        url: `https://apps.wasla.local/${bot}`,
        label: "Mini App",
      };
      expect(launch.mini_app).toBe(bot);
    }
    const unique = new Set(BOT_KINDS.map((b: BotKind) => BOT_MINI_APP[b]));
    expect(unique.size).toBe(BOT_KINDS.length);
  });

  it("exposes the stable error envelope", () => {
    const error: ChannelErrorResponse = {
      code: "CHANNEL_UNAUTHORIZED_WEBHOOK",
      message: "secret token mismatch",
    };
    expect(error.code).toBe("CHANNEL_UNAUTHORIZED_WEBHOOK");
  });

  it("declares telegram as the only implemented channel in Phase 03", () => {
    expect(IMPLEMENTED_CHANNEL).toBe("telegram");
  });

  it("types the webhook and messages operations as declared paths", () => {
    type Webhook = paths["/channel/{bot}/webhook"]["post"];
    type Send = paths["/channel/messages"]["post"];
    type Launch = paths["/channel/{bot}/mini-app"]["get"];
    const declared: [Webhook, Send, Launch] extends [unknown, unknown, unknown]
      ? true
      : false = true;
    expect(declared).toBe(true);
  });
});

describe("channel OpenAPI source — ADR-007 boundary guards", () => {
  it("declares exactly one inbound entry point and one outbound exit point", () => {
    expect(openapi).toContain("/channel/{bot}/webhook:");
    expect(openapi).toContain("/channel/messages:");
    // No per-bot send endpoint may exist — a single exit keeps the Core out of
    // channel details (Notification Service → Channel Router → Adapter).
    expect(openapi).not.toMatch(/\/channel\/\{bot\}\/(send|messages):/);
  });

  it("requires the webhook secret token header", () => {
    expect(openapi).toContain("X-Telegram-Bot-Api-Secret-Token");
    expect(WEBHOOK_SECRET_HEADER).toBe("x-telegram-bot-api-secret-token");
  });

  it("keeps schema field names channel-agnostic", () => {
    // "telegram" may appear as an enum value or in the secret header name only,
    // never as part of a schema property name (e.g. telegram_chat_id).
    expect(openapi).not.toMatch(/^\s{4,}telegram_[a-z_]+:/m);
    expect(openapi).toContain("chat_ref:");
  });

  it("reserves future channels in the contract without implementing them", () => {
    expect(openapi).toContain("enum: [telegram, web, mobile, whatsapp]");
  });
});
