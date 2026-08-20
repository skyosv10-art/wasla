import { describe, it, expect } from "vitest";

import {
  formatWaslaPublicId,
  isValidWaslaPublicId,
  WASLA_PUBLIC_ID_PATTERN,
} from "../index.js";

describe("Wasla Public ID (contract: ^WS-[0-9]{10}$)", () => {
  it("formats a sequence number as WS- + 10 zero-padded digits", () => {
    expect(formatWaslaPublicId(1)).toBe("WS-0000000001");
    expect(formatWaslaPublicId(10427)).toBe("WS-0000010427");
    expect(formatWaslaPublicId(9_999_999_999)).toBe("WS-9999999999");
  });

  it("rejects out-of-range sequence numbers", () => {
    expect(() => formatWaslaPublicId(0)).toThrow(RangeError);
    expect(() => formatWaslaPublicId(10_000_000_000)).toThrow(RangeError);
    expect(() => formatWaslaPublicId(1.5)).toThrow(RangeError);
  });

  it("validates the contract pattern", () => {
    expect(isValidWaslaPublicId("WS-0000010427")).toBe(true);
    expect(isValidWaslaPublicId("WS-0000000001")).toBe(true);
    expect(isValidWaslaPublicId("WS-12345")).toBe(false); // too short
    expect(isValidWaslaPublicId("WS-000000000X")).toBe(false); // non-digit
    expect(isValidWaslaPublicId("ws-0000010427")).toBe(false); // case
    expect(isValidWaslaPublicId("0000010427")).toBe(false); // missing prefix
    expect(isValidWaslaPublicId(null)).toBe(false);
  });

  it("exposes the canonical pattern", () => {
    expect(WASLA_PUBLIC_ID_PATTERN.test("WS-0000010427")).toBe(true);
  });
});
