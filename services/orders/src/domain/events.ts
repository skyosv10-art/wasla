/**
 * Order Engine event builders.
 *
 * Events are built here, in the domain, and appended to the outbox by the use
 * case in the same logical operation as the write. Building them at the HTTP
 * layer would mean a state that changed through any other entry point (a job, a
 * Phase 07 call, a repair script) emits nothing — and this phase's promise is
 * that no state changes silently.
 *
 * The envelope shape is contract-owned (@wasla/contracts-order): `producer` is
 * always "orders-service", `aggregate.id` is the ORDER PUBLIC ID for order
 * events and the assignment UUID for assignment events. Consumers outside this
 * service never see internal UUIDs of orders.
 */

import {
  ORDER_EVENT_TYPES,
  type OrderAssignmentResolution,
  type OrderAssignmentOfferedV1,
  type OrderAssignmentResolvedV1,
  type OrderCreatedV1,
  type OrderDomainEvent,
  type OrderStatusChangedV1,
} from "@wasla/contracts-order";

import type { Assignment, Order, StatusHistoryEntry } from "./model.js";
import { isTerminalStatus } from "./state-machine.js";

export type { OrderDomainEvent };

/** What every builder needs and cannot invent for itself. */
export interface EventContext {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly traceId?: string | null;
}

/**
 * `order.created`.
 *
 * Stops are reduced to `{kind, zone_id}`: the event says an order exists in a
 * zone pair, not where the customer lives. A consumer that needs the label can
 * read the order; a consumer subscribed to a stream should not accumulate
 * addresses it never asked for.
 */
export function orderCreatedEvent(order: Order, context: EventContext): OrderCreatedV1 {
  return {
    event_id: context.eventId,
    event_type: ORDER_EVENT_TYPES.ORDER_CREATED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "orders-service",
    aggregate: { type: "order", id: order.orderPublicId },
    trace_id: context.traceId ?? null,
    data: {
      order_public_id: order.orderPublicId,
      customer_public_id: order.customerPublicId,
      order_type: order.orderType,
      vehicle_class: order.vehicleClass,
      price_mode: order.priceMode,
      offered_amount_minor: order.offeredPrice?.amountMinor ?? null,
      currency: order.offeredPrice?.currency ?? null,
      status: "published",
      stops: order.stops.map((stop) => ({ kind: stop.kind, zone_id: stop.zoneId })),
      requested_at: order.requestedAt,
    },
  };
}

/**
 * `order.status_changed` — emitted for EVERY transition, creation included.
 *
 * `is_terminal` is derived from the transition table rather than copied from a
 * list, so a consumer that closes its own record on terminality can never be
 * misled by a stale enum. `sequence` is the audit row's ordinal, which lets a
 * consumer detect redelivery and ordering without a clock.
 */
export function orderStatusChangedEvent(
  order: Order,
  entry: StatusHistoryEntry,
  activeDriverPublicId: string | null,
  context: EventContext,
): OrderStatusChangedV1 {
  return {
    event_id: context.eventId,
    event_type: ORDER_EVENT_TYPES.ORDER_STATUS_CHANGED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "orders-service",
    aggregate: { type: "order", id: order.orderPublicId },
    trace_id: context.traceId ?? entry.traceId ?? null,
    data: {
      order_public_id: order.orderPublicId,
      customer_public_id: order.customerPublicId,
      from_status: entry.fromStatus,
      to_status: entry.toStatus,
      sequence: entry.sequence,
      reason_code: entry.reasonCode,
      actor_type: entry.actorType,
      actor_ref: entry.actorRef,
      driver_public_id: activeDriverPublicId,
      is_terminal: isTerminalStatus(entry.toStatus),
    },
  };
}

/** `order.assignment_offered` — a record of a Phase 07 decision, not a decision. */
export function assignmentOfferedEvent(
  order: Order,
  assignment: Assignment,
  context: EventContext,
): OrderAssignmentOfferedV1 {
  return {
    event_id: context.eventId,
    event_type: ORDER_EVENT_TYPES.ORDER_ASSIGNMENT_OFFERED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "orders-service",
    aggregate: { type: "order_assignment", id: assignment.id },
    trace_id: context.traceId ?? null,
    data: {
      order_public_id: order.orderPublicId,
      driver_public_id: assignment.driverPublicId,
      sequence: assignment.sequence,
      offered_at: assignment.offeredAt,
    },
  };
}

/**
 * `order.assignment_resolved`.
 *
 * Emitted for all four resolutions, and deliberately NOT accompanied by a status
 * change for rejection or timeout: those move the order through its own
 * transition (`offered → driver_rejected`), which produces its own event. Fusing
 * the two would let a consumer infer the order ended when it went back to
 * searching (ADR-010 decision 3.5).
 */
export function assignmentResolvedEvent(
  order: Order,
  assignment: Assignment,
  resolvedAt: string,
  context: EventContext,
): OrderAssignmentResolvedV1 {
  return {
    event_id: context.eventId,
    event_type: ORDER_EVENT_TYPES.ORDER_ASSIGNMENT_RESOLVED,
    event_version: "v1",
    occurred_at: context.occurredAt,
    producer: "orders-service",
    aggregate: { type: "order_assignment", id: assignment.id },
    trace_id: context.traceId ?? null,
    data: {
      order_public_id: order.orderPublicId,
      driver_public_id: assignment.driverPublicId,
      sequence: assignment.sequence,
      assignment_state: assignment.state as OrderAssignmentResolution,
      reason_code: assignment.reasonCode,
      resolved_at: resolvedAt,
    },
  };
}
