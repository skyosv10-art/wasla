/**
 * Ports (hexagonal boundaries) for the Order Engine domain.
 *
 * Use cases depend on these interfaces only. Adapters live in ./infrastructure:
 * the in-memory store here (MR 2/6), and the Drizzle/Postgres repository in
 * MR 3/6. The parity suite runs the same use-case tests against both, so
 * "it worked in memory" can never mean "it works".
 *
 * Dependency direction (ADR-010): the engine depends on NOTHING. It does not
 * read identity, geography or drivers — every cross-service reference it stores
 * (`customer_public_id`, `driver_public_id`, `zone_id`) is opaque. That is what
 * lets Phase 07 be built without touching this service.
 */

import type { OrderDomainEvent } from "@wasla/contracts-order";

import type {
  Assignment,
  Money,
  Order,
  OrderActorType,
  OrderAssignmentState,
  OrderReasonCode,
  OrderStatus,
  OrderType,
  PriceMode,
  ShipmentDetails,
  StatusHistoryEntry,
  Stop,
  VehicleClass,
} from "./domain/model.js";

/** Wall-clock time as an ISO-8601 string. */
export interface Clock {
  now(): string;
}

/** UUID generator (entity ids and event ids). */
export interface IdGenerator {
  uuid(): string;
}

/**
 * Mints `order_public_id`.
 *
 * A separate port from `IdGenerator` because the two have different guarantees:
 * a UUID may be generated anywhere, while the public id comes from a database
 * sequence (`order_public_id_seq`) precisely so it is gapless and monotone. If
 * the service minted it, two replicas would collide.
 */
export interface OrderPublicIdGenerator {
  nextOrderPublicId(): Promise<string>;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

/** Row to insert for an order, including its ordered stops. */
export interface InsertOrderInput {
  readonly id: string;
  readonly orderPublicId: string;
  readonly orderRequestId: string;
  readonly customerPublicId: string;
  readonly orderType: OrderType;
  readonly vehicleClass: VehicleClass;
  readonly priceMode: PriceMode;
  readonly offeredPrice: Money | null;
  readonly stops: readonly Stop[];
  readonly shipment: ShipmentDetails | null;
  readonly notes: string | null;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly requestedAt: string;
  readonly acceptedAt: string;
  readonly createdAt: string;
}

/** The state change to apply to a stored order, with its audit row. */
export interface ApplyTransitionInput {
  readonly orderId: string;
  readonly toStatus: OrderStatus;
  readonly reasonCode: OrderReasonCode | null;
  readonly actorType: OrderActorType;
  readonly actorRef: string | null;
  readonly activeAssignmentId: string | null;
  readonly occurredAt: string;
  readonly traceId: string | null;
}

/** Row to insert for an assignment offer. */
export interface InsertAssignmentInput {
  readonly id: string;
  readonly orderId: string;
  readonly driverPublicId: string;
  readonly offeredAt: string;
}

/** The resolution to apply to a stored assignment. */
export interface ResolveAssignmentInput {
  readonly assignmentId: string;
  readonly state: Exclude<OrderAssignmentState, "offered">;
  readonly reasonCode: OrderReasonCode | null;
  readonly resolvedAt: string;
}

/** Set the agreed-price quartet once, without exposing a partial row write. */
export interface RecordAgreedPriceInput {
  readonly orderId: string;
  readonly negotiationId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly agreedAt: string;
  readonly recordedAt: string;
}

/**
 * The order repository. One port for orders, stops, history and assignments
 * because they share one transaction boundary: an order whose status moved
 * without its audit row is the impossible state this phase forbids, so the
 * ability to write one without the other must not exist in the interface.
 *
 * Implementations must enforce the schema.sql constraints — the unique
 * `order_request_id`, the per-order `sequence` uniqueness on history and
 * assignments, the one-offer-per-driver-per-order rule, and the
 * assignment/status coupling — so both adapters make the use cases behave
 * identically.
 */
export interface OrderRepository {
  // --- reads ---
  findOrderById(orderId: string): Promise<Order | null>;
  findOrderByPublicId(orderPublicId: string): Promise<Order | null>;
  /** Intake replay guard: the customer's request id is unique across orders. */
  findOrderByRequestId(orderRequestId: string): Promise<Order | null>;
  findOrderByIdempotencyKey(idempotencyKey: string): Promise<Order | null>;
  /**
   * The payload fingerprint stored with a key.
   *
   * Needed to tell the two cases apart: the same key with the same payload is a
   * retry and must return the original order (200), while the same key with a
   * different payload is a caller bug and must be refused (409). Without the
   * fingerprint the second case silently returns someone else's order.
   */
  findFingerprintByIdempotencyKey(idempotencyKey: string): Promise<string | null>;
  /** Audit rows of an order, oldest first. */
  listStatusHistory(orderId: string): Promise<StatusHistoryEntry[]>;
  /** Assignment records of an order, oldest first. */
  listAssignments(orderId: string): Promise<Assignment[]>;
  findAssignment(orderId: string, assignmentId: string): Promise<Assignment | null>;
  findAssignmentByDriver(orderId: string, driverPublicId: string): Promise<Assignment | null>;

  // --- writes ---
  /**
   * Insert the order, its stops AND the first audit row (`from_status: null`)
   * as one unit. The creation row is not optional, so it is not a separate call.
   */
  insertOrder(input: InsertOrderInput): Promise<{
    readonly order: Order;
    readonly historyEntry: StatusHistoryEntry;
  }>;
  /** Move the status and append the audit row as one unit. */
  applyTransition(input: ApplyTransitionInput): Promise<{
    readonly order: Order;
    readonly historyEntry: StatusHistoryEntry;
  }>;
  insertAssignment(input: InsertAssignmentInput): Promise<Assignment>;
  resolveAssignment(input: ResolveAssignmentInput): Promise<Assignment>;
  /**
   * Writes the complete agreed-price quartet only while it is absent.
   * `null` means another writer got there first, so the use case can classify
   * the stored value rather than overwriting a negotiation's evidence.
   */
  recordAgreedPrice(input: RecordAgreedPriceInput): Promise<Order | null>;
  /** Bind or unbind the accepted assignment carried on the order row. */
  setActiveAssignment(orderId: string, assignmentId: string | null, updatedAt: string): Promise<Order>;
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

/**
 * Domain event outbox. Use cases append within the same logical operation as the
 * write; a relay publishes later (Phase 09). Kept separate from the repository
 * so the domain owns event ordering without knowing about a broker.
 */
export interface Outbox {
  append(event: OrderDomainEvent): Promise<void>;
  /** Appended (unpublished) events — used by tests and the future relay. */
  unread(): Promise<OrderDomainEvent[]>;
}

/** Everything a use case needs, passed explicitly rather than imported. */
export interface OrderDependencies {
  readonly repository: OrderRepository;
  readonly outbox: Outbox;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly publicIds: OrderPublicIdGenerator;
}
