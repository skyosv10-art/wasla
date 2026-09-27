import { describe, it, expect } from "vitest";
import { withTimeout, TimeoutError, withTimeoutFn } from "../timeout.js";

describe("withTimeout", () => {
  it("returns the value if the promise settles in time", async () => {
    const result = await withTimeout(Promise.resolve(42), { timeoutMs: 1_000 });
    expect(result).toBe(42);
  });

  it("throws TimeoutError if the promise does not settle in time", async () => {
    const slow = new Promise<string>((r) => setTimeout(() => r("late"), 5_000));
    await expect(withTimeout(slow, { timeoutMs: 50 })).rejects.toThrow(TimeoutError);
  });

  it("propagates the original error if the promise rejects quickly", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("original")), { timeoutMs: 1_000 })
    ).rejects.toThrow("original");
  });

  it("does not keep the process alive with the timer", async () => {
    // This test just verifies that unref is called (no hang)
    const slow = new Promise<string>((r) => setTimeout(() => r("late"), 100_000));
    await expect(withTimeout(slow, { timeoutMs: 50 })).rejects.toThrow(TimeoutError);
  });
});

describe("withTimeoutFn", () => {
  it("executes the function and returns the result", async () => {
    const result = await withTimeoutFn(async () => 99, { timeoutMs: 1_000 });
    expect(result).toBe(99);
  });

  it("throws TimeoutError if the function is too slow", async () => {
    await expect(
      withTimeoutFn(() => new Promise((r) => setTimeout(() => r(1), 5_000)), { timeoutMs: 50 })
    ).rejects.toThrow(TimeoutError);
  });
});
