/**
 * Webhook authentication tests.
 *
 * This is the whole perimeter of the inbound side: if it can be bypassed, anyone
 * can forge an update from any user. The cases therefore include the boring
 * mistakes that actually happen — a missing environment variable, a header cased
 * differently by a proxy, a value that merely starts with the secret.
 */

import { describe, expect, it } from "vitest";

import { ChannelError } from "@wasla/channel-core";

import { WEBHOOK_SECRET_HEADER, assertWebhookSecret } from "../webhook-auth.js";

const SECRET = "s".repeat(24);

function expectUnauthorized(headers: Record<string, string | string[] | undefined>, expected?: string): void {
  try {
    assertWebhookSecret(headers, expected);
  } catch (error) {
    expect(error).toBeInstanceOf(ChannelError);
    const channelError = error as ChannelError;
    expect(channelError.code).toBe("CHANNEL_UNAUTHORIZED_WEBHOOK");
    expect(channelError.status).toBe(401);
    // No details: the response must not tell a prober which check failed.
    expect(channelError.details).toBeUndefined();
    return;
  }
  throw new Error("expected the request to be rejected");
}

describe("assertWebhookSecret", () => {
  it("accepts a matching secret", () => {
    expect(() => assertWebhookSecret({ [WEBHOOK_SECRET_HEADER]: SECRET }, SECRET)).not.toThrow();
  });

  it("accepts the header whatever casing the proxy used", () => {
    expect(() =>
      assertWebhookSecret({ "X-Telegram-Bot-Api-Secret-Token": SECRET } as Record<string, string>, SECRET),
    ).not.toThrow();
  });

  it("accepts a header delivered as a single-value array", () => {
    expect(() => assertWebhookSecret({ [WEBHOOK_SECRET_HEADER]: [SECRET] }, SECRET)).not.toThrow();
  });

  it("rejects a missing header", () => {
    expectUnauthorized({}, SECRET);
  });

  it("rejects a wrong secret", () => {
    expectUnauthorized({ [WEBHOOK_SECRET_HEADER]: "w".repeat(24) }, SECRET);
  });

  it("rejects a value that only shares a prefix", () => {
    expectUnauthorized({ [WEBHOOK_SECRET_HEADER]: `${SECRET}extra` }, SECRET);
    expectUnauthorized({ [WEBHOOK_SECRET_HEADER]: SECRET.slice(0, 20) }, SECRET);
  });

  it("rejects everything when no secret is configured", () => {
    // A deployment that forgot the variable must stop accepting updates rather
    // than accept them all.
    expectUnauthorized({ [WEBHOOK_SECRET_HEADER]: SECRET }, undefined);
    expectUnauthorized({ [WEBHOOK_SECRET_HEADER]: "" }, "");
  });

  it("rejects a configured secret that is too short to be a secret", () => {
    expectUnauthorized({ [WEBHOOK_SECRET_HEADER]: "short" }, "short");
  });
});
