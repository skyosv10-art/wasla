/**
 * In-memory adapters for the Customer Core domain.
 *
 * Used by unit tests now and by the HTTP layer's `app.inject` tests in MR 4/6.
 * They enforce the same constraints as schema.sql — unique
 * (wasla_public_id, idempotency_key) for places and requests, case-insensitive
 * label uniqueness, ordered stops — so switching to the Postgres repository in
 * MR 3/6 cannot change use-case behavior. Where an adapter cannot enforce a
 * constraint the use case would otherwise rely on, that is a defect in this
 * file, not a licence for the use case to skip the check.
 */

import { randomUUID } from "node:crypto";

import type { CustomerEvent } from "@wasla/contracts-customer";

import { OrderIntakeFailure } from "../domain/errors.js";
import type {
  CustomerOrderRequest,
  CustomerProfile,
  IntakeFailureReason,
  OrderRequestStatus,
  SavedPlace,
  ZoneReference,
} from "../domain/model.js";
import type {
  Clock,
  CustomerRepository,
  GeographyPort,
  IdGenerator,
  IdentityLookupPort,
  InsertOrderRequestInput,
  InsertSavedPlaceInput,
  OrderIntakePort,
  OrderIntakeRequestInput,
  OrderIntakeResultOutput,
  OrderRequestOutcome,
  Outbox,
} from "../ports.js";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class CryptoIdGenerator implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }
}

/** Deterministic clock for tests: advances only when asked. */
export class FixedClock implements Clock {
  private current: Date;
  constructor(start: string = "2026-08-21T00:00:00.000Z") {
    this.current = new Date(start);
  }
  now(): string {
    return this.current.toISOString();
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Deterministic ids for tests: uuid-shaped and sequential. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;
  constructor(private readonly prefix = "00000000-0000-4000-8000") {}
  uuid(): string {
    this.counter += 1;
    return `${this.prefix}-${String(this.counter).padStart(12, "0")}`;
  }
}

export class InMemoryOutbox implements Outbox {
  private readonly events: CustomerEvent[] = [];
  async append(event: CustomerEvent): Promise<void> {
    this.events.push(event);
  }
  async unread(): Promise<CustomerEvent[]> {
    return [...this.events];
  }
  /** Test helper: synchronous read without awaiting. */
  all(): readonly CustomerEvent[] {
    return this.events;
  }
  /** Test helper: drop appended events so a later assertion starts clean. */
  clear(): void {
    this.events.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class InMemoryCustomerRepository implements CustomerRepository {
  private readonly profiles = new Map<string, CustomerProfile>();
  private readonly places = new Map<string, SavedPlace>();
  private readonly requests = new Map<string, CustomerOrderRequest>();

  // --- profile ---

  async findProfile(waslaPublicId: string): Promise<CustomerProfile | null> {
    return this.profiles.get(waslaPublicId) ?? null;
  }

  async saveProfile(profile: CustomerProfile): Promise<CustomerProfile> {
    this.profiles.set(profile.waslaPublicId, profile);
    return profile;
  }

  // --- saved places ---

  private placesOf(waslaPublicId: string): SavedPlace[] {
    return [...this.places.values()].filter(
      (place) => place.waslaPublicId === waslaPublicId,
    );
  }

  async listPlaces(waslaPublicId: string): Promise<SavedPlace[]> {
    // Most recently used first (never-used last), then newest first — the
    // ordering the bot shows, mirrored by the schema index.
    return this.placesOf(waslaPublicId).sort((a, b) => {
      if (a.lastUsedAt !== b.lastUsedAt) {
        if (a.lastUsedAt === null) return 1;
        if (b.lastUsedAt === null) return -1;
        return a.lastUsedAt < b.lastUsedAt ? 1 : -1;
      }
      return a.createdAt < b.createdAt ? 1 : -1;
    });
  }

  async findPlace(
    waslaPublicId: string,
    placeId: string,
  ): Promise<SavedPlace | null> {
    const place = this.places.get(placeId);
    return place && place.waslaPublicId === waslaPublicId ? place : null;
  }

  async findPlaceByLabel(
    waslaPublicId: string,
    label: string,
  ): Promise<SavedPlace | null> {
    const needle = label.toLowerCase();
    return (
      this.placesOf(waslaPublicId).find(
        (place) => place.label.toLowerCase() === needle,
      ) ?? null
    );
  }

  async findPlaceByIdempotencyKey(
    waslaPublicId: string,
    idempotencyKey: string,
  ): Promise<SavedPlace | null> {
    return (
      this.placesOf(waslaPublicId).find(
        (place) => place.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }

  async countPlaces(waslaPublicId: string): Promise<number> {
    return this.placesOf(waslaPublicId).length;
  }

  async insertPlace(input: InsertSavedPlaceInput): Promise<SavedPlace> {
    const clash = await this.findPlaceByLabel(input.waslaPublicId, input.label);
    if (clash) throw new Error("duplicate place label for customer");
    const dup = await this.findPlaceByIdempotencyKey(
      input.waslaPublicId,
      input.idempotencyKey,
    );
    if (dup) throw new Error("duplicate idempotency key for customer place");

    const place: SavedPlace = {
      id: input.id,
      waslaPublicId: input.waslaPublicId,
      label: input.label,
      zoneId: input.zoneId,
      addressText: input.addressText,
      coordinates: input.coordinates,
      idempotencyKey: input.idempotencyKey,
      lastUsedAt: null,
      createdAt: input.createdAt,
    };
    this.places.set(place.id, place);
    return place;
  }

  async deletePlace(waslaPublicId: string, placeId: string): Promise<boolean> {
    const place = await this.findPlace(waslaPublicId, placeId);
    if (!place) return false;
    this.places.delete(placeId);
    return true;
  }

  async touchPlace(
    waslaPublicId: string,
    placeId: string,
    usedAt: string,
  ): Promise<void> {
    const place = await this.findPlace(waslaPublicId, placeId);
    if (!place) return;
    this.places.set(placeId, { ...place, lastUsedAt: usedAt });
  }

  // --- order requests ---

  private requestsOf(waslaPublicId: string): CustomerOrderRequest[] {
    return [...this.requests.values()].filter(
      (request) => request.waslaPublicId === waslaPublicId,
    );
  }

  async findOrderRequest(
    waslaPublicId: string,
    orderRequestId: string,
  ): Promise<CustomerOrderRequest | null> {
    const request = this.requests.get(orderRequestId);
    return request && request.waslaPublicId === waslaPublicId ? request : null;
  }

  async findOrderRequestByIdempotencyKey(
    waslaPublicId: string,
    idempotencyKey: string,
  ): Promise<CustomerOrderRequest | null> {
    return (
      this.requestsOf(waslaPublicId).find(
        (request) => request.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }

  async listOrderRequests(
    waslaPublicId: string,
    options: { status?: OrderRequestStatus; limit?: number } = {},
  ): Promise<CustomerOrderRequest[]> {
    const rows = this.requestsOf(waslaPublicId)
      .filter((request) =>
        options.status === undefined ? true : request.status === options.status,
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return options.limit === undefined ? rows : rows.slice(0, options.limit);
  }

  async insertOrderRequest(
    input: InsertOrderRequestInput,
  ): Promise<CustomerOrderRequest> {
    const dup = await this.findOrderRequestByIdempotencyKey(
      input.waslaPublicId,
      input.idempotencyKey,
    );
    if (dup) throw new Error("duplicate idempotency key for order request");

    const request: CustomerOrderRequest = {
      id: input.id,
      waslaPublicId: input.waslaPublicId,
      idempotencyKey: input.idempotencyKey,
      status: input.status,
      orderType: input.orderType,
      vehicleClass: input.vehicleClass,
      priceMode: input.priceMode,
      offeredPrice: input.offeredPrice,
      stops: [...input.stops].sort((a, b) => a.sequence - b.sequence),
      shipment: input.shipment,
      notes: input.notes,
      orderPublicId: input.orderPublicId,
      submittedAt: input.submittedAt,
      failureReasonCode: input.failureReasonCode,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.requests.set(request.id, request);
    return request;
  }

  async updateOrderRequestOutcome(
    orderRequestId: string,
    outcome: OrderRequestOutcome,
  ): Promise<CustomerOrderRequest> {
    const existing = this.requests.get(orderRequestId);
    if (!existing) throw new Error("order request not found");
    const updated: CustomerOrderRequest = {
      ...existing,
      status: outcome.status,
      orderPublicId: outcome.orderPublicId,
      submittedAt: outcome.submittedAt,
      failureReasonCode: outcome.failureReasonCode,
      updatedAt: outcome.updatedAt,
    };
    this.requests.set(orderRequestId, updated);
    return updated;
  }
}

// ---------------------------------------------------------------------------
// Cross-service fakes
// ---------------------------------------------------------------------------

/** In-process identity lookup: a set of known public ids. */
export class FakeIdentityLookup implements IdentityLookupPort {
  private readonly known = new Set<string>();
  constructor(ids: readonly string[] = []) {
    for (const id of ids) this.known.add(id);
  }
  add(waslaPublicId: string): void {
    this.known.add(waslaPublicId);
  }
  remove(waslaPublicId: string): void {
    this.known.delete(waslaPublicId);
  }
  async identityExists(waslaPublicId: string): Promise<boolean> {
    return this.known.has(waslaPublicId);
  }
}

/** In-process geography: a map of zone id → status. */
export class FakeGeography implements GeographyPort {
  private readonly zones = new Map<string, ZoneReference>();
  constructor(zones: readonly ZoneReference[] = []) {
    for (const zone of zones) this.zones.set(zone.zoneId, zone);
  }
  addZone(zone: ZoneReference): void {
    this.zones.set(zone.zoneId, zone);
  }
  async findZone(zoneId: string): Promise<ZoneReference | null> {
    return this.zones.get(zoneId) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Order intake adapters
// ---------------------------------------------------------------------------

/**
 * The default Phase 04 adapter: there is no order engine, so every handover
 * fails loudly.
 *
 * This is the fail-closed choice (ADR-009 §3). The alternative — storing the
 * request and pretending it was accepted — creates orders with no owner and no
 * one waiting for them, which §53 forbids. Wiring the real engine is a Phase 06
 * adapter swap; nothing in the domain changes.
 */
export class UnavailableOrderIntake implements OrderIntakePort {
  constructor(
    private readonly reasonCode: IntakeFailureReason = "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
  ) {}
  async submitOrderRequest(): Promise<OrderIntakeResultOutput> {
    throw new OrderIntakeFailure(
      this.reasonCode,
      "no order engine adapter is configured",
    );
  }
}

/**
 * A test double standing in for the order engine.
 *
 * It records what it received, so the Phase 04 exit gate (MR 6/6) can assert the
 * handover payload rather than the fact that a function was called, and it mints
 * the public id the way the engine will — outside this service.
 */
export class RecordingOrderIntake implements OrderIntakePort {
  readonly received: OrderIntakeRequestInput[] = [];
  private failure: IntakeFailureReason | null = null;

  constructor(
    private readonly options: {
      readonly clock?: Clock;
      readonly mintOrderPublicId?: (
        request: OrderIntakeRequestInput,
        attempt: number,
      ) => string;
    } = {},
  ) {}

  /** Make the next handovers fail with a given reason (null = succeed again). */
  failWith(reasonCode: IntakeFailureReason | null): void {
    this.failure = reasonCode;
  }

  get lastRequest(): OrderIntakeRequestInput | undefined {
    return this.received[this.received.length - 1];
  }

  async submitOrderRequest(
    request: OrderIntakeRequestInput,
  ): Promise<OrderIntakeResultOutput> {
    if (this.failure !== null) {
      throw new OrderIntakeFailure(this.failure);
    }
    this.received.push(request);
    const attempt = this.received.length;
    const acceptedAt = this.options.clock?.now() ?? new Date().toISOString();
    const orderPublicId =
      this.options.mintOrderPublicId?.(request, attempt) ??
      `ORD-${String(attempt).padStart(10, "0")}`;
    return { orderPublicId, acceptedAt };
  }
}
