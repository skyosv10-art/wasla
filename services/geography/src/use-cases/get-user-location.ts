/**
 * getUserLocation use case — returns the user's current location with the
 * zone name resolved for the requested locale (falling back to `ar`).
 */

import type { UserLocation } from "@wasla/contracts-geography";

import { GeographyError } from "../domain/errors.js";
import { toUserLocationDto } from "./mappers.js";
import type { UseCaseDeps, UseCaseLocale } from "./deps.js";

const WASLA_PUBLIC_ID_PATTERN = /^WS-[0-9]{10}$/;

export interface GetUserLocationInput {
  readonly waslaPublicId: string;
  readonly locale?: UseCaseLocale;
}

export async function getUserLocation(
  deps: UseCaseDeps,
  input: GetUserLocationInput,
): Promise<UserLocation> {
  const locale = input.locale ?? "ar";

  if (!WASLA_PUBLIC_ID_PATTERN.test(input.waslaPublicId)) {
    throw new GeographyError(
      "GEO_INVALID_PUBLIC_ID",
      `wasla_public_id '${input.waslaPublicId}' does not match ^WS-[0-9]{10}$`,
    );
  }

  const assignment = await deps.repo.findUserLocation(input.waslaPublicId);
  if (!assignment) {
    throw new GeographyError(
      "GEO_USER_LOCATION_NOT_FOUND",
      `no location set for wasla_public_id ${input.waslaPublicId}`,
    );
  }

  const zone = await deps.repo.findZone(assignment.zoneId);
  if (!zone) {
    // Data-integrity issue: the stored zone no longer exists.
    throw new GeographyError(
      "GEO_ZONE_NOT_FOUND",
      `zone ${assignment.zoneId} referenced by location no longer exists`,
    );
  }

  return toUserLocationDto(assignment, zone, locale);
}
