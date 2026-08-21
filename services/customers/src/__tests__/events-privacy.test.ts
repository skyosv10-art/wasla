/**
 * Privacy guard for domain events (§12.3 · §48).
 *
 * Events carry zone-level location and classifications only. This suite walks
 * every event a full customer journey produces and fails if any user-authored
 * text or coordinate pair appears anywhere in the serialized payload, so the rule
 * cannot be broken by adding a field later.
 */

import { describe, expect, it } from "vitest";

import { upsertCustomerProfile } from "../use-cases/customer-profile.js";
import { removeSavedPlace, savePlace } from "../use-cases/saved-places.js";
import { submitOrderRequest } from "../use-cases/order-requests.js";
import {
  CUSTOMER,
  ZONE_A,
  ZONE_B,
  deliveryDraft,
  makeContext,
  rideDraft,
} from "./helpers.js";

const DISPLAY_NAME = "أبو محمد";
const PLACE_LABEL = "بيت العائلة";
const ADDRESS_TEXT = "شارع الستين، حي العزيزية";
const NOTES = "الاتصال قبل الوصول";
const LATITUDE = 24.4711;
const LONGITUDE = 39.6142;

describe("event privacy", () => {
  it("never publishes user text or coordinates", async () => {
    const ctx = makeContext({ traceId: "trace-0001" });

    await upsertCustomerProfile(ctx, {
      waslaPublicId: CUSTOMER,
      patch: { displayName: DISPLAY_NAME, defaultZoneId: ZONE_A },
    });
    const { place } = await savePlace(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: "place-key-0001",
      draft: {
        label: PLACE_LABEL,
        zoneId: ZONE_A,
        addressText: ADDRESS_TEXT,
        coordinates: { latitude: LATITUDE, longitude: LONGITUDE },
      },
    });
    await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: "order-key-000001",
      draft: rideDraft({
        notes: NOTES,
        stops: [
          {
            kind: "pickup",
            zoneId: ZONE_A,
            label: PLACE_LABEL,
            coordinates: { latitude: LATITUDE, longitude: LONGITUDE },
            source: "map",
          },
          { kind: "dropoff", zoneId: ZONE_B, source: "map" },
        ],
      }),
    });
    await removeSavedPlace(ctx, { waslaPublicId: CUSTOMER, placeId: place.id });

    const events = ctx.outbox.all();
    expect(events.map((event) => event.event_type)).toEqual([
      "customer.profile.created",
      "customer.place.saved",
      "customer.order_request.submitted",
      "customer.place.removed",
    ]);

    const serialized = JSON.stringify(events);
    for (const secret of [DISPLAY_NAME, PLACE_LABEL, ADDRESS_TEXT, NOTES]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain(String(LATITUDE));
    expect(serialized).not.toContain(String(LONGITUDE));

    // The presence of a name is announced as a boolean, without the value.
    const created = events[0] as { payload: { has_display_name: boolean } };
    expect(created.payload.has_display_name).toBe(true);
    const saved = events[1] as { payload: { has_coordinates: boolean } };
    expect(saved.payload.has_coordinates).toBe(true);

    // Zone level only, and the trace id is carried on every envelope.
    const submitted = events[2] as {
      trace_id?: string;
      payload: { pickup_zone_id: string; dropoff_zone_id: string };
    };
    expect(submitted.payload.pickup_zone_id).toBe(ZONE_A);
    expect(submitted.payload.dropoff_zone_id).toBe(ZONE_B);
    expect(submitted.trace_id).toBe("trace-0001");
  });

  it("never publishes the shipment description the customer wrote", async () => {
    // MR 3/6 adopted `shipment.description`: the OpenAPI contract publishes it
    // and the schema has a column for it, but the domain used to drop it. It is
    // now stored and handed to the order engine — which makes it exactly the
    // kind of field that could leak into an event by accident, since
    // `shipment_type` already travels there. This test is the guard that came
    // with the adoption.
    const description = "أوراق ثبوتية باسم أبو محمد";
    const ctx = makeContext();

    await upsertCustomerProfile(ctx, {
      waslaPublicId: CUSTOMER,
      patch: { displayName: DISPLAY_NAME },
    });
    const { orderRequest } = await submitOrderRequest(ctx, {
      waslaPublicId: CUSTOMER,
      idempotencyKey: "order-key-0002",
      draft: deliveryDraft({
        shipment: { shipmentType: "documents", description, weightKg: 2 },
      }),
    });

    // Stored and handed over…
    expect(orderRequest.shipment?.description).toBe(description);
    expect(ctx.intake.lastRequest?.shipment?.description).toBe(description);

    // …but absent from every event, in whole and in part.
    const serialized = JSON.stringify(ctx.outbox.all());
    expect(serialized).not.toContain(description);
    expect(serialized).not.toContain("ثبوتية");
    expect(serialized).not.toContain("description");
    // The classification still travels: it is a category, not the text.
    expect(serialized).toContain("documents");
  });

  it("stamps every event with the same producer and version", async () => {
    const ctx = makeContext();
    await upsertCustomerProfile(ctx, { waslaPublicId: CUSTOMER, patch: {} });

    for (const event of ctx.outbox.all()) {
      expect(event.producer).toBe("customers-service");
      expect(event.event_version).toBe("v1");
      expect(event.occurred_at).toBe(ctx.clock.now());
      expect(event.event_id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
