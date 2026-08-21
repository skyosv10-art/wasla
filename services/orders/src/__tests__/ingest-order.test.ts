/**
 * Intake: the only door an order comes through.
 *
 * The tests focus on the two things that decide whether the handover from
 * Phase 04 is trustworthy: the validation the engine performs on its own behalf,
 * and the three distinct idempotency outcomes. A retry that created a second
 * order would double-charge a customer later; a key reuse that returned someone
 * else's order would show them a stranger's trip.
 */

import { ORDER_PUBLIC_ID_PATTERN } from "@wasla/contracts-order";
import { beforeEach, describe, expect, it } from "vitest";

import { ingestOrder, fingerprintIntake } from "../use-cases/ingest-order.js";
import { createOrder, intakeCommand, makeHarness, publicId, type Harness } from "./harness.js";

let harness: Harness;

beforeEach(() => {
  harness = makeHarness();
});

describe("a created order", () => {
  it("starts published with no reason and no assignment", async () => {
    const outcome = await ingestOrder(harness, intakeCommand());
    expect(outcome.order.status).toBe("published");
    expect(outcome.order.statusReasonCode).toBeNull();
    expect(outcome.order.activeAssignmentId).toBeNull();
    expect(outcome.replayed).toBe(false);
  });

  it("carries an engine-minted public id", async () => {
    const outcome = await ingestOrder(harness, intakeCommand());
    expect(outcome.orderPublicId).toMatch(ORDER_PUBLIC_ID_PATTERN);
    expect(outcome.order.orderPublicId).toBe(outcome.orderPublicId);
  });

  it("mints gapless, monotone public ids", async () => {
    const first = await ingestOrder(harness, intakeCommand());
    const second = await ingestOrder(harness, intakeCommand());
    expect(first.orderPublicId).toBe("ORD-0000000001");
    expect(second.orderPublicId).toBe("ORD-0000000002");
  });

  it("keeps the customer's requested_at distinct from the engine's accepted_at", async () => {
    harness.clock.advance(60);
    const outcome = await ingestOrder(
      harness,
      intakeCommand({ requestedAt: "2026-01-01T00:00:00.000Z" }),
    );
    expect(outcome.order.requestedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(outcome.order.acceptedAt).toBe("2026-01-01T00:01:00.000Z");
  });

  it("writes the creation audit row as part of creation", async () => {
    const orderId = await createOrder(harness);
    const history = await harness.repository.listStatusHistory(orderId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      sequence: 1,
      fromStatus: null,
      toStatus: "published",
      actorType: "system",
      actorRef: null,
    });
  });

  it("emits order.created and order.status_changed together", async () => {
    await ingestOrder(harness, intakeCommand());
    const events = await harness.outbox.unread();
    expect(events.map((e) => e.event_type)).toEqual([
      "order.created",
      "order.status_changed",
    ]);
    expect(events.every((e) => e.producer === "orders-service")).toBe(true);
  });

  it("addresses events by public id and reduces stops to their zones", async () => {
    const outcome = await ingestOrder(harness, intakeCommand());
    const [created] = await harness.outbox.unread();
    expect(created!.aggregate).toEqual({ type: "order", id: outcome.orderPublicId });
    expect((created!.data as { stops: unknown[] }).stops).toEqual([
      { kind: "pickup", zone_id: "66666666-6666-4666-8666-666666666666" },
      { kind: "dropoff", zone_id: "77777777-7777-4777-8777-777777777777" },
    ]);
  });

  it("carries money as integer minor units in the event", async () => {
    await ingestOrder(harness, intakeCommand());
    const [created] = await harness.outbox.unread();
    expect(created!.data).toMatchObject({
      offered_amount_minor: 2500,
      currency: "SAR",
    });
  });
});

describe("idempotency", () => {
  it("returns the same order for a retry with the same payload", async () => {
    const command = intakeCommand();
    const first = await ingestOrder(harness, command);
    const second = await ingestOrder(harness, command);
    expect(second.order.id).toBe(first.order.id);
    expect(second.orderPublicId).toBe(first.orderPublicId);
    expect(second.replayed).toBe(true);
  });

  it("emits no second set of events on a retry", async () => {
    const command = intakeCommand();
    await ingestOrder(harness, command);
    await ingestOrder(harness, command);
    expect(await harness.outbox.unread()).toHaveLength(2);
  });

  it("ignores the trace id when fingerprinting, so a retry stays a retry", async () => {
    const command = intakeCommand({ traceId: "trace-1" });
    expect(fingerprintIntake(command)).toBe(
      fingerprintIntake({ ...command, traceId: "trace-2" }),
    );
  });

  it("refuses the same key with a different payload", async () => {
    const command = intakeCommand();
    await ingestOrder(harness, command);
    await expect(
      ingestOrder(harness, {
        ...command,
        orderRequestId: "11111111-1111-4111-8111-999999999999",
        vehicleClass: "suv",
      }),
    ).rejects.toMatchObject({ code: "ORDER_IDEMPOTENCY_KEY_REUSED", httpStatus: 409 });
  });

  it("refuses a second handover of the same customer request", async () => {
    const command = intakeCommand();
    await ingestOrder(harness, command);
    await expect(
      ingestOrder(harness, { ...command, idempotencyKey: "another-key" }),
    ).rejects.toMatchObject({ code: "ORDER_REQUEST_ALREADY_INGESTED", httpStatus: 409 });
  });
});

describe("validation the engine performs on its own behalf", () => {
  it("refuses a customer offer with no amount", async () => {
    await expect(
      ingestOrder(harness, intakeCommand({ priceMode: "customer_offer", offeredPrice: null })),
    ).rejects.toMatchObject({ code: "ORDER_PRICE_MODE_MISMATCH", httpStatus: 422 });
  });

  it("refuses a negotiable order carrying an amount", async () => {
    await expect(
      ingestOrder(harness, intakeCommand({ priceMode: "negotiable" })),
    ).rejects.toMatchObject({ code: "ORDER_PRICE_MODE_MISMATCH", httpStatus: 422 });
  });

  it("accepts a negotiable order with no amount", async () => {
    const outcome = await ingestOrder(
      harness,
      intakeCommand({ priceMode: "negotiable", offeredPrice: null }),
    );
    expect(outcome.order.offeredPrice).toBeNull();
  });

  it("refuses a fractional amount", async () => {
    await expect(
      ingestOrder(
        harness,
        intakeCommand({ offeredPrice: { amountMinor: 25.5, currency: "SAR" } }),
      ),
    ).rejects.toMatchObject({ code: "ORDER_VALIDATION_FAILED", httpStatus: 400 });
  });

  it("refuses anything other than exactly two stops", async () => {
    const [pickup] = intakeCommand().stops;
    await expect(
      ingestOrder(harness, intakeCommand({ stops: [pickup!] })),
    ).rejects.toMatchObject({ code: "ORDER_STOPS_INVALID", httpStatus: 422 });
  });

  it("refuses the stops in the wrong order", async () => {
    const stops = intakeCommand().stops;
    await expect(
      ingestOrder(harness, intakeCommand({ stops: [stops[1]!, stops[0]!] })),
    ).rejects.toMatchObject({ code: "ORDER_STOPS_INVALID", httpStatus: 422 });
  });

  it("refuses a stop with no zone", async () => {
    const stops = intakeCommand().stops;
    await expect(
      ingestOrder(
        harness,
        intakeCommand({ stops: [{ ...stops[0]!, zoneId: "" }, stops[1]!] }),
      ),
    ).rejects.toMatchObject({ code: "ORDER_STOPS_INVALID", httpStatus: 422 });
  });

  it("refuses shipment details on a ride", async () => {
    await expect(
      ingestOrder(
        harness,
        intakeCommand({
          orderType: "ride",
          shipment: { shipmentType: "parcel", description: null, weightKg: 3 },
        }),
      ),
    ).rejects.toMatchObject({ code: "ORDER_SHIPMENT_NOT_ALLOWED", httpStatus: 422 });
  });

  it("accepts shipment details on a delivery", async () => {
    const outcome = await ingestOrder(
      harness,
      intakeCommand({
        orderType: "delivery",
        shipment: { shipmentType: "parcel", description: "كتب", weightKg: 3 },
      }),
    );
    expect(outcome.order.shipment).toEqual({
      shipmentType: "parcel",
      description: "كتب",
      weightKg: 3,
    });
  });

  it("refuses a malformed customer reference", async () => {
    await expect(
      ingestOrder(harness, intakeCommand({ customerPublicId: "customer-1" })),
    ).rejects.toMatchObject({ code: "ORDER_VALIDATION_FAILED", httpStatus: 400 });
  });

  it("refuses an unparseable requested_at", async () => {
    await expect(
      ingestOrder(harness, intakeCommand({ requestedAt: "أمس" })),
    ).rejects.toMatchObject({ code: "ORDER_VALIDATION_FAILED", httpStatus: 400 });
  });

  it("refuses an empty idempotency key", async () => {
    await expect(
      ingestOrder(harness, intakeCommand({ idempotencyKey: "" })),
    ).rejects.toMatchObject({ code: "ORDER_VALIDATION_FAILED", httpStatus: 400 });
  });

  it("writes nothing when validation fails", async () => {
    await expect(
      ingestOrder(harness, intakeCommand({ priceMode: "negotiable" })),
    ).rejects.toThrow();
    expect(await harness.outbox.unread()).toEqual([]);
  });

  it("stores an opaque customer reference without looking it up", async () => {
    const outcome = await ingestOrder(
      harness,
      intakeCommand({ customerPublicId: publicId(4242) }),
    );
    expect(outcome.order.customerPublicId).toBe("WS-0000004242");
  });
});
