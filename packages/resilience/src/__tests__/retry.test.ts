import { describe, it, expect, vi } from "vitest";
import { withRetry, type RetryOptions } from "../retry.js";

describe("withRetry", () => {
  it("returns the result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds eventually", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      jitter: () => 0,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rejects after maxAttempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, jitter: () => 0 })
    ).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects isRetryable predicate", async () => {
    const nonRetryable = new Error("non-retryable");
    const fn = vi.fn().mockRejectedValue(nonRetryable);
    await expect(
      withRetry(fn, {
        maxAttempts: 5,
        isRetryable: (err) => err !== nonRetryable,
      })
    ).rejects.toThrow("non-retryable");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses exponential backoff with jitter", async () => {
    const delays: number[] = [];
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("ok");

    // Track setTimeout calls
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = vi.fn((fn: () => void, ms: number) => {
      delays.push(ms);
      originalSetTimeout(fn, 0);
    }) as unknown as typeof setTimeout;

    try {
      await withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 100,
        jitterRatio: 0,
        jitter: () => 0,
      });
    } finally {
      global.setTimeout = originalSetTimeout;
    }

    // First retry: baseDelay * 2^0 = 100
    expect(delays).toEqual([100]);
  });

  it("with zero jitter, backoff is deterministic", async () => {
    const delays: number[] = [];
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValueOnce("ok");

    const originalSetTimeout = global.setTimeout;
    global.setTimeout = vi.fn((fn: () => void, ms: number) => {
      delays.push(ms);
      originalSetTimeout(fn, 0);
    }) as unknown as typeof setTimeout;

    try {
      await withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 100,
        jitterRatio: 0,
        jitter: () => 0,
      });
    } finally {
      global.setTimeout = originalSetTimeout;
    }

    // First retry: 100 * 2^0 = 100
    // Second retry: 100 * 2^1 = 200
    expect(delays).toEqual([100, 200]);
  });
});
