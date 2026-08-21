/**
 * In-memory adapters for the Order Engine ports.
 *
 * These are not a toy. They are the reference implementation of the port
 * contract: every schema.sql rule the use cases rely on is enforced here too, so
 * the parity suite in MR 3/6 can run the SAME use-case tests against Postgres
 * and prove the two agree. A permissive fake would turn that suite into
 * decoration — it would pass while the real store rejects the write.
 *
 * Deliberately synchronous under an async interface: no transaction machinery,
 * because a single-threaded JS map does not need one. The compound writes
 * (`insertOrder`, `applyTransition`) are still single methods, because the
 * TRANSACTION BOUNDARY is part of the port contract, not of the adapter.
 */

import { randomUUID } from "node:crypto";

import { ORDER_INITIAL_STATUS, type OrderDomainEvent } from "@wasla/contracts-order";

import { OrderError } from "../domain/errors.js";
import type {
  Assignment,
  Order,
  StatusHistoryEntry,
  Stop,
} from "../domain/model.js";
import { assignmentRequirement } from "../domain/state-machine.js";
import type {
  ApplyTransitionInput,
  Clock,
  IdGenerator,
  InsertAssignmentInput,
  InsertOrderInput,
  OrderPublicIdGenerator,
  OrderRepository,
  Outbox,
  ResolveAssignmentInput,
} from "../ports.js";

/** A fixed or steppable clock. Tests need time to be an input, not an ambient fact. */
export class FixedClock implements Clock {
  private current: number;

  constructor(start = "2026-01-01T00:00:00.000Z") {
    this.current = Date.parse(start);
  }

  now(): string {
    return new Date(this.current).toISOString();
  }

  /** Advance by whole seconds so ordering in the audit trail stays readable. */
  advance(seconds = 1): void {
    this.current += seconds * 1000;
  }
}

/**
 * The real wall clock (MR 4/6).
 *
 * The service process needs one: `FixedClock` exists so tests can make time an
 * input, and a running engine must not inherit a frozen clock by accident. Kept
 * beside it — rather than in `http/` — because the clock is an adapter for the
 * `Clock` port, and a use case called from anywhere else (Phase 07) needs the
 * same one. ISO-8601 in UTC, matching every `timestamptz` the contract stores.
 */
export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

/**
 * UUID v4 ids from the platform crypto (MR 4/6).
 *
 * `randomUUID` is a CSPRNG: order and assignment ids appear in URLs and in
 * events, so a guessable id would let a caller enumerate other customers' orders
 * by counting. `SequentialIdGenerator` — which is guessable on purpose — stays
 * for tests only.
 */
export class CryptoIdGenerator implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }
}

/** Deterministic UUID-shaped ids. Readable failures beat random ones. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = "0000") {}

  uuid(): string {
    this.counter += 1;
    const tail = String(this.counter).padStart(12, "0");
    return `${this.prefix}0000-0000-4000-8000-${tail}`;
  }
}

/**
 * Mints `ORD-##########` from an in-memory counter.
 *
 * Mirrors the database sequence: gapless and monotone. The format is asserted by
 * `ORDER_PUBLIC_ID_PATTERN`, so a drift here fails the tests rather than
 * shipping ids nobody can parse.
 */
export class InMemoryOrderPublicIdGenerator implements OrderPublicIdGenerator {
  private counter = 0;

  async nextOrderPublicId(): Promise<string> {
    this.counter += 1;
    return `ORD-${String(this.counter).padStart(10, "0")}`;
  }
}

interface StoredOrder {
  order: Order;
  history: StatusHistoryEntry[];
  assignments: Assignment[];
  idempotencyKey: string;
  payloadFingerprint: string;
}

/** In-memory `OrderRepository`, enforcing the schema's named constraints. */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, StoredOrder>();

  private stored(orderId: string): StoredOrder {
    const found = this.orders.get(orderId);
    if (!found) {
      throw new OrderError("ORDER_NOT_FOUND", `الطلب ${orderId} غير موجود`);
    }
    return found;
  }

  private all(): StoredOrder[] {
    return [...this.orders.values()];
  }

  async findOrderById(orderId: string): Promise<Order | null> {
    return this.orders.get(orderId)?.order ?? null;
  }

  async findOrderByPublicId(orderPublicId: string): Promise<Order | null> {
    return this.all().find((s) => s.order.orderPublicId === orderPublicId)?.order ?? null;
  }

  async findOrderByRequestId(orderRequestId: string): Promise<Order | null> {
    return this.all().find((s) => s.order.orderRequestId === orderRequestId)?.order ?? null;
  }

  async findOrderByIdempotencyKey(idempotencyKey: string): Promise<Order | null> {
    return this.all().find((s) => s.idempotencyKey === idempotencyKey)?.order ?? null;
  }

  /** The stored fingerprint, so the use case can tell replay from key reuse. */
  async findFingerprintByIdempotencyKey(idempotencyKey: string): Promise<string | null> {
    return this.all().find((s) => s.idempotencyKey === idempotencyKey)?.payloadFingerprint ?? null;
  }

  async listStatusHistory(orderId: string): Promise<StatusHistoryEntry[]> {
    return [...this.stored(orderId).history];
  }

  async listAssignments(orderId: string): Promise<Assignment[]> {
    return [...this.stored(orderId).assignments];
  }

  async findAssignment(orderId: string, assignmentId: string): Promise<Assignment | null> {
    return this.stored(orderId).assignments.find((a) => a.id === assignmentId) ?? null;
  }

  async findAssignmentByDriver(
    orderId: string,
    driverPublicId: string,
  ): Promise<Assignment | null> {
    return (
      this.stored(orderId).assignments.find((a) => a.driverPublicId === driverPublicId) ?? null
    );
  }

  async insertOrder(input: InsertOrderInput): Promise<{
    order: Order;
    historyEntry: StatusHistoryEntry;
  }> {
    // ux_orders_order_request_id: one order per customer request, ever.
    if (await this.findOrderByRequestId(input.orderRequestId)) {
      throw new OrderError(
        "ORDER_REQUEST_ALREADY_INGESTED",
        `طلب العميل ${input.orderRequestId} مُستوعب مسبقاً`,
      );
    }
    const stops: Stop[] = input.stops.map((stop) => ({ ...stop }));
    const order: Order = {
      id: input.id,
      orderPublicId: input.orderPublicId,
      orderRequestId: input.orderRequestId,
      customerPublicId: input.customerPublicId,
      orderType: input.orderType,
      vehicleClass: input.vehicleClass,
      status: ORDER_INITIAL_STATUS,
      statusReasonCode: null,
      priceMode: input.priceMode,
      offeredPrice: input.offeredPrice,
      stops,
      shipment: input.shipment,
      notes: input.notes,
      activeAssignmentId: null,
      requestedAt: input.requestedAt,
      acceptedAt: input.acceptedAt,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    // The creation audit row is the only row with from_status = null.
    const historyEntry: StatusHistoryEntry = {
      sequence: 1,
      fromStatus: null,
      toStatus: ORDER_INITIAL_STATUS,
      reasonCode: null,
      actorType: "system",
      actorRef: null,
      occurredAt: input.createdAt,
      traceId: null,
    };
    this.orders.set(order.id, {
      order,
      history: [historyEntry],
      assignments: [],
      idempotencyKey: input.idempotencyKey,
      payloadFingerprint: input.payloadFingerprint,
    });
    return { order, historyEntry };
  }

  async applyTransition(input: ApplyTransitionInput): Promise<{
    order: Order;
    historyEntry: StatusHistoryEntry;
  }> {
    const stored = this.stored(input.orderId);
    const fromStatus = stored.order.status;

    // ck_orders_assignment_matches_status — the adapter refuses the impossible
    // row even if a use case forgets to check.
    const requirement = assignmentRequirement(input.toStatus);
    if (requirement === "required" && input.activeAssignmentId == null) {
      throw new OrderError(
        "ORDER_ASSIGNMENT_REQUIRED",
        `الحالة ${input.toStatus} تستلزم إسناداً نشطاً`,
        { details: { from: fromStatus, to: input.toStatus } },
      );
    }
    if (requirement === "forbidden" && input.activeAssignmentId != null) {
      throw new OrderError(
        "ORDER_ASSIGNMENT_FORBIDDEN",
        `الحالة ${input.toStatus} لا تحمل إسناداً نشطاً`,
        { details: { from: fromStatus, to: input.toStatus } },
      );
    }

    const historyEntry: StatusHistoryEntry = {
      sequence: stored.history.length + 1,
      fromStatus,
      toStatus: input.toStatus,
      reasonCode: input.reasonCode,
      actorType: input.actorType,
      actorRef: input.actorRef,
      occurredAt: input.occurredAt,
      traceId: input.traceId,
    };
    stored.history.push(historyEntry);
    stored.order = {
      ...stored.order,
      status: input.toStatus,
      statusReasonCode: input.reasonCode,
      activeAssignmentId: input.activeAssignmentId,
      updatedAt: input.occurredAt,
    };
    return { order: stored.order, historyEntry };
  }

  async insertAssignment(input: InsertAssignmentInput): Promise<Assignment> {
    const stored = this.stored(input.orderId);
    // ux_order_assignments_order_driver: the same driver is never offered the
    // same order twice — a duplicate offer would double-count a decline.
    if (stored.assignments.some((a) => a.driverPublicId === input.driverPublicId)) {
      throw new OrderError(
        "ORDER_ASSIGNMENT_DUPLICATE",
        `السائق ${input.driverPublicId} عُرض عليه هذا الطلب مسبقاً`,
      );
    }
    const assignment: Assignment = {
      id: input.id,
      orderId: input.orderId,
      driverPublicId: input.driverPublicId,
      sequence: stored.assignments.length + 1,
      state: "offered",
      reasonCode: null,
      offeredAt: input.offeredAt,
      acceptedAt: null,
      rejectedAt: null,
      expiredAt: null,
      cancelledAt: null,
    };
    stored.assignments.push(assignment);
    return assignment;
  }

  async resolveAssignment(input: ResolveAssignmentInput): Promise<Assignment> {
    for (const stored of this.all()) {
      const index = stored.assignments.findIndex((a) => a.id === input.assignmentId);
      if (index === -1) continue;
      const current = stored.assignments[index]!;
      // An offer is resolved once: re-resolving would rewrite history.
      if (current.state !== "offered") {
        throw new OrderError(
          "ORDER_ASSIGNMENT_ALREADY_RESOLVED",
          `الإسناد ${input.assignmentId} محسوم مسبقاً بحالة ${current.state}`,
        );
      }
      // ck_order_assignments_state_timestamp: the state names its timestamp.
      const resolved: Assignment = {
        ...current,
        state: input.state,
        reasonCode: input.reasonCode,
        acceptedAt: input.state === "accepted" ? input.resolvedAt : null,
        rejectedAt: input.state === "rejected" ? input.resolvedAt : null,
        expiredAt: input.state === "expired" ? input.resolvedAt : null,
        cancelledAt: input.state === "cancelled" ? input.resolvedAt : null,
      };
      stored.assignments[index] = resolved;
      return resolved;
    }
    throw new OrderError(
      "ORDER_ASSIGNMENT_NOT_FOUND",
      `الإسناد ${input.assignmentId} غير موجود`,
    );
  }

  async setActiveAssignment(
    orderId: string,
    assignmentId: string | null,
    updatedAt: string,
  ): Promise<Order> {
    const stored = this.stored(orderId);
    if (assignmentId != null && !stored.assignments.some((a) => a.id === assignmentId)) {
      // fk_orders_active_assignment: the order cannot point at a record that
      // does not belong to it.
      throw new OrderError(
        "ORDER_ASSIGNMENT_NOT_FOUND",
        `الإسناد ${assignmentId} لا ينتمي إلى الطلب ${orderId}`,
      );
    }
    // ck_orders_assignment_matches_status — enforced here too, because an
    // adapter that accepts what the database refuses turns every in-memory test
    // into a false negative. This exact hole let acceptance bind a driver onto an
    // `offered` order and pass 621 tests while failing on Postgres (Phase 06 gate).
    const requirement = assignmentRequirement(stored.order.status);
    if (requirement === "forbidden" && assignmentId != null) {
      throw new OrderError(
        "ORDER_ASSIGNMENT_FORBIDDEN",
        `الحالة ${stored.order.status} لا تجوز أن تحمل إسناداً نشطاً`,
        { details: { from: stored.order.status } },
      );
    }
    if (requirement === "required" && assignmentId == null) {
      throw new OrderError(
        "ORDER_ASSIGNMENT_REQUIRED",
        `الحالة ${stored.order.status} تستلزم إسناداً نشطاً`,
        { details: { from: stored.order.status } },
      );
    }
    stored.order = { ...stored.order, activeAssignmentId: assignmentId, updatedAt };
    return stored.order;
  }
}

/** In-memory `Outbox`. Append-only, ordered — exactly like the table. */
export class InMemoryOutbox implements Outbox {
  private readonly events: OrderDomainEvent[] = [];

  async append(event: OrderDomainEvent): Promise<void> {
    this.events.push(event);
  }

  async unread(): Promise<OrderDomainEvent[]> {
    return [...this.events];
  }
}
