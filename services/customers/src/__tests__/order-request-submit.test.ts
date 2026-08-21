/**
 * Submission tests: the handover, its idempotency, and its fail-closed path.
 *
 * This is the behavior the Phase 04 exit gate depends on, so the assertions look
 * at what the order engine actually received — not merely that a call happened.
 */

import { describe, expect, it } from "vitest";

import { UnavailableOrderIntake } from "../infrastructure/in-memory.js";
import {
  getOrderRequest,
  listOrderRequests,
  submitOrderRequest,
} from "../use-cases/order-requests.js";
import { toOrderIntakeRequestDto } from "../use-cases/mappers.js";
import {
  CUSTOMER,
  OTHER_CUSTOMER,
  ZONE_A,
  ZONE_B,
  deliveryDraft,
  expectCustomerError,
  makeContext,
  rideDraft,
  seedProfile,
} from "./helpers.js";

const KEY = "order-key-000001";

describe("order request submission", () => {
  it("hands the request to the order engine and stores its reference", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);

    const { orderRequest, replayed } = await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: KEY,
      draft: rideDraft(),
    });

    expect(replayed).toBe(false);
    expect(orderRequest.status).toBe("submitted");
    // The engine owns the public id; this service only records what it received.
    expect(orderRequest.orderPublicId).toBe("ORD-0000000001");
    expect(orderRequest.submittedAt).toBe(ctx.clock.now());
    expect(orderRequest.failureReasonCode).toBeNull();

    const handover = ctx.intake.lastRequest;
    expect(handover?.orderRequestId).toBe(orderRequest.id);
    expect(handover?.customerPublicId).toBe(CUSTOMER);
    expect(handover?.idempotencyKey).toBe(KEY);
    expect(handover?.stops.map((stop) => stop.zoneId)).toEqual([ZONE_A, ZONE_B]);

    const [event] = ctx.outbox.all();
    expect(event?.event_type).toBe("customer.order_request.submitted");
  });

  it("maps the handover payload to the intake contract shape", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: KEY,
      draft: deliveryDraft(),
    });

    const dto = toOrderIntakeRequestDto(ctx.intake.lastRequest!);
    expect(dto.customer_public_id).toBe(CUSTOMER);
    expect(dto.order_type).toBe("delivery");
    expect(dto.shipment).toEqual({ shipment_type: "parcel", weight_kg: 3.5 });
    expect(dto.stops).toHaveLength(2);
    expect(dto.idempotency_key).toBe(KEY);
  });

  it("replays the same key without a second handover", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    const first = await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: KEY,
      draft: rideDraft(),
    });
    const second = await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: KEY,
      draft: rideDraft(),
    });

    expect(second.replayed).toBe(true);
    expect(second.orderRequest.id).toBe(first.orderRequest.id);
    expect(ctx.intake.received).toHaveLength(1);
    expect(ctx.outbox.all()).toHaveLength(1);
    expect(await listOrderRequests(ctx, { waslaPublicId: CUSTOMER })).toHaveLength(1);
  });

  it("rejects a reused key with a different payload", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: KEY,
      draft: rideDraft(),
    });

    const failure = await expectCustomerError(
      () =>
        submitOrderRequest(ctx, {
          waslaPublicId: CUSTOMER,
          idempotencyKey: KEY,
          draft: rideDraft({ vehicleClass: "van" }),
        }),
      "CUSTOMER_IDEMPOTENCY_KEY_REUSED",
    );
    expect(failure.httpStatus).toBe(409);
    expect(ctx.intake.received).toHaveLength(1);
  });

  it("fails closed when no order engine is available", async () => {
    const ctx = makeContext({ orderIntake: new UnavailableOrderIntake() });
    await seedProfile(ctx);

    const failure = await expectCustomerError(
      () =>
        submitOrderRequest(ctx, {
          waslaPublicId: CUSTOMER,
          idempotencyKey: KEY,
          draft: rideDraft(),
        }),
      "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
    );
    expect(failure.httpStatus).toBe(503);
    expect(failure.reasonCode).toBe("CUSTOMER_ORDER_INTAKE_UNAVAILABLE");

    // The intent is kept, marked as not delivered, and the failure is announced.
    const [stored] = await listOrderRequests(ctx, { waslaPublicId: CUSTOMER });
    expect(stored?.status).toBe("submission_failed");
    expect(stored?.orderPublicId).toBeNull();
    expect(stored?.submittedAt).toBeNull();
    expect(stored?.failureReasonCode).toBe("CUSTOMER_ORDER_INTAKE_UNAVAILABLE");

    const [event] = ctx.outbox.all();
    expect(event?.event_type).toBe("customer.order_request.submission_failed");
  });

  it("records the operational reason a rejection carried", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    ctx.intake.failWith("CUSTOMER_ORDER_INTAKE_TIMEOUT");

    const failure = await expectCustomerError(
      () =>
        submitOrderRequest(ctx, {
          waslaPublicId: CUSTOMER,
          idempotencyKey: KEY,
          draft: rideDraft(),
        }),
      "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
    );
    expect(failure.reasonCode).toBe("CUSTOMER_ORDER_INTAKE_TIMEOUT");
  });

  it("retries a failed handover on the same row", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    ctx.intake.failWith("CUSTOMER_ORDER_INTAKE_UNAVAILABLE");

    await expectCustomerError(
      () =>
        submitOrderRequest(ctx, {
          waslaPublicId: CUSTOMER,
          idempotencyKey: KEY,
          draft: rideDraft(),
        }),
      "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
    );
    const [failed] = await listOrderRequests(ctx, { waslaPublicId: CUSTOMER });

    ctx.intake.failWith(null);
    ctx.clock.advance(30_000);
    const retry = await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: KEY,
      draft: rideDraft(),
    });

    expect(retry.replayed).toBe(true);
    // Same row, now delivered — never a second request for the same key.
    expect(retry.orderRequest.id).toBe(failed?.id);
    expect(retry.orderRequest.status).toBe("submitted");
    expect(retry.orderRequest.orderPublicId).toBe("ORD-0000000001");
    expect(await listOrderRequests(ctx, { waslaPublicId: CUSTOMER })).toHaveLength(1);
    expect(
      ctx.outbox.all().map((event) => event.event_type),
    ).toEqual([
      "customer.order_request.submission_failed",
      "customer.order_request.submitted",
    ]);
  });

  it("marks the saved places a request used", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    const place = await ctx.repo.insertPlace({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      waslaPublicId: CUSTOMER,
      label: "البيت",
      zoneId: ZONE_A,
      addressText: null,
      coordinates: null,
      idempotencyKey: "place-key-0001",
      createdAt: ctx.clock.now(),
    });

    ctx.clock.advance(5000);
    await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: KEY,
      draft: rideDraft({
        stops: [
          {
            kind: "pickup",
            zoneId: ZONE_A,
            source: "saved_place",
            savedPlaceId: place.id,
          },
          { kind: "dropoff", zoneId: ZONE_B, source: "map" },
        ],
      }),
    });

    const stored = await ctx.repo.findPlace(CUSTOMER, place.id);
    expect(stored?.lastUsedAt).toBe(ctx.clock.now());
  });

  it("rejects a stop pointing at a place the customer does not own", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    await expectCustomerError(
      () =>
        submitOrderRequest(ctx, {
          waslaPublicId: CUSTOMER,
          idempotencyKey: KEY,
          draft: rideDraft({
            stops: [
              {
                kind: "pickup",
                zoneId: ZONE_A,
                source: "saved_place",
                savedPlaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              },
              { kind: "dropoff", zoneId: ZONE_B, source: "map" },
            ],
          }),
        }),
      "CUSTOMER_PLACE_NOT_FOUND",
    );
    expect(ctx.intake.received).toHaveLength(0);
  });

  it("scopes reads to the owning customer", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    const { orderRequest } = await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: KEY,
      draft: rideDraft(),
    });

    const found = await getOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      orderRequestId: orderRequest.id,
    });
    expect(found.id).toBe(orderRequest.id);

    await expectCustomerError(
      () =>
        getOrderRequest(ctx, {
          waslaPublicId: OTHER_CUSTOMER,
          orderRequestId: orderRequest.id,
        }),
      "CUSTOMER_ORDER_REQUEST_NOT_FOUND",
    );
  });

  it("filters a listing by handover status", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: KEY,
      draft: rideDraft(),
    });
    ctx.intake.failWith("CUSTOMER_ORDER_INTAKE_REJECTED");
    ctx.clock.advance(1000);
    await expectCustomerError(
      () =>
        submitOrderRequest(ctx, {
          waslaPublicId: CUSTOMER,
          idempotencyKey: "order-key-000002",
          draft: rideDraft({ notes: "طلب آخر" }),
        }),
      "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
    );

    expect(
      await listOrderRequests(ctx, { waslaPublicId: CUSTOMER, status: "submitted" }),
    ).toHaveLength(1);
    expect(
      await listOrderRequests(ctx, {
        waslaPublicId: CUSTOMER,
        status: "submission_failed",
      }),
    ).toHaveLength(1);
  });
});
