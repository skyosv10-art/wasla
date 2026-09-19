/**
 * اختباراتُ وحدةِ تصريفِ صندوقِ الصادر (ADR-042).
 *
 * اختباراتُ الحدودِ بلا قاعدةِ بيانات: التحققُ من الوسائط، والفشلُ لا يُوقفُ
 * الدفعة، والتقريرُ صادقٌ. اختباراتُ التكاملِ على PostgreSQL في خدماتِ العملاء.
 */

import { describe, expect, it } from "vitest";

import { createDirectOutboxDrainRunner, drainOutbox } from "../drain.js";
import type { EventSinkPort, OutboxRecord, OutboxDrainStore } from "../index.js";

function makeRecord(id: string): OutboxRecord {
  return {
    id,
    eventId: `event-${id}`,
    eventType: "test.event",
    eventVersion: "v1",
    aggregateType: "test",
    aggregateId: `agg-${id}`,
    payload: {},
    occurredAt: "2026-01-01T00:00:00Z",
    traceId: null,
    attempts: 0,
  };
}

/** مخزنُ ذاكرةٍ للاختبار — يُحاكي claimUnpublished/markPublished/recordDeliveryFailure. */
class InMemoryStore implements OutboxDrainStore {
  private records: OutboxRecord[] = [];
  private published = new Set<string>();
  public failures: { id: string; reason: string }[] = [];

  seed(records: OutboxRecord[]): void {
    this.records = records;
  }

  async claimUnpublished(): Promise<readonly OutboxRecord[]> {
    return this.records.filter((r) => !this.published.has(r.id));
  }

  async markPublished(id: string): Promise<boolean> {
    if (this.published.has(id)) return false;
    this.published.add(id);
    return true;
  }

  async recordDeliveryFailure(id: string, reason: string): Promise<void> {
    this.failures.push({ id, reason });
  }
}

/** مُستقبٍ يُسجّلُ ويفشلُ صفوفًا مُعيَّنة. */
class TestSink implements EventSinkPort {
  readonly delivered: OutboxRecord[] = [];
  private readonly failIds: Set<string>;

  constructor(failIds: string[] = []) {
    this.failIds = new Set(failIds);
  }

  async deliver(record: OutboxRecord): Promise<void> {
    if (this.failIds.has(record.id)) {
      throw new Error(`simulated failure for ${record.id}`);
    }
    this.delivered.push(record);
  }
}

describe("drainOutbox", () => {
  it("rejects invalid limit", async () => {
    const store = new InMemoryStore();
    const runner = createDirectOutboxDrainRunner(store);
    const sink = new TestSink();
    const clock = { now: () => "2026-01-01T00:00:00Z" };

    await expect(drainOutbox(runner, sink, { limit: 0, clock })).rejects.toThrow(RangeError);
    await expect(drainOutbox(runner, sink, { limit: -1, clock })).rejects.toThrow(RangeError);
    await expect(drainOutbox(runner, sink, { limit: 1.5, clock })).rejects.toThrow(RangeError);
  });

  it("claims, delivers, and marks published", async () => {
    const store = new InMemoryStore();
    store.seed([makeRecord("1"), makeRecord("2")]);
    const runner = createDirectOutboxDrainRunner(store);
    const sink = new TestSink();
    const clock = { now: () => "2026-01-01T00:00:00Z" };

    const report = await drainOutbox(runner, sink, { limit: 10, clock });

    expect(report.claimed).toBe(2);
    expect(report.published).toBe(2);
    expect(report.failed).toHaveLength(0);
    expect(report.alreadyPublished).toBe(0);
    expect(sink.delivered).toHaveLength(2);
  });

  it("does not stop on delivery failure", async () => {
    const store = new InMemoryStore();
    store.seed([makeRecord("1"), makeRecord("2"), makeRecord("3")]);
    const runner = createDirectOutboxDrainRunner(store);
    const sink = new TestSink(["2"]);
    const clock = { now: () => "2026-01-01T00:00:00Z" };

    const report = await drainOutbox(runner, sink, { limit: 10, clock });

    expect(report.claimed).toBe(3);
    expect(report.published).toBe(2);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].id).toBe("2");
  });

  it("records delivery failure when store supports it", async () => {
    const store = new InMemoryStore();
    store.seed([makeRecord("1")]);
    const runner = createDirectOutboxDrainRunner(store);
    const sink = new TestSink(["1"]);
    const clock = { now: () => "2026-01-01T00:00:00Z" };

    await drainOutbox(runner, sink, { limit: 10, clock });

    expect(store.failures).toHaveLength(1);
    expect(store.failures[0].id).toBe("1");
  });

  it("works without recordDeliveryFailure (G3 tables)", async () => {
    const store: OutboxDrainStore = {
      claimUnpublished: async () => [makeRecord("1")],
      markPublished: async () => true,
      // recordDeliveryFailure intentionally absent
    };
    const runner = createDirectOutboxDrainRunner(store);
    const sink = new TestSink(["1"]);
    const clock = { now: () => "2026-01-01T00:00:00Z" };

    const report = await drainOutbox(runner, sink, { limit: 10, clock });

    expect(report.published).toBe(0);
    expect(report.failed).toHaveLength(1);
    // No crash — failure captured in report only
  });

  it("detects already-published rows", async () => {
    const store = new InMemoryStore();
    store.seed([makeRecord("1")]);
    // Mark as published before drain
    await store.markPublished("1");
    const runner = createDirectOutboxDrainRunner(store);
    const sink = new TestSink();
    const clock = { now: () => "2026-01-01T00:00:00Z" };

    // claimUnpublished filters out published, so claimed=0
    const report = await drainOutbox(runner, sink, { limit: 10, clock });

    expect(report.claimed).toBe(0);
    expect(report.published).toBe(0);
  });
});
