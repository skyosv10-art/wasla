import { describe, it, expect } from "vitest";
import { canTransition, assertTransition, LIFECYCLE_TRANSITIONS, LifecycleTransitionError } from "../domain/lifecycle";

describe("lifecycle state machine", () => {
  it("allows pending → approved", () => {
    expect(canTransition("pending", "approved")).toBe(true);
  });

  it("allows approved → active", () => {
    expect(canTransition("approved", "active")).toBe(true);
  });

  it("allows active → suspended", () => {
    expect(canTransition("active", "suspended")).toBe(true);
  });

  it("allows suspended → active (reinstate)", () => {
    expect(canTransition("suspended", "active")).toBe(true);
  });

  it("allows active → offboarded", () => {
    expect(canTransition("active", "offboarded")).toBe(true);
  });

  it("allows suspended → offboarded", () => {
    expect(canTransition("suspended", "offboarded")).toBe(true);
  });

  it("allows approved → offboarded", () => {
    expect(canTransition("approved", "offboarded")).toBe(true);
  });

  it("rejects pending → active (must go through approved)", () => {
    expect(canTransition("pending", "active")).toBe(false);
  });

  it("rejects offboarded → anything (terminal state)", () => {
    for (const target of ["pending", "approved", "active", "suspended", "offboarded"] as const) {
      expect(canTransition("offboarded", target)).toBe(false);
    }
  });

  it("rejects suspended → pending (cannot go back)", () => {
    expect(canTransition("suspended", "pending")).toBe(false);
  });

  it("assertTransition throws on invalid transition", () => {
    expect(() => assertTransition("pending", "active")).toThrow(LifecycleTransitionError);
  });

  it("assertTransition passes on valid transition", () => {
    expect(() => assertTransition("approved", "active")).not.toThrow();
  });

  it("has no empty transition arrays", () => {
    for (const state of ["pending", "approved", "active", "suspended"] as const) {
      expect(LIFECYCLE_TRANSITIONS[state].length).toBeGreaterThan(0);
    }
  });
});
