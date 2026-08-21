/**
 * The transition use case, exercised over the WHOLE pair space.
 *
 * The sweep is the point: 441 attempts, each against a real order that was
 * legitimately driven into its starting state, asserting that exactly the 72
 * documented pairs succeed and the other 369 are refused with
 * `ORDER_ILLEGAL_TRANSITION`. A test that only checked a few interesting cases
 * would prove the interesting cases; this one proves there is nothing else.
 */

import { ORDER_STATUSES, type OrderStatus } from "@wasla/contracts-order";
import { beforeEach, describe, expect, it } from "vitest";

import { OrderError } from "../domain/errors.js";
import {
  isTerminalStatus,
  isTransitionAllowed,
  transitionRule,
} from "../domain/state-machine.js";
import { transitionOrder } from "../use-cases/transition-order.js";
import {
  bindAcceptedAssignment,
  createOrder,
  makeHarness,
  orderInStatus,
  publicId,
  type Harness,
} from "./harness.js";

let harness: Harness;

beforeEach(() => {
  harness = makeHarness();
});

async function attempt(from: OrderStatus, to: OrderStatus): Promise<OrderError | null> {
  const local = makeHarness();
  const orderId = await orderInStatus(local, from);
  const rule = transitionRule(from, to);
  const actorType = rule?.expectedActor ?? "admin";
  // A driver-bound target needs its assignment recorded first; that is the
  // documented precondition, not part of what the sweep is testing.
  if (
    rule &&
    (to === "accepted" || to === "assigned" || to === "driver_en_route" ||
      to === "arrived" || to === "in_progress" || to === "completed")
  ) {
    const order = await local.repository.findOrderById(orderId);
    if (order!.activeAssignmentId == null) await bindAcceptedAssignment(local, orderId);
  }
  try {
    await transitionOrder(local, orderId, {
      toStatus: to,
      // Terminal targets always get a reason so the sweep isolates the table
      // rule from the reason rule, which has its own tests below.
      reasonCode: rule?.typicalReason ?? (isTerminalStatus(to) ? "TECHNICAL_FAILURE" : null),
      actorType,
      actorRef: actorType === "system" ? null : publicId(1),
    });
    return null;
  } catch (error) {
    if (error instanceof OrderError) return error;
    throw error;
  }
}

describe("the full 441-pair sweep", () => {
  for (const from of ORDER_STATUSES) {
    describe(`from ${from}`, () => {
      for (const to of ORDER_STATUSES) {
        const allowed = isTransitionAllowed(from, to);
        it(`${allowed ? "accepts" : "refuses"} ${from} → ${to}`, async () => {
          const error = await attempt(from, to);
          if (allowed) {
            expect(error).toBeNull();
          } else {
            expect(error?.code).toBe("ORDER_ILLEGAL_TRANSITION");
            expect(error?.httpStatus).toBe(409);
            expect(error?.details).toEqual({ from, to });
          }
        });
      }
    });
  }
});

describe("the audit trail", () => {
  it("has one row per transition plus the creation row", async () => {
    const orderId = await createOrder(harness);
    for (const target of ["searching", "offered", "driver_rejected", "searching"] as const) {
      harness.clock.advance();
      const rule = transitionRule(
        (await harness.repository.findOrderById(orderId))!.status,
        target,
      )!;
      await transitionOrder(harness, orderId, {
        toStatus: target,
        reasonCode: rule.typicalReason,
        actorType: rule.expectedActor,
        actorRef: rule.expectedActor === "system" ? null : publicId(1),
      });
    }
    const history = await harness.repository.listStatusHistory(orderId);
    expect(history).toHaveLength(5);
    expect(history.map((row) => row.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(history.map((row) => row.toStatus)).toEqual([
      "published",
      "searching",
      "offered",
      "driver_rejected",
      "searching",
    ]);
  });

  it("records from_status = null exactly once, at creation", async () => {
    const orderId = await orderInStatus(harness, "in_progress");
    const history = await harness.repository.listStatusHistory(orderId);
    const births = history.filter((row) => row.fromStatus === null);
    expect(births).toHaveLength(1);
    expect(births[0]!.sequence).toBe(1);
    expect(births[0]!.toStatus).toBe("published");
  });

  it("chains every row to the previous status", async () => {
    const orderId = await orderInStatus(harness, "completed");
    const history = await harness.repository.listStatusHistory(orderId);
    for (let index = 1; index < history.length; index += 1) {
      expect(history[index]!.fromStatus).toBe(history[index - 1]!.toStatus);
    }
  });

  it("emits one status_changed event per audit row", async () => {
    const orderId = await orderInStatus(harness, "arrived");
    const history = await harness.repository.listStatusHistory(orderId);
    const events = await harness.outbox.unread();
    const statusEvents = events.filter((e) => e.event_type === "order.status_changed");
    expect(statusEvents).toHaveLength(history.length);
    expect(statusEvents.map((e) => (e.data as { sequence: number }).sequence)).toEqual(
      history.map((row) => row.sequence),
    );
  });

  it("derives is_terminal in the event from the table", async () => {
    await orderInStatus(harness, "no_driver_found");
    const events = await harness.outbox.unread();
    const statusEvents = events.filter((e) => e.event_type === "order.status_changed");
    const last = statusEvents.at(-1)!.data as { to_status: OrderStatus; is_terminal: boolean };
    expect(last.to_status).toBe("no_driver_found");
    expect(last.is_terminal).toBe(true);
    const first = statusEvents[0]!.data as { is_terminal: boolean };
    expect(first.is_terminal).toBe(false);
  });
});

describe("reason codes", () => {
  it("refuses a terminal transition with no reason", async () => {
    const orderId = await orderInStatus(harness, "searching");
    await expect(
      transitionOrder(harness, orderId, {
        toStatus: "expired",
        reasonCode: null,
        actorType: "system",
        actorRef: null,
      }),
    ).rejects.toMatchObject({ code: "ORDER_REASON_CODE_REQUIRED", httpStatus: 422 });
  });

  it("refuses a reason outside the closed catalog", async () => {
    const orderId = await orderInStatus(harness, "searching");
    await expect(
      transitionOrder(harness, orderId, {
        toStatus: "expired",
        reasonCode: "BECAUSE_I_SAID_SO" as never,
        actorType: "system",
        actorRef: null,
      }),
    ).rejects.toMatchObject({ code: "ORDER_REASON_CODE_UNKNOWN", httpStatus: 422 });
  });

  it("accepts a non-terminal transition without a reason", async () => {
    const orderId = await createOrder(harness);
    const result = await transitionOrder(harness, orderId, {
      toStatus: "searching",
      reasonCode: null,
      actorType: "system",
      actorRef: null,
    });
    expect(result.order.status).toBe("searching");
    expect(result.order.statusReasonCode).toBeNull();
  });

  it("stores the reason on the order and on the audit row", async () => {
    const orderId = await orderInStatus(harness, "searching");
    const result = await transitionOrder(harness, orderId, {
      toStatus: "customer_cancelled",
      reasonCode: "CUSTOMER_WAIT_TOO_LONG",
      actorType: "customer",
      actorRef: publicId(1),
    });
    expect(result.order.statusReasonCode).toBe("CUSTOMER_WAIT_TOO_LONG");
    expect(result.historyEntry.reasonCode).toBe("CUSTOMER_WAIT_TOO_LONG");
  });

  it("checks the table before the reason: an illegal pair reports the pair", async () => {
    const orderId = await createOrder(harness);
    const error = await transitionOrder(harness, orderId, {
      toStatus: "driver_cancelled",
      reasonCode: null,
      actorType: "driver",
      actorRef: publicId(2),
    }).then(
      () => null,
      (e: unknown) => e as OrderError,
    );
    expect(error?.code).toBe("ORDER_ILLEGAL_TRANSITION");
  });
});

describe("actor shape", () => {
  it("refuses a system actor carrying a reference", async () => {
    const orderId = await createOrder(harness);
    await expect(
      transitionOrder(harness, orderId, {
        toStatus: "searching",
        reasonCode: null,
        actorType: "system",
        actorRef: publicId(9),
      }),
    ).rejects.toMatchObject({ code: "ORDER_ACTOR_REF_FORBIDDEN", httpStatus: 422 });
  });

  it("refuses a human actor with no reference", async () => {
    const orderId = await createOrder(harness);
    await expect(
      transitionOrder(harness, orderId, {
        toStatus: "customer_cancelled",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        actorType: "customer",
        actorRef: null,
      }),
    ).rejects.toMatchObject({ code: "ORDER_ACTOR_REF_REQUIRED", httpStatus: 422 });
  });

  it("refuses a malformed reference", async () => {
    const orderId = await createOrder(harness);
    await expect(
      transitionOrder(harness, orderId, {
        toStatus: "customer_cancelled",
        reasonCode: "CUSTOMER_CHANGED_MIND",
        actorType: "customer",
        actorRef: "customer-42",
      }),
    ).rejects.toMatchObject({ code: "ORDER_VALIDATION_FAILED", httpStatus: 400 });
  });
});

describe("assignment coupling", () => {
  it("refuses a driver-bound status with no accepted assignment", async () => {
    const orderId = await orderInStatus(harness, "offered");
    await expect(
      transitionOrder(harness, orderId, {
        toStatus: "accepted",
        reasonCode: null,
        actorType: "driver",
        actorRef: publicId(2),
      }),
    ).rejects.toMatchObject({ code: "ORDER_ASSIGNMENT_REQUIRED", httpStatus: 422 });
  });

  it("carries the assignment through the driver-bound states", async () => {
    const orderId = await orderInStatus(harness, "in_progress");
    const order = await harness.repository.findOrderById(orderId);
    expect(order!.activeAssignmentId).not.toBeNull();
  });

  it("releases the driver when the order returns to the search", async () => {
    const orderId = await orderInStatus(harness, "offered");
    await bindAcceptedAssignment(harness, orderId);
    await transitionOrder(harness, orderId, {
      toStatus: "driver_rejected",
      reasonCode: "DRIVER_DECLINED",
      actorType: "driver",
      actorRef: publicId(2),
    });
    await transitionOrder(harness, orderId, {
      toStatus: "searching",
      reasonCode: "SEARCH_RESUMED",
      actorType: "system",
      actorRef: null,
    });
    const order = await harness.repository.findOrderById(orderId);
    expect(order!.status).toBe("searching");
    expect(order!.activeAssignmentId).toBeNull();
  });

  it("names the active driver in the status event", async () => {
    await orderInStatus(harness, "assigned");
    const events = await harness.outbox.unread();
    const last = events.filter((e) => e.event_type === "order.status_changed").at(-1)!;
    expect((last.data as { driver_public_id: string | null }).driver_public_id).toMatch(
      /^WS-\d{10}$/,
    );
  });
});

describe("missing order", () => {
  it("reports 404 rather than inventing one", async () => {
    await expect(
      transitionOrder(harness, "00000000-0000-4000-8000-000000000404", {
        toStatus: "searching",
        reasonCode: null,
        actorType: "system",
        actorRef: null,
      }),
    ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND", httpStatus: 404 });
  });
});
