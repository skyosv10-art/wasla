/**
 * Register a driver profile.
 *
 * A ROLE profile for an existing WASLA user, not a new person (ADR-009 §1): there
 * is no name, no phone and no password here, and `waslaPublicId` arrives already
 * minted by identity. Creating a person in this service would give the platform two
 * places that believe they own who somebody is.
 *
 * A fresh profile is `offline` and `unverified` — fail-closed. A driver who becomes
 * available the instant he registers would be offered a passenger before anyone
 * looked at his licence.
 */

import type { DriverProfile, Locale, ServiceKind } from "../domain/model.js";
import { driverAlreadyExists, zoneUnknown } from "../domain/errors.js";
import {
  assertDisplayName,
  assertLocale,
  assertServiceKinds,
  assertWaslaPublicId,
} from "../domain/validation.js";
import { driverRegistered } from "../domain/events.js";
import { LAUNCH_POLICY_VERSION } from "../domain/policy.js";
import type { DriverDependencies } from "../ports.js";
import { recomputeEligibility } from "./recompute-eligibility.js";

export interface RegisterDriverInput {
  readonly waslaPublicId: unknown;
  readonly displayName?: unknown;
  readonly preferredLocale?: unknown;
  readonly workCityZoneId?: string | null;
  readonly serviceKinds?: unknown;
  readonly traceId?: string | null;
}

export async function registerDriver(
  deps: DriverDependencies,
  input: RegisterDriverInput,
): Promise<DriverProfile> {
  const waslaPublicId = assertWaslaPublicId(input.waslaPublicId);
  const displayName = assertDisplayName(input.displayName ?? null);
  const preferredLocale: Locale = assertLocale(input.preferredLocale ?? "ar");
  const serviceKinds: readonly ServiceKind[] = assertServiceKinds(input.serviceKinds ?? []);

  const existing = await deps.profiles.find(waslaPublicId);
  // A conflict and not an idempotent success: re-registering is a caller bug, and
  // answering "created" would let it overwrite a file that already has documents.
  if (existing !== null) throw driverAlreadyExists();

  const workCityZoneId = input.workCityZoneId ?? null;
  if (workCityZoneId !== null) {
    const known = await deps.zoneCatalog.existing([workCityZoneId]);
    if (!known.has(workCityZoneId)) throw zoneUnknown("workCityZoneId");
  }

  const now = deps.clock.now();
  const profile = await deps.profiles.create({
    waslaPublicId,
    displayName,
    preferredLocale,
    workCityZoneId,
    serviceKinds,
    // Pinned to the policy version in force at registration. Yesterday's driver
    // keeps yesterday's rules until a migration moves him, deliberately.
    eligibilityPolicyVersion: LAUNCH_POLICY_VERSION,
    createdAt: now,
  });

  await deps.outbox.append(
    driverRegistered(profile, {
      eventId: deps.ids.uuid(),
      occurredAt: now,
      traceId: input.traceId ?? null,
    }),
  );

  // The first evaluation runs here, so the very first `driver_eligibility_log` row
  // exists from minute one. Without it, the first real recompute would report
  // `from_state: null` weeks later and nobody could tell whether the driver had
  // been ineligible all along or had just become so.
  await recomputeEligibility(deps, waslaPublicId, {
    trigger: "profile_changed",
    traceId: input.traceId ?? null,
  });

  const created = await deps.profiles.find(waslaPublicId);
  return created ?? profile;
}
