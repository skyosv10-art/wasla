/**
 * Postgres adapters for the Customer Core ports.
 *
 * `PostgresCustomerRepository` implements `CustomerRepository` and
 * `PostgresCustomerOutbox` implements `Outbox`, both against the canonical DDL
 * in `services/customers/contracts/schema.sql`. No use case changes when the
 * in-memory adapters are swapped for these — that is the property the
 * port-conformance suite proves by running one set of scenarios twice, once per
 * adapter (`src/__tests__/port-conformance.integration.test.ts`).
 *
 * Three deliberate choices, each of which has a cheaper wrong version:
 *
 *  1. **NULL columns become absent keys, not `null` values.** A row whose
 *     `shipment_type` is NULL reconstructs as `{ weightKg: 3.5 }`, exactly the
 *     object the validator produced before it was stored. Reconstructing
 *     `{ shipmentType: null, weightKg: 3.5 }` would compare unequal to the
 *     in-memory adapter and would make the idempotency fingerprint of a replay
 *     depend on where the request was read from.
 *
 *  2. **Unique-violation errors are translated.** Postgres raises SQLSTATE 23505
 *     where the in-memory adapter throws a plain `Error`. Callers must not have
 *     to know which adapter they hold, so the two constraints the use cases rely
 *     on (idempotency pairs, case-insensitive place label) surface with the same
 *     message from both.
 *
 *  3. **`NUMERIC` is parsed once, here.** `pg` returns numerics as strings to
 *     avoid float surprises; letting a string escape into the domain would make
 *     `weightKg` sometimes `3.5` and sometimes `"3.500"`.
 *
 * Known divergence (documented in docs/02-architecture/CUSTOMER_PERSISTENCE.md):
 * `updated_at` is owned by the `customer_set_updated_at` trigger declared in the
 * contract, so on UPDATE Postgres uses server time and ignores the injected
 * clock. No use case reads `updatedAt` to make a decision, so behavior is
 * unaffected; the conformance suite therefore asserts monotonicity rather than
 * an exact timestamp.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import type { CustomerEvent } from "@wasla/contracts-customer";

import type {
  Coordinates,
  CustomerOrderRequest,
  CustomerProfile,
  CustomerStatus,
  IntakeFailureReason,
  Locale,
  Money,
  OrderRequestStatus,
  OrderType,
  PriceMode,
  SavedPlace,
  ShipmentDetails,
  ShipmentType,
  Stop,
  StopKind,
  StopSource,
  VehicleClass,
} from "../../domain/model.js";
import type {
  CustomerRepository,
  InsertOrderRequestInput,
  InsertSavedPlaceInput,
  OrderRequestOutcome,
  Outbox,
} from "../../ports.js";
import type { Db } from "./db.js";
import {
  customerOrderRequestStops,
  customerOrderRequests,
  customerOutbox,
  customerProfiles,
  customerSavedPlaces,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Column ⇄ domain conversions
// ---------------------------------------------------------------------------

/** `pg` returns NUMERIC as a string; the domain speaks numbers. */
function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/** The domain writes numbers; NUMERIC columns take strings. */
function toNumeric(value: number | null | undefined): string | null {
  return value === undefined || value === null ? null : String(value);
}

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
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

/**
 * Rebuild shipment details with absent keys for NULL columns (choice 1 above).
 * All three NULL means the request carried no shipment at all.
 */
function toShipment(row: {
  shipmentType: string | null;
  shipmentDescription: string | null;
  weightKg: string | null;
}): ShipmentDetails | null {
  const shipment: {
    shipmentType?: ShipmentType;
    description?: string | null;
    weightKg?: number | null;
  } = {};
  if (row.shipmentType !== null) shipment.shipmentType = row.shipmentType as ShipmentType;
  if (row.shipmentDescription !== null) shipment.description = row.shipmentDescription;
  if (row.weightKg !== null) shipment.weightKg = toNumber(row.weightKg);
  return Object.keys(shipment).length === 0 ? null : shipment;
}

function toMoney(amountMinor: number | null, currency: string | null): Money | null {
  return amountMinor === null || currency === null
    ? null
    : { amountMinor, currency };
}

// ---------------------------------------------------------------------------
// Row → domain mappers
// ---------------------------------------------------------------------------

function mapProfile(row: typeof customerProfiles.$inferSelect): CustomerProfile {
  return {
    waslaPublicId: row.waslaPublicId,
    displayName: row.displayName,
    preferredLocale: row.preferredLocale as Locale,
    defaultZoneId: row.defaultZoneId,
    status: row.status as CustomerStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapPlace(row: typeof customerSavedPlaces.$inferSelect): SavedPlace {
  return {
    id: row.id,
    waslaPublicId: row.waslaPublicId,
    label: row.label,
    zoneId: row.zoneId,
    addressText: row.addressText,
    coordinates: toCoordinates(row.latitude, row.longitude),
    idempotencyKey: row.idempotencyKey,
    lastUsedAt: toIso(row.lastUsedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

function mapStop(row: typeof customerOrderRequestStops.$inferSelect): Stop {
  return {
    kind: row.kind as StopKind,
    sequence: row.sequence,
    zoneId: row.zoneId,
    label: row.label,
    coordinates: toCoordinates(row.latitude, row.longitude),
    source: row.source as StopSource,
    savedPlaceId: row.savedPlaceId,
  };
}

function mapOrderRequest(
  row: typeof customerOrderRequests.$inferSelect,
  stops: readonly Stop[],
): CustomerOrderRequest {
  return {
    id: row.id,
    waslaPublicId: row.waslaPublicId,
    idempotencyKey: row.idempotencyKey,
    status: row.status as OrderRequestStatus,
    orderType: row.orderType as OrderType,
    vehicleClass: row.vehicleClass as VehicleClass,
    priceMode: row.priceMode as PriceMode,
    offeredPrice: toMoney(row.offeredAmountMinor, row.currency),
    stops: [...stops].sort((a, b) => a.sequence - b.sequence),
    shipment: toShipment(row),
    notes: row.notes,
    orderPublicId: row.orderPublicId,
    submittedAt: toIso(row.submittedAt),
    failureReasonCode: row.failureReasonCode as IntakeFailureReason | null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Error translation (choice 2 above)
// ---------------------------------------------------------------------------

const UNIQUE_VIOLATION = "23505";

/**
 * Re-throw a unique violation with the message the in-memory adapter uses, so a
 * caller cannot tell the adapters apart by the failure it sees.
 *
 * The cause chain is walked because drizzle wraps driver errors: the SQLSTATE
 * and the constraint name live on `error.cause`, not on the error it throws.
 */
function translateUniqueViolation(error: unknown, byConstraint: Record<string, string>): never {
  let current: unknown = error;
  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth += 1) {
    const pgError = current as { code?: string; constraint?: string; cause?: unknown };
    if (pgError.code === UNIQUE_VIOLATION && pgError.constraint !== undefined) {
      const message = byConstraint[pgError.constraint];
      if (message !== undefined) throw new Error(message);
    }
    current = pgError.cause;
  }
  throw error;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class PostgresCustomerRepository implements CustomerRepository {
  constructor(private readonly db: Db) {}

  // --- profile ---

  async findProfile(waslaPublicId: string): Promise<CustomerProfile | null> {
    const rows = await this.db
      .select()
      .from(customerProfiles)
      .where(eq(customerProfiles.waslaPublicId, waslaPublicId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : mapProfile(row);
  }

  /**
   * Upsert, because the use case owns the decision of what the profile should
   * be and has already read it. `created_at` is written only on insert: an
   * update that reset it would rewrite the customer's history.
   */
  async saveProfile(profile: CustomerProfile): Promise<CustomerProfile> {
    const rows = await this.db
      .insert(customerProfiles)
      .values({
        waslaPublicId: profile.waslaPublicId,
        displayName: profile.displayName,
        preferredLocale: profile.preferredLocale,
        defaultZoneId: profile.defaultZoneId,
        status: profile.status,
        createdAt: new Date(profile.createdAt),
        updatedAt: new Date(profile.updatedAt),
      })
      .onConflictDoUpdate({
        target: customerProfiles.waslaPublicId,
        set: {
          displayName: profile.displayName,
          preferredLocale: profile.preferredLocale,
          defaultZoneId: profile.defaultZoneId,
          status: profile.status,
          updatedAt: new Date(profile.updatedAt),
        },
      })
      .returning();
    return mapProfile(rows[0]!);
  }

  // --- saved places ---

  /**
   * Most recently used first (never-used last), then newest first — the order
   * the bot shows, and the order `ix_customer_saved_places_owner` serves.
   */
  async listPlaces(waslaPublicId: string): Promise<SavedPlace[]> {
    const rows = await this.db
      .select()
      .from(customerSavedPlaces)
      .where(eq(customerSavedPlaces.waslaPublicId, waslaPublicId))
      .orderBy(
        sql`${customerSavedPlaces.lastUsedAt} DESC NULLS LAST`,
        desc(customerSavedPlaces.createdAt),
      );
    return rows.map(mapPlace);
  }

  /** Scoped to the owner: another customer's place id must read as absent. */
  async findPlace(waslaPublicId: string, placeId: string): Promise<SavedPlace | null> {
    const rows = await this.db
      .select()
      .from(customerSavedPlaces)
      .where(
        and(
          eq(customerSavedPlaces.waslaPublicId, waslaPublicId),
          eq(customerSavedPlaces.id, placeId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : mapPlace(row);
  }

  /** Case-insensitive, matching `ux_customer_saved_places_label`. */
  async findPlaceByLabel(
    waslaPublicId: string,
    label: string,
  ): Promise<SavedPlace | null> {
    const rows = await this.db
      .select()
      .from(customerSavedPlaces)
      .where(
        and(
          eq(customerSavedPlaces.waslaPublicId, waslaPublicId),
          sql`lower(${customerSavedPlaces.label}) = lower(${label})`,
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : mapPlace(row);
  }

  async findPlaceByIdempotencyKey(
    waslaPublicId: string,
    idempotencyKey: string,
  ): Promise<SavedPlace | null> {
    const rows = await this.db
      .select()
      .from(customerSavedPlaces)
      .where(
        and(
          eq(customerSavedPlaces.waslaPublicId, waslaPublicId),
          eq(customerSavedPlaces.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : mapPlace(row);
  }

  async countPlaces(waslaPublicId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(customerSavedPlaces)
      .where(eq(customerSavedPlaces.waslaPublicId, waslaPublicId));
    return Number(rows[0]?.count ?? 0);
  }

  async insertPlace(input: InsertSavedPlaceInput): Promise<SavedPlace> {
    try {
      const rows = await this.db
        .insert(customerSavedPlaces)
        .values({
          id: input.id,
          waslaPublicId: input.waslaPublicId,
          label: input.label,
          zoneId: input.zoneId,
          addressText: input.addressText,
          latitude: toNumeric(input.coordinates?.latitude ?? null),
          longitude: toNumeric(input.coordinates?.longitude ?? null),
          idempotencyKey: input.idempotencyKey,
          lastUsedAt: null,
          createdAt: new Date(input.createdAt),
          updatedAt: new Date(input.createdAt),
        })
        .returning();
      return mapPlace(rows[0]!);
    } catch (error) {
      return translateUniqueViolation(error, {
        ux_customer_saved_places_label: "duplicate place label for customer",
        ux_customer_saved_places_idempotency:
          "duplicate idempotency key for customer place",
      });
    }
  }

  async deletePlace(waslaPublicId: string, placeId: string): Promise<boolean> {
    const rows = await this.db
      .delete(customerSavedPlaces)
      .where(
        and(
          eq(customerSavedPlaces.waslaPublicId, waslaPublicId),
          eq(customerSavedPlaces.id, placeId),
        ),
      )
      .returning({ id: customerSavedPlaces.id });
    return rows.length > 0;
  }

  /** A missing place is silently ignored: touching is a hint, not a command. */
  async touchPlace(
    waslaPublicId: string,
    placeId: string,
    usedAt: string,
  ): Promise<void> {
    await this.db
      .update(customerSavedPlaces)
      .set({ lastUsedAt: new Date(usedAt) })
      .where(
        and(
          eq(customerSavedPlaces.waslaPublicId, waslaPublicId),
          eq(customerSavedPlaces.id, placeId),
        ),
      );
  }

  // --- order requests ---

  private async loadStops(orderRequestIds: readonly string[]): Promise<Map<string, Stop[]>> {
    const byRequest = new Map<string, Stop[]>();
    if (orderRequestIds.length === 0) return byRequest;
    const rows = await this.db
      .select()
      .from(customerOrderRequestStops)
      .where(inArray(customerOrderRequestStops.orderRequestId, [...orderRequestIds]))
      .orderBy(asc(customerOrderRequestStops.sequence));
    for (const row of rows) {
      const stops = byRequest.get(row.orderRequestId) ?? [];
      stops.push(mapStop(row));
      byRequest.set(row.orderRequestId, stops);
    }
    return byRequest;
  }

  private async hydrate(
    rows: readonly (typeof customerOrderRequests.$inferSelect)[],
  ): Promise<CustomerOrderRequest[]> {
    const stops = await this.loadStops(rows.map((row) => row.id));
    return rows.map((row) => mapOrderRequest(row, stops.get(row.id) ?? []));
  }

  async findOrderRequest(
    waslaPublicId: string,
    orderRequestId: string,
  ): Promise<CustomerOrderRequest | null> {
    const rows = await this.db
      .select()
      .from(customerOrderRequests)
      .where(
        and(
          eq(customerOrderRequests.waslaPublicId, waslaPublicId),
          eq(customerOrderRequests.id, orderRequestId),
        ),
      )
      .limit(1);
    const hydrated = await this.hydrate(rows);
    return hydrated[0] ?? null;
  }

  async findOrderRequestByIdempotencyKey(
    waslaPublicId: string,
    idempotencyKey: string,
  ): Promise<CustomerOrderRequest | null> {
    const rows = await this.db
      .select()
      .from(customerOrderRequests)
      .where(
        and(
          eq(customerOrderRequests.waslaPublicId, waslaPublicId),
          eq(customerOrderRequests.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    const hydrated = await this.hydrate(rows);
    return hydrated[0] ?? null;
  }

  /** Newest first, served by `ix_customer_order_requests_owner`. */
  async listOrderRequests(
    waslaPublicId: string,
    options: { readonly status?: OrderRequestStatus; readonly limit?: number } = {},
  ): Promise<CustomerOrderRequest[]> {
    const where =
      options.status === undefined
        ? eq(customerOrderRequests.waslaPublicId, waslaPublicId)
        : and(
            eq(customerOrderRequests.waslaPublicId, waslaPublicId),
            eq(customerOrderRequests.status, options.status),
          );

    const query = this.db
      .select()
      .from(customerOrderRequests)
      .where(where)
      .orderBy(desc(customerOrderRequests.createdAt));
    const rows =
      options.limit === undefined ? await query : await query.limit(options.limit);
    return this.hydrate(rows);
  }

  /**
   * One transaction for the request and its stops. A request without its stops
   * is not a partially saved request, it is an unanswerable one: the engine
   * cannot be told where to go, and nothing in the row says so.
   */
  async insertOrderRequest(
    input: InsertOrderRequestInput,
  ): Promise<CustomerOrderRequest> {
    try {
      return await this.db.transaction(async (tx) => {
        const rows = await tx
          .insert(customerOrderRequests)
          .values({
            id: input.id,
            waslaPublicId: input.waslaPublicId,
            idempotencyKey: input.idempotencyKey,
            status: input.status,
            orderType: input.orderType,
            vehicleClass: input.vehicleClass,
            priceMode: input.priceMode,
            offeredAmountMinor: input.offeredPrice?.amountMinor ?? null,
            currency: input.offeredPrice?.currency ?? null,
            shipmentType: input.shipment?.shipmentType ?? null,
            shipmentDescription: input.shipment?.description ?? null,
            weightKg: toNumeric(input.shipment?.weightKg ?? null),
            notes: input.notes,
            orderPublicId: input.orderPublicId,
            submittedAt:
              input.submittedAt === null ? null : new Date(input.submittedAt),
            failureReasonCode: input.failureReasonCode,
            createdAt: new Date(input.createdAt),
            updatedAt: new Date(input.createdAt),
          })
          .returning();

        if (input.stops.length > 0) {
          await tx.insert(customerOrderRequestStops).values(
            input.stops.map((stop) => ({
              orderRequestId: input.id,
              sequence: stop.sequence,
              kind: stop.kind,
              zoneId: stop.zoneId,
              label: stop.label,
              latitude: toNumeric(stop.coordinates?.latitude ?? null),
              longitude: toNumeric(stop.coordinates?.longitude ?? null),
              source: stop.source,
              savedPlaceId: stop.savedPlaceId,
            })),
          );
        }

        return mapOrderRequest(rows[0]!, [...input.stops]);
      });
    } catch (error) {
      return translateUniqueViolation(error, {
        ux_customer_order_requests_idempotency:
          "duplicate idempotency key for order request",
      });
    }
  }

  /**
   * Apply a handover outcome in place. A retry updates the row the customer's
   * intent already occupies; inserting a second row would be exactly the
   * duplicate the idempotency key exists to prevent.
   */
  async updateOrderRequestOutcome(
    orderRequestId: string,
    outcome: OrderRequestOutcome,
  ): Promise<CustomerOrderRequest> {
    const rows = await this.db
      .update(customerOrderRequests)
      .set({
        status: outcome.status,
        orderPublicId: outcome.orderPublicId,
        submittedAt:
          outcome.submittedAt === null ? null : new Date(outcome.submittedAt),
        failureReasonCode: outcome.failureReasonCode,
        // updated_at is overwritten by the contract's trigger — see the header.
        updatedAt: new Date(outcome.updatedAt),
      })
      .where(eq(customerOrderRequests.id, orderRequestId))
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error("order request not found");
    const stops = await this.loadStops([row.id]);
    return mapOrderRequest(row, stops.get(row.id) ?? []);
  }
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

/**
 * Durable outbox. `unread()` returns unpublished rows in append order, which is
 * the order a relay must publish them in: a `submitted` event overtaking the
 * `profile.created` of the same customer would describe a customer who ordered
 * before existing.
 *
 * Publishing itself has no consumer yet (Phase 09 owns the relay); the rows
 * accumulate on purpose, because an event that was never stored cannot be
 * replayed once a consumer exists.
 *
 * Declared gap: the contract has no `trace_id` column, so a rehydrated event
 * loses the correlation id its envelope carried. Recorded as a risk in TASK_LOG
 * rather than fixed by inventing a column outside the contract — the relay that
 * needs it (Phase 09) is the change that should add it.
 */
export class PostgresCustomerOutbox implements Outbox {
  constructor(private readonly db: Db) {}

  async append(event: CustomerEvent): Promise<void> {
    await this.db.insert(customerOutbox).values({
      eventId: event.event_id,
      eventType: event.event_type,
      eventVersion: event.event_version,
      aggregateType: event.aggregate.type,
      aggregateId: event.aggregate.id,
      payload: event.payload,
      occurredAt: new Date(event.occurred_at),
    });
  }

  async unread(): Promise<CustomerEvent[]> {
    const rows = await this.db
      .select()
      .from(customerOutbox)
      .where(sql`${customerOutbox.publishedAt} IS NULL`)
      .orderBy(asc(customerOutbox.id));
    return rows.map(
      (row) =>
        ({
          event_id: row.eventId,
          event_type: row.eventType,
          event_version: row.eventVersion,
          occurred_at: row.occurredAt.toISOString(),
          producer: "customers-service",
          aggregate: { type: row.aggregateType, id: row.aggregateId },
          payload: row.payload,
        }) as CustomerEvent,
    );
  }

  /** Mark rows as published. Used by the relay (Phase 09) and by tests. */
  async markPublished(eventIds: readonly string[], publishedAt: string): Promise<number> {
    if (eventIds.length === 0) return 0;
    const rows = await this.db
      .update(customerOutbox)
      .set({ publishedAt: new Date(publishedAt) })
      .where(inArray(customerOutbox.eventId, [...eventIds]))
      .returning({ id: customerOutbox.id });
    return rows.length;
  }
}
