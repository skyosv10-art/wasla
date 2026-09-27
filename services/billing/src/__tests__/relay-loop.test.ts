/**
 * حلقةُ المُرحِّلِ داخلَ العملية (M5-17P · CLM-0375): تُشغِّلُ الدفعاتِ تباعاً بلا تداخل،
 * وتنجو من خطأِ دفعة، و`stop()` تنتظرُ الدفعةَ الجارية.
 */

import { describe, expect, it } from "vitest";

import {
  InMemoryConsumedEventLedger,
  InMemoryEventPublisher,
  InMemoryInvoiceStore,
  InMemoryDeliveryEventSource,
  InMemoryRelayCheckpointStore,
  InMemoryRelayConsumerLock,
  InMemoryRelayTransactionRunner,
  InMemorySettlement,
  InMemoryStoreOrderSnapshotStore,
  type RelayDeps,
} from "../ports.js";
import { DEFAULT_RELAY_CONFIG, type RelayBatchResult } from "../relay.js";
import { startRelayLoop } from "../relay-loop.js";
import { createdRow, deliveredRow, orderRef } from "./delivery-events.js";

const ORDER = orderRef(1);

function deps(): RelayDeps & { settlements: InMemorySettlement } {
  const settlements = new InMemorySettlement();
  const ledger = new InMemoryConsumedEventLedger();
  return {
    events: new InMemoryDeliveryEventSource([
      createdRow(ORDER, 10000, 0, { occurredAt: "2026-09-01T00:00:00.000000Z" }),
      deliveredRow(ORDER, { occurredAt: "2026-09-01T00:00:01.000000Z" }),
    ]),
    transaction: new InMemoryRelayTransactionRunner({
      invoices: new InMemoryInvoiceStore(),
      settlements,
      publisher: new InMemoryEventPublisher(),
      ledger,
      snapshots: new InMemoryStoreOrderSnapshotStore(),
    }),
    ledger,
    settlements,
    checkpoint: new InMemoryRelayCheckpointStore(),
    lock: new InMemoryRelayConsumerLock(),
    idGen: {
      newInvoiceId: () => crypto.randomUUID(),
      newSettlementId: () => crypto.randomUUID(),
      newPayoutId: () => crypto.randomUUID(),
    },
    clock: { now: () => new Date("2026-09-27T00:00:00Z") },
  };
}

const waitFor = async (cond: () => boolean, ms = 2000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("billing relay loop (in-process)", () => {
  it("runs batches repeatedly and settles the pending event once", async () => {
    const d = deps();
    const results: RelayBatchResult[] = [];
    const loop = startRelayLoop({ deps: d, config: DEFAULT_RELAY_CONFIG, intervalMs: 5, onBatch: (r) => results.push(r) });
    await waitFor(() => results.length >= 3);
    await loop.stop();

    expect(results[0].settled).toBe(1);
    expect(results.slice(1).every((r) => r.settled === 0)).toBe(true);
    expect((await d.settlements.listSettlements({ limit: 10 })).items).toHaveLength(1);
  });

  it("a failing batch is reported and the loop keeps going", async () => {
    const d = deps();
    let calls = 0;
    const flaky: RelayDeps = {
      ...d,
      checkpoint: {
        getCheckpoint: async (id) => {
          calls++;
          if (calls === 1) throw new Error("db down");
          return d.checkpoint.getCheckpoint(id);
        },
        writeCheckpoint: (id, cp) => d.checkpoint.writeCheckpoint(id, cp),
      },
    };
    const errors: unknown[] = [];
    const results: RelayBatchResult[] = [];
    const loop = startRelayLoop({
      deps: flaky,
      config: DEFAULT_RELAY_CONFIG,
      intervalMs: 5,
      onBatch: (r) => results.push(r),
      onError: (e) => errors.push(e),
    });
    await waitFor(() => results.length >= 1);
    await loop.stop();

    expect(errors).toHaveLength(1);
    expect(results[0].settled).toBe(1);
  });

  it("stop() waits for the running batch and no batch starts afterwards", async () => {
    const d = deps();
    let started = 0;
    let release: () => void = () => undefined;
    const slow: RelayDeps = {
      ...d,
      lock: {
        withConsumerLock: async (_id, fn) => {
          started++;
          await new Promise<void>((r) => (release = r));
          return fn();
        },
      },
    };
    const loop = startRelayLoop({ deps: slow, config: DEFAULT_RELAY_CONFIG, intervalMs: 1 });
    await waitFor(() => started === 1);
    let stopped = false;
    const stopping = loop.stop().then(() => (stopped = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(stopped).toBe(false);
    release();
    await stopping;
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toBe(1);
  });
});
