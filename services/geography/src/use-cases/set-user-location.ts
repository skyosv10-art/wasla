/**
 * setUserLocation use case — the core of the Phase 02 Exit Gate:
 * "a user changes their location without creating a new account".
 *
 * Flow (per ADR-006 + errors.md failure paths):
 *  1. Validate wasla_public_id format (^WS-[0-9]{10}$) → GEO_INVALID_PUBLIC_ID.
 *  2. Validate the identity exists via IdentityLookupPort → GEO_IDENTITY_NOT_FOUND.
 *  3. Validate the zone exists → GEO_ZONE_NOT_FOUND; and is active →
 *     GEO_LOCATION_INACTIVE.
 *  4. If the user already has a location set to the same zone → idempotent:
 *     return the current assignment, no history, no event, no version bump.
 *  5. Otherwise upsert the location, record a history entry (old_zone_id is
 *     null on first set), and emit:
 *     - geo.user_location.set.v1       on first assignment, or
 *     - geo.user_location.changed.v1   on a change to a new zone.
 *
 * The identity itself is never modified — Geography only stores wasla_public_id
 * as an opaque reference, so identity stability is guaranteed by construction.
 */

import type { SetUserLocationRequest, UserLocation } from "@wasla/contracts-geography";

import { GeographyError } from "../domain/errors.js";
import { resolveLocalizedName } from "../domain/locale.js";
import {
  userLocationSet,
  userLocationChanged,
} from "../domain/events.js";
import { toZoneDto } from "./mappers.js";
import type { UseCaseDeps, UseCaseLocale } from "./deps.js";

/** Wasla Public ID pattern (schema.sql CHECK constraint). */
const WASLA_PUBLIC_ID_PATTERN = /^WS-[0-9]{10}$/;

export interface SetUserLocationInput {
  readonly waslaPublicId: string;
  readonly zoneId: string;
  readonly source: SetUserLocationRequest["source"];
  readonly locale?: UseCaseLocale;
}

export interface SetUserLocationResult {
  /** The API DTO for the resulting location. */
  readonly location: UserLocation;
  /** True if this was the first location assignment (HTTP 201), false if a change (200). */
  readonly created: boolean;
}

export async function setUserLocation(
  deps: UseCaseDeps,
  input: SetUserLocationInput,
): Promise<SetUserLocationResult> {
  const { repo, outbox, clock, idGen, identityLookup, traceId } = deps;
  const locale = input.locale ?? "ar";

  // 1. Validate wasla_public_id format.
  if (!WASLA_PUBLIC_ID_PATTERN.test(input.waslaPublicId)) {
    throw new GeographyError(
      "GEO_INVALID_PUBLIC_ID",
      `wasla_public_id '${input.waslaPublicId}' does not match ^WS-[0-9]{10}$`,
    );
  }

  // 2. Validate the identity exists (cross-service, opaque reference).
  const exists = await identityLookup.identityExists(input.waslaPublicId);
  if (!exists) {
    throw new GeographyError(
      "GEO_IDENTITY_NOT_FOUND",
      `no identity with wasla_public_id ${input.waslaPublicId}`,
    );
  }

  // 3. Validate the zone exists and is active.
  const zone = await repo.findZone(input.zoneId);
  if (!zone) {
    throw new GeographyError(
      "GEO_ZONE_NOT_FOUND",
      `no zone with id ${input.zoneId}`,
    );
  }
  if (zone.status !== "active") {
    throw new GeographyError(
      "GEO_LOCATION_INACTIVE",
      `zone ${input.zoneId} is not active`,
    );
  }

  // 4. Idempotent: same zone → no-op (no history, no event, no version bump).
  const current = await repo.findUserLocation(input.waslaPublicId);
  if (current && current.zoneId === input.zoneId) {
    return {
      location: {
        wasla_public_id: current.waslaPublicId,
        zone: toZoneDto(zone, locale),
        source: current.source,
        effective_at: current.effectiveAt,
        version: current.version,
      },
      created: false,
    };
  }

  // 5. Upsert location, record history, emit event.
  const now = clock.now();
  const oldZoneId = current?.zoneId ?? null;
  const assignment = await repo.setUserLocation({
    waslaPublicId: input.waslaPublicId,
    zoneId: input.zoneId,
    source: input.source,
    effectiveAt: now,
  });

  await repo.recordUserLocationHistory({
    waslaPublicId: input.waslaPublicId,
    oldZoneId,
    newZoneId: input.zoneId,
    changedAt: now,
    source: input.source,
  });

  const created = oldZoneId === null;
  if (created) {
    await outbox.append(
      userLocationSet({
        idGen,
        clock,
        aggregateId: input.waslaPublicId,
        waslaPublicId: input.waslaPublicId,
        zoneId: input.zoneId,
        source: input.source,
        traceId,
      }),
    );
  } else {
    await outbox.append(
      userLocationChanged({
        idGen,
        clock,
        aggregateId: input.waslaPublicId,
        waslaPublicId: input.waslaPublicId,
        oldZoneId,
        newZoneId: input.zoneId,
        source: input.source,
        traceId,
      }),
    );
  }

  return {
    location: {
      wasla_public_id: assignment.waslaPublicId,
      zone: toZoneDto(zone, locale),
      source: assignment.source,
      effective_at: assignment.effectiveAt,
      version: assignment.version,
    },
    created,
  };
}

// resolveLocalizedName is re-exported here so callers mapping raw names outside
// the use-case layer can reach it through the service barrel.
export { resolveLocalizedName };
