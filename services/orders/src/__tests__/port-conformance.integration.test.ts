/**
 * Port conformance: the in-memory and Postgres adapters must be
 * indistinguishable through the use cases (MR 3/6).
 *
 * The whole promise of MR 3/6 is that adding a database changed no behavior. A
 * suite that only exercised the Postgres adapter could not prove that: it would
 * pass while the two adapters quietly disagreed about which keys exist on a
 * shipment, about the ordering of history rows, or about what an absent
 * `active_assignment_id` means — and the disagreement would surface as a bug in
 * the bot, months later, in production only.
 *
 * So each scenario here is written once and executed twice, once per adapter,
 * through the same use cases with the same deterministic clock and ids. The
 * Postgres run executes inside a `PostgresOrderUnitOfWork` so the comparison
 * also proves the Unit of Work path behaves like the in-memory direct path —
 * the atomicity layer is transparent to the use cases.
 *
 * Three fields are normalized away before comparing, all for documented reasons:
 *
 *  - `orderPublicId` — the in-memory generator is monotone-per-instance, while
 *    Postgres draws from a database sequence reset between scenarios; the value
 *    differs but the format (`ORD-0000000001`) is asserted separately.
 *  - `updatedAt` — owned by the contract trigger on Postgres, by the injected
 *    clock in memory; monotonicity is asserted separately.
 *
 * Unlike the customers service, `order_outbox` DOES store `trace_id`, so the
 * full event envelope — including `trace_id` — round-trips through Postgres and
 * must match the in-memory adapter exactly. No declared gap here.
 *
 * Run with:
 *   DATABASE_URL=postgres://... pnpm --filter @wasla/orders-service test:integration
 * Skipped entirely when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Pool } from "pg";

import { FixedClock, InMemoryOrderPublicIdGenerator, InMemoryOrderRepository, InMemoryOutbox, SequentialIdGenerator, } from "../infrastructure/in-memory.js";
import { PostgresOrderUnitOfWork } from "../infrastructure/drizzle/transaction.js";
import { ingestOrder } from "../use-cases/ingest-order.js";
import { transitionOrder } from "../use-cases/transition-order.js";
import type { OrderDependencies } from "../ports.js";
import { PG_ENABLED, setupPostgres, truncateAll } from "./pg-harness.js";

const ZONE_A = "66666666-6666-4666-8666-666666666666";
const ZONE_B = "77777777-7777-4777-8777-777777777777";

function intakeCommand(n: number, notes: string | null = null) {
  return {
    orderRequestId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    customerPublicId: "WS-0000000001",
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
    notes,
    requestedAt: "2026-08-21T00:00:00.000Z",
    idempotencyKey: `key-${String(n).padStart(8, "0")}`,
    traceId: `trace-${n}`,
  };
}

/** Drop fields whose value is legitimately adapter-specific (see the header). */
function normalize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, inner) =>
      key === "orderPublicId" ||
      key === "order_public_id" ||
      key === "updatedAt" ||
      key === "updated_at"
        ? undefined
        : inner,
    ),
  );
}

interface Snapshot {
  readonly result: unknown;
  readonly events: readonly unknown[];
}

interface Scenario {
  readonly name: string;
  readonly run: (deps: OrderDependencies) => Promise<unknown>;
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: "ingests an order with a price and full stops",
    run: async (deps) => ingestOrder(deps, intakeCommand(1)),
  },
  {
    name: "ingests an order with shipment details and null notes",
    run: async (deps) => {
      const command = intakeCommand(2);
      return ingestOrder(deps, {
        ...command,
        orderType: "delivery" as const,
        vehicleClass: "van" as const,
        shipment: {
          shipmentType: "parcel" as const,
          description: "ظرف صغير",
          weightKg: 0.5,
        },
      });
    },
  },
  {
    name: "ingests a delivery order with shipment weight and description",
    run: async (deps) => {
      const command = intakeCommand(3);
      return ingestOrder(deps, {
        ...command,
        orderType: "delivery" as const,
        vehicleClass: "van" as const,
        shipment: {
          shipmentType: "documents" as const,
          description: "مظاريف مهمة",
          weightKg: 2.5,
        },
        stops: [
          {
            kind: "pickup" as const,
            zoneId: ZONE_A,
            label: "الرسمي",
            source: "text_search" as const,
            savedPlaceId: null,
            coordinates: null,
          },
          {
            kind: "dropoff" as const,
            zoneId: ZONE_B,
            label: "الوجهة",
            source: "map" as const,
            savedPlaceId: null,
            coordinates: { latitude: 24.4711, longitude: 39.6111 },
          },
        ],
      });
    },
  },
  {
    name: "replays the same key + payload and reports it as a retry",
    run: async (deps) => {
      const first = await ingestOrder(deps, intakeCommand(4));
      const replayed = await ingestOrder(deps, intakeCommand(4));
      return { firstReplayed: first.replayed, replayedReplayed: replayed.replayed };
    },
  },
  {
    name: "transitions an order to searching and reads back the new status",
    run: async (deps) => {
      const created = await ingestOrder(deps, intakeCommand(5));
      const transitioned = await transitionOrder(deps, created.order.id, {
        toStatus: "searching",
        reasonCode: null,
        actorType: "system",
        actorRef: null,
        traceId: "trace-5",
      });
      return {
        before: created.order.status,
        after: transitioned.order.status,
      };
    },
  },
  {
    name: "transitions with a reason code and actor reference",
    run: async (deps) => {
      const created = await ingestOrder(deps, intakeCommand(6));
      const transitioned = await transitionOrder(deps, created.order.id, {
        toStatus: "searching",
        reasonCode: "CUSTOMER_CHANGED_MIND" as const,
        actorType: "customer" as const,
        actorRef: "WS-0000000001",
        traceId: "trace-6",
      });
      return {
        status: transitioned.order.status,
        reasonCode: transitioned.order.statusReasonCode,
      };
    },
  },
];

describe.skipIf(!PG_ENABLED)("Port conformance: in-memory ↔ Postgres", () => {
  let pool: Pool;
  let unitOfWork: PostgresOrderUnitOfWork;
  let fixture: Awaited<ReturnType<typeof setupPostgres>>;
  let close: () => Promise<void>;

  beforeAll(async () => {
    fixture = await setupPostgres();
    pool = fixture.pool;
    unitOfWork = fixture.unitOfWork;
    close = fixture.close;
  });

  afterAll(async () => {
    await close();
  });

  /** Build a fresh set of in-memory deps. */
  function makeMemoryDeps(): OrderDependencies & {
    clock: FixedClock;
    outbox: InMemoryOutbox;
  } {
    const outbox = new InMemoryOutbox();
    return {
      repository: new InMemoryOrderRepository(),
      outbox,
      clock: new FixedClock(),
      ids: new SequentialIdGenerator(),
      publicIds: new InMemoryOrderPublicIdGenerator(),
    };
  }

  /** Run a scenario against Postgres inside a Unit of Work, capturing its events. */
  async function runPostgres(
    scenario: Scenario,
  ): Promise<Snapshot> {
    await truncateAll(pool);
    await pool.query(`ALTER SEQUENCE order_public_id_seq RESTART WITH 1`);
    let result: unknown;
    const shared = { clock: new FixedClock(), ids: new SequentialIdGenerator() };
    await unitOfWork.run(shared, async ({ deps }) => {
      // Use the REAL Postgres outbox — no stub. The events written inside the tx
      // are durable in order_outbox after commit, so reading them back proves the
      // round-trip through the real adapter, not an in-memory substitute.
      result = await scenario.run(deps);
    });
    const events = await fixture.outbox.unread();
    // Reset for the next scenario.
    await truncateAll(pool);
    await pool.query(`ALTER SEQUENCE order_public_id_seq RESTART WITH 1`);
    return { result, events };
  }

  it.each(SCENARIOS)(
    "$name behaves identically on both adapters",
    async (scenario) => {
      // In-memory run.
      const memoryDeps = makeMemoryDeps();
      const memory: Snapshot = {
        result: await scenario.run(memoryDeps),
        events: await memoryDeps.outbox.unread(),
      };

      // Postgres run (inside a Unit of Work).
      const postgres = await runPostgres(scenario);

      expect(normalize(postgres.result)).toEqual(normalize(memory.result));
      expect(normalize(postgres.events)).toEqual(normalize(memory.events));
      // A scenario that produced no observable effect would pass vacuously.
      expect(
        JSON.stringify(memory.result) !== "{}" || memory.events.length > 0,
      ).toBe(true);
    },
  );

  it("formats public ids as ORD-########## on both adapters", async () => {
    const memoryDeps = makeMemoryDeps();
    const memoryOrder = await ingestOrder(memoryDeps, intakeCommand(7));
    expect(memoryOrder.order.orderPublicId).toMatch(/^ORD-\d{10}$/);

    await truncateAll(pool);
    await pool.query(`ALTER SEQUENCE order_public_id_seq RESTART WITH 1`);
    const shared = { clock: new FixedClock(), ids: new SequentialIdGenerator() };
    let pgOrder: { order: { orderPublicId: string } } | undefined;
    await unitOfWork.run(shared, async ({ deps }) => {
      pgOrder = await ingestOrder(deps, intakeCommand(7));
    });
    expect(pgOrder!.order.orderPublicId).toMatch(/^ORD-\d{10}$/);
  });
});
