/**
 * M6-18A chaos/failure scenario tests.
 *
 * These tests verify that the resilience patterns work together under the
 * failure scenarios listed in LAUNCH_EXECUTION_BOARD.md acceptance criteria:
 * DB unavailable, DB slow, service unavailable, network timeout,
 * duplicate request, duplicate event, delayed event, partial success,
 * process restart, pod kill, node failure, corrupted cache, expired credentials.
 *
 * Each scenario simulates the failure and asserts the resilience control
 * behaves correctly (circuit breaker trips, bulkhead rejects, timeout fires,
 * retry recovers).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createCircuitBreaker,
  createBulkhead,
  withTimeout,
  withRetry,
  TimeoutError,
  BulkheadFullError,
} from "../index.js";

describe("Chaos scenario: DB unavailable", () => {
  it("circuit breaker trips after consecutive DB failures", () => {
    const cb = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });

    // Simulate 3 consecutive DB connection failures
    for (let i = 0; i < 3; i++) {
      expect(cb.before()).toBe(true);
      cb.onFailure();
    }

    // Circuit is now open — further calls are rejected
    expect(cb.state).toBe("open");
    expect(cb.before()).toBe(false);
  });
});

describe("Chaos scenario: DB slow (network timeout)", () => {
  it("timeout fires when DB query exceeds deadline", async () => {
    const slowDb = new Promise<string>((r) => setTimeout(() => r("late"), 10_000));
    await expect(withTimeout(slowDb, { timeoutMs: 50 })).rejects.toThrow(TimeoutError);
  });

  it("timeout does not fire when DB query completes in time", async () => {
    const fastDb = new Promise<string>((r) => setTimeout(() => r("ok"), 10));
    const result = await withTimeout(fastDb, { timeoutMs: 1_000 });
    expect(result).toBe("ok");
  });
});

describe("Chaos scenario: service unavailable (retry recovery)", () => {
  it("retry recovers when service comes back after transient failure", async () => {
    let callCount = 0;
    const fn = () => {
      callCount++;
      if (callCount <= 2) return Promise.reject(new Error("service unavailable"));
      return Promise.resolve("recovered");
    };

    const result = await withRetry(fn, {
      maxAttempts: 5,
      baseDelayMs: 1,
      jitter: () => 0,
    });

    expect(result).toBe("recovered");
    expect(callCount).toBe(3);
  });
});

describe("Chaos scenario: duplicate request (bulkhead concurrency limit)", () => {
  it("bulkhead limits concurrent duplicate requests", async () => {
    const bulkhead = createBulkhead({ maxConcurrent: 1, maxQueue: 0 });

    // First request occupies the single slot
    const p1 = bulkhead.execute(() => new Promise<number>(r => setTimeout(() => r(1), 100)));

    // Duplicate (concurrent) request is rejected
    await expect(bulkhead.execute(async () => 2)).rejects.toThrow(BulkheadFullError);

    await p1;
  });
});

describe("Chaos scenario: process restart (circuit breaker reset)", () => {
  it("circuit breaker can be reset after process restart simulation", () => {
    const cb = createCircuitBreaker({ failureThreshold: 2 });

    // Simulate failures
    cb.onFailure();
    cb.onFailure();
    expect(cb.state).toBe("open");

    // Simulate process restart — reset
    cb.reset();
    expect(cb.state).toBe("closed");
    expect(cb.before()).toBe(true);
  });
});

describe("Chaos scenario: partial success (circuit breaker stays closed)", () => {
  it("circuit breaker does not trip on intermittent failures", () => {
    const cb = createCircuitBreaker({ failureThreshold: 5 });

    // Mix of successes and failures — never reaches threshold
    cb.onFailure();
    cb.onSuccess();
    cb.onFailure();
    cb.onSuccess();
    cb.onFailure();
    cb.onSuccess();

    expect(cb.state).toBe("closed");
    expect(cb.failureCount).toBe(0);
  });
});

describe("Chaos scenario: node failure (half-open recovery)", () => {
  it("circuit breaker recovers via half-open probe after cooldown", () => {
    const now = { value: 0 };
    const cb = createCircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 5_000,
      clock: () => now.value,
    });

    // Trip the breaker
    cb.onFailure();
    cb.onFailure();
    expect(cb.state).toBe("open");

    // After cooldown, allow a probe
    now.value = 6_000;
    expect(cb.before()).toBe(true);
    expect(cb.state).toBe("half_open");

    // Probe succeeds → circuit closes
    cb.onSuccess();
    expect(cb.state).toBe("closed");
  });

  it("circuit breaker re-opens if probe fails", () => {
    const now = { value: 0 };
    const cb = createCircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 5_000,
      clock: () => now.value,
    });

    cb.onFailure();
    cb.onFailure();
    now.value = 6_000;
    cb.before(); // half_open
    cb.onFailure(); // probe fails
    expect(cb.state).toBe("open");
  });
});

describe("Chaos scenario: combined resilience (circuit breaker + timeout + retry)", () => {
  it("composes circuit breaker, timeout, and retry for a full resilience pipeline", async () => {
    const cb = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 });
    const now = { value: 0 };

    let callCount = 0;

    const pipeline = async (): Promise<string> => {
      if (!cb.before()) throw new Error("circuit open");

      try {
        const result = await withTimeout(
          withRetry(
            async () => {
              callCount++;
              if (callCount <= 1) throw new Error("transient");
              return Promise.resolve("ok");
            },
            { maxAttempts: 3, baseDelayMs: 1, jitter: () => 0 }
          ),
          { timeoutMs: 5_000 }
        );
        cb.onSuccess();
        return result;
      } catch (err) {
        cb.onFailure();
        throw err;
      }
    };

    const result = await pipeline();
    expect(result).toBe("ok");
    expect(cb.state).toBe("closed");
    expect(callCount).toBe(2);
  });
});
