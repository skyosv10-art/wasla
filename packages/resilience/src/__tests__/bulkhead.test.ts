import { describe, it, expect, vi } from "vitest";
import { createBulkhead, BulkheadFullError } from "../bulkhead.js";

describe("Bulkhead", () => {
  it("executes operations up to maxConcurrent", async () => {
    const bulkhead = createBulkhead({ maxConcurrent: 2 });
    let resolved = 0;

    const p1 = bulkhead.execute(async () => { resolved++; return 1; });
    const p2 = bulkhead.execute(async () => { resolved++; return 2; });

    await Promise.all([p1, p2]);
    expect(resolved).toBe(2);
    expect(bulkhead.stats.running).toBe(0);
  });

  it("rejects when full and no queue", async () => {
    const bulkhead = createBulkhead({ maxConcurrent: 1, maxQueue: 0 });

    // Start a slow operation
    const p1 = bulkhead.execute(() => new Promise<number>(r => setTimeout(() => r(1), 100)));

    // Second should be rejected immediately
    await expect(bulkhead.execute(async () => 2)).rejects.toThrow(BulkheadFullError);

    await p1;
  });

  it("queues when full and maxQueue > 0", async () => {
    const bulkhead = createBulkhead({ maxConcurrent: 1, maxQueue: 5 });

    const results: number[] = [];
    const p1 = bulkhead.execute(async () => { results.push(1); return 1; });
    const p2 = bulkhead.execute(async () => { results.push(2); return 2; });

    await Promise.all([p1, p2]);
    expect(results).toEqual([1, 2]);
  });

  it("reports stats correctly", async () => {
    const bulkhead = createBulkhead({ maxConcurrent: 2, maxQueue: 0 });
    expect(bulkhead.stats.available).toBe(2);
    expect(bulkhead.stats.running).toBe(0);

    const p1 = bulkhead.execute(() => new Promise<number>(r => setTimeout(() => r(1), 50)));
    const p2 = bulkhead.execute(() => new Promise<number>(r => setTimeout(() => r(2), 50)));

    // After starting both, running should be 2
    // (but we can't check mid-flight reliably without timing)
    await Promise.all([p1, p2]);
    expect(bulkhead.stats.available).toBe(2);
    expect(bulkhead.stats.running).toBe(0);
  });

  it("frees slot after operation completes", async () => {
    const bulkhead = createBulkhead({ maxConcurrent: 1 });
    await bulkhead.execute(async () => 42);
    expect(bulkhead.stats.available).toBe(1);
  });

  it("frees slot after operation fails", async () => {
    const bulkhead = createBulkhead({ maxConcurrent: 1 });
    await expect(bulkhead.execute(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(bulkhead.stats.available).toBe(1);
  });
});
