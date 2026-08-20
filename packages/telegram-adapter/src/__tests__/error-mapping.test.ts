/**
 * Error-mapping tests.
 *
 * The point of every case is a *consequence*: whether the core will retry. A
 * mapping mistake is either a message lost forever or a loop hammering Telegram,
 * so retryability is asserted against the shared catalogue rather than restated
 * here as a literal.
 */

import { describe, expect, it } from "vitest";

import { CHANNEL_ERRORS } from "@wasla/contracts-channel";

import { mapTelegramFailure } from "../error-mapping.js";

function retryable(code: string): boolean {
  return CHANNEL_ERRORS[code as keyof typeof CHANNEL_ERRORS].retryable;
}

describe("mapTelegramFailure · transient failures are retried", () => {
  it("maps a transport failure with no response", () => {
    const mapped = mapTelegramFailure({ transportFailed: true });
    expect(mapped.errorCode).toBe("CHANNEL_TRANSPORT_ERROR");
    expect(retryable(mapped.errorCode)).toBe(true);
  });

  it("maps every 5xx to a retryable transport error", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(mapTelegramFailure({ status }).errorCode).toBe("CHANNEL_TRANSPORT_ERROR");
    }
  });

  it("maps 429 and carries the cooldown Telegram asked for", () => {
    const mapped = mapTelegramFailure({ status: 429, description: "Too Many Requests", retryAfterSeconds: 37 });
    expect(mapped.errorCode).toBe("CHANNEL_RATE_LIMITED");
    expect(mapped.retryAfterSeconds).toBe(37);
    expect(retryable(mapped.errorCode)).toBe(true);
  });

  it("still maps 429 when no cooldown is supplied", () => {
    const mapped = mapTelegramFailure({ status: 429 });
    expect(mapped.errorCode).toBe("CHANNEL_RATE_LIMITED");
    expect(mapped.retryAfterSeconds).toBeUndefined();
  });
});

describe("mapTelegramFailure · permanent failures are not retried", () => {
  it("treats a blocked or deactivated user as an unreachable chat", () => {
    for (const description of [
      "Forbidden: bot was blocked by the user",
      "Forbidden: user is deactivated",
      "Bad Request: chat not found",
      "Forbidden: bot was kicked from the supergroup chat",
    ]) {
      const mapped = mapTelegramFailure({ status: description.startsWith("Forbidden") ? 403 : 400, description });
      expect(mapped.errorCode).toBe("CHANNEL_CHAT_UNREACHABLE");
      expect(retryable(mapped.errorCode)).toBe(false);
    }
  });

  it("classifies a rejected payload as an invalid message, not as a chat problem", () => {
    for (const description of [
      "Bad Request: message text is empty",
      "Bad Request: BUTTON_URL_INVALID",
      "Bad Request: WEB_APP_URL_INVALID",
    ]) {
      expect(mapTelegramFailure({ status: 400, description }).errorCode).toBe("CHANNEL_INVALID_MESSAGE");
    }
  });

  it("treats a bad token or unknown method as our own misconfiguration", () => {
    // Retrying a wrong token forever would look like an outage while it is a
    // deployment defect, so these stay non-retryable and loud.
    expect(mapTelegramFailure({ status: 401, description: "Unauthorized" }).errorCode).toBe(
      "CHANNEL_INTERNAL_ERROR",
    );
    expect(mapTelegramFailure({ status: 404, description: "Not Found" }).errorCode).toBe(
      "CHANNEL_INTERNAL_ERROR",
    );
    expect(retryable("CHANNEL_INTERNAL_ERROR")).toBe(false);
  });

  it("falls back on the status when the description is unknown", () => {
    expect(mapTelegramFailure({ status: 400, description: "Bad Request: something new" }).errorCode).toBe(
      "CHANNEL_INVALID_MESSAGE",
    );
    expect(mapTelegramFailure({ status: 403, description: "Forbidden: something new" }).errorCode).toBe(
      "CHANNEL_CHAT_UNREACHABLE",
    );
    expect(mapTelegramFailure({ status: 409, description: "Conflict" }).errorCode).toBe(
      "CHANNEL_INTERNAL_ERROR",
    );
  });

  it("recognises an unreachable chat reported with a 403 description on any status", () => {
    expect(
      mapTelegramFailure({ status: 400, description: "Forbidden: bot can't initiate conversation with a user" })
        .errorCode,
    ).toBe("CHANNEL_CHAT_UNREACHABLE");
  });

  it("returns only a code and an optional cooldown, never channel text", () => {
    const mapped = mapTelegramFailure({ status: 400, description: "Bad Request: chat not found" });
    expect(Object.keys(mapped)).toEqual(["errorCode"]);
  });
});
