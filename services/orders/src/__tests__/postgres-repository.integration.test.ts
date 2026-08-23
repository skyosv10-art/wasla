/**
 * Postgres integration test for the Order Engine persistence layer (MR 3/6).
 *
 * This file tests the adapter itself against a real database: the things that
 * cannot fail in memory and cannot be caught by a type. Concretely — the
 * `order_public_id_seq` mints gapless `ORD-` ids, NUMERIC coordinates round-trip
 * as numbers, absent shipment/coordinate columns come back as absent keys, the
 * unique constraints raise the same `OrderError` codes the in-memory adapter
 * raises, the stops/history are written in the same transaction as the order, and
 * the CHECK constraints of the contract reject rows the domain would also reject.
 *
 * The behavioral equivalence of the two adapters is a different question and is
 * answered by `port-conformance.integration.test.ts`. The atomicity of the triple
 * write is answered by `atomicity.integration.test.ts`.
 *
 * Excluded from the default `pnpm -r test` (see vitest.config.ts). Run with:
 *   DATABASE_URL=postgres://... pnpm --filter @wasla/orders-service test:integration
 * Skipped entirely when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Pool } from "pg";

import { OrderError } from "../domain/errors.js";
import type { InsertOrderInput } from "../ports.js";
import { orderPublicIdSeq } from "../infrastructure/drizzle/schema.js";
import type {
  PostgresOrderOutbox,
  PostgresOrderPublicIdGenerator,
  PostgresOrderRepository,
} from "../infrastructure/drizzle/repository.js";
import { PG_ENABLED, setupPostgres, truncateAll } from "./pg-harness.js";

const T0 = "2026-08-21T00:00:00.000Z";
const T1 = "2026-08-21T01:00:00.000Z";
const T2 = "2026-08-21T02:00:00.000Z";

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const CUSTOMER = "WS-0000000001";
const ZONE_A = "66666666-6666-4666-8666-666666666666";
const ZONE_B = "77777777-7777-4777-8777-777777777777";
const DRIVER = "WS-0000000100";

function orderInput(overrides: Partial<InsertOrderInput> = {}): InsertOrderInput {
  return {
    id: id(1),
    orderPublicId: "ORD-0000000001",
    orderRequestId: id(100),
    customerPublicId: CUSTOMER,
    orderType: "ride",
    vehicleClass: "sedan",
    priceMode: "customer_offer",
    offeredPrice: { amountMinor: 2500, currency: "SAR" },
    stops: [
      {
        kind: "pickup",
        zoneId: ZONE_A,
        label: "المنزل",
        source: "map",
        savedPlaceId: null,
        coordinates: { latitude: 24.4686, longitude: 39.6142 },
      },
      {
        kind: "dropoff",
        zoneId: ZONE_B,
        label: null,
        source: "text_search",
        savedPlaceId: null,
        coordinates: null,
      },
    ],
    shipment: null,
    notes: null,
    idempotencyKey: "key-00000001",
    payloadFingerprint: "a".repeat(64),
    requestedAt: T0,
    acceptedAt: T0,
    createdAt: T0,
    ...overrides,
  };
}

describe.skipIf(!PG_ENABLED)("Order Postgres adapter", () => {
  let pool: Pool;
  let repo: PostgresOrderRepository;
  let outbox: PostgresOrderOutbox;
  let publicIds: PostgresOrderPublicIdGenerator;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const fixture = await setupPostgres();
    pool = fixture.pool;
    repo = fixture.repo;
    outbox = fixture.outbox;
    publicIds = fixture.publicIds;
    close = fixture.close;
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await truncateAll(pool);
    // Restart the sequence so the first public id is always ORD-0000000001.
    await pool.query(`ALTER SEQUENCE order_public_id_seq RESTART WITH 1`);
  });

  // -------------------------------------------------------------------------
  // public id sequence
  // -------------------------------------------------------------------------

  it("mints gapless monotone order public ids from the sequence", async () => {
    const a = await publicIds.nextOrderPublicId();
    const b = await publicIds.nextOrderPublicId();
    const c = await publicIds.nextOrderPublicId();
    expect(a).toBe("ORD-0000000001");
    expect(b).toBe("ORD-0000000002");
    expect(c).toBe("ORD-0000000003");
  });

  it("the sequence is the contract's `order_public_id_seq`", () => {
    // Drizzle must project the same sequence the generator reads from.
    expect(orderPublicIdSeq.seqName).toBe("order_public_id_seq");
  });

  // -------------------------------------------------------------------------
  // insertOrder
  // -------------------------------------------------------------------------

  it("inserts an order, its stops and the creation audit row as one unit", async () => {
    const { order, historyEntry } = await repo.insertOrder(orderInput());

    expect(order.id).toBe(id(1));
    expect(order.orderPublicId).toBe("ORD-0000000001");
    expect(order.status).toBe("published");
    expect(order.offeredPrice).toEqual({ amountMinor: 2500, currency: "SAR" });
    expect(order.stops).toHaveLength(2);
    expect(order.stops[0]).toEqual({
      kind: "pickup",
      zoneId: ZONE_A,
      label: "المنزل",
      source: "map",
      savedPlaceId: null,
      coordinates: { latitude: 24.4686, longitude: 39.6142 },
    });
    // Absent coordinate columns come back as a null coordinates object, not as
    // half-pair fields — matching the in-memory adapter.
    expect(order.stops[1]!.coordinates).toBeNull();

    expect(historyEntry.sequence).toBe(1);
    expect(historyEntry.fromStatus).toBeNull();
    expect(historyEntry.toStatus).toBe("published");
    expect(historyEntry.actorType).toBe("system");
  });

  it("NUMERIC coordinates round-trip as numbers, not strings", async () => {
    await repo.insertOrder(orderInput());
    const order = await repo.findOrderById(id(1));
    expect(order!.stops[0]!.coordinates!.latitude).toBe(24.4686);
    expect(typeof order!.stops[0]!.coordinates!.latitude).toBe("number");
  });

  it("stores shipment details for a delivery order and reads them back", async () => {
    await repo.insertOrder(
      orderInput({
        orderType: "delivery",
        vehicleClass: "van",
        shipment: {
          shipmentType: "parcel",
          description: "وثائق",
          weightKg: 1.5,
        },
      }),
    );
    const order = await repo.findOrderById(id(1));
    expect(order!.shipment).toEqual({
      shipmentType: "parcel",
      description: "وثائق",
      weightKg: 1.5,
    });
  });

  it("rejects a duplicate idempotency key with ORDER_IDEMPOTENCY_KEY_REUSED", async () => {
    await repo.insertOrder(orderInput());
    await expect(
      repo.insertOrder(
        orderInput({
          id: id(2),
          orderRequestId: id(101),
          payloadFingerprint: "b".repeat(64),
        }),
      ),
    ).rejects.toMatchObject({ code: "ORDER_IDEMPOTENCY_KEY_REUSED" });
  });

  it("rejects a duplicate request id with ORDER_REQUEST_ALREADY_INGESTED", async () => {
    await repo.insertOrder(orderInput());
    await expect(
      repo.insertOrder(
        orderInput({
          id: id(2),
          orderPublicId: "ORD-0000000002",
          idempotencyKey: "key-00000002",
        }),
      ),
    ).rejects.toMatchObject({ code: "ORDER_REQUEST_ALREADY_INGESTED" });
  });

  // -------------------------------------------------------------------------
  // reads
  // -------------------------------------------------------------------------

  it("finds an order by public id, request id and idempotency key", async () => {
    await repo.insertOrder(orderInput());
    expect((await repo.findOrderByPublicId("ORD-0000000001"))!.id).toBe(id(1));
    expect((await repo.findOrderByRequestId(id(100)))!.id).toBe(id(1));
    expect((await repo.findOrderByIdempotencyKey("key-00000001"))!.id).toBe(id(1));
    expect(await repo.findFingerprintByIdempotencyKey("key-00000001")).toBe(
      "a".repeat(64),
    );
  });

  it("returns null when no order matches", async () => {
    expect(await repo.findOrderById(id(999))).toBeNull();
    expect(await repo.findOrderByPublicId("ORD-0000000099")).toBeNull();
    expect(await repo.findOrderByRequestId(id(999))).toBeNull();
    expect(await repo.findOrderByIdempotencyKey("missing")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // applyTransition
  // -------------------------------------------------------------------------

  it("applies a transition and appends the audit row with an incrementing sequence", async () => {
    await repo.insertOrder(orderInput());

    const first = await repo.applyTransition({
      orderId: id(1),
      toStatus: "searching",
      reasonCode: null,
      actorType: "system",
      actorRef: null,
      activeAssignmentId: null,
      occurredAt: T1,
      traceId: null,
    });

    expect(first.order.status).toBe("searching");
    expect(first.historyEntry.sequence).toBe(2);
    expect(first.historyEntry.fromStatus).toBe("published");
    expect(first.historyEntry.toStatus).toBe("searching");

    const second = await repo.applyTransition({
      orderId: id(1),
      toStatus: "offered",
      reasonCode: null,
      actorType: "system",
      actorRef: null,
      activeAssignmentId: null,
      occurredAt: T2,
      traceId: "trace-1",
    });

    expect(second.historyEntry.sequence).toBe(3);
    expect(second.historyEntry.fromStatus).toBe("searching");
    expect(second.historyEntry.traceId).toBe("trace-1");

    const history = await repo.listStatusHistory(id(1));
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.sequence)).toEqual([1, 2, 3]);
  });

  it("throws ORDER_NOT_FOUND when transitioning a nonexistent order", async () => {
    await expect(
      repo.applyTransition({
        orderId: id(999),
        toStatus: "searching",
        reasonCode: null,
        actorType: "system",
        actorRef: null,
        activeAssignmentId: null,
        occurredAt: T1,
        traceId: null,
      }),
    ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  });

  // -------------------------------------------------------------------------
  // agreed price
  // -------------------------------------------------------------------------

  it("records the complete agreed-price quartet and reads it back", async () => {
    await repo.insertOrder(
      orderInput({ priceMode: "negotiable", offeredPrice: null }),
    );
    const recorded = await repo.recordAgreedPrice({
      orderId: id(1),
      negotiationId: id(700),
      amountMinor: 2200,
      currency: "SAR",
      agreedAt: T1,
      recordedAt: T2,
    });

    expect(recorded).toMatchObject({
      agreedPrice: { amountMinor: 2200, currency: "SAR" },
      agreedAt: T1,
      agreedNegotiationId: id(700),
    });
    expect(await repo.recordAgreedPrice({
      orderId: id(1),
      negotiationId: id(701),
      amountMinor: 2300,
      currency: "SAR",
      agreedAt: T2,
      recordedAt: T2,
    })).toBeNull();
  });

  it("the canonical database rejects incomplete, non-negotiable and reused agreement evidence", async () => {
    await repo.insertOrder(orderInput());
    await expect(
      pool.query(`UPDATE orders SET agreed_amount_minor = 2200 WHERE id = $1`, [id(1)]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        `UPDATE orders
         SET agreed_amount_minor = 2200, agreed_currency = 'SAR',
             agreed_at = $2, agreed_negotiation_id = $3
         WHERE id = $1`,
        [id(1), T1, id(700)],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    await repo.insertOrder(
      orderInput({
        id: id(2),
        orderPublicId: "ORD-0000000002",
        orderRequestId: id(101),
        idempotencyKey: "key-00000002",
        priceMode: "negotiable",
        offeredPrice: null,
      }),
    );
    await pool.query(
      `UPDATE orders
       SET agreed_amount_minor = 2200, agreed_currency = 'SAR',
           agreed_at = $2, agreed_negotiation_id = $3
       WHERE id = $1`,
      [id(2), T1, id(700)],
    );
    await repo.insertOrder(
      orderInput({
        id: id(3),
        orderPublicId: "ORD-0000000003",
        orderRequestId: id(102),
        idempotencyKey: "key-00000003",
        priceMode: "negotiable",
        offeredPrice: null,
      }),
    );
    await expect(
      pool.query(
        `UPDATE orders
         SET agreed_amount_minor = 2200, agreed_currency = 'SAR',
             agreed_at = $2, agreed_negotiation_id = $3
         WHERE id = $1`,
        [id(3), T1, id(700)],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  // -------------------------------------------------------------------------
  // assignments
  // -------------------------------------------------------------------------

  it("records an assignment offer with an incrementing sequence", async () => {
    await repo.insertOrder(orderInput());
    const first = await repo.insertAssignment({
      id: id(10),
      orderId: id(1),
      driverPublicId: DRIVER,
      offeredAt: T1,
    });
    expect(first.sequence).toBe(1);
    expect(first.state).toBe("offered");
    expect(first.driverPublicId).toBe(DRIVER);
  });

  it("rejects offering the same driver the same order twice", async () => {
    await repo.insertOrder(orderInput());
    await repo.insertAssignment({
      id: id(10),
      orderId: id(1),
      driverPublicId: DRIVER,
      offeredAt: T1,
    });
    await expect(
      repo.insertAssignment({
        id: id(11),
        orderId: id(1),
        driverPublicId: DRIVER,
        offeredAt: T2,
      }),
    ).rejects.toMatchObject({ code: "ORDER_ASSIGNMENT_DUPLICATE" });
  });

  it("resolves an assignment and refuses to resolve it twice", async () => {
    await repo.insertOrder(orderInput());
    const assignment = await repo.insertAssignment({
      id: id(10),
      orderId: id(1),
      driverPublicId: DRIVER,
      offeredAt: T1,
    });
    const accepted = await repo.resolveAssignment({
      assignmentId: assignment.id,
      state: "accepted",
      reasonCode: null,
      resolvedAt: T2,
    });
    expect(accepted.state).toBe("accepted");
    expect(accepted.acceptedAt).toBeTruthy();

    await expect(
      repo.resolveAssignment({
        assignmentId: assignment.id,
        state: "rejected",
        reasonCode: "DRIVER_DECLINED",
        resolvedAt: T2,
      }),
    ).rejects.toMatchObject({ code: "ORDER_ASSIGNMENT_ALREADY_RESOLVED" });
  });

  it("binds and unbinds the active assignment on the order row", async () => {
    await repo.insertOrder(orderInput());
    const assignment = await repo.insertAssignment({
      id: id(10),
      orderId: id(1),
      driverPublicId: DRIVER,
      offeredAt: T1,
    });
    await repo.resolveAssignment({
      assignmentId: assignment.id,
      state: "accepted",
      reasonCode: null,
      resolvedAt: T2,
    });
    // The order must be in a driver-bound state before it can carry an active
    // assignment — ck_orders_assignment_matches_status forbids the coupling in
    // any state that does not name a driver.
    await repo.applyTransition({
      orderId: id(1),
      toStatus: "accepted",
      reasonCode: null,
      actorType: "system",
      actorRef: null,
      activeAssignmentId: assignment.id,
      occurredAt: T2,
      traceId: null,
    });
    const bound = await repo.findOrderById(id(1));
    expect(bound!.activeAssignmentId).toBe(assignment.id);
    expect(bound!.status).toBe("accepted");

    // Unbinding the driver must coincide with a transition back to a state that
    // does not name a driver — `accepted` with a null assignment is the impossible
    // state ck_orders_assignment_matches_status exists to forbid.
    await repo.applyTransition({
      orderId: id(1),
      toStatus: "searching",
      reasonCode: null,
      actorType: "system",
      actorRef: null,
      activeAssignmentId: null,
      occurredAt: T2,
      traceId: null,
    });
    const unbound = await repo.findOrderById(id(1));
    expect(unbound!.activeAssignmentId).toBeNull();
    expect(unbound!.status).toBe("searching");
  });

  it("refuses to point the order at an assignment it does not own", async () => {
    await repo.insertOrder(orderInput());
    await expect(
      repo.setActiveAssignment(id(1), id(99), T2),
    ).rejects.toMatchObject({ code: "ORDER_ASSIGNMENT_NOT_FOUND" });
  });

  // -------------------------------------------------------------------------
  // outbox
  // -------------------------------------------------------------------------

  it("returns unread events in append order", async () => {
    await repo.insertOrder(orderInput());
    await outbox.append({
      event_id: id(200),
      event_type: "order.created",
      event_version: "v1",
      occurred_at: T0,
      producer: "orders-service",
      aggregate: { type: "order", id: "ORD-0000000001" },
      trace_id: null,
      data: { order_public_id: "ORD-0000000001" },
    } as never);
    await outbox.append({
      event_id: id(201),
      event_type: "order.status_changed",
      event_version: "v1",
      occurred_at: T1,
      producer: "orders-service",
      aggregate: { type: "order", id: "ORD-0000000001" },
      trace_id: null,
      data: { sequence: 2 },
    } as never);

    const unread = await outbox.unread();
    expect(unread).toHaveLength(2);
    expect(unread[0]!.event_type).toBe("order.created");
    expect(unread[1]!.event_type).toBe("order.status_changed");
  });

  it("marks published events and excludes them from unread", async () => {
    await repo.insertOrder(orderInput());
    const eventId = id(200);
    await outbox.append({
      event_id: eventId,
      event_type: "order.created",
      event_version: "v1",
      occurred_at: T0,
      producer: "orders-service",
      aggregate: { type: "order", id: "ORD-0000000001" },
      trace_id: null,
      data: {},
    } as never);

    const published = await outbox.markPublished([eventId], T2);
    expect(published).toBe(1);
    expect(await outbox.unread()).toHaveLength(0);
  });

  it("OrderError instances are recognisable by isOrderError", async () => {
    await repo.insertOrder(orderInput());
    let caught: unknown;
    try {
      await repo.insertOrder(orderInput());
    } catch (error) {
      caught = error;
    }
    // The translated error is an OrderError carrying a stable contract code.
    expect(caught).toBeInstanceOf(OrderError);
  });
});
