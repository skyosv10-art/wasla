import { describe, it, expect, vi } from "vitest";
import { createCircuitBreaker } from "../circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("starts in closed state and allows calls", () => {
    const cb = createCircuitBreaker();
    expect(cb.state).toBe("closed");
    expect(cb.before()).toBe(true);
  });

  it("trips to open after failure threshold", () => {
    const cb = createCircuitBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      expect(cb.before()).toBe(true);
      cb.onFailure();
    }
    expect(cb.state).toBe("open");
    expect(cb.before()).toBe(false);
  });

  it("resets failure count on success while closed", () => {
    const cb = createCircuitBreaker({ failureThreshold: 3 });
    cb.onFailure();
    cb.onFailure();
    cb.onSuccess();
    expect(cb.failureCount).toBe(0);
  });

  it("transitions to half-open after cooldown", () => {
    const now = { value: 1000 };
    const cb = createCircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 5_000,
      clock: () => now.value,
    });
    cb.onFailure();
    cb.onFailure();
    expect(cb.state).toBe("open");

    // Still open before cooldown
    expect(cb.before()).toBe(false);

    // After cooldown, should transition to half_open
    now.value = 7_000;
    expect(cb.before()).toBe(true);
    expect(cb.state).toBe("half_open");
  });

  it("closes on success in half-open state", () => {
    const now = { value: 1000 };
    const cb = createCircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 5_000,
      clock: () => now.value,
    });
    cb.onFailure();
    cb.onFailure();
    now.value = 7_000;
    cb.before(); // transitions to half_open
    cb.onSuccess();
    expect(cb.state).toBe("closed");
    expect(cb.failureCount).toBe(0);
  });

  it("reopens on failure in half-open state", () => {
    const now = { value: 1000 };
    const cb = createCircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 5_000,
      clock: () => now.value,
    });
    cb.onFailure();
    cb.onFailure();
    now.value = 7_000;
    cb.before(); // transitions to half_open
    cb.onFailure();
    expect(cb.state).toBe("open");
  });

  it("can be manually reset", () => {
    const cb = createCircuitBreaker({ failureThreshold: 1 });
    cb.onFailure();
    expect(cb.state).toBe("open");
    cb.reset();
    expect(cb.state).toBe("closed");
    expect(cb.failureCount).toBe(0);
  });
});
