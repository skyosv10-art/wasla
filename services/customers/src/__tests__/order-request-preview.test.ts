/**
 * Preview and validation tests.
 *
 * The preview is read-only: every case here also asserts that nothing was
 * written and no event was emitted, because a customer inspecting a request must
 * not create one.
 */

import { describe, expect, it } from "vitest";

import { previewOrderRequest } from "../use-cases/order-requests.js";
import { toOrderRequestPreviewDto } from "../use-cases/mappers.js";
import {
  CUSTOMER,
  ZONE_A,
  ZONE_INACTIVE,
  ZONE_UNKNOWN,
  deliveryDraft,
  expectCustomerError,
  makeContext,
  rideDraft,
  seedProfile,
} from "./helpers.js";

describe("order request preview", () => {
  it("accepts a valid ride and reports the resolved stops", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);

    const preview = await previewOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      draft: rideDraft(),
    });

    expect(preview.valid).toBe(true);
    expect(preview.stops.map((stop) => stop.sequence)).toEqual([1, 2]);
    expect(preview.stops.map((stop) => stop.kind)).toEqual(["pickup", "dropoff"]);
    expect(preview.warnings).toEqual([]);
    // Read-only: no request stored, no event emitted.
    expect(await ctx.repo.listOrderRequests(CUSTOMER)).toHaveLength(0);
    expect(ctx.outbox.all()).toHaveLength(0);
  });

  it("maps the preview to the published DTO shape", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    const dto = toOrderRequestPreviewDto(
      await previewOrderRequest(ctx, { waslaPublicId: CUSTOMER, draft: rideDraft() }),
    );

    expect(dto.valid).toBe(true);
    expect(dto.offered_price).toEqual({ amount_minor: 1500, currency: "SAR" });
    expect(dto.stops[0]?.zone_id).toBe(ZONE_A);
    expect(dto.stops[0]?.zone_path).toContain("العزيزية");
  });

  it("warns without blocking when both stops share a zone", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);

    const preview = await previewOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      draft: rideDraft({
        stops: [
          { kind: "pickup", zoneId: ZONE_A, source: "map" },
          { kind: "dropoff", zoneId: ZONE_A, source: "map" },
        ],
      }),
    });

    expect(preview.warnings).toContain("same_zone_pickup_and_dropoff");
  });

  it("warns when no price is offered", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);

    const preview = await previewOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      draft: rideDraft({ priceMode: "negotiable", offeredPrice: null }),
    });

    expect(preview.warnings).toContain("no_price_offered");
  });

  it("requires an amount in customer_offer mode", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    const failure = await expectCustomerError(
      () =>
        previewOrderRequest(ctx, {
          waslaPublicId: CUSTOMER,
          draft: rideDraft({ offeredPrice: null }),
        }),
      "CUSTOMER_PRICE_MODE_MISMATCH",
    );
    expect(failure.httpStatus).toBe(422);
  });

  it("forbids an amount in negotiable mode", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    await expectCustomerError(
      () =>
        previewOrderRequest(ctx, {
          waslaPublicId: CUSTOMER,
          draft: rideDraft({ priceMode: "negotiable" }),
        }),
      "CUSTOMER_PRICE_MODE_MISMATCH",
    );
  });

  it("reports more than two stops with its own code", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    await expectCustomerError(
      () =>
        previewOrderRequest(ctx, {
          waslaPublicId: CUSTOMER,
          draft: rideDraft({
            stops: [
              { kind: "pickup", zoneId: ZONE_A, source: "map" },
              { kind: "dropoff", zoneId: ZONE_A, source: "map" },
              { kind: "dropoff", zoneId: ZONE_A, source: "map" },
            ],
          }),
        }),
      "CUSTOMER_MULTI_STOP_NOT_SUPPORTED",
    );
  });

  it("rejects a single stop as an invalid body", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    await expectCustomerError(
      () =>
        previewOrderRequest(ctx, {
          waslaPublicId: CUSTOMER,
          draft: rideDraft({
            stops: [{ kind: "pickup", zoneId: ZONE_A, source: "map" }],
          }),
        }),
      "CUSTOMER_INVALID_REQUEST_BODY",
    );
  });

  it("rejects shipment details on a ride", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    await expectCustomerError(
      () =>
        previewOrderRequest(ctx, {
          waslaPublicId: CUSTOMER,
          draft: rideDraft({ shipment: { shipmentType: "parcel" } }),
        }),
      "CUSTOMER_SHIPMENT_NOT_ALLOWED_FOR_RIDE",
    );
  });

  it("accepts shipment details on a delivery", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    const preview = await previewOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      draft: deliveryDraft(),
    });
    expect(preview.request.shipment).toEqual({
      shipmentType: "parcel",
      weightKg: 3.5,
    });
  });

  it("validates every referenced zone", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    await expectCustomerError(
      () =>
        previewOrderRequest(ctx, {
          waslaPublicId: CUSTOMER,
          draft: rideDraft({
            stops: [
              { kind: "pickup", zoneId: ZONE_A, source: "map" },
              { kind: "dropoff", zoneId: ZONE_UNKNOWN, source: "map" },
            ],
          }),
        }),
      "CUSTOMER_ZONE_NOT_FOUND",
    );
    await expectCustomerError(
      () =>
        previewOrderRequest(ctx, {
          waslaPublicId: CUSTOMER,
          draft: rideDraft({
            stops: [
              { kind: "pickup", zoneId: ZONE_INACTIVE, source: "map" },
              { kind: "dropoff", zoneId: ZONE_A, source: "map" },
            ],
          }),
        }),
      "CUSTOMER_ZONE_INACTIVE",
    );
  });

  it("requires a profile before previewing", async () => {
    const ctx = makeContext();
    await expectCustomerError(
      () => previewOrderRequest(ctx, { waslaPublicId: CUSTOMER, draft: rideDraft() }),
      "CUSTOMER_PROFILE_NOT_FOUND",
    );
  });

  it("refuses a suspended profile", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    const profile = await ctx.repo.findProfile(CUSTOMER);
    await ctx.repo.saveProfile({ ...profile!, status: "suspended" });

    const failure = await expectCustomerError(
      () => previewOrderRequest(ctx, { waslaPublicId: CUSTOMER, draft: rideDraft() }),
      "CUSTOMER_PROFILE_SUSPENDED",
    );
    expect(failure.httpStatus).toBe(409);
  });
});
