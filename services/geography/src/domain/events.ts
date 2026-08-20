/**
 * Domain event factories.
 *
 * Produce typed Geography domain events (GeographyEvent from
 * @wasla/contracts-geography) that match the canonical Event Contract
 * (services/geography/contracts/events.json). Events are written to the Outbox
 * port (not published directly) so a relay can forward them to Kafka later
 * without redesigning the domain.
 */

import type {
  UserLocationSetV1,
  UserLocationChangedV1,
} from "@wasla/contracts-geography";

import type { Clock, IdGenerator } from "../ports.js";
import type { LocationSource } from "./model.js";

/** Source of a location set/change (events.json payload.source enum). */
export type LocationChangeSource = LocationSource;

function envelope(input: {
  idGen: IdGenerator;
  clock: Clock;
  aggregateId: string;
  traceId?: string;
}) {
  return {
    event_id: input.idGen.uuid(),
    occurred_at: input.clock.now(),
    producer: "geography-service" as const,
    aggregate: { type: "user" as const, id: input.aggregateId },
    ...(input.traceId ? { trace_id: input.traceId } : {}),
  };
}

/** A user's location was set for the first time. */
export function userLocationSet(input: {
  idGen: IdGenerator;
  clock: Clock;
  aggregateId: string;
  waslaPublicId: string;
  zoneId: string;
  source: LocationChangeSource;
  traceId?: string;
}): UserLocationSetV1 {
  return {
    ...envelope(input),
    event_type: "geo.user_location.set",
    event_version: "v1",
    payload: {
      wasla_public_id: input.waslaPublicId,
      zone_id: input.zoneId,
      source: input.source,
    },
  };
}

/** A user's location changed to a new zone — does NOT create a new identity. */
export function userLocationChanged(input: {
  idGen: IdGenerator;
  clock: Clock;
  aggregateId: string;
  waslaPublicId: string;
  oldZoneId: string | null;
  newZoneId: string;
  source: LocationChangeSource;
  traceId?: string;
}): UserLocationChangedV1 {
  return {
    ...envelope(input),
    event_type: "geo.user_location.changed",
    event_version: "v1",
    payload: {
      wasla_public_id: input.waslaPublicId,
      old_zone_id: input.oldZoneId,
      new_zone_id: input.newZoneId,
      source: input.source,
    },
  };
}
