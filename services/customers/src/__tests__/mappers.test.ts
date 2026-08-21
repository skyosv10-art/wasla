/**
 * Mapper tests: the domain must reach the wire in the published snake_case shape.
 *
 * These assertions are the reason the HTTP layer (MR 4/6) can be thin: if the
 * DTO shape drifts from the contract, it fails here rather than in a browser.
 */

import { describe, expect, it } from "vitest";

import { upsertCustomerProfile } from "../use-cases/customer-profile.js";
import { savePlace } from "../use-cases/saved-places.js";
import { submitOrderRequest } from "../use-cases/order-requests.js";
import {
  toCustomerProfileDto,
  toOrderRequestDto,
  toSavedPlaceDto,
} from "../use-cases/mappers.js";
import {
  CUSTOMER,
  ZONES,
  ZONE_A,
  makeContext,
  rideDraft,
  seedProfile,
} from "./helpers.js";

describe("mappers", () => {
  it("maps a profile to the published field names", async () => {
    const ctx = makeContext();
    const { profile } = await upsertCustomerProfile(ctx, {
      waslaPublicId: CUSTOMER,
      patch: { displayName: "أبو محمد", defaultZoneId: ZONE_A },
    });

    expect(toCustomerProfileDto(profile)).toEqual({
      wasla_public_id: CUSTOMER,
      display_name: "أبو محمد",
      preferred_locale: "ar",
      default_zone_id: ZONE_A,
      status: "active",
      created_at: ctx.clock.now(),
      updated_at: ctx.clock.now(),
    });
  });

  it("maps a place, resolving the zone path at read time", async () => {
    const ctx = makeContext();
    const { place } = await savePlace(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: "place-key-0001",
      draft: {
        label: "البيت",
        zoneId: ZONE_A,
        coordinates: { latitude: 24.47, longitude: 39.61 },
      },
    });

    const dto = toSavedPlaceDto(place, ZONES[0]?.path);
    expect(dto.zone_id).toBe(ZONE_A);
    expect(dto.zone_path).toContain("العزيزية");
    expect(dto.coordinates).toEqual({ latitude: 24.47, longitude: 39.61 });
    expect(dto.address_text).toBeNull();
    expect(dto.last_used_at).toBeNull();
  });

  it("maps an order request without inventing an order", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    const { orderRequest } = await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: "order-key-000001",
      draft: rideDraft(),
    });

    const dto = toOrderRequestDto(orderRequest, ZONES);
    expect(dto.status).toBe("submitted");
    expect(dto.order_public_id).toBe("ORD-0000000001");
    expect(dto.price_mode).toBe("customer_offer");
    expect(dto.offered_price).toEqual({ amount_minor: 1500, currency: "SAR" });
    expect(dto.stops.map((stop) => stop.sequence)).toEqual([1, 2]);
    expect(dto.shipment).toBeUndefined();
  });

  it("omits the order reference while a handover has not happened", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);
    ctx.intake.failWith("CUSTOMER_ORDER_INTAKE_UNAVAILABLE");
    await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: "order-key-000001",
      draft: rideDraft(),
    }).catch(() => undefined);

    const [stored] = await ctx.repo.listOrderRequests(CUSTOMER);
    const dto = toOrderRequestDto(stored!);
    expect(dto.status).toBe("submission_failed");
    expect(dto.order_public_id).toBeUndefined();
    expect(dto.submitted_at).toBeNull();
  });
});
