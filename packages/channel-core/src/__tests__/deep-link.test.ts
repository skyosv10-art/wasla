import { describe, expect, it } from "vitest";

import { DEEP_LINK_MAX_PAYLOAD_LENGTH } from "@wasla/contracts-channel";

import { decodeDeepLinkPayload, encodeDeepLinkPayload } from "../domain/deep-link.js";
import { isChannelError } from "../domain/errors.js";

/** Assert on the stable error code, never on the (translatable) message. */
function expectCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(isChannelError(error)).toBe(true);
    expect(error).toMatchObject({ code });
    return;
  }
  expect.unreachable(`expected ${code}`);
}

describe("deep link payloads", () => {
  it("round-trips an action with parameters", () => {
    const payload = encodeDeepLinkPayload("track_order", { order: "ORD-42", ref: "sms" });

    expect(decodeDeepLinkPayload(payload)).toEqual({
      action: "track_order",
      params: { order: "ORD-42", ref: "sms" },
    });
  });

  it("round-trips an action without parameters", () => {
    const payload = encodeDeepLinkPayload("open_app", {});

    expect(decodeDeepLinkPayload(payload)).toEqual({ action: "open_app", params: {} });
  });

  it("stays inside the contract length budget", () => {
    const payload = encodeDeepLinkPayload("verify_partner", { partner: "PRT-000123" });

    expect(payload.length).toBeLessThanOrEqual(DEEP_LINK_MAX_PAYLOAD_LENGTH);
  });

  it("survives values that need escaping", () => {
    const payload = encodeDeepLinkPayload("join_support", { q: "a&b=c" });

    expect(decodeDeepLinkPayload(payload).params.q).toBe("a&b=c");
  });

  it("refuses a payload that would exceed the contract length", () => {
    expectCode(
      () => encodeDeepLinkPayload("track_order", { order: "X".repeat(80) }),
      "CHANNEL_DEEP_LINK_TOO_LONG",
    );
  });

  it("rejects an unknown action on decode", () => {
    const forged = Buffer.from("teleport?x=1", "utf8").toString("base64url");

    expectCode(() => decodeDeepLinkPayload(forged), "CHANNEL_INVALID_DEEP_LINK");
  });

  it("rejects a payload that is not valid base64url", () => {
    expectCode(() => decodeDeepLinkPayload("!!!not-base64!!!"), "CHANNEL_INVALID_DEEP_LINK");
  });

  it("rejects too many parameters", () => {
    expectCode(
      () => encodeDeepLinkPayload("open_app", { a: "1", b: "2", c: "3", d: "4", e: "5" }),
      "CHANNEL_INVALID_DEEP_LINK",
    );
  });
});
