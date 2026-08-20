/**
 * Geography Domain Event types — hand-derived from the canonical Event Contract
 * (services/geography/contracts/events.json, JSON Schema 2020-12).
 *
 * Why hand-derived (not codegen): `json-schema-to-typescript` emits a generic
 * index signature for the $defs-only root schema, which is unusable. The event
 * set is small, stable, and versioned (v1; any breaking change requires v2 +
 * ADR), so hand-authoring is reliable and low-drift.
 *
 * Drift guard: `__tests__/events.test.ts` reads events.json and asserts the
 * event_type literals + payload structure stay in sync with these types.
 *
 * Canonical source = events.json. If the contract changes, update this file
 * to match and re-run the drift-guard test.
 */

/** Base envelope shared by all Geography domain events. */
export interface EventEnvelope {
  /** UUID. */
  event_id: string;
  /** Discriminator (e.g. "geo.user_location.set"). */
  event_type: string;
  /** Schema version, pattern ^v[0-9]+$. */
  event_version: string;
  /** ISO-8601 date-time. */
  occurred_at: string;
  /** Always "geography-service". */
  producer: "geography-service";
  /** The aggregate (user) the event concerns. */
  aggregate: {
    type: "user";
    /** wasla_public_id — opaque identity reference (pattern ^WS-[0-9]{10}$). */
    id: string;
  };
  /** Optional trace/correlation id. */
  trace_id?: string;
}

/** A user's location was set for the first time. */
export interface UserLocationSetV1 extends EventEnvelope {
  event_type: "geo.user_location.set";
  event_version: "v1";
  payload: {
    /** Pattern ^WS-[0-9]{10}$. */
    wasla_public_id: string;
    /** UUID — the zone. */
    zone_id: string;
    source: "customer_bot" | "driver_bot" | "partner_bot" | "admin" | "system";
  };
}

/** A user's location changed to a new zone — does NOT create a new identity. */
export interface UserLocationChangedV1 extends EventEnvelope {
  event_type: "geo.user_location.changed";
  event_version: "v1";
  payload: {
    /** Pattern ^WS-[0-9]{10}$. */
    wasla_public_id: string;
    /** Previous zone UUID — null on first set is not emitted (set event is). */
    old_zone_id: string | null;
    /** UUID — the new zone. */
    new_zone_id: string;
    source: "customer_bot" | "driver_bot" | "partner_bot" | "admin" | "system";
  };
}

/** Union of all v1 Geography domain events. */
export type GeographyEvent = UserLocationSetV1 | UserLocationChangedV1;

/** Discriminator union of all event_type literals. */
export type GeographyEventType = GeographyEvent["event_type"];

/** All v1 event_type literals, in declaration order. (Drift-guarded by tests.) */
export const GEOGRAPHY_EVENT_TYPES: readonly GeographyEventType[] = [
  "geo.user_location.set",
  "geo.user_location.changed",
] as const;

/** Map an event_type literal to its concrete event interface (type-level). */
export interface GeographyEventByType {
  "geo.user_location.set": UserLocationSetV1;
  "geo.user_location.changed": UserLocationChangedV1;
}
