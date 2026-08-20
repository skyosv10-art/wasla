/**
 * getUserLocationHistory use case — returns the chronologically ordered list of
 * a user's location changes, with zone names resolved for the requested locale
 * (falling back to `ar`). old_zone is null on the first assignment.
 */

import type { UserLocationHistoryEntry } from "@wasla/contracts-geography";

import { GeographyError } from "../domain/errors.js";
import { toHistoryEntryDto } from "./mappers.js";
import type { UseCaseDeps, UseCaseLocale } from "./deps.js";

const WASLA_PUBLIC_ID_PATTERN = /^WS-[0-9]{10}$/;

export interface GetUserLocationHistoryInput {
  readonly waslaPublicId: string;
  readonly locale?: UseCaseLocale;
}

export async function getUserLocationHistory(
  deps: UseCaseDeps,
  input: GetUserLocationHistoryInput,
): Promise<UserLocationHistoryEntry[]> {
  const locale = input.locale ?? "ar";

  if (!WASLA_PUBLIC_ID_PATTERN.test(input.waslaPublicId)) {
    throw new GeographyError(
      "GEO_INVALID_PUBLIC_ID",
      `wasla_public_id '${input.waslaPublicId}' does not match ^WS-[0-9]{10}$`,
    );
  }

  const entries = await deps.repo.listUserLocationHistory(input.waslaPublicId);

  const result: UserLocationHistoryEntry[] = [];
  for (const entry of entries) {
    const oldZone = entry.oldZoneId
      ? await deps.repo.findZone(entry.oldZoneId)
      : null;
    const newZone = await deps.repo.findZone(entry.newZoneId);
    if (!newZone) {
      throw new GeographyError(
        "GEO_ZONE_NOT_FOUND",
        `zone ${entry.newZoneId} referenced by history no longer exists`,
      );
    }
    result.push(toHistoryEntryDto(entry, oldZone, newZone, locale));
  }
  return result;
}
