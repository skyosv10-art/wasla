import { describe, expect, it } from "vitest";
import { isVisible } from "../domain/visibility.js";
import type { ConsumedProductState } from "../domain/visibility.js";

const visible: ConsumedProductState = {
  store_state: "approved",
  publication_state: "published",
  moderation_state: "approved",
  quantity_on_hand: 5,
};

function override(overrides: Partial<ConsumedProductState>): ConsumedProductState {
  return { ...visible, ...overrides };
}

describe("visibility — rebuilt from consumed state (ADR-016 decision 3)", () => {
  it("all four conditions hold => visible", () => {
    expect(isVisible(visible)).toBe(true);
  });

  it("store not approved => hidden", () => {
    expect(isVisible(override({ store_state: "pending" }))).toBe(false);
    expect(isVisible(override({ store_state: "suspended" }))).toBe(false);
  });

  it("product not published => hidden", () => {
    expect(isVisible(override({ publication_state: "draft" }))).toBe(false);
    expect(isVisible(override({ publication_state: "archived" }))).toBe(false);
  });

  it("moderation not approved => hidden", () => {
    expect(isVisible(override({ moderation_state: "pending" }))).toBe(false);
    expect(isVisible(override({ moderation_state: "rejected" }))).toBe(false);
  });

  it("quantity zero => hidden", () => {
    expect(isVisible(override({ quantity_on_hand: 0 }))).toBe(false);
  });

  it("negative quantity => hidden", () => {
    expect(isVisible(override({ quantity_on_hand: -1 }))).toBe(false);
  });
});
