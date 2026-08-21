import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  CustomerEvent,
  CustomerEventType,
  CustomerEventByType,
  CustomerProfileCreatedV1,
  CustomerProfileUpdatedV1,
  CustomerPlaceSavedV1,
  CustomerPlaceRemovedV1,
  CustomerOrderRequestSubmittedV1,
  CustomerOrderRequestSubmissionFailedV1,
} from "../index.js";
import { CUSTOMER_EVENT_TYPES } from "../index.js";

/**
 * Drift-guard tests for the hand-derived event types.
 *
 * The event types are hand-authored from events.json (codegen produced an
 * unusable generic type for the $defs-only root schema). These tests read the
 * canonical events.json and assert the hand-written types stay in sync with
 * the contract's event_type literals + payload shapes, and that the privacy
 * rule declared in the contract is actually upheld by the schema.
 */

const eventsContract = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../../../services/customers/contracts/events.json"),
    "utf8",
  ),
) as { $defs: Record<string, any> };

/** Extract the `const` event_type literal from a $def (or null). */
function eventTypeOf(def: any): string | null {
  const allOf = Array.isArray(def?.allOf) ? def.allOf : [];
  for (const part of allOf) {
    const et = part?.properties?.event_type?.const;
    if (typeof et === "string") return et;
  }
  return null;
}

/** Extract the payload schema of an event $def (or null). */
function payloadOf(def: any): any | null {
  const allOf = Array.isArray(def?.allOf) ? def.allOf : [];
  for (const part of allOf) {
    const p = part?.properties?.payload;
    if (p) return p;
  }
  return null;
}

const eventDefs = Object.values(eventsContract.$defs).filter(
  (d) => eventTypeOf(d) !== null,
);

describe("@wasla/contracts-customer — event types drift guard", () => {
  it("CUSTOMER_EVENT_TYPES matches the event_type literals in events.json", () => {
    const schemaTypes = eventDefs
      .map(eventTypeOf)
      .filter((t): t is string => typeof t === "string")
      .sort();
    expect([...CUSTOMER_EVENT_TYPES].sort()).toEqual(schemaTypes);
  });

  it("every schema event_type has a matching key in CustomerEventByType", () => {
    const tsKeys: CustomerEventType[] = [
      "customer.profile.created",
      "customer.profile.updated",
      "customer.place.saved",
      "customer.place.removed",
      "customer.order_request.submitted",
      "customer.order_request.submission_failed",
    ];
    for (const def of eventDefs) {
      expect(tsKeys).toContain(eventTypeOf(def) as CustomerEventType);
    }
    type _Keys = keyof CustomerEventByType;
    const _assertKeys: _Keys[] = tsKeys;
    expect(_assertKeys).toHaveLength(6);
  });

  it("every event declares producer customers-service and version v1", () => {
    for (const def of Object.values(eventsContract.$defs)) {
      if (eventTypeOf(def) === null) continue;
      const allOf = def.allOf as any[];
      const version = allOf.find((p) => p?.properties?.event_version?.const)
        ?.properties.event_version.const;
      expect(version).toBe("v1");
    }
    expect(eventsContract.$defs.EventEnvelope.properties.producer.const).toBe(
      "customers-service",
    );
  });

  it("the envelope aggregate is customer or customer_order_request only", () => {
    expect(
      eventsContract.$defs.EventEnvelope.properties.aggregate.properties.type.enum,
    ).toEqual(["customer", "customer_order_request"]);
  });
});

describe("event payload privacy rule (zone-level, no raw text or coordinates)", () => {
  const forbidden = [
    "latitude",
    "longitude",
    "coordinates",
    "label",
    "address_text",
    "notes",
    "description",
    "display_name",
    "shipment_description",
  ];

  it("no event payload carries coordinates or user-authored text", () => {
    for (const def of eventDefs) {
      const payload = payloadOf(def);
      if (!payload?.properties) continue;
      const keys = Object.keys(payload.properties);
      for (const bad of forbidden) {
        expect(keys, `${eventTypeOf(def)} must not publish ${bad}`).not.toContain(bad);
      }
    }
  });

  it("place events carry zone_id, and only a boolean hint about coordinates", () => {
    const saved = eventsContract.$defs.CustomerPlaceSavedV1;
    const payload = payloadOf(saved);
    expect(payload.required).toContain("zone_id");
    expect(payload.properties.has_coordinates.type).toBe("boolean");
  });

  it("profile events publish only whether a display name exists", () => {
    const created = payloadOf(eventsContract.$defs.CustomerProfileCreatedV1);
    expect(created.properties.has_display_name.type).toBe("boolean");
  });
});

describe("event payload shapes mirror the hand-written types", () => {
  it("CustomerProfileCreatedV1", () => {
    const ev: CustomerProfileCreatedV1 = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      event_type: "customer.profile.created",
      event_version: "v1",
      occurred_at: "2026-08-21T09:00:00Z",
      producer: "customers-service",
      aggregate: { type: "customer", id: "WS-0000010427" },
      payload: {
        wasla_public_id: "WS-0000010427",
        preferred_locale: "ar",
        default_zone_id: null,
        has_display_name: true,
      },
    };
    expect(ev.payload.wasla_public_id).toMatch(/^WS-\d{10}$/);
  });

  it("CustomerProfileUpdatedV1 announces changed fields, not values", () => {
    const ev: CustomerProfileUpdatedV1 = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      event_type: "customer.profile.updated",
      event_version: "v1",
      occurred_at: "2026-08-21T09:00:00Z",
      producer: "customers-service",
      aggregate: { type: "customer", id: "WS-0000010427" },
      payload: {
        wasla_public_id: "WS-0000010427",
        changed_fields: ["display_name", "preferred_locale"],
      },
    };
    expect(ev.payload.changed_fields).toContain("display_name");
  });

  it("CustomerPlaceSavedV1 / CustomerPlaceRemovedV1", () => {
    const saved: CustomerPlaceSavedV1 = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      event_type: "customer.place.saved",
      event_version: "v1",
      occurred_at: "2026-08-21T09:00:00Z",
      producer: "customers-service",
      aggregate: { type: "customer", id: "WS-0000010427" },
      payload: {
        wasla_public_id: "WS-0000010427",
        place_id: "660e8400-e29b-41d4-a716-446655440001",
        zone_id: "770e8400-e29b-41d4-a716-446655440002",
        has_coordinates: false,
      },
    };
    const removed: CustomerPlaceRemovedV1 = {
      ...saved,
      event_type: "customer.place.removed",
      payload: {
        wasla_public_id: "WS-0000010427",
        place_id: "660e8400-e29b-41d4-a716-446655440001",
      },
    };
    expect(saved.payload.zone_id).toBeTruthy();
    expect(removed.payload.place_id).toBe(saved.payload.place_id);
  });

  it("CustomerOrderRequestSubmittedV1 references, never mints, order_public_id", () => {
    const ev: CustomerOrderRequestSubmittedV1 = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      event_type: "customer.order_request.submitted",
      event_version: "v1",
      occurred_at: "2026-08-21T09:00:00Z",
      producer: "customers-service",
      aggregate: {
        type: "customer_order_request",
        id: "880e8400-e29b-41d4-a716-446655440003",
      },
      payload: {
        order_request_id: "880e8400-e29b-41d4-a716-446655440003",
        customer_public_id: "WS-0000010427",
        order_public_id: "ORD-000000123",
        order_type: "ride",
        vehicle_class: "sedan",
        price_mode: "customer_offer",
        offered_amount_minor: 3000,
        currency: "SAR",
        pickup_zone_id: "550e8400-e29b-41d4-a716-446655440000",
        dropoff_zone_id: "660e8400-e29b-41d4-a716-446655440001",
        shipment_type: null,
      },
    };
    expect(Number.isInteger(ev.payload.offered_amount_minor)).toBe(true);
    // The event announces no order state — the engine owns the lifecycle.
    expect(Object.keys(ev.payload)).not.toContain("order_status");
  });

  it("CustomerOrderRequestSubmissionFailedV1 keeps failure visible", () => {
    const ev: CustomerOrderRequestSubmissionFailedV1 = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      event_type: "customer.order_request.submission_failed",
      event_version: "v1",
      occurred_at: "2026-08-21T09:00:00Z",
      producer: "customers-service",
      aggregate: {
        type: "customer_order_request",
        id: "880e8400-e29b-41d4-a716-446655440003",
      },
      payload: {
        order_request_id: "880e8400-e29b-41d4-a716-446655440003",
        customer_public_id: "WS-0000010427",
        reason_code: "CUSTOMER_ORDER_INTAKE_UNAVAILABLE",
      },
    };
    expect(ev.payload.reason_code).toBe("CUSTOMER_ORDER_INTAKE_UNAVAILABLE");
  });

  it("CustomerEvent union discriminates by event_type", () => {
    const ev: CustomerEvent = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      event_type: "customer.place.removed",
      event_version: "v1",
      occurred_at: "2026-08-21T09:00:00Z",
      producer: "customers-service",
      aggregate: { type: "customer", id: "WS-0000010427" },
      payload: {
        wasla_public_id: "WS-0000010427",
        place_id: "660e8400-e29b-41d4-a716-446655440001",
      },
    };
    if (ev.event_type === "customer.place.removed") {
      expect(ev.payload.place_id).toBeTruthy();
    }
  });
});
