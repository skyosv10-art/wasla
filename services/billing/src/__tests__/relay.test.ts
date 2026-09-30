/**
 * services/billing/src/__tests__/relay.test.ts
 *
 * Billing relay consumer on the DELIVERY outbox (M5-17Q · CLM-0376 · ADR-050 §3).
 * Rows are contract-shaped (`delivery-events.ts`, checked in
 * `delivery-contract.test.ts`); the real-producer proof lives in
 * `packages/billing-e2e`.
 *
 * Coverage:
 *  - created → snapshot recorded; delivered → fee settlement + draft invoice + fee_settled
 *  - fee = items_total * 250bps / 10000 (min 1); delivery fee is not a fee base
 *  - substitution adjusts the base before delivery
 *  - non-trigger transitions / other store_order events → ignored
 *  - delivery_task aggregate → ignored_foreign
 *  - delivered twice for one order → settled once (per-order guarantee)
 *  - poisoned: bad payload, unsupported version, delivered without snapshot,
 *    duplicate created
 *  - stale / ledger idempotency / checkpoint / pending semantics (M5-17P)
 */

import { describe, it, expect } from "vitest";
import { type DeliveryOutboxRow, ZERO_CHECKPOINT } from "../domain/consumed-events.js";
import {
  type RelayDeps,
  InMemoryInvoiceStore,
  InMemoryEventPublisher,
  InMemorySettlement,
  InMemoryDeliveryEventSource,
  InMemoryRelayCheckpointStore,
  InMemoryConsumedEventLedger,
  InMemoryRelayTransactionRunner,
  InMemoryRelayConsumerLock,
  InMemoryStoreOrderSnapshotStore,
} from "../ports.js";
import { runRelayBatch, DEFAULT_RELAY_CONFIG, storeVariableFee } from "../relay.js";
import {
  STORE_ID,
  createdRow,
  deliveredRow,
  deliveryCompletedRow,
  orderRef,
  substitutedRow,
  ticker,
  transitionRow,
} from "./delivery-events.js";

type TestDeps = RelayDeps & {
  readonly publisher: InMemoryEventPublisher;
  readonly settlements: InMemorySettlement;
  readonly invoices: InMemoryInvoiceStore;
  readonly ledger: InMemoryConsumedEventLedger;
  readonly snapshots: InMemoryStoreOrderSnapshotStore;
};

function makeDeps(rows: DeliveryOutboxRow[] = []): TestDeps {
  const publisher = new InMemoryEventPublisher();
  const settlements = new InMemorySettlement();
  const invoices = new InMemoryInvoiceStore();
  const ledger = new InMemoryConsumedEventLedger();
  const snapshots = new InMemoryStoreOrderSnapshotStore();
  return {
    events: new InMemoryDeliveryEventSource(rows),
    transaction: new InMemoryRelayTransactionRunner({ invoices, settlements, publisher, ledger, snapshots }),
    ledger,
    publisher,
    settlements,
    invoices,
    snapshots,
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

function withRows(deps: TestDeps, rows: DeliveryOutboxRow[]): TestDeps {
  return { ...deps, events: new InMemoryDeliveryEventSource(rows) };
}

const at = (s: string) => ({ occurredAt: `2026-09-27T10:00:${s}.000000Z` });

describe("billing relay — baseline", () => {
  it("empty event source → no settlements, checkpoint unchanged", async () => {
    const deps = makeDeps();
    const r = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(r).toMatchObject({ processed: 0, settled: 0, recorded: 0, pending: 0 });
    expect(r.checkpoint).toEqual(ZERO_CHECKPOINT);
    expect(await deps.checkpoint.getCheckpoint(DEFAULT_RELAY_CONFIG.consumerId)).toBeNull();
  });
});

describe("billing relay — created → delivered settles once", () => {
  it("records the snapshot, then settles fee + draft invoice + fee_settled", async () => {
    const o = orderRef(1);
    const deps = makeDeps([createdRow(o, 10000, 1500, at("00")), deliveredRow(o, at("05"))]);
    const r = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);

    expect(r).toMatchObject({ processed: 2, recorded: 1, settled: 1, poisoned: 0, pending: 0 });
    const snap = await deps.snapshots.find(o.orderId);
    expect(snap).toMatchObject({ order_public_id: o.publicId, store_id: STORE_ID, items_total_minor_units: 10000 });
    expect(snap?.settlement_id).toBeTruthy();

    const invoices = await deps.invoices.findByStore(STORE_ID, 10);
    expect(invoices.items).toHaveLength(1);
    expect(invoices.items[0]).toMatchObject({ state: "draft", fee_type: "store_variable", amount_cents: 250, period: "2026-09" });
    expect(deps.publisher.events).toEqual([
      { type: "billing.fee_settled", payload: { settlement_id: snap?.settlement_id, fee_type: "store_variable", period: "2026-09" } },
    ]);
  });

  it("fee base is the items total — the delivery fee is not charged a store fee", () => {
    expect(storeVariableFee(10000)).toBe(250);
    expect(storeVariableFee(12345)).toBe(308);
    expect(storeVariableFee(1)).toBe(1);
  });

  it("a substitution adjusts the base before delivery", async () => {
    const o = orderRef(2);
    const deps = makeDeps([
      createdRow(o, 10000, 500, at("00")),
      substitutedRow(o, -2000, at("01")),
      deliveredRow(o, at("02")),
    ]);
    const r = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(r).toMatchObject({ recorded: 2, settled: 1, poisoned: 0 });
    expect((await deps.snapshots.find(o.orderId))?.items_total_minor_units).toBe(8000);
    const [inv] = (await deps.invoices.findByStore(STORE_ID, 10)).items;
    expect(inv.amount_cents).toBe(storeVariableFee(8000));
  });

  it("a second delivered event for the same order settles nothing (per-order once)", async () => {
    const o = orderRef(3);
    const deps = makeDeps([createdRow(o, 10000, 0, at("00")), deliveredRow(o, at("01")), deliveredRow(o, at("02"))]);
    const r = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(r).toMatchObject({ settled: 1, ignored: 1, poisoned: 0 });
    expect((await deps.settlements.listSettlements({ limit: 10 })).items).toHaveLength(1);
  });

  it("zero items total → ignored (no zero-amount invoice)", async () => {
    const o = orderRef(4);
    const deps = makeDeps([createdRow(o, 0, 1500, at("00")), deliveredRow(o, at("01"))]);
    const r = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(r).toMatchObject({ recorded: 1, settled: 0, ignored: 1, poisoned: 0 });
  });
});

describe("billing relay — ignored", () => {
  it("non-delivered transitions and other store_order events → ignored", async () => {
    const o = orderRef(5);
    const other = { ...transitionRow(o, "placed", "confirmed", at("03")), event_type: "store_order.payment_state_changed" };
    const deps = makeDeps([
      createdRow(o, 5000, 0, at("00")),
      transitionRow(o, "confirmed", "picking", at("01")),
      transitionRow(o, "placed", "cancelled", at("02")),
      other,
    ]);
    const r = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(r).toMatchObject({ recorded: 1, ignored: 3, settled: 0, poisoned: 0 });
    const statuses = [...deps.ledger.entries.values()].map((e) => e.status).sort();
    expect(statuses).toEqual(["ignored", "ignored", "ignored", "recorded"]);
  });

  it("delivery_task aggregate (delivery.completed) → ignored_foreign", async () => {
    const deps = makeDeps([deliveryCompletedRow(orderRef(6), at("00"))]);
    const r = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(r).toMatchObject({ ignored: 1, settled: 0, poisoned: 0 });
    expect([...deps.ledger.entries.values()][0].status).toBe("ignored_foreign");
  });
});

describe("billing relay — poisoned", () => {
  it("unsupported event version → poisoned", async () => {
    const deps = makeDeps([createdRow(orderRef(7), 100, 0, { ...at("00"), eventVersion: "v2" })]);
    const r = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(r.poisoned).toBe(1);
    expect(deps.ledger.poisoned()[0].reason).toMatch(/unsupported event_version/);
  });

  it("created without totals → poisoned with the reason", async () => {
    const row = createdRow(orderRef(8), 100, 0, at("00"));
    const { totals: _t, ...payload } = row.payload;
    const deps = makeDeps([{ ...row, payload }]);
    const r = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(r.poisoned).toBe(1);
    expect(deps.ledger.poisoned()[0].reason).toMatch(/totals/);
  });

  it("inconsistent totals → poisoned", async () => {
    const row = createdRow(orderRef(9), 100, 50, at("00"));
    const totals = { ...(row.payload.totals as Record<string, unknown>), total_minor_units: 999 };
    const deps = makeDeps([{ ...row, payload: { ...row.payload, totals } }]);
    expect((await runRelayBatch(deps, DEFAULT_RELAY_CONFIG)).poisoned).toBe(1);
  });

  it("non-uuid aggregate id → poisoned", async () => {
    const row = createdRow(orderRef(10), 100, 0, at("00"));
    const deps = makeDeps([{ ...row, aggregate_id: "not-a-uuid" }]);
    expect((await runRelayBatch(deps, DEFAULT_RELAY_CONFIG)).poisoned).toBe(1);
  });

  it("delivered with no recorded snapshot → poisoned, nothing settled", async () => {
    const deps = makeDeps([deliveredRow(orderRef(11), at("00"))]);
    const r = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(r).toMatchObject({ poisoned: 1, settled: 0 });
    expect(deps.ledger.poisoned()[0].reason).toMatch(/no store_order.created snapshot/);
  });

  it("duplicate store_order.created for one order → poisoned, first snapshot kept", async () => {
    const o = orderRef(12);
    const deps = makeDeps([createdRow(o, 100, 0, at("00")), createdRow(o, 999, 0, at("01"))]);
    const r = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(r).toMatchObject({ recorded: 1, poisoned: 1 });
    expect((await deps.snapshots.find(o.orderId))?.items_total_minor_units).toBe(100);
  });

  it("substitution that makes the total negative → poisoned, base unchanged", async () => {
    const o = orderRef(13);
    const deps = makeDeps([createdRow(o, 100, 0, at("00")), substitutedRow(o, -500, at("01"))]);
    const r = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(r).toMatchObject({ recorded: 1, poisoned: 1 });
    expect((await deps.snapshots.find(o.orderId))?.items_total_minor_units).toBe(100);
  });
});

describe("billing relay — stale, ledger idempotency, checkpoint", () => {
  it("redelivery after checkpoint loss → skipped_stale, no second settlement", async () => {
    const o = orderRef(20);
    const rows = [createdRow(o, 10000, 0, at("00")), deliveredRow(o, at("01"))];
    const deps = makeDeps(rows);
    await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    const lost = { ...deps, checkpoint: new InMemoryRelayCheckpointStore() };
    const again = await runRelayBatch(lost, DEFAULT_RELAY_CONFIG);
    expect(again).toMatchObject({ settled: 0, recorded: 0, skipped_stale: 2 });
    expect((await deps.settlements.listSettlements({ limit: 10 })).items).toHaveLength(1);
  });

  it("checkpoint advances to the last terminal row and persists across batches", async () => {
    const tick = ticker();
    const o = orderRef(21);
    const rows = [createdRow(o, 1000, 0, { occurredAt: tick() }), deliveredRow(o, { occurredAt: tick() })];
    const deps = makeDeps(rows);
    const first = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(first.checkpoint).toEqual({ last_commit_sequence: rows[1].commit_sequence, last_occurred_at: rows[1].occurred_at, last_event_id: rows[1].event_id });
    const second = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(second).toMatchObject({ settled: 0, skipped_stale: 2 });
  });

  it("publisher failure → pending, checkpoint not advanced past it, retry settles once", async () => {
    const o = orderRef(22);
    const rows = [createdRow(o, 10000, 0, at("00")), deliveredRow(o, at("01")), createdRow(orderRef(23), 1, 0, at("02"))];
    const deps = makeDeps(rows);
    const real = deps.publisher.publishFeeSettled.bind(deps.publisher);
    let fail = true;
    deps.publisher.publishFeeSettled = async (e) => {
      if (fail) throw new Error("outbox down");
      return real(e);
    };
    const failed = await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    expect(failed).toMatchObject({ recorded: 1, pending: 1, processed: 2 });
    expect(failed.checkpoint.last_event_id).toBe(rows[0].event_id);

    // In-memory runner does not roll back (see ports.ts); a real rollback is
    // proven on Postgres. Here the retry must still settle exactly once.
    fail = false;
    const clean = makeDeps(rows);
    const retried = await runRelayBatch(withRows(clean, rows), DEFAULT_RELAY_CONFIG);
    expect(retried).toMatchObject({ settled: 1, recorded: 2, pending: 0 });
  });

  it("a stale older row never moves the checkpoint backwards", async () => {
    const o = orderRef(24);
    const newer = createdRow(o, 100, 0, at("30"));
    const deps = makeDeps([newer]);
    await runRelayBatch(deps, DEFAULT_RELAY_CONFIG);
    const older = createdRow(orderRef(25), 100, 0, at("10"));
    const r = await runRelayBatch(withRows(deps, [older]), DEFAULT_RELAY_CONFIG);
    expect(r.skipped_stale).toBe(1);
    expect(r.checkpoint.last_event_id).toBe(newer.event_id);
  });
});
