/**
 * Postgres integration test for the Customer Core persistence layer (MR 3/6).
 *
 * This file tests the adapter itself against a real database: the things that
 * cannot fail in memory and cannot be caught by a type. Concretely — NUMERIC
 * round-trips as a number, absent shipment/coordinate columns come back as
 * absent keys rather than nulls, the two unique constraints raise the same
 * errors the in-memory adapter raises, the stops of a request are written in the
 * same transaction as the request, and the CHECK constraints of the contract
 * reject rows the domain would also reject.
 *
 * The behavioral equivalence of the two adapters is a different question and is
 * answered by `port-conformance.integration.test.ts`.
 *
 * Excluded from the default `pnpm -r test` (see vitest.config.ts). Run with:
 *   DATABASE_URL=postgres://... pnpm --filter @wasla/customers-service test:integration
 * Skipped entirely when DATABASE_URL is unset.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Pool } from "pg";

import type { CustomerProfile, Stop } from "../domain/model.js";
import type { PostgresCustomerOutbox, PostgresCustomerRepository } from "../infrastructure/drizzle/repository.js";
import type { InsertOrderRequestInput, InsertSavedPlaceInput } from "../ports.js";
import { CUSTOMER, OTHER_CUSTOMER, ZONE_A, ZONE_B } from "./helpers.js";
import { PG_ENABLED, setupPostgres, truncateAll } from "./pg-harness.js";

const T0 = "2026-08-21T00:00:00.000Z";
const T1 = "2026-08-21T01:00:00.000Z";
const T2 = "2026-08-21T02:00:00.000Z";

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function profile(overrides: Partial<CustomerProfile> = {}): CustomerProfile {
  return {
    waslaPublicId: CUSTOMER,
    displayName: "أبو محمد",
    preferredLocale: "ar",
    defaultZoneId: null,
    status: "active",
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function placeInput(overrides: Partial<InsertSavedPlaceInput> = {}): InsertSavedPlaceInput {
  return {
    id: id(1),
    waslaPublicId: CUSTOMER,
    label: "المنزل",
    zoneId: ZONE_A,
    addressText: "حي العزيزية",
    coordinates: null,
    idempotencyKey: "place-0001",
    createdAt: T0,
    ...overrides,
  };
}

const STOPS: readonly Stop[] = [
  {
    kind: "pickup",
    sequence: 1,
    zoneId: ZONE_A,
    label: "المنزل",
    coordinates: { latitude: 24.4711, longitude: 39.6111 },
    source: "map",
    savedPlaceId: null,
  },
  {
    kind: "dropoff",
    sequence: 2,
    zoneId: ZONE_B,
    label: null,
    coordinates: null,
    source: "text_search",
    savedPlaceId: null,
  },
];

function requestInput(
  overrides: Partial<InsertOrderRequestInput> = {},
): InsertOrderRequestInput {
  return {
    id: id(10),
    waslaPublicId: CUSTOMER,
    idempotencyKey: "req-00001",
    // There is no `draft` state: the handover is attempted before the row is
    // written, so every stored row records a completed attempt (ADR-009 §8, and
    // the contract's status CHECK allows nothing else).
    status: "submitted",
    orderType: "ride",
    vehicleClass: "sedan",
    priceMode: "customer_offer",
    offeredPrice: { amountMinor: 1500, currency: "SAR" },
    stops: STOPS,
    shipment: null,
    notes: "الاتصال قبل الوصول",
    orderPublicId: "ORD-0000000001",
    submittedAt: T0,
    failureReasonCode: null,
    createdAt: T0,
    ...overrides,
  };
}

/** A request whose handover failed — the fail-closed row of ADR-009 §8. */
function failedRequestInput(
  overrides: Partial<InsertOrderRequestInput> = {},
): InsertOrderRequestInput {
  return requestInput({
    status: "submission_failed",
    orderPublicId: null,
    submittedAt: null,
    failureReasonCode: "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
    ...overrides,
  });
}

describe.skipIf(!PG_ENABLED)("Customer Postgres adapter", () => {
  let pool: Pool;
  let repo: PostgresCustomerRepository;
  let outbox: PostgresCustomerOutbox;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const fixture = await setupPostgres();
    pool = fixture.pool;
    repo = fixture.repo;
    outbox = fixture.outbox;
    close = fixture.close;
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  // -------------------------------------------------------------------------
  // profile
  // -------------------------------------------------------------------------

  it("round-trips a profile and updates it in place", async () => {
    const created = await repo.saveProfile(profile());
    expect(created).toEqual(profile());

    const updated = await repo.saveProfile(
      profile({ displayName: "أبو خالد", defaultZoneId: ZONE_A, updatedAt: T1 }),
    );
    expect(updated.displayName).toBe("أبو خالد");
    expect(updated.defaultZoneId).toBe(ZONE_A);
    // created_at survives the update: it is the customer's history, not state.
    expect(updated.createdAt).toBe(T0);
    // updated_at is owned by the contract's trigger (server clock), so it is
    // only guaranteed to be at or after created_at — never asserted exactly.
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(T0).getTime(),
    );

    const rows = await pool.query("SELECT count(*)::int AS n FROM customer_profiles");
    expect(rows.rows[0].n).toBe(1);
  });

  it("returns null for an unknown profile instead of throwing", async () => {
    expect(await repo.findProfile(OTHER_CUSTOMER)).toBeNull();
  });

  it("rejects a wasla_public_id that is not WS-<10 digits> (ADR-009 §2)", async () => {
    // The CHECK is the last line of defence if a future writer bypasses the
    // validator; without it an unroutable profile could be stored.
    await expect(repo.saveProfile(profile({ waslaPublicId: "customer-1" }))).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // saved places
  // -------------------------------------------------------------------------

  it("stores coordinates as numbers and their absence as an absent key", async () => {
    const withPoint = await repo.insertPlace(
      placeInput({ coordinates: { latitude: 24.4711, longitude: 39.6111 } }),
    );
    expect(withPoint.coordinates).toEqual({ latitude: 24.4711, longitude: 39.6111 });
    expect(typeof withPoint.coordinates!.latitude).toBe("number");

    const withoutPoint = await repo.insertPlace(
      placeInput({ id: id(2), label: "العمل", idempotencyKey: "place-0002" }),
    );
    expect(withoutPoint.coordinates).toBeNull();
  });

  it("orders places most-recently-used first, never-used last, newest first", async () => {
    await repo.insertPlace(placeInput({ id: id(1), label: "أ", idempotencyKey: "key-0001" }));
    await repo.insertPlace(
      placeInput({ id: id(2), label: "ب", idempotencyKey: "key-0002", createdAt: T1 }),
    );
    await repo.insertPlace(
      placeInput({ id: id(3), label: "ج", idempotencyKey: "key-0003", createdAt: T2 }),
    );

    // Nothing used yet → newest first.
    expect((await repo.listPlaces(CUSTOMER)).map((p) => p.label)).toEqual(["ج", "ب", "أ"]);

    // Using the oldest one moves it to the front; never-used ones stay ordered.
    await repo.touchPlace(CUSTOMER, id(1), T2);
    expect((await repo.listPlaces(CUSTOMER)).map((p) => p.label)).toEqual(["أ", "ج", "ب"]);
  });

  it("rejects a duplicate label case-insensitively with the port's error", async () => {
    await repo.insertPlace(placeInput({ label: "Home" }));
    await expect(
      repo.insertPlace(placeInput({ id: id(2), label: "HOME", idempotencyKey: "key-0002" })),
    ).rejects.toThrow("duplicate place label for customer");
  });

  it("rejects a reused idempotency key with the port's error", async () => {
    await repo.insertPlace(placeInput());
    await expect(
      repo.insertPlace(placeInput({ id: id(2), label: "العمل" })),
    ).rejects.toThrow("duplicate idempotency key for customer place");
  });

  it("scopes every place read and write to its owner", async () => {
    await repo.insertPlace(placeInput());
    expect(await repo.findPlace(OTHER_CUSTOMER, id(1))).toBeNull();
    expect(await repo.findPlaceByLabel(OTHER_CUSTOMER, "المنزل")).toBeNull();
    expect(await repo.findPlaceByIdempotencyKey(OTHER_CUSTOMER, "place-0001")).toBeNull();
    expect(await repo.countPlaces(OTHER_CUSTOMER)).toBe(0);
    // A cross-owner delete must not report success, or the bot would tell a
    // customer their place was removed while it still exists.
    expect(await repo.deletePlace(OTHER_CUSTOMER, id(1))).toBe(false);
    expect(await repo.countPlaces(CUSTOMER)).toBe(1);

    expect(await repo.deletePlace(CUSTOMER, id(1))).toBe(true);
    expect(await repo.deletePlace(CUSTOMER, id(1))).toBe(false);
  });

  it("ignores touching a place that does not exist", async () => {
    await expect(repo.touchPlace(CUSTOMER, id(99), T1)).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // order requests
  // -------------------------------------------------------------------------

  it("writes a request and its ordered stops, and reads them back identically", async () => {
    const inserted = await repo.insertOrderRequest(requestInput());
    expect(inserted.stops.map((s) => s.sequence)).toEqual([1, 2]);

    const read = await repo.findOrderRequest(CUSTOMER, id(10));
    expect(read).not.toBeNull();
    expect(read).toEqual(inserted);
    expect(read!.offeredPrice).toEqual({ amountMinor: 1500, currency: "SAR" });
    expect(read!.stops[0].coordinates).toEqual({ latitude: 24.4711, longitude: 39.6111 });
    // Absent coordinates stay absent — a stop is anchored by its zone, and an
    // invented (0,0) would be a point in the Gulf of Guinea.
    expect(read!.stops[1].coordinates).toBeNull();
    expect(read!.shipment).toBeNull();
    expect(read!.updatedAt).toBe(read!.createdAt);
  });

  it("keeps weight as a number and omits shipment fields the customer never sent", async () => {
    await repo.insertOrderRequest(
      requestInput({
        orderType: "delivery",
        vehicleClass: "motorcycle",
        shipment: { shipmentType: "parcel", weightKg: 3.5 },
      }),
    );
    const read = await repo.findOrderRequest(CUSTOMER, id(10));
    // Exactly the object the validator produced: no `description: null` key,
    // because the idempotency fingerprint must not depend on where the request
    // was read from.
    expect(read!.shipment).toEqual({ shipmentType: "parcel", weightKg: 3.5 });
  });

  it("stores the shipment description published by the OpenAPI contract", async () => {
    await repo.insertOrderRequest(
      requestInput({
        orderType: "delivery",
        vehicleClass: "motorcycle",
        shipment: { shipmentType: "parcel", description: "أوراق", weightKg: 1 },
      }),
    );
    const read = await repo.findOrderRequest(CUSTOMER, id(10));
    expect(read!.shipment).toEqual({
      shipmentType: "parcel",
      description: "أوراق",
      weightKg: 1,
    });
  });

  it("rolls back the request when its stops cannot be written", async () => {
    // A request without its stops is not partially saved, it is unanswerable:
    // the engine cannot be told where to go and nothing in the row says so.
    await expect(
      repo.insertOrderRequest(
        requestInput({
          stops: [
            ...STOPS,
            { ...STOPS[1], sequence: 2, kind: "dropoff" }, // duplicate PK
          ],
        }),
      ),
    ).rejects.toThrow();

    expect(await repo.findOrderRequest(CUSTOMER, id(10))).toBeNull();
    const rows = await pool.query("SELECT count(*)::int AS n FROM customer_order_requests");
    expect(rows.rows[0].n).toBe(0);
  });

  it("rejects a reused idempotency key with the port's error", async () => {
    await repo.insertOrderRequest(requestInput());
    await expect(
      repo.insertOrderRequest(
        requestInput({ id: id(11), orderPublicId: "ORD-0000000002" }),
      ),
    ).rejects.toThrow("duplicate idempotency key for order request");
  });

  it("refuses to reference the same engine order twice", async () => {
    // Two customer requests pointing at one order would make the engine's
    // reference ambiguous in both directions.
    await repo.insertOrderRequest(requestInput());
    await expect(
      repo.insertOrderRequest(requestInput({ id: id(11), idempotencyKey: "req-00002" })),
    ).rejects.toThrow();
  });

  it("finds a request by idempotency key, scoped to its owner", async () => {
    await repo.insertOrderRequest(requestInput());
    expect((await repo.findOrderRequestByIdempotencyKey(CUSTOMER, "req-00001"))!.id).toBe(id(10));
    expect(await repo.findOrderRequestByIdempotencyKey(OTHER_CUSTOMER, "req-00001")).toBeNull();
  });

  it("lists requests newest first, filtered and limited", async () => {
    await repo.insertOrderRequest(failedRequestInput({ id: id(10), idempotencyKey: "key-aaaa" }));
    await repo.insertOrderRequest(
      failedRequestInput({ id: id(11), idempotencyKey: "key-bbbb", createdAt: T1 }),
    );
    await repo.insertOrderRequest(
      requestInput({
        id: id(12),
        idempotencyKey: "key-cccc",
        createdAt: T2,
        submittedAt: T2,
      }),
    );

    expect((await repo.listOrderRequests(CUSTOMER)).map((r) => r.id)).toEqual([
      id(12),
      id(11),
      id(10),
    ]);
    expect(
      (await repo.listOrderRequests(CUSTOMER, { status: "submitted" })).map((r) => r.id),
    ).toEqual([id(12)]);
    expect((await repo.listOrderRequests(CUSTOMER, { limit: 2 })).map((r) => r.id)).toEqual([
      id(12),
      id(11),
    ]);
    expect(await repo.listOrderRequests(OTHER_CUSTOMER)).toEqual([]);
    // Every listed request still carries its stops: a list the bot cannot
    // render is not a useful list.
    for (const request of await repo.listOrderRequests(CUSTOMER)) {
      expect(request.stops).toHaveLength(2);
    }
  });

  it("applies a retried handover in place, keeping one row per intent", async () => {
    await repo.insertOrderRequest(failedRequestInput());
    const submitted = await repo.updateOrderRequestOutcome(id(10), {
      status: "submitted",
      orderPublicId: "ORD-0000000001",
      submittedAt: T1,
      failureReasonCode: null,
      updatedAt: T1,
    });
    expect(submitted.status).toBe("submitted");
    expect(submitted.orderPublicId).toBe("ORD-0000000001");
    expect(submitted.submittedAt).toBe(T1);
    expect(submitted.stops).toHaveLength(2);

    const rows = await pool.query("SELECT count(*)::int AS n FROM customer_order_requests");
    expect(rows.rows[0].n).toBe(1);
  });

  it("records a failed handover with its reason and no order id (fail-closed)", async () => {
    const failed = await repo.insertOrderRequest(failedRequestInput());
    expect(failed.status).toBe("submission_failed");
    expect(failed.failureReasonCode).toBe("CUSTOMER_ORDER_INTAKE_UNAVAILABLE");
    expect(failed.orderPublicId).toBeNull();
    expect(failed.submittedAt).toBeNull();

    const read = await repo.findOrderRequest(CUSTOMER, id(10));
    expect(read).toEqual(failed);
  });

  it("throws when the outcome targets a request that does not exist", async () => {
    await expect(
      repo.updateOrderRequestOutcome(id(99), {
        status: "submitted",
        orderPublicId: "ORD-0000000001",
        submittedAt: T1,
        failureReasonCode: null,
        updatedAt: T1,
      }),
    ).rejects.toThrow("order request not found");
  });

  it("cascades stops when a request is deleted", async () => {
    await repo.insertOrderRequest(requestInput());
    await pool.query("DELETE FROM customer_order_requests WHERE id = $1", [id(10)]);
    const rows = await pool.query(
      "SELECT count(*)::int AS n FROM customer_order_request_stops",
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it("refuses a submitted request with no submission time (coherence CHECK)", async () => {
    await expect(
      repo.insertOrderRequest(requestInput({ submittedAt: null })),
    ).rejects.toThrow();
  });

  it("refuses a failed request with no reason (coherence CHECK)", async () => {
    await expect(
      repo.insertOrderRequest(
        failedRequestInput({ failureReasonCode: null }),
      ),
    ).rejects.toThrow();
  });

  it("refuses an offered price without an amount (price mode CHECK)", async () => {
    await expect(
      repo.insertOrderRequest(requestInput({ offeredPrice: null })),
    ).rejects.toThrow();
  });

  it("refuses shipment details on a ride (shipment scope CHECK)", async () => {
    // A ride carrying a parcel weight is a broken model, not extra data.
    await expect(
      repo.insertOrderRequest(
        requestInput({ shipment: { shipmentType: "parcel", weightKg: 3.5 } }),
      ),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // outbox
  // -------------------------------------------------------------------------

  it("appends events and returns unpublished ones in append order", async () => {
    const event = (n: number, type: string) =>
      ({
        event_id: id(100 + n),
        event_type: type,
        event_version: "1.0",
        occurred_at: T0,
        producer: "customers-service",
        aggregate: { type: "customer", id: CUSTOMER },
        payload: { wasla_public_id: CUSTOMER },
      }) as never;

    await outbox.append(event(1, "customer.profile.created"));
    await outbox.append(event(2, "customer.profile.updated"));

    const unread = await outbox.unread();
    expect(unread.map((e) => e.event_type)).toEqual([
      "customer.profile.created",
      "customer.profile.updated",
    ]);

    // Marking one published removes it from the relay's queue and leaves the
    // rest in order — a published event must never be delivered twice.
    expect(await outbox.markPublished([id(101)], T1)).toBe(1);
    expect((await outbox.unread()).map((e) => e.event_id)).toEqual([id(102)]);
  });

  it("refuses to store the same event twice (event_id is unique)", async () => {
    const event = {
      event_id: id(200),
      event_type: "customer.profile.created",
      event_version: "1.0",
      occurred_at: T0,
      producer: "customers-service",
      aggregate: { type: "customer", id: CUSTOMER },
      payload: { wasla_public_id: CUSTOMER },
    } as never;
    await outbox.append(event);
    await expect(outbox.append(event)).rejects.toThrow();
  });
});
