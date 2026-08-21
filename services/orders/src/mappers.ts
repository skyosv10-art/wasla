/**
 * Translation between the three representations of an order.
 *
 * The domain speaks camelCase and nests (`offeredPrice: Money`, `coordinates`);
 * the API and events speak snake_case and flatten (`offered_amount_minor`).
 * Neither is wrong — the domain shape is the one that makes invariants
 * expressible, the wire shape is the one that is published and versioned.
 * Keeping the translation in one file means a contract change breaks compilation
 * HERE rather than leaking a renamed field into a use case.
 *
 * Mapping is total and lossless in both directions for every field the contract
 * declares; anything the contract does not declare (`payload_fingerprint`,
 * `idempotency_key`) never leaves the service.
 */

import type {
  Assignment as AssignmentDto,
  Order as OrderDto,
  OrderIntakeRequest,
  StatusHistoryEntry as StatusHistoryEntryDto,
  TransitionRequest,
} from "@wasla/contracts-order";

import type {
  Assignment,
  Coordinates,
  Money,
  Order,
  OrderIntakeCommand,
  ShipmentDetails,
  StatusHistoryEntry,
  Stop,
  TransitionCommand,
} from "./domain/model.js";
import { assertReasonCodeKnown } from "./domain/validation.js";

// ---------------------------------------------------------------------------
// wire → domain
// ---------------------------------------------------------------------------

function coordinatesFromWire(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): Coordinates | null {
  // Present together or not at all — matching ck_order_stops_coordinates_complete.
  // A half-pair is dropped rather than half-stored: a lone latitude is not a
  // location, and keeping it would let a reader believe the stop was pinned.
  if (latitude == null || longitude == null) return null;
  return { latitude, longitude };
}

/** A wire stop becomes a domain stop. */
export function stopFromWire(wire: OrderIntakeRequest["stops"][number]): Stop {
  return {
    kind: wire.kind,
    zoneId: wire.zone_id,
    label: wire.label ?? null,
    source: wire.source,
    savedPlaceId: wire.saved_place_id ?? null,
    coordinates: coordinatesFromWire(wire.latitude, wire.longitude),
  };
}

function moneyFromWire(
  wire: NonNullable<OrderIntakeRequest["offered_price"]> | null | undefined,
): Money | null {
  if (wire == null) return null;
  return { amountMinor: wire.amount_minor, currency: wire.currency };
}

function shipmentFromWire(
  wire: OrderIntakeRequest["shipment"] | null | undefined,
): ShipmentDetails | null {
  if (wire == null) return null;
  return {
    shipmentType: wire.shipment_type ?? null,
    description: wire.description ?? null,
    weightKg: wire.weight_kg ?? null,
  };
}

/** The intake DTO becomes the intake command. */
export function intakeCommandFromWire(
  wire: OrderIntakeRequest,
  context: { readonly idempotencyKey: string; readonly traceId?: string },
): OrderIntakeCommand {
  return {
    orderRequestId: wire.order_request_id,
    customerPublicId: wire.customer_public_id,
    orderType: wire.order_type,
    vehicleClass: wire.vehicle_class,
    priceMode: wire.price_mode,
    offeredPrice: moneyFromWire(wire.offered_price),
    stops: wire.stops.map(stopFromWire),
    shipment: shipmentFromWire(wire.shipment),
    notes: wire.notes ?? null,
    requestedAt: wire.requested_at,
    idempotencyKey: context.idempotencyKey,
    traceId: context.traceId,
  };
}

/**
 * The transition DTO becomes the transition command.
 *
 * The reason code is checked against the closed catalog HERE rather than deeper
 * in, because the contract types it as plain text: an unknown value would
 * otherwise be carried as if it were a catalog member and only be caught — or
 * not — later. `assertReasonCodeKnown` raises the documented
 * `ORDER_REASON_CODE_UNKNOWN`, so the caller learns which value was refused
 * instead of seeing it silently dropped to `null`.
 */
export function transitionCommandFromWire(
  wire: TransitionRequest,
  context: { readonly idempotencyKey?: string; readonly traceId?: string } = {},
): TransitionCommand {
  const reasonCode = wire.reason_code ?? null;
  assertReasonCodeKnown(reasonCode, context.traceId);
  return {
    toStatus: wire.to_status,
    reasonCode: reasonCode as TransitionCommand["reasonCode"],
    actorType: wire.actor_type,
    actorRef: wire.actor_ref ?? null,
    idempotencyKey: context.idempotencyKey,
    traceId: context.traceId,
  };
}

// ---------------------------------------------------------------------------
// domain → wire
// ---------------------------------------------------------------------------

/** A domain stop becomes a wire stop. */
export function stopToWire(stop: Stop): OrderDto["stops"][number] {
  return {
    kind: stop.kind,
    zone_id: stop.zoneId,
    label: stop.label,
    source: stop.source,
    saved_place_id: stop.savedPlaceId,
    latitude: stop.coordinates?.latitude ?? null,
    longitude: stop.coordinates?.longitude ?? null,
  };
}

/** A domain assignment becomes the published `Assignment`. */
export function assignmentToWire(assignment: Assignment): AssignmentDto {
  return {
    id: assignment.id,
    order_id: assignment.orderId,
    driver_public_id: assignment.driverPublicId,
    sequence: assignment.sequence,
    assignment_state: assignment.state,
    reason_code: assignment.reasonCode,
    offered_at: assignment.offeredAt,
    accepted_at: assignment.acceptedAt,
    rejected_at: assignment.rejectedAt,
    expired_at: assignment.expiredAt,
    cancelled_at: assignment.cancelledAt,
  };
}

/** An audit row becomes the published `StatusHistoryEntry`. */
export function statusHistoryEntryToWire(
  entry: StatusHistoryEntry,
): StatusHistoryEntryDto {
  return {
    sequence: entry.sequence,
    from_status: entry.fromStatus,
    to_status: entry.toStatus,
    reason_code: entry.reasonCode,
    actor_type: entry.actorType,
    actor_ref: entry.actorRef,
    occurred_at: entry.occurredAt,
    trace_id: entry.traceId,
  };
}

/**
 * A domain order becomes the published `Order`.
 *
 * `active_assignment` is the full record, not the id: a caller asking for an
 * order in a driver-bound state always needs to know WHICH driver, and making
 * that a second request invites the two answers to disagree.
 */
export function orderToWire(
  order: Order,
  activeAssignment: Assignment | null,
): OrderDto {
  return {
    id: order.id,
    order_public_id: order.orderPublicId,
    order_request_id: order.orderRequestId,
    customer_public_id: order.customerPublicId,
    order_type: order.orderType,
    vehicle_class: order.vehicleClass,
    status: order.status,
    status_reason_code: order.statusReasonCode,
    price_mode: order.priceMode,
    offered_price:
      order.offeredPrice == null
        ? null
        : {
            amount_minor: order.offeredPrice.amountMinor,
            currency: order.offeredPrice.currency,
          },
    stops: order.stops.map(stopToWire),
    shipment:
      order.shipment == null
        ? null
        : {
            shipment_type: order.shipment.shipmentType,
            description: order.shipment.description,
            weight_kg: order.shipment.weightKg,
          },
    notes: order.notes,
    active_assignment: activeAssignment == null ? null : assignmentToWire(activeAssignment),
    requested_at: order.requestedAt,
    accepted_at: order.acceptedAt,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
  };
}
