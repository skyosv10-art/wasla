/**
 * Atomicity test: the triple write commits or rolls back as one unit (MR 3/6).
 *
 * ADR-010 §127 promises that every status change + audit row + outbox event is
 * ONE transaction. The customer service carried the repository/outbox split as
 * documented debt; the order engine settles it through `PostgresOrderUnitOfWork`,
 * which hands the SAME transaction handle to `PostgresOrderRepository` and
 * `PostgresOrderOutbox` and runs the use cases unchanged inside the callback.
 *
 * The discriminating proof: make `outbox.append()` fail AFTER
 * `repository.applyTransition()` has already succeeded, and assert the order's
 * status, the audit row AND the event are all absent after the rollback. A
 * repository-internal transaction could not produce that outcome — it would
 * have committed the status + audit before the outbox call was even made.
 *
 * Excluded from the default `pnpm -r test` (see vitest.config.ts). Run with:
 *   DATABASE_URL=postgres://... pnpm --filter @wasla/orders-service test:integration
 * Skipped entirely when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Pool } from "pg";

import type { OrderDomainEvent } from "@wasla/contracts-order";

import { FixedClock, SequentialIdGenerator } from "../infrastructure/in-memory.js";
import { PostgresOrderUnitOfWork } from "../infrastructure/drizzle/transaction.js";
import { ingestOrder } from "../use-cases/ingest-order.js";
import { transitionOrder } from "../use-cases/transition-order.js";
import type { OrderDependencies, Outbox } from "../ports.js";
import { PG_ENABLED, setupPostgres, truncateAll } from "./pg-harness.js";

const T0 = "2026-08-21T00:00:00.000Z";

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const CUSTOMER = "WS-0000000001";
const ZONE_A = "66666666-6666-4666-8666-666666666666";
const ZONE_B = "77777777-7777-4777-8777-777777777777";

function intakeCommand() {
  return {
    orderRequestId: id(100),
    customerPublicId: CUSTOMER,
    orderType: "ride" as const,
    vehicleClass: "sedan" as const,
    priceMode: "customer_offer" as const,
    offeredPrice: { amountMinor: 2500, currency: "SAR" },
    stops: [
      {
        kind: "pickup" as const,
        zoneId: ZONE_A,
        label: "المنزل",
        source: "map" as const,
        savedPlaceId: null,
        coordinates: { latitude: 24.4686, longitude: 39.6142 },
      },
      {
        kind: "dropoff" as const,
        zoneId: ZONE_B,
        label: null,
        source: "text_search" as const,
        savedPlaceId: null,
        coordinates: null,
      },
    ],
    shipment: null,
    notes: null,
    requestedAt: T0,
    idempotencyKey: "key-00000001",
    traceId: "trace-1",
  };
}

/**
 * An outbox that fails on the Nth append, simulating a relay/storage failure
 * mid-write. It does not write anything — the atomicity contract is that NOTHING
 * survives a failed triple write, so a successful append inside the failing path
 * would contradict the very property under test.
 */
class FailingOutbox implements Outbox {
  private readonly failOnCall: number;
  private calls = 0;
  public lastError: unknown;

  constructor(failOnCall: number) {
    this.failOnCall = failOnCall;
  }

  async append(_event: OrderDomainEvent): Promise<void> {
    this.calls += 1;
    if (this.calls === this.failOnCall) {
      this.lastError = new Error("simulated outbox failure");
      throw this.lastError;
    }
  }

  async unread(): Promise<OrderDomainEvent[]> {
    return [];
  }
}

describe.skipIf(!PG_ENABLED)("Order triple-write atomicity", () => {
  let pool: Pool;
  let unitOfWork: PostgresOrderUnitOfWork;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const fixture = await setupPostgres();
    pool = fixture.pool;
    unitOfWork = fixture.unitOfWork;
    close = fixture.close;
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await truncateAll(pool);
    await pool.query(`ALTER SEQUENCE order_public_id_seq RESTART WITH 1`);
  });

  it("rolls back the order, the audit row AND the event when outbox.append fails after ingest", async () => {
    // Ingest writes the order + stops + the creation audit row, then appends TWO
    // events (order.created + order.status_changed). Failing on the first append
    // means the order row was already written — and the promise is that it must
    // NOT survive the failure.
    const shared = { clock: new FixedClock(), ids: new SequentialIdGenerator() };
    const failing = new FailingOutbox(1);

    await expect(
      unitOfWork.run(shared, async ({ deps }) => {
        // Swap in the failing outbox: the UoW built a real one, but the use case
        // reads deps.outbox, so we override it on the deps object directly.
        const poisoned: OrderDependencies = { ...deps, outbox: failing };
        await ingestOrder(poisoned, intakeCommand());
      }),
    ).rejects.toThrow("simulated outbox failure");

    // Nothing survived: no order, no history, no event.
    const ordersRow = await pool.query("SELECT count(*)::int AS n FROM orders");
    const historyRow = await pool.query(
      "SELECT count(*)::int AS n FROM order_status_history",
    );
    const outboxRow = await pool.query("SELECT count(*)::int AS n FROM order_outbox");
    expect(ordersRow.rows[0]!.n).toBe(0);
    expect(historyRow.rows[0]!.n).toBe(0);
    expect(outboxRow.rows[0]!.n).toBe(0);
  });

  it("rolls back the status change and its audit row when outbox.append fails after a transition", async () => {
    // First, ingest an order successfully (two events appended normally).
    const shared = { clock: new FixedClock(), ids: new SequentialIdGenerator() };
    let orderId: string;
    await unitOfWork.run(shared, async ({ deps }) => {
      const outcome = await ingestOrder(deps, intakeCommand());
      orderId = outcome.order.id;
    });

    // Now transition the order, but fail the outbox append that follows the
    // status change. The transition must be undone: the status stays `published`,
    // and no second audit row exists.
    const failing = new FailingOutbox(1);
    await expect(
      unitOfWork.run(shared, async ({ deps }) => {
        const poisoned: OrderDependencies = { ...deps, outbox: failing };
        await transitionOrder(poisoned, orderId!, {
          toStatus: "searching",
          reasonCode: null,
          actorType: "system",
          actorRef: null,
          traceId: "trace-2",
        });
      }),
    ).rejects.toThrow("simulated outbox failure");

    const statusRow = await pool.query(
      "SELECT status FROM orders WHERE id = $1",
      [orderId!],
    );
    const historyRow = await pool.query(
      "SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1",
      [orderId!],
    );
    expect(statusRow.rows[0]!.status).toBe("published");
    // Only the creation audit row (sequence 1) remains.
    expect(historyRow.rows[0]!.n).toBe(1);
  });

  it("rolls back the real Postgres outbox row when a failure happens after the use case returns", async () => {
    // This is the discriminating test for the Unit of Work: it proves that the
    // REAL PostgresOrderOutbox(tx) — not a stub — shares the transaction with
    // the repository. The use case runs to completion (order + audit + two events
    // written inside the tx), then the callback throws AFTER the use case returns.
    // If repo and outbox shared the tx, the commit never happens and nothing
    // survives — including the real outbox rows a stub-based test could never see.
    const shared = { clock: new FixedClock(), ids: new SequentialIdGenerator() };

    await expect(
      unitOfWork.run(shared, async ({ deps }) => {
        await ingestOrder(deps, intakeCommand());
        throw new Error("failure after the use case committed its writes");
      }),
    ).rejects.toThrow("failure after the use case committed its writes");

    const ordersRow = await pool.query("SELECT count(*)::int AS n FROM orders");
    const historyRow = await pool.query(
      "SELECT count(*)::int AS n FROM order_status_history",
    );
    const outboxRow = await pool.query("SELECT count(*)::int AS n FROM order_outbox");
    expect(ordersRow.rows[0]!.n).toBe(0);
    expect(historyRow.rows[0]!.n).toBe(0);
    expect(outboxRow.rows[0]!.n).toBe(0);
  });

  it("commits all three writes together when nothing fails", async () => {
    const shared = { clock: new FixedClock(), ids: new SequentialIdGenerator() };
    let outcome: { order: { id: string }; replayed: boolean } | undefined;
    await unitOfWork.run(shared, async ({ deps }) => {
      outcome = await ingestOrder(deps, intakeCommand());
    });

    expect(outcome!.replayed).toBe(false);
    const ordersRow = await pool.query("SELECT count(*)::int AS n FROM orders");
    const historyRow = await pool.query(
      "SELECT count(*)::int AS n FROM order_status_history",
    );
    const outboxRow = await pool.query("SELECT count(*)::int AS n FROM order_outbox");
    expect(ordersRow.rows[0]!.n).toBe(1);
    expect(historyRow.rows[0]!.n).toBe(1);
    // Two events: order.created + order.status_changed (from_status = null).
    expect(outboxRow.rows[0]!.n).toBe(2);
  });
});
