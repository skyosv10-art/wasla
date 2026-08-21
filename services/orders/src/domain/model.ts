/**
 * Order Engine domain model (Phase 06).
 *
 * In-service shapes: camelCase, no transport concerns, no SQL concerns. They
 * mirror the published contracts one-to-one in meaning:
 *  - the API DTOs live in @wasla/contracts-order (generated from OpenAPI),
 *  - the storage columns live in services/orders/contracts/schema.sql,
 *  - `../mappers.ts` translates between the three.
 *
 * Boundary reminders (ADR-010):
 *  - nothing here decides WHO gets an offer: `driverPublicId` is an opaque
 *    reference and the engine never inspects a driver. Phase 07 decides, the
 *    engine records (§16).
 *  - nothing here models money movement. `offeredPrice` is what the customer
 *    said, carried untouched; settlement is Phase 12.
 *  - nothing here models a channel: no chat id, no telegram.
 */

import type {
  OrderActorType,
  OrderAssignmentState,
  OrderReasonCode,
  OrderStatus,
  OrderType,
  PriceMode,
  StopKind,
  StopSource,
  VehicleClass,
} from "@wasla/contracts-order";

export type {
  OrderActorType,
  OrderAssignmentState,
  OrderReasonCode,
  OrderStatus,
  OrderType,
  PriceMode,
  StopKind,
  StopSource,
  VehicleClass,
};

/** Delivery-only shipment kinds (mirrors the customer contract). */
export type ShipmentType = "parcel" | "documents" | "food" | "goods" | "other";

/**
 * Integer minor units + ISO currency.
 *
 * Never a float: a price the customer typed is an exact amount, and rounding a
 * customer's own offer is indefensible.
 */
export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

/** Optional coordinates. Present together or not at all (schema constraint). */
export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/** A stop on the order. `zoneId` is mandatory: a stop without a zone is unmatchable. */
export interface Stop {
  readonly kind: StopKind;
  readonly zoneId: string;
  readonly label: string | null;
  readonly source: StopSource;
  readonly savedPlaceId: string | null;
  readonly coordinates: Coordinates | null;
}

/** Delivery-only shipment details. */
export interface ShipmentDetails {
  readonly shipmentType: ShipmentType | null;
  readonly description: string | null;
  readonly weightKg: number | null;
}

/**
 * A recorded assignment offer (§16).
 *
 * The engine stores the four resolution timestamps separately rather than one
 * `resolved_at` + state, because an expired offer and a rejected offer are
 * different operational facts and Phase 07 needs to tell them apart when it
 * decides who to try next.
 */
export interface Assignment {
  readonly id: string;
  readonly orderId: string;
  readonly driverPublicId: string;
  readonly sequence: number;
  readonly state: OrderAssignmentState;
  readonly reasonCode: OrderReasonCode | null;
  readonly offeredAt: string;
  readonly acceptedAt: string | null;
  readonly rejectedAt: string | null;
  readonly expiredAt: string | null;
  readonly cancelledAt: string | null;
}

/**
 * One audit row: a single state transition.
 *
 * `fromStatus` is `null` exactly once per order — at creation. That row exists
 * so the audit trail answers "how did this order come to be?" with a row and
 * not with an absence.
 */
export interface StatusHistoryEntry {
  readonly sequence: number;
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus;
  readonly reasonCode: OrderReasonCode | null;
  readonly actorType: OrderActorType;
  readonly actorRef: string | null;
  readonly occurredAt: string;
  readonly traceId: string | null;
}

/** A persisted order. */
export interface Order {
  readonly id: string;
  readonly orderPublicId: string;
  readonly orderRequestId: string;
  readonly customerPublicId: string;
  readonly orderType: OrderType;
  readonly vehicleClass: VehicleClass;
  readonly status: OrderStatus;
  readonly statusReasonCode: OrderReasonCode | null;
  readonly priceMode: PriceMode;
  readonly offeredPrice: Money | null;
  readonly stops: readonly Stop[];
  readonly shipment: ShipmentDetails | null;
  readonly notes: string | null;
  readonly activeAssignmentId: string | null;
  readonly requestedAt: string;
  readonly acceptedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The validated intake payload handed over by the customers service. */
export interface OrderIntakeCommand {
  readonly orderRequestId: string;
  readonly customerPublicId: string;
  readonly orderType: OrderType;
  readonly vehicleClass: VehicleClass;
  readonly priceMode: PriceMode;
  readonly offeredPrice: Money | null;
  readonly stops: readonly Stop[];
  readonly shipment: ShipmentDetails | null;
  readonly notes: string | null;
  readonly requestedAt: string;
  readonly idempotencyKey: string;
  readonly traceId?: string;
}

/** What intake returns. The engine owns `orderPublicId`; nobody else mints it. */
export interface OrderIntakeOutcome {
  readonly order: Order;
  readonly orderPublicId: string;
  readonly acceptedAt: string;
  /** True when an existing order was returned for a replayed idempotency key. */
  readonly replayed: boolean;
}

/** A requested state change. The only way an order's status ever moves. */
export interface TransitionCommand {
  readonly toStatus: OrderStatus;
  readonly reasonCode: OrderReasonCode | null;
  readonly actorType: OrderActorType;
  readonly actorRef: string | null;
  readonly idempotencyKey?: string;
  readonly traceId?: string;
}

/** A requested assignment offer record. */
export interface RecordAssignmentCommand {
  readonly driverPublicId: string;
  readonly idempotencyKey?: string;
  readonly traceId?: string;
}

/** A requested assignment resolution (accept · reject · expire · cancel). */
export interface ResolveAssignmentCommand {
  readonly assignmentId: string;
  readonly state: Exclude<OrderAssignmentState, "offered">;
  readonly reasonCode: OrderReasonCode | null;
  readonly traceId?: string;
}

/** An order together with its audit trail and assignment records. */
export interface OrderDetail {
  readonly order: Order;
  readonly statusHistory: readonly StatusHistoryEntry[];
  readonly assignments: readonly Assignment[];
  readonly activeAssignment: Assignment | null;
}
