/**
 * Intake: the only way an order comes into existence.
 *
 * The customers service hands over a validated intent; the engine re-validates
 * it anyway. Not distrust — the engine is the party that receives from the
 * network, and a payload that reached it through any other route (a Phase 07
 * job, a replay, a future partner integration) would otherwise land unchecked.
 *
 * There is no `draft`: an order that exists is published (ADR-010 decision 2).
 * Creation therefore writes the order, its stops, the first audit row and both
 * events as ONE unit, so no reader can ever observe an order without its origin.
 */

import { createHash } from "node:crypto";

import { ORDER_INITIAL_STATUS } from "@wasla/contracts-order";

import { OrderError } from "../domain/errors.js";
import { orderCreatedEvent, orderStatusChangedEvent } from "../domain/events.js";
import type { OrderIntakeCommand, OrderIntakeOutcome } from "../domain/model.js";
import { assertIntakeCommand } from "../domain/validation.js";
import type { OrderDependencies } from "../ports.js";

/**
 * A stable fingerprint of the meaningful payload.
 *
 * Only the fields that define the order are hashed — not the trace id, not the
 * key itself. Otherwise a retry that carried a fresh trace id would look like a
 * different payload and be refused as key reuse, turning correct client
 * behaviour into a 409.
 */
export function fingerprintIntake(command: OrderIntakeCommand): string {
  const meaningful = {
    order_request_id: command.orderRequestId,
    customer_public_id: command.customerPublicId,
    order_type: command.orderType,
    vehicle_class: command.vehicleClass,
    price_mode: command.priceMode,
    offered_price: command.offeredPrice,
    stops: command.stops.map((stop) => ({
      kind: stop.kind,
      zone_id: stop.zoneId,
      source: stop.source,
      saved_place_id: stop.savedPlaceId,
      coordinates: stop.coordinates,
      label: stop.label,
    })),
    shipment: command.shipment,
    notes: command.notes,
    requested_at: command.requestedAt,
  };
  return createHash("sha256").update(JSON.stringify(meaningful)).digest("hex");
}

/**
 * Ingest a handed-over order request.
 *
 * Idempotency has three outcomes, and they are different on purpose:
 *  - same key + same payload  → the original order, `replayed: true` (a retry);
 *  - same key + other payload → 409 `ORDER_IDEMPOTENCY_KEY_REUSED` (a bug);
 *  - known `order_request_id` → 409 `ORDER_REQUEST_ALREADY_INGESTED` (a second
 *    handover of one request, which would create a duplicate order).
 */
export async function ingestOrder(
  deps: OrderDependencies,
  command: OrderIntakeCommand,
): Promise<OrderIntakeOutcome> {
  assertIntakeCommand(command);

  const fingerprint = fingerprintIntake(command);
  const existing = await deps.repository.findOrderByIdempotencyKey(command.idempotencyKey);
  if (existing) {
    const storedFingerprint = await deps.repository.findFingerprintByIdempotencyKey(
      command.idempotencyKey,
    );
    if (storedFingerprint !== fingerprint) {
      throw new OrderError(
        "ORDER_IDEMPOTENCY_KEY_REUSED",
        "مفتاح التكرار مُستخدم مسبقاً بحمولة مختلفة",
        { traceId: command.traceId, details: { field: "idempotency_key" } },
      );
    }
    return {
      order: existing,
      orderPublicId: existing.orderPublicId,
      acceptedAt: existing.acceptedAt,
      replayed: true,
    };
  }

  if (await deps.repository.findOrderByRequestId(command.orderRequestId)) {
    throw new OrderError(
      "ORDER_REQUEST_ALREADY_INGESTED",
      `طلب العميل ${command.orderRequestId} مُستوعب مسبقاً`,
      { traceId: command.traceId, details: { field: "order_request_id" } },
    );
  }

  const acceptedAt = deps.clock.now();
  const { order, historyEntry } = await deps.repository.insertOrder({
    id: deps.ids.uuid(),
    orderPublicId: await deps.publicIds.nextOrderPublicId(),
    orderRequestId: command.orderRequestId,
    customerPublicId: command.customerPublicId,
    orderType: command.orderType,
    vehicleClass: command.vehicleClass,
    priceMode: command.priceMode,
    offeredPrice: command.offeredPrice,
    stops: command.stops,
    shipment: command.shipment,
    notes: command.notes,
    idempotencyKey: command.idempotencyKey,
    payloadFingerprint: fingerprint,
    requestedAt: command.requestedAt,
    acceptedAt,
    createdAt: acceptedAt,
  });

  // Two events, not one. `order.created` describes the order for consumers that
  // build a projection; `order.status_changed` with from_status = null keeps the
  // promise that EVERY status the order ever held has a corresponding event, so
  // a consumer tracking status alone never needs to special-case birth.
  await deps.outbox.append(
    orderCreatedEvent(order, {
      eventId: deps.ids.uuid(),
      occurredAt: acceptedAt,
      traceId: command.traceId ?? null,
    }),
  );
  await deps.outbox.append(
    orderStatusChangedEvent(order, historyEntry, null, {
      eventId: deps.ids.uuid(),
      occurredAt: acceptedAt,
      traceId: command.traceId ?? null,
    }),
  );

  return {
    order,
    orderPublicId: order.orderPublicId,
    acceptedAt,
    replayed: false,
  };
}

/** The status every ingested order starts in. Exported so tests assert it by name. */
export { ORDER_INITIAL_STATUS };
