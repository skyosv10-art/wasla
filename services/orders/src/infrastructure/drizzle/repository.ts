/**
 * Postgres adapters for the Order Engine ports.
 *
 * `PostgresOrderRepository` implements `OrderRepository` and
 * `PostgresOrderOutbox` implements `Outbox`, both against the canonical DDL in
 * `services/orders/contracts/schema.sql`. No use case changes when the in-memory
 * adapters are swapped for these — that is the property the port-conformance
 * suite proves by running one set of scenarios twice, once per adapter
 * (`src/__tests__/port-conformance.integration.test.ts`).
 *
 * Atomicity (ADR-010 §127): unlike the customer service, where the repository
 * write and the outbox append were two separate `Db` instances (documented debt),
 * here BOTH adapters accept a `DbOrTx` handle. When `PostgresOrderUnitOfWork`
 * (transaction.ts) hands the same transaction tx to both, the status update +
 * audit row + outbox event share one transaction and commit or roll back
 * together — the triple write this phase promised, with no change to
 * `src/use-cases/`.
 *
 * Three deliberate choices, each of which has a cheaper wrong version:
 *
 *  1. **NULL columns become absent keys, not `null` values.** A stop whose
 *     `label` is NULL reconstructs as `{ kind, zoneId, ... }` without `label`,
 *     exactly the object the validator produced before it was stored.
 *     Reconstructing `{ label: null, ... }` would compare unequal to the in-memory
 *     adapter and would make the parity snapshots diverge on adapter shape, not
 *     behavior.
 *
 *  2. **Unique-violation and CHECK errors are translated.** Postgres raises
 *     SQLSTATE 23505 / 23514 where the in-memory adapter throws an `OrderError`.
 *     Callers must not have to know which adapter they hold, so the constraints the
 *     use cases rely on (idempotency key uniqueness, request id uniqueness,
 *     one-offer-per-driver, assignment/status coupling) surface with the same
 *     `OrderError` code from both.
 *
 *  3. **`NUMERIC` and `BIGINT` are parsed once, here.** `pg` returns numerics as
 *     strings to avoid float surprises; letting a string escape into the domain
 *     would make `shipmentWeightKg` sometimes `3.5` and sometimes `"3.50"`.
 */

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { OrderDomainEvent } from "@wasla/contracts-order";

import { OrderError } from "../../domain/errors.js";
import type {
  Assignment,
  Coordinates,
  Money,
  Order,
  ShipmentDetails,
  StatusHistoryEntry,
  Stop,
} from "../../domain/model.js";
import type {
  ApplyTransitionInput,
  InsertAssignmentInput,
  InsertOrderInput,
  OrderPublicIdGenerator,
  OrderRepository,
  Outbox,
  ResolveAssignmentInput,
  RecordAgreedPriceInput,
} from "../../ports.js";
import type { DbOrTx } from "./db.js";
import {
  orderAssignments,
  orderOutbox,
  orders,
  orderStatusHistory,
  orderStops,
} from "./schema.js";

// --------------------------------------------------------------------------- //
// Column ⇄ domain conversions                                                //
// --------------------------------------------------------------------------- //

/** `pg` returns NUMERIC as a string; the domain speaks numbers. */
function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function toCoordinates(
  latitude: string | null,
  longitude: string | null,
): Coordinates | null {
  const lat = toNumber(latitude);
  const lon = toNumber(longitude);
  // The schema CHECK guarantees both or neither, so one NULL means no point.
  return lat === null || lon === null ? null : { latitude: lat, longitude: lon };
}

/** Rebuild a stop with absent keys for NULL columns (choice 1 above). */
function toStop(row: {
  kind: string;
  zoneId: string;
  label: string | null;
  source: string;
  latitude: string | null;
  longitude: string | null;
}): Stop {
  const stop: Stop = {
    kind: row.kind as Stop["kind"],
    zoneId: row.zoneId,
    source: row.source as Stop["source"],
    label: row.label,
    savedPlaceId: null,
    coordinates: toCoordinates(row.latitude, row.longitude),
  };
  return stop;
}

function toMoney(
  amountMinor: number | null,
  currency: string | null,
): Money | null {
  return amountMinor === null || currency === null
    ? null
    : { amountMinor, currency };
}

/** Rebuild shipment details with absent keys for NULL columns. */
function toShipment(row: {
  shipmentType: string | null;
  shipmentDescription: string | null;
  weightKg: string | null;
}): ShipmentDetails | null {
  const shipment: {
    shipmentType?: ShipmentDetails["shipmentType"];
    description?: string | null;
    weightKg?: number | null;
  } = {};
  if (row.shipmentType !== null)
    shipment.shipmentType = row.shipmentType as ShipmentDetails["shipmentType"];
  if (row.shipmentDescription !== null)
    shipment.description = row.shipmentDescription;
  if (row.weightKg !== null) shipment.weightKg = toNumber(row.weightKg);
  return Object.keys(shipment).length === 0 ? null : (shipment as ShipmentDetails);
}

function toOrder(row: typeof orders.$inferSelect, stops: Stop[]): Order {
  return {
    id: row.id,
    orderPublicId: row.orderPublicId,
    orderRequestId: row.orderRequestId,
    customerPublicId: row.customerPublicId,
    orderType: row.orderType as Order["orderType"],
    vehicleClass: row.vehicleClass as Order["vehicleClass"],
    status: row.status as Order["status"],
    statusReasonCode: row.statusReasonCode as Order["statusReasonCode"],
    priceMode: row.priceMode as Order["priceMode"],
    offeredPrice: toMoney(row.offeredAmountMinor, row.offeredCurrency),
    agreedPrice: toMoney(row.agreedAmountMinor, row.agreedCurrency),
    agreedAt: row.agreedAt?.toISOString() ?? null,
    agreedNegotiationId: row.agreedNegotiationId,
    stops,
    shipment: toShipment({
      shipmentType: row.shipmentType,
      shipmentDescription: row.shipmentDescription,
      weightKg: row.shipmentWeightKg,
    }),
    notes: row.notes,
    activeAssignmentId: row.activeAssignmentId,
    requestedAt: row.requestedAt.toISOString(),
    acceptedAt: row.acceptedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toHistoryEntry(
  row: typeof orderStatusHistory.$inferSelect,
): StatusHistoryEntry {
  return {
    sequence: row.sequence,
    fromStatus: row.fromStatus as StatusHistoryEntry["fromStatus"],
    toStatus: row.toStatus as StatusHistoryEntry["toStatus"],
    reasonCode: row.reasonCode as StatusHistoryEntry["reasonCode"],
    actorType: row.actorType as StatusHistoryEntry["actorType"],
    actorRef: row.actorRef,
    occurredAt: row.occurredAt.toISOString(),
    traceId: row.traceId,
  };
}

function toAssignment(
  row: typeof orderAssignments.$inferSelect,
): Assignment {
  return {
    id: row.id,
    orderId: row.orderId,
    driverPublicId: row.driverPublicId,
    sequence: row.sequence,
    state: row.assignmentState as Assignment["state"],
    reasonCode: row.reasonCode as Assignment["reasonCode"],
    offeredAt: row.offeredAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    expiredAt: row.expiredAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}

// --------------------------------------------------------------------------- //
// Error translation                                                           //
// --------------------------------------------------------------------------- //

/**
 * Walk a Drizzle error's cause chain to find a Postgres `DatabaseError` carrying
 * a SQLSTATE. Drizzle wraps driver errors; the constraint name lives on
 * `error.cause.constraint` when the driver exposes it.
 */
function postgresCode(error: unknown): string | undefined {
  let cursor: unknown = error;
  for (let depth = 0; depth < 4 && cursor !== null; depth += 1) {
    if (typeof cursor !== "object") return undefined;
    const candidate = cursor as { code?: unknown };
    if (typeof candidate.code === "string" && candidate.code.length === 5) {
      return candidate.code;
    }
    const cause = (cursor as { cause?: unknown }).cause;
    if (cause === cursor) return undefined;
    cursor = cause;
  }
  return undefined;
}

function postgresConstraint(error: unknown): string | undefined {
  let cursor: unknown = error;
  for (let depth = 0; depth < 4 && cursor !== null; depth += 1) {
    if (typeof cursor !== "object") return undefined;
    const candidate = cursor as { constraint?: unknown };
    if (typeof candidate.constraint === "string") return candidate.constraint;
    const cause = (cursor as { cause?: unknown }).cause;
    if (cause === cursor) return undefined;
    cursor = cause;
  }
  return undefined;
}

/**
 * Translate Postgres constraint violations into the `OrderError` codes the use
 * cases and tests already know. The in-memory adapter throws these directly; a
 * Postgres adapter that let SQLSTATE escape would force callers to branch on the
 * adapter they hold — the exact coupling the port boundary exists to prevent.
 */
function translateWriteError(
  error: unknown,
  context: { orderId?: string; driverPublicId?: string; traceId?: string | null },
): never {
  const code = postgresCode(error);
  const constraint = postgresConstraint(error);
  const traceId = context.traceId ?? undefined;

  if (code === "23505") {
    switch (constraint) {
      case "ux_orders_idempotency_key":
      case "orders_idempotency_key_key":
        throw new OrderError(
          "ORDER_IDEMPOTENCY_KEY_REUSED",
          "مفتاح التكرار مُستخدم مسبقاً بحمولة مختلفة",
          { traceId },
        );
      // `order_request_id` is declared UNIQUE inline on the column, so Postgres
      // generates the constraint name `orders_order_request_id_key` rather than a
      // named `ux_...` index.
      case "ux_orders_request_id":
      case "orders_order_request_id_key":
        throw new OrderError(
          "ORDER_REQUEST_ALREADY_INGESTED",
          "طلب العميل مُستوعب مسبقاً",
          { traceId },
        );
      case "ux_order_assignments_order_driver":
      case "order_assignments_order_id_driver_public_id_key":
        throw new OrderError(
          "ORDER_ASSIGNMENT_DUPLICATE",
          `السائق ${context.driverPublicId ?? "?"} عُرض عليه هذا الطلب مسبقاً`,
          { traceId },
        );
      case "ux_orders_agreed_negotiation":
        throw new OrderError(
          "ORDER_AGREED_PRICE_ALREADY_SET",
          "خيط التفاوض سجّل سعراً على طلب آخر",
          { traceId },
        );
      case "ux_order_status_history_order_sequence":
      case "order_status_history_order_id_sequence_key":
      case "ux_order_assignments_order_sequence":
      case "order_assignments_order_id_sequence_key":
        // Two concurrent writers raced for the same sequence slot. Re-reading the
        // order would yield a different sequence than the caller intended, so this
        // is a conflict, not a retry.
        throw new OrderError(
          "ORDER_ILLEGAL_TRANSITION",
          "تعارض تسلسل في كتابة التدقيق",
          { traceId, details: { field: constraint } },
        );
      default:
        throw new OrderError(
          "ORDER_IDEMPOTENCY_KEY_REUSED",
          "تعارض تفرّد غير مُصنَّف",
          { traceId, details: { field: constraint ?? "unknown" } },
        );
    }
  }

  if (code === "23503") {
    // Foreign-key violation: the referenced row does not exist. The transition
    // path inserts the audit row before updating the order, so a transition on a
    // nonexistent order fails here first — and the caller must see ORDER_NOT_FOUND,
    // not a raw FK error. The active-assignment FK is the exception: a violation
    // there means the assignment was missing, not the order.
    if (constraint === "fk_orders_active_assignment") {
      throw new OrderError(
        "ORDER_ASSIGNMENT_NOT_FOUND",
        `الإسناد غير موجود`,
        { traceId },
      );
    }
    throw new OrderError(
      "ORDER_NOT_FOUND",
      `الطلب ${context.orderId ?? "?"} غير موجود`,
      { traceId },
    );
  }

  if (code === "23514") {
    // CHECK constraint: the most likely culprit is the assignment/status coupling
    // (ck_orders_assignment_matches_status), which the in-memory adapter raises as
    // ORDER_ASSIGNMENT_REQUIRED / ORDER_ASSIGNMENT_FORBIDDEN.
    if (constraint === "ck_orders_assignment_matches_status") {
      throw new OrderError(
        "ORDER_ASSIGNMENT_FORBIDDEN",
        "الحالة الحالية لا تجوز أن تحمل إسناداً نشطاً",
        { traceId, details: { field: constraint } },
      );
    }
    throw new OrderError(
      "ORDER_VALIDATION_FAILED",
      "قيد قاعدة رفض الكتابة",
      { traceId, details: { field: constraint ?? "unknown" } },
    );
  }

  // Not a recognised constraint error — rethrow so the caller sees the real cause.
  throw error;
}

// --------------------------------------------------------------------------- //
// Repository                                                                  //
// --------------------------------------------------------------------------- //

/**
 * Postgres `OrderRepository`. Accepts a `DbOrTx` handle: the root `db` for reads
 * and standalone writes, or a transaction `tx` shared with `PostgresOrderOutbox`
 * when the write must be atomic with its event (the triple write).
 */
export class PostgresOrderRepository implements OrderRepository {
  constructor(private readonly db: DbOrTx) {}

  async findOrderById(orderId: string): Promise<Order | null> {
    const row = await this.db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    return row[0] ? toOrder(row[0], await this.loadStops(row[0].id)) : null;
  }

  async findOrderByPublicId(orderPublicId: string): Promise<Order | null> {
    const row = await this.db
      .select()
      .from(orders)
      .where(eq(orders.orderPublicId, orderPublicId))
      .limit(1);
    return row[0] ? toOrder(row[0], await this.loadStops(row[0].id)) : null;
  }

  async findOrderByRequestId(orderRequestId: string): Promise<Order | null> {
    const row = await this.db
      .select()
      .from(orders)
      .where(eq(orders.orderRequestId, orderRequestId))
      .limit(1);
    return row[0] ? toOrder(row[0], await this.loadStops(row[0].id)) : null;
  }

  async findOrderByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<Order | null> {
    const row = await this.db
      .select()
      .from(orders)
      .where(eq(orders.idempotencyKey, idempotencyKey))
      .limit(1);
    return row[0] ? toOrder(row[0], await this.loadStops(row[0].id)) : null;
  }

  async findFingerprintByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<string | null> {
    const row = await this.db
      .select({ fingerprint: orders.payloadFingerprint })
      .from(orders)
      .where(eq(orders.idempotencyKey, idempotencyKey))
      .limit(1);
    return row[0]?.fingerprint ?? null;
  }

  async listStatusHistory(orderId: string): Promise<StatusHistoryEntry[]> {
    const rows = await this.db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(asc(orderStatusHistory.sequence));
    return rows.map(toHistoryEntry);
  }

  async listAssignments(orderId: string): Promise<Assignment[]> {
    const rows = await this.db
      .select()
      .from(orderAssignments)
      .where(eq(orderAssignments.orderId, orderId))
      .orderBy(asc(orderAssignments.sequence));
    return rows.map(toAssignment);
  }

  async findAssignment(
    orderId: string,
    assignmentId: string,
  ): Promise<Assignment | null> {
    const row = await this.db
      .select()
      .from(orderAssignments)
      .where(
        and(
          eq(orderAssignments.orderId, orderId),
          eq(orderAssignments.id, assignmentId),
        ),
      )
      .limit(1);
    return row[0] ? toAssignment(row[0]) : null;
  }

  async findAssignmentByDriver(
    orderId: string,
    driverPublicId: string,
  ): Promise<Assignment | null> {
    const row = await this.db
      .select()
      .from(orderAssignments)
      .where(
        and(
          eq(orderAssignments.orderId, orderId),
          eq(orderAssignments.driverPublicId, driverPublicId),
        ),
      )
      .limit(1);
    return row[0] ? toAssignment(row[0]) : null;
  }

  async insertOrder(input: InsertOrderInput): Promise<{
    order: Order;
    historyEntry: StatusHistoryEntry;
  }> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(orders)
          .values({
            id: input.id,
            orderPublicId: input.orderPublicId,
            orderRequestId: input.orderRequestId,
            customerPublicId: input.customerPublicId,
            orderType: input.orderType,
            vehicleClass: input.vehicleClass,
            status: "published",
            priceMode: input.priceMode,
            offeredAmountMinor: input.offeredPrice?.amountMinor ?? null,
            offeredCurrency: input.offeredPrice?.currency ?? null,
            shipmentDescription: input.shipment?.description ?? null,
            shipmentType: input.shipment?.shipmentType ?? null,
            shipmentWeightKg:
              input.shipment?.weightKg == null
                ? null
                : String(input.shipment.weightKg),
            notes: input.notes,
            idempotencyKey: input.idempotencyKey,
            payloadFingerprint: input.payloadFingerprint,
            requestedAt: new Date(input.requestedAt),
            acceptedAt: new Date(input.acceptedAt),
            createdAt: new Date(input.createdAt),
          })
          .returning();

        if (row === undefined) {
          throw new OrderError("ORDER_VALIDATION_FAILED", "لم يُدرج الطلب");
        }

        await tx.insert(orderStops).values(
          input.stops.map((stop, index) => ({
            id: crypto.randomUUID(),
            orderId: row.id,
            sequence: index,
            kind: stop.kind,
            zoneId: stop.zoneId,
            label: stop.label,
            source: stop.source,
            latitude:
              stop.coordinates?.latitude == null
                ? null
                : String(stop.coordinates.latitude),
            longitude:
              stop.coordinates?.longitude == null
                ? null
                : String(stop.coordinates.longitude),
          })),
        );

        const [historyRow] = await tx
          .insert(orderStatusHistory)
          .values({
            id: crypto.randomUUID(),
            orderId: row.id,
            sequence: 1,
            fromStatus: null,
            toStatus: "published",
            reasonCode: null,
            actorType: "system",
            actorRef: null,
            traceId: null,
            occurredAt: new Date(input.createdAt),
          })
          .returning();

        const stops = await this.loadStops(row.id, tx);
        const order = toOrder(row, stops);
        const historyEntry = toHistoryEntry(historyRow!);
        return { order, historyEntry };
      });
    } catch (error) {
      return translateWriteError(error, { traceId: null });
    }
  }

  async applyTransition(input: ApplyTransitionInput): Promise<{
    order: Order;
    historyEntry: StatusHistoryEntry;
  }> {
    try {
      return await this.db.transaction(async (tx) => {
        const sequenceResult = await tx
          .select({
            next: sql<number>`coalesce(max(${orderStatusHistory.sequence}), 0) + 1`,
          })
          .from(orderStatusHistory)
          .where(eq(orderStatusHistory.orderId, input.orderId));

        const nextSequence = sequenceResult[0]?.next ?? 1;

        const [historyRow] = await tx
          .insert(orderStatusHistory)
          .values({
            id: crypto.randomUUID(),
            orderId: input.orderId,
            sequence: nextSequence,
            fromStatus: (
              await tx
                .select({ status: orders.status })
                .from(orders)
                .where(eq(orders.id, input.orderId))
                .limit(1)
            )[0]?.status ?? null,
            toStatus: input.toStatus,
            reasonCode: input.reasonCode,
            actorType: input.actorType,
            actorRef: input.actorRef,
            traceId: input.traceId,
            occurredAt: new Date(input.occurredAt),
          })
          .returning();

        const [updatedRow] = await tx
          .update(orders)
          .set({
            status: input.toStatus,
            statusReasonCode: input.reasonCode,
            activeAssignmentId: input.activeAssignmentId,
          })
          .where(eq(orders.id, input.orderId))
          .returning();

        if (updatedRow === undefined) {
          throw new OrderError(
            "ORDER_NOT_FOUND",
            `الطلب ${input.orderId} غير موجود`,
            { traceId: input.traceId ?? undefined },
          );
        }

        const stops = await this.loadStops(updatedRow.id, tx);
        const order = toOrder(updatedRow, stops);
        const historyEntry = toHistoryEntry(historyRow!);
        return { order, historyEntry };
      });
    } catch (error) {
      return translateWriteError(error, {
        orderId: input.orderId,
        traceId: input.traceId,
      });
    }
  }

  async insertAssignment(input: InsertAssignmentInput): Promise<Assignment> {
    try {
      return await this.db.transaction(async (tx) => {
        const sequenceResult = await tx
          .select({
            next: sql<number>`coalesce(max(${orderAssignments.sequence}), 0) + 1`,
          })
          .from(orderAssignments)
          .where(eq(orderAssignments.orderId, input.orderId));

        const nextSequence = sequenceResult[0]?.next ?? 1;

        const [row] = await tx
          .insert(orderAssignments)
          .values({
            id: input.id,
            orderId: input.orderId,
            driverPublicId: input.driverPublicId,
            sequence: nextSequence,
            assignmentState: "offered",
            offeredAt: new Date(input.offeredAt),
          })
          .returning();

        return toAssignment(row!);
      });
    } catch (error) {
      return translateWriteError(error, {
        orderId: input.orderId,
        driverPublicId: input.driverPublicId,
      });
    }
  }

  async resolveAssignment(input: ResolveAssignmentInput): Promise<Assignment> {
    // Find the assignment across all orders (the port takes only the id).
    const existing = await this.db
      .select()
      .from(orderAssignments)
      .where(eq(orderAssignments.id, input.assignmentId))
      .limit(1);

    const row = existing[0];
    if (row === undefined) {
      throw new OrderError(
        "ORDER_ASSIGNMENT_NOT_FOUND",
        `الإسناد ${input.assignmentId} غير موجود`,
      );
    }
    if (row.assignmentState !== "offered") {
      throw new OrderError(
        "ORDER_ASSIGNMENT_ALREADY_RESOLVED",
        `الإسناد ${input.assignmentId} محسوم مسبقاً بحالة ${row.assignmentState}`,
      );
    }

    const set: Partial<typeof orderAssignments.$inferInsert> = {
      assignmentState: input.state,
      reasonCode: input.reasonCode,
      acceptedAt:
        input.state === "accepted" ? new Date(input.resolvedAt) : null,
      rejectedAt:
        input.state === "rejected" ? new Date(input.resolvedAt) : null,
      expiredAt:
        input.state === "expired" ? new Date(input.resolvedAt) : null,
      cancelledAt:
        input.state === "cancelled" ? new Date(input.resolvedAt) : null,
    };

    const [updated] = await this.db
      .update(orderAssignments)
      .set(set)
      .where(eq(orderAssignments.id, input.assignmentId))
      .returning();

    return toAssignment(updated!);
  }

  async recordAgreedPrice(input: RecordAgreedPriceInput): Promise<Order | null> {
    try {
      // The NULL predicate is the concurrency guard: a second writer cannot
      // overwrite the price after its stale read of the same order.
      const [updatedRow] = await this.db
        .update(orders)
        .set({
          agreedAmountMinor: input.amountMinor,
          agreedCurrency: input.currency,
          agreedAt: new Date(input.agreedAt),
          agreedNegotiationId: input.negotiationId,
          updatedAt: new Date(input.recordedAt),
        })
        .where(and(eq(orders.id, input.orderId), isNull(orders.agreedAmountMinor)))
        .returning();
      if (updatedRow === undefined) return null;
      return toOrder(updatedRow, await this.loadStops(updatedRow.id));
    } catch (error) {
      return translateWriteError(error, { orderId: input.orderId });
    }
  }

  async setActiveAssignment(
    orderId: string,
    assignmentId: string | null,
    _updatedAt: string,
  ): Promise<Order> {
    if (assignmentId != null) {
      // fk_orders_active_assignment: the order cannot point at a record that
      // does not belong to it.
      const owns = await this.db
        .select({ id: orderAssignments.id })
        .from(orderAssignments)
        .where(
          and(
            eq(orderAssignments.orderId, orderId),
            eq(orderAssignments.id, assignmentId),
          ),
        )
        .limit(1);
      if (owns[0] === undefined) {
        throw new OrderError(
          "ORDER_ASSIGNMENT_NOT_FOUND",
          `الإسناد ${assignmentId} لا ينتمي إلى الطلب ${orderId}`,
        );
      }
    }

    const [updatedRow] = await this.db
      .update(orders)
      .set({ activeAssignmentId: assignmentId })
      .where(eq(orders.id, orderId))
      .returning();

    if (updatedRow === undefined) {
      throw new OrderError(
        "ORDER_NOT_FOUND",
        `الطلب ${orderId} غير موجود`,
      );
    }

    const stops = await this.loadStops(updatedRow.id);
    return toOrder(updatedRow, stops);
  }

  /** Load stops for an order, ordered by sequence. Accepts a tx for use inside a transaction. */
  private async loadStops(
    orderId: string,
    tx?: DbOrTx,
  ): Promise<Stop[]> {
    const handle = tx ?? this.db;
    const rows = await handle
      .select()
      .from(orderStops)
      .where(eq(orderStops.orderId, orderId))
      .orderBy(asc(orderStops.sequence));
    return rows.map((row) =>
      toStop({
        kind: row.kind,
        zoneId: row.zoneId,
        label: row.label,
        source: row.source,
        latitude: row.latitude,
        longitude: row.longitude,
      }),
    );
  }
}

// --------------------------------------------------------------------------- //
// Public id generator                                                         //
// --------------------------------------------------------------------------- //

/**
 * Mints `ORD-##########` from the `order_public_id_seq` database sequence.
 *
 * A separate class from the repository because the guarantee is different: a
 * UUID may be generated anywhere, while the public id comes from the sequence
 * precisely so it is unique and monotone across replicas and retries.
 *
 * NOTE on gaps: `nextval()` is NOT transactional in PostgreSQL — a value drawn
 * inside a transaction that rolls back is consumed and will not be reused. This
 * means the public-id sequence can have gaps after a failed/retried order. That
 * is acceptable: the public id only needs to be unique and monotonically
 * increasing (never reused, never out of order across committed orders), not
 * gapless. It shares the `Db` so it can run inside the Unit of Work's
 * transaction for ordering, but a rolled-back order still consumes a sequence
 * value — which is the correct outcome (a rolled-back order never existed).
 */
export class PostgresOrderPublicIdGenerator implements OrderPublicIdGenerator {
  constructor(private readonly db: DbOrTx) {}

  async nextOrderPublicId(): Promise<string> {
    const result = await this.db.execute<{ nextval: bigint }>(
      sql`select nextval('order_public_id_seq') as nextval`,
    );
    const row = result.rows?.[0] ?? (result as unknown as { nextval: bigint }[])[0];
    const value = Number(row?.nextval ?? 1);
    return `ORD-${String(value).padStart(10, "0")}`;
  }
}

// --------------------------------------------------------------------------- //
// Outbox                                                                      //
// --------------------------------------------------------------------------- //

/**
 * Durable outbox. Accepts a `DbOrTx` handle so that, inside a
 * `PostgresOrderUnitOfWork`, the event is appended to the same transaction as the
 * status change + audit row — the triple write that commits or rolls back
 * together (ADR-010 §127).
 *
 * `unread()` returns unpublished rows in append order, which is the order a relay
 * must publish them in. Publishing itself has no consumer yet (Phase 09 owns the
 * relay); the rows accumulate on purpose, because an event that was never stored
 * cannot be replayed once a consumer exists.
 */
export class PostgresOrderOutbox implements Outbox {
  constructor(private readonly db: DbOrTx) {}

  async append(event: OrderDomainEvent): Promise<void> {
    await this.db.insert(orderOutbox).values({
      eventId: event.event_id,
      eventType: event.event_type,
      eventVersion: event.event_version,
      aggregateType: event.aggregate.type,
      aggregateId: event.aggregate.id,
      payload: event as unknown as Record<string, unknown>,
      traceId: event.trace_id ?? null,
      occurredAt: new Date(event.occurred_at),
    });
  }

  async unread(): Promise<OrderDomainEvent[]> {
    const rows = await this.db
      .select()
      .from(orderOutbox)
      .where(sql`${orderOutbox.publishedAt} IS NULL`)
      .orderBy(asc(orderOutbox.eventId));
    return rows.map(
      (row) => row.payload as unknown as OrderDomainEvent,
    );
  }

  /** Mark rows as published. Used by the relay (Phase 09) and by tests. */
  async markPublished(
    eventIds: readonly string[],
    publishedAt: string,
  ): Promise<number> {
    if (eventIds.length === 0) return 0;
    const rows = await this.db
      .update(orderOutbox)
      .set({ publishedAt: new Date(publishedAt) })
      .where(inArray(orderOutbox.eventId, [...eventIds]))
      .returning({ eventId: orderOutbox.eventId });
    return rows.length;
  }
}
