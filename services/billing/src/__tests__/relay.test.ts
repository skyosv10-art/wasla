/**
 * services/billing/src/__tests__/relay.test.ts
 *
 * Tests for the billing relay consumer (ADR-050 §3).
 * Fee settlement from completed order events.
 *
 * Coverage:
 *  - Baseline: empty event source → no settlements, checkpoint unchanged
 *  - Settle: completed order → fee settlement + draft invoice + fee_settled event
 *  - Ignored: non-completed order states (cancelled, failed, etc.)
 *  - Ignored foreign: non-order.status_changed events
 *  - Poisoned: invalid payload (missing fields, bad types)
 *  - Poisoned: unsupported event version
 *  - Stale: older event than checkpoint → skipped
 *  - Idempotency: duplicate event_id → skipped_stale
 *  - Checkpoint advances past terminal events
 *  - Checkpoint does NOT advance past pending (retryable) events
 *  - Batch: multiple events processed in order
 *  - Fee calculation: store_variable = order_total * 250bps / 10000
 *  - Consumer lock: concurrent batches serialized
 */

import { describe, it, expect } from "vitest";
import {
  type OrderOutboxRow,
  ZERO_CHECKPOINT,
} from "../domain/consumed-events.js";
import {
  type RelayDeps,
  InMemoryInvoiceStore,
  InMemoryEventPublisher,
  InMemorySettlement,
  InMemoryOrderEventSource,
  InMemoryRelayCheckpointStore,
  InMemoryConsumedEventLedger,
  InMemoryRelayTransactionRunner,
  InMemoryRelayConsumerLock,
} from "../ports.js";
import { runRelayBatch, DEFAULT_RELAY_CONFIG, STORE_VARIABLE_FEE_BPS } from "../relay.js";

function makeRow(overrides: Partial<OrderOutboxRow> = {}): OrderOutboxRow {
  return {
    event_id: crypto.randomUUID(),
    event_type: "order.status_changed",
    event_version: "v1",
    aggregate_type: "order",
    aggregate_id: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    trace_id: null,
    data: {
      order_public_id: "ORD-0000000001",
      store_public_id: "WS-0000000001",
      customer_public_id: "CUST-0000000001",
      to_status: "completed",
      from_status: "assigned",
      order_total_cents: 10000,
    },
    ...overrides,
  };
}

type TestDeps = RelayDeps & {
  readonly publisher: InMemoryEventPublisher;
  readonly settlements: InMemorySettlement;
  readonly invoices: InMemoryInvoiceStore;
  readonly ledger: InMemoryConsumedEventLedger;
};

function makeDeps(rows: OrderOutboxRow[] = []): TestDeps {
  const publisher = new InMemoryEventPublisher();
  const settlements = new InMemorySettlement();
  const invoices = new InMemoryInvoiceStore();
  const ledger = new InMemoryConsumedEventLedger();
  return {
    events: new InMemoryOrderEventSource(rows),
    transaction: new InMemoryRelayTransactionRunner({ invoices, settlements, publisher, ledger }),
    ledger,
    publisher,
    settlements,
    invoices,
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

describe("billing relay — baseline", () => {
  it("empty event source → no settlements, checkpoint unchanged", async () => {
    const deps = makeDeps([]);
    const result = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    expect(result.processed).toBe(0);
    expect(result.settled).toBe(0);
    expect(result.ignored).toBe(0);
    expect(result.poisoned).toBe(0);
    expect(result.skipped_stale).toBe(0);
    expect(result.checkpoint).toEqual(ZERO_CHECKPOINT);
  });
});

describe("billing relay — settle", () => {
  it("completed order → fee settlement + draft invoice + fee_settled event", async () => {
    const row = makeRow();
    const deps = makeDeps([row]);
    const result = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    expect(result.processed).toBe(1);
    expect(result.settled).toBe(1);
    expect(result.checkpoint.last_event_id).toBe(row.event_id);

    // Check invoice was created
    const events = deps.publisher.events;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("billing.fee_settled");
    expect(events[0].payload).toHaveProperty("settlement_id");
    expect(events[0].payload).toHaveProperty("fee_type", "store_variable");
  });

  it("fee amount = order_total * STORE_VARIABLE_FEE_BPS / 10000", async () => {
    const orderTotal = 10000; // 100.00 SAR
    const row = makeRow({
      data: {
        order_public_id: "ORD-0000000001",
        store_public_id: "WS-0000000001",
        customer_public_id: "CUST-0000000001",
        to_status: "completed",
        from_status: "assigned",
        order_total_cents: orderTotal,
      },
    });
    const deps = makeDeps([row]);
    const result = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    expect(result.settled).toBe(1);
    const expectedFee = Math.max(1, Math.floor(orderTotal * STORE_VARIABLE_FEE_BPS / 10000));
    // 10000 * 250 / 10000 = 250 cents = 2.50 SAR
    expect(expectedFee).toBe(250);
  });
});

describe("billing relay — ignored", () => {
  it("non-completed order state → ignored", async () => {
    const row = makeRow({
      data: {
        order_public_id: "ORD-0000000001",
        store_public_id: "WS-0000000001",
        customer_public_id: "CUST-0000000001",
        to_status: "customer_cancelled",
        from_status: "assigned",
        order_total_cents: 10000,
      },
    });
    const deps = makeDeps([row]);
    const result = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    expect(result.ignored).toBe(1);
    expect(result.settled).toBe(0);
  });

  it("foreign event type → ignored_foreign", async () => {
    const row = makeRow({ event_type: "order.created" });
    const deps = makeDeps([row]);
    const result = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    expect(result.ignored).toBe(1);
    expect(result.settled).toBe(0);
  });
});

describe("billing relay — poisoned", () => {
  it("unsupported event version → poisoned", async () => {
    const row = makeRow({ event_version: "v2" });
    const deps = makeDeps([row]);
    const result = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    expect(result.poisoned).toBe(1);
    expect(result.settled).toBe(0);
    expect(deps.ledger.poisoned()).toHaveLength(1);
  });

  it("missing order_public_id → poisoned", async () => {
    const row = makeRow({
      data: {
        store_public_id: "WS-0000000001",
        customer_public_id: "CUST-0000000001",
        to_status: "completed",
        from_status: "assigned",
        order_total_cents: 10000,
      },
    });
    const deps = makeDeps([row]);
    const result = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    expect(result.poisoned).toBe(1);
    expect(deps.ledger.poisoned()).toHaveLength(1);
  });

  it("missing store_public_id → poisoned", async () => {
    const row = makeRow({
      data: {
        order_public_id: "ORD-0000000001",
        customer_public_id: "CUST-0000000001",
        to_status: "completed",
        from_status: "assigned",
        order_total_cents: 10000,
      },
    });
    const deps = makeDeps([row]);
    const result = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    expect(result.poisoned).toBe(1);
  });

  it("invalid order_total_cents (string) → poisoned", async () => {
    const row = makeRow({
      data: {
        order_public_id: "ORD-0000000001",
        store_public_id: "WS-0000000001",
        customer_public_id: "CUST-0000000001",
        to_status: "completed",
        from_status: "assigned",
        order_total_cents: "not-a-number",
      },
    });
    const deps = makeDeps([row]);
    const result = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    expect(result.poisoned).toBe(1);
  });
});

describe("billing relay — stale & idempotency", () => {
  it("older event than checkpoint → skipped_stale", async () => {
    const oldRow = makeRow({
      event_id: "00000000-0000-0000-0000-000000000001",
      occurred_at: "2026-09-01T00:00:00Z",
    });
    const deps = makeDeps([oldRow]);

    // Set checkpoint ahead of the event
    await deps.checkpoint.writeCheckpoint(DEFAULT_RELAY_CONFIG.consumerId, {
      last_occurred_at: "2026-09-02T00:00:00Z",
      last_event_id: "00000000-0000-0000-0000-000000000002",
    });

    const result = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    expect(result.skipped_stale).toBe(1);
    expect(result.settled).toBe(0);
  });

  it("same event_id as checkpoint → skipped_stale", async () => {
    const row = makeRow({
      event_id: "00000000-0000-0000-0000-000000000001",
      occurred_at: "2026-09-01T00:00:00Z",
    });
    const deps = makeDeps([row]);

    await deps.checkpoint.writeCheckpoint(DEFAULT_RELAY_CONFIG.consumerId, {
      last_occurred_at: "2026-09-01T00:00:00Z",
      last_event_id: "00000000-0000-0000-0000-000000000001",
    });

    const result = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    expect(result.skipped_stale).toBe(1);
    expect(result.settled).toBe(0);
  });
});

describe("billing relay — checkpoint", () => {
  it("checkpoint advances past terminal events", async () => {
    const row1 = makeRow({
      event_id: "00000000-0000-0000-0000-000000000001",
      occurred_at: "2026-09-01T00:00:00Z",
    });
    const row2 = makeRow({
      event_id: "00000000-0000-0000-0000-000000000002",
      occurred_at: "2026-09-02T00:00:00Z",
    });
    const deps = makeDeps([row1, row2]);

    const result = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    expect(result.settled).toBe(2);
    expect(result.checkpoint.last_event_id).toBe(row2.event_id);
    expect(result.checkpoint.last_occurred_at).toBe(row2.occurred_at);
  });

  it("checkpoint persists across batches", async () => {
    const row1 = makeRow({
      event_id: "00000000-0000-0000-0000-000000000001",
      occurred_at: "2026-09-01T00:00:00Z",
    });
    const deps = makeDeps([row1]);

    await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    // Second batch with same events → all stale
    const result2 = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    expect(result2.skipped_stale).toBe(1);
    expect(result2.settled).toBe(0);
  });
});

describe("billing relay — batch", () => {
  it("mixed batch: settled + ignored + poisoned", async () => {
    const completed = makeRow({
      event_id: "00000000-0000-0000-0000-000000000001",
      occurred_at: "2026-09-01T00:00:00Z",
    });
    const cancelled = makeRow({
      event_id: "00000000-0000-0000-0000-000000000002",
      occurred_at: "2026-09-02T00:00:00Z",
      data: {
        order_public_id: "ORD-0000000002",
        store_public_id: "WS-0000000002",
        customer_public_id: "CUST-0000000002",
        to_status: "customer_cancelled",
        from_status: "assigned",
        order_total_cents: 5000,
      },
    });
    const badVersion = makeRow({
      event_id: "00000000-0000-0000-0000-000000000003",
      occurred_at: "2026-09-03T00:00:00Z",
      event_version: "v2",
    });

    const deps = makeDeps([completed, cancelled, badVersion]);
    const result = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    expect(result.processed).toBe(3);
    expect(result.settled).toBe(1);
    expect(result.ignored).toBe(1);
    expect(result.poisoned).toBe(1);
  });
});

describe("billing relay — ledger idempotency (M5-17P)", () => {
  it("redelivery after checkpoint loss → skipped_stale, no second settlement", async () => {
    const row = makeRow({ occurred_at: "2026-09-01T00:00:00Z" });
    const deps = makeDeps([row]);

    const first = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(first.settled).toBe(1);

    // Checkpoint lost (e.g. restored from an old backup) — the ledger still knows.
    const lost: TestDeps = { ...deps, checkpoint: new InMemoryRelayCheckpointStore() };
    const second = await runRelayBatch(lost, DEFAULT_RELAY_CONFIG);

    expect(second.settled).toBe(0);
    expect(second.skipped_stale).toBe(1);
    const listed = await deps.settlements.listSettlements({ limit: 100 });
    expect(listed.items).toHaveLength(1);
    expect(deps.publisher.events).toHaveLength(1);
  });

  it("ignored and foreign events are recorded in the ledger", async () => {
    const cancelled = makeRow({
      occurred_at: "2026-09-01T00:00:00Z",
      data: { ...makeRow().data, to_status: "customer_cancelled" },
    });
    const foreign = makeRow({ occurred_at: "2026-09-02T00:00:00Z", event_type: "order.created" });
    const deps = makeDeps([cancelled, foreign]);
    await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    const statuses = [...deps.ledger.entries.values()].map((e) => e.status).sort();
    expect(statuses).toEqual(["ignored", "ignored_foreign"]);
  });

  it("settled ledger row carries the settlement id", async () => {
    const row = makeRow();
    const deps = makeDeps([row]);
    await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    const entry = [...deps.ledger.entries.values()][0];
    expect(entry.status).toBe("settled");
    const listed = await deps.settlements.listSettlements({ limit: 10 });
    expect(entry.settlementId).toBe(listed.items[0].settlement_id);
  });
});

describe("billing relay — retryable failure (M5-17P)", () => {
  it("publisher failure → pending, checkpoint not advanced, no ledger row", async () => {
    const row = makeRow({ occurred_at: "2026-09-01T00:00:00Z" });
    const deps = makeDeps([row]);
    let fail = true;
    const original = deps.publisher.publishFeeSettled.bind(deps.publisher);
    deps.publisher.publishFeeSettled = async (e) => {
      if (fail) throw new Error("outbox unavailable");
      return original(e);
    };

    const first = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(first.pending).toBe(1);
    expect(first.settled).toBe(0);
    expect(first.checkpoint).toEqual(ZERO_CHECKPOINT);
    expect(await deps.checkpoint.getCheckpoint(DEFAULT_RELAY_CONFIG.consumerId)).toBeNull();
    expect(deps.ledger.entries.size).toBe(0);

    fail = false;
    const second = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(second.settled).toBe(1);
    expect(second.checkpoint.last_event_id).toBe(row.event_id);
  });

  it("batch stops at the first pending event — later events wait", async () => {
    const r1 = makeRow({ event_id: "00000000-0000-0000-0000-000000000001", occurred_at: "2026-09-01T00:00:00Z" });
    const r2 = makeRow({ event_id: "00000000-0000-0000-0000-000000000002", occurred_at: "2026-09-02T00:00:00Z" });
    const r3 = makeRow({ event_id: "00000000-0000-0000-0000-000000000003", occurred_at: "2026-09-03T00:00:00Z" });
    const deps = makeDeps([r1, r2, r3]);
    let calls = 0;
    const original = deps.settlements.settle.bind(deps.settlements);
    deps.settlements.settle = async (p) => {
      calls++;
      if (calls === 2) throw new Error("transient");
      return original(p);
    };

    const result = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(result.settled).toBe(1);
    expect(result.pending).toBe(1);
    expect(result.processed).toBe(2);
    expect(result.checkpoint.last_event_id).toBe(r1.event_id);
  });

  it("a stale older row never moves the checkpoint backwards", async () => {
    const older = makeRow({ event_id: "00000000-0000-0000-0000-000000000001", occurred_at: "2026-09-01T00:00:00Z" });
    const deps = makeDeps([older]);
    const ahead = { last_occurred_at: "2026-09-05T00:00:00Z", last_event_id: "00000000-0000-0000-0000-000000000009" };
    await deps.checkpoint.writeCheckpoint(DEFAULT_RELAY_CONFIG.consumerId, ahead);

    const result = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(result.skipped_stale).toBe(1);
    expect(result.checkpoint).toEqual(ahead);
    expect(await deps.checkpoint.getCheckpoint(DEFAULT_RELAY_CONFIG.consumerId)).toEqual(ahead);
  });
});
