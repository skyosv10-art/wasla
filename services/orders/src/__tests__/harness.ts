/**
 * Test harness for the Order Engine core.
 *
 * The important piece is `driveTo`: it puts an order into ANY of the 21 statuses
 * by walking the shortest legal path from `published`, recording and accepting an
 * assignment whenever the next state names a driver. Without it, the 441-pair
 * sweep could not exist — tests would only ever be able to check the handful of
 * states reachable by hand, which is exactly how an unreachable or unguarded
 * state survives review.
 *
 * It uses the real use cases, not shortcuts into the store. A helper that wrote
 * a status directly would prove the store can hold a state, not that the engine
 * can reach it legitimately.
 */

import { ORDER_INITIAL_STATUS, type OrderStatus } from "@wasla/contracts-order";

import type { OrderIntakeCommand } from "../domain/model.js";
import { allowedTargets, transitionRule } from "../domain/state-machine.js";
import {
  FixedClock,
  InMemoryOrderPublicIdGenerator,
  InMemoryOrderRepository,
  InMemoryOutbox,
  SequentialIdGenerator,
} from "../infrastructure/in-memory.js";
import type { OrderDependencies } from "../ports.js";
import { ingestOrder } from "../use-cases/ingest-order.js";
import {
  recordAssignment,
  resolveAssignment,
} from "../use-cases/manage-assignments.js";
import { transitionOrder } from "../use-cases/transition-order.js";

/** A public id shaped like the real thing, for actor refs and drivers. */
export function publicId(n: number): string {
  return `WS-${String(n).padStart(10, "0")}`;
}

export interface Harness extends OrderDependencies {
  readonly repository: InMemoryOrderRepository;
  readonly outbox: InMemoryOutbox;
  readonly clock: FixedClock;
}

/** Fresh in-memory dependencies with a deterministic clock and ids. */
export function makeHarness(): Harness {
  return {
    repository: new InMemoryOrderRepository(),
    outbox: new InMemoryOutbox(),
    clock: new FixedClock(),
    ids: new SequentialIdGenerator(),
    publicIds: new InMemoryOrderPublicIdGenerator(),
  };
}

let requestCounter = 0;

/** A valid ride intake command; override any field to make it invalid on purpose. */
export function intakeCommand(
  overrides: Partial<OrderIntakeCommand> = {},
): OrderIntakeCommand {
  requestCounter += 1;
  const suffix = String(requestCounter).padStart(12, "0");
  return {
    orderRequestId: `11111111-1111-4111-8111-${suffix}`,
    customerPublicId: publicId(1),
    orderType: "ride",
    vehicleClass: "sedan",
    priceMode: "customer_offer",
    offeredPrice: { amountMinor: 2500, currency: "SAR" },
    stops: [
      {
        kind: "pickup",
        zoneId: "66666666-6666-4666-8666-666666666666",
        label: "المنزل",
        source: "saved_place",
        savedPlaceId: null,
        coordinates: { latitude: 24.4686, longitude: 39.6142 },
      },
      {
        kind: "dropoff",
        zoneId: "77777777-7777-4777-8777-777777777777",
        label: null,
        source: "map",
        savedPlaceId: null,
        coordinates: null,
      },
    ],
    shipment: null,
    notes: null,
    requestedAt: "2026-01-01T00:00:00.000Z",
    idempotencyKey: `key-${suffix}`,
    ...overrides,
  };
}

/** Create an order through the real intake use case. */
export async function createOrder(
  harness: Harness,
  overrides: Partial<OrderIntakeCommand> = {},
): Promise<string> {
  const outcome = await ingestOrder(harness, intakeCommand(overrides));
  return outcome.order.id;
}

/**
 * The shortest legal sequence of statuses from `published` to `target`.
 *
 * Breadth-first so the path is minimal: a longer walk would pile up audit rows
 * and make the "history length" assertions depend on the harness rather than on
 * the engine.
 */
export function shortestPath(
  target: OrderStatus,
): Exclude<OrderStatus, typeof ORDER_INITIAL_STATUS>[] {
  type Step = Exclude<OrderStatus, typeof ORDER_INITIAL_STATUS>;
  if (target === ORDER_INITIAL_STATUS) return [];
  const previous = new Map<OrderStatus, OrderStatus>();
  const queue: OrderStatus[] = [ORDER_INITIAL_STATUS];
  const seen = new Set<OrderStatus>([ORDER_INITIAL_STATUS]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of allowedTargets(current)) {
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, current);
      if (next === target) {
        // `published` is where the walk starts, so it never appears as a step.
        const path: Step[] = [target as Step];
        let cursor: OrderStatus = target;
        while (previous.has(cursor)) {
          cursor = previous.get(cursor)!;
          if (cursor === ORDER_INITIAL_STATUS) break;
          path.unshift(cursor as Step);
        }
        return path;
      }
      queue.push(next);
    }
  }
  throw new Error(`${target} is unreachable from ${ORDER_INITIAL_STATUS}`);
}

let driverCounter = 100;

/** Record an offer to a fresh driver and accept it, binding it to the order. */
export async function bindAcceptedAssignment(
  harness: Harness,
  orderId: string,
): Promise<string> {
  driverCounter += 1;
  const assignment = await recordAssignment(harness, orderId, {
    driverPublicId: publicId(driverCounter),
  });
  await resolveAssignment(harness, orderId, {
    assignmentId: assignment.id,
    state: "accepted",
    reasonCode: null,
  });
  return assignment.id;
}

/**
 * Walk an order from `published` to `target` through real transitions.
 *
 * Each step uses the actor and reason the published table names for that edge,
 * so the walk itself is a check: if a documented edge were unusable in practice,
 * every test that passes through it would fail.
 */
export async function driveTo(
  harness: Harness,
  orderId: string,
  target: OrderStatus,
): Promise<void> {
  for (const next of shortestPath(target)) {
    const order = await harness.repository.findOrderById(orderId);
    const rule = transitionRule(order!.status, next);
    if (!rule) throw new Error(`no rule for ${order!.status} → ${String(next)}`);
    if (order!.activeAssignmentId == null && needsAssignment(next)) {
      await bindAcceptedAssignment(harness, orderId);
    }
    harness.clock.advance();
    await transitionOrder(harness, orderId, {
      toStatus: next,
      reasonCode: rule.typicalReason,
      actorType: rule.expectedActor,
      actorRef: rule.expectedActor === "system" ? null : publicId(1),
    });
  }
}

function needsAssignment(status: string): boolean {
  return (
    status === "accepted" ||
    status === "assigned" ||
    status === "driver_en_route" ||
    status === "arrived" ||
    status === "in_progress" ||
    status === "completed"
  );
}

/** An order sitting in `status`, ready for the assertion under test. */
export async function orderInStatus(
  harness: Harness,
  status: OrderStatus,
): Promise<string> {
  const orderId = await createOrder(harness);
  await driveTo(harness, orderId, status);
  return orderId;
}
