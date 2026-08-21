/**
 * Saved-place use-case tests: limit, label uniqueness, idempotency, ownership.
 */

import { SAVED_PLACES_LIMIT } from "@wasla/contracts-customer";
import { describe, expect, it } from "vitest";

import {
  listSavedPlaces,
  removeSavedPlace,
  savePlace,
} from "../use-cases/saved-places.js";
import {
  CUSTOMER,
  OTHER_CUSTOMER,
  ZONE_A,
  ZONE_B,
  ZONE_INACTIVE,
  expectCustomerError,
  makeContext,
  seedProfile,
  type TestContext,
} from "./helpers.js";

async function save(
  ctx: TestContext,
  label: string,
  key: string,
  zoneId: string = ZONE_A,
) {
  return savePlace(ctx, {
    waslaPublicId: CUSTOMER,
    idempotencyKey: key,
    draft: { label, zoneId },
  });
}

describe("saved places", () => {
  it("saves a place anchored to an active zone", async () => {
    const ctx = makeContext();
    await seedProfile(ctx);

    const { place, replayed } = await savePlace(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: "place-key-0001",
      draft: {
        label: "البيت",
        zoneId: ZONE_A,
        addressText: "شارع الستين",
        coordinates: { latitude: 24.47, longitude: 39.61 },
      },
    });

    expect(replayed).toBe(false);
    expect(place.zoneId).toBe(ZONE_A);
    expect(place.lastUsedAt).toBeNull();
    expect(ctx.outbox.all()[0]?.event_type).toBe("customer.place.saved");
  });

  it("separates a missing idempotency key from an unusable one", async () => {
    const ctx = makeContext();
    // Absent means the caller forgot the header — its own code, so the bot can
    // fix the call rather than blame the body.
    const missing = await expectCustomerError(
      () => save(ctx, "البيت", "   "),
      "CUSTOMER_MISSING_IDEMPOTENCY_KEY",
    );
    expect(missing.httpStatus).toBe(400);
    // Present but too short is a malformed value, not a missing one.
    await expectCustomerError(
      () => save(ctx, "البيت", "short"),
      "CUSTOMER_INVALID_REQUEST_BODY",
    );
  });

  it("rejects an inactive zone", async () => {
    const ctx = makeContext();
    await expectCustomerError(
      () => save(ctx, "البيت", "place-key-0001", ZONE_INACTIVE),
      "CUSTOMER_ZONE_INACTIVE",
    );
  });

  it("rejects a duplicate label regardless of letter case", async () => {
    const ctx = makeContext();
    await save(ctx, "Home", "place-key-0001");
    const failure = await expectCustomerError(
      () => save(ctx, "hOmE", "place-key-0002"),
      "CUSTOMER_PLACE_LABEL_TAKEN",
    );
    expect(failure.httpStatus).toBe(409);
  });

  it("returns the same place for a replayed key and emits one event only", async () => {
    const ctx = makeContext();
    const first = await save(ctx, "البيت", "place-key-0001");
    const second = await save(ctx, "البيت", "place-key-0001");

    expect(second.replayed).toBe(true);
    expect(second.place.id).toBe(first.place.id);
    expect(ctx.outbox.all()).toHaveLength(1);
  });

  it("rejects a reused key that carries a different payload", async () => {
    const ctx = makeContext();
    await save(ctx, "البيت", "place-key-0001", ZONE_A);
    await expectCustomerError(
      () => save(ctx, "البيت", "place-key-0001", ZONE_B),
      "CUSTOMER_IDEMPOTENCY_KEY_REUSED",
    );
  });

  it("enforces the documented places limit", async () => {
    const ctx = makeContext();
    for (let index = 0; index < SAVED_PLACES_LIMIT; index += 1) {
      await save(ctx, `مكان ${index}`, `place-key-${String(index).padStart(4, "0")}`);
    }
    const failure = await expectCustomerError(
      () => save(ctx, "مكان زائد", "place-key-overflow"),
      "CUSTOMER_PLACE_LIMIT_REACHED",
    );
    expect(failure.httpStatus).toBe(422);
  });

  it("lists places most recently used first", async () => {
    const ctx = makeContext();
    const older = await save(ctx, "البيت", "place-key-0001");
    ctx.clock.advance(1000);
    await save(ctx, "العمل", "place-key-0002");
    ctx.clock.advance(1000);
    await ctx.repo.touchPlace(CUSTOMER, older.place.id, ctx.clock.now());

    const places = await listSavedPlaces(ctx, { waslaPublicId: CUSTOMER });
    expect(places.map((place) => place.label)).toEqual(["البيت", "العمل"]);
  });

  it("removes a place and announces it", async () => {
    const ctx = makeContext();
    const { place } = await save(ctx, "البيت", "place-key-0001");
    ctx.outbox.clear();

    await removeSavedPlace(ctx, { waslaPublicId: CUSTOMER, placeId: place.id });

    expect(await listSavedPlaces(ctx, { waslaPublicId: CUSTOMER })).toHaveLength(0);
    expect(ctx.outbox.all()[0]?.event_type).toBe("customer.place.removed");
  });

  it("hides another customer's place behind a 404", async () => {
    const ctx = makeContext();
    const { place } = await save(ctx, "البيت", "place-key-0001");
    await expectCustomerError(
      () =>
        removeSavedPlace(ctx, {
          waslaPublicId: OTHER_CUSTOMER,
          placeId: place.id,
        }),
      "CUSTOMER_PLACE_NOT_FOUND",
    );
  });
});
