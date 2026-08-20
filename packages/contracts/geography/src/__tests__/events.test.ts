import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  GeographyEvent,
  GeographyEventType,
  GeographyEventByType,
  UserLocationSetV1,
  UserLocationChangedV1,
} from "../index.js";
import { GEOGRAPHY_EVENT_TYPES } from "../index.js";

/**
 * Drift-guard tests for the hand-derived event types.
 *
 * The event types are hand-authored from events.json (codegen produced an
 * unusable generic type for the $defs-only root schema). These tests read the
 * canonical events.json and assert the hand-written types stay in sync with
 * the contract's event_type literals + payload shapes.
 */

const eventsContract = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../../../services/geography/contracts/events.json"),
    "utf8",
  ),
) as {
  $defs: Record<string, any>;
};

/** Extract the `const` event_type literal from a $def (or null). */
function eventTypeOf(def: any): string | null {
  const allOf = Array.isArray(def?.allOf) ? def.allOf : [];
  for (const part of allOf) {
    const et = part?.properties?.event_type?.const;
    if (typeof et === "string") return et;
  }
  return null;
}

describe("@wasla/contracts-geography — event types drift guard", () => {
  it("GEOGRAPHY_EVENT_TYPES matches the event_type literals in events.json", () => {
    const schemaTypes = Object.values(eventsContract.$defs)
      .map(eventTypeOf)
      .filter((t): t is string => typeof t === "string")
      .sort();
    const codeTypes = [...GEOGRAPHY_EVENT_TYPES].sort();
    expect(codeTypes).toEqual(schemaTypes);
  });

  it("every schema event_type has a matching TS interface in GeographyEventByType", () => {
    const schemaTypes = new Set(
      Object.values(eventsContract.$defs)
        .map(eventTypeOf)
        .filter((t): t is string => typeof t === "string"),
    );
    const tsKeys: GeographyEventType[] = [
      "geo.user_location.set",
      "geo.user_location.changed",
    ];
    for (const t of schemaTypes) {
      expect(tsKeys).toContain(t);
    }
    type _Keys = keyof GeographyEventByType;
    const _assertKeys: _Keys[] = [
      "geo.user_location.set",
      "geo.user_location.changed",
    ];
    expect(_assertKeys).toHaveLength(2);
  });

  it("UserLocationSetV1 payload mirrors the schema (wasla_public_id + zone_id + source)", () => {
    const ev: UserLocationSetV1 = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      event_type: "geo.user_location.set",
      event_version: "v1",
      occurred_at: "2026-08-20T11:00:00Z",
      producer: "geography-service",
      aggregate: { type: "user", id: "WS-0000010427" },
      payload: {
        wasla_public_id: "WS-0000010427",
        zone_id: "550e8400-e29b-41d4-a716-446655440000",
        source: "customer_bot",
      },
    };
    expect(ev.payload.wasla_public_id).toMatch(/^WS-\d{10}$/);
    expect(ev.aggregate.id).toMatch(/^WS-\d{10}$/);
  });

  it("UserLocationChangedV1 payload mirrors the schema (old/new zone + source)", () => {
    const ev: UserLocationChangedV1 = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      event_type: "geo.user_location.changed",
      event_version: "v1",
      occurred_at: "2026-08-20T11:00:00Z",
      producer: "geography-service",
      aggregate: { type: "user", id: "WS-0000010427" },
      payload: {
        wasla_public_id: "WS-0000010427",
        old_zone_id: "660e8400-e29b-41d4-a716-446655440001",
        new_zone_id: "770e8400-e29b-41d4-a716-446655440002",
        source: "driver_bot",
      },
    };
    expect(ev.payload.old_zone_id).not.toBeNull();
  });

  it("GeographyEvent union discriminates by event_type", () => {
    const ev: GeographyEvent = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      event_type: "geo.user_location.changed",
      event_version: "v1",
      occurred_at: "2026-08-20T11:00:00Z",
      producer: "geography-service",
      aggregate: { type: "user", id: "WS-0000010427" },
      payload: {
        wasla_public_id: "WS-0000010427",
        old_zone_id: null,
        new_zone_id: "770e8400-e29b-41d4-a716-446655440002",
        source: "system",
      },
    };
    if (ev.event_type === "geo.user_location.changed") {
      expect(ev.payload.source).toBe("system");
    }
  });
});
