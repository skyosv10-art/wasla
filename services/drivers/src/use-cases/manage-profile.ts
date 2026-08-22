/**
 * Profile writes: the patch, the served zones, the availability declaration, and
 * the administrative suspend/reinstate pair.
 *
 * Every one of them ends in `recomputeEligibility`. That is the rule the whole
 * service rests on: **no state change without a re-decision.** A change that leaves
 * the verdict untouched costs one pure function call; a change that silently
 * invalidates the verdict costs a passenger a driver who should not have been
 * offered the trip.
 */

import type { DeclaredAvailability, DriverProfile, ServiceZone } from "../domain/model.js";
import {
  driverNotFound,
  driverNotSuspended,
  driverSuspended,
  zoneUnknown,
} from "../domain/errors.js";
import {
  assertDisplayName,
  assertLocale,
  assertReasonCode,
  assertServiceKinds,
  assertZonePreferences,
} from "../domain/validation.js";
import { deriveVerificationStatus } from "../domain/documents.js";
import {
  driverAvailabilityDeclared,
  driverProfileUpdated,
  driverReinstated,
  driverServiceZonesChanged,
  driverSuspendedEvent,
} from "../domain/events.js";
import { requiredDocumentsFor, requireUsablePolicy } from "../domain/policy.js";
import type { DriverDependencies } from "../ports.js";
import { recomputeEligibility } from "./recompute-eligibility.js";

async function loadProfile(
  deps: DriverDependencies,
  waslaPublicId: string,
): Promise<DriverProfile> {
  const profile = await deps.profiles.find(waslaPublicId);
  if (profile === null) throw driverNotFound();
  return profile;
}

/**
 * Refuse driver-initiated writes while the profile is suspended (§7).
 *
 * The data would be accepted happily; the harm is what the driver concludes. A
 * suspended driver who can keep uploading papers believes he is working his way
 * back, and nothing he uploads can lift a suspension — only an operator can.
 */
function assertNotSuspended(profile: DriverProfile): void {
  if (profile.status === "suspended") throw driverSuspended();
}

export interface UpdateProfileInput {
  readonly displayName?: unknown;
  readonly preferredLocale?: unknown;
  readonly workCityZoneId?: string | null;
  readonly serviceKinds?: unknown;
  readonly traceId?: string | null;
}

export async function updateProfile(
  deps: DriverDependencies,
  waslaPublicId: string,
  input: UpdateProfileInput,
): Promise<DriverProfile> {
  const profile = await loadProfile(deps, waslaPublicId);
  assertNotSuspended(profile);

  const mutation: Parameters<DriverDependencies["profiles"]["update"]>[1] = {};
  if ("displayName" in input) Object.assign(mutation, { displayName: assertDisplayName(input.displayName) });
  if (input.preferredLocale !== undefined) {
    Object.assign(mutation, { preferredLocale: assertLocale(input.preferredLocale) });
  }
  if ("workCityZoneId" in input) {
    const zoneId = input.workCityZoneId ?? null;
    if (zoneId !== null) {
      const known = await deps.zoneCatalog.existing([zoneId]);
      if (!known.has(zoneId)) throw zoneUnknown("workCityZoneId");
    }
    Object.assign(mutation, { workCityZoneId: zoneId });
  }
  if (input.serviceKinds !== undefined) {
    const serviceKinds = assertServiceKinds(input.serviceKinds);
    Object.assign(mutation, { serviceKinds });
    // Changing the accepted service kinds changes WHICH documents are required, so
    // the derived verification status has to be recomputed in the same write. A
    // driver who adds `delivery` and stays `verified` under the ride requirements
    // would be verified against a question nobody asked him.
    const version = profile.eligibilityPolicyVersion;
    const policy = requireUsablePolicy(await deps.policies.find(version), version);
    const documents = await deps.documents.list(waslaPublicId);
    Object.assign(mutation, {
      verificationStatus: deriveVerificationStatus(documents, requiredDocumentsFor(policy, serviceKinds)),
    });
  }

  const now = deps.clock.now();
  const updated = await deps.profiles.update(waslaPublicId, mutation, now);
  await deps.outbox.append(
    driverProfileUpdated(updated, {
      eventId: deps.ids.uuid(),
      occurredAt: now,
      traceId: input.traceId ?? null,
    }),
  );
  await recomputeEligibility(deps, waslaPublicId, {
    trigger: "profile_changed",
    traceId: input.traceId ?? null,
  });
  return (await deps.profiles.find(waslaPublicId)) ?? updated;
}

export interface SetServiceZonesInput {
  readonly zones: readonly { zoneId: string; preferenceRank: number }[];
  readonly traceId?: string | null;
}

/**
 * Replace the served zones wholesale.
 *
 * A full replacement and not a merge: the request means "these are my zones", and a
 * merge turns a removal into a no-op the driver cannot see — he keeps receiving
 * orders from a district he told us he had left.
 *
 * Unknown zone ids are refused (422) rather than stored and ignored. This is where
 * the list is AUTHORED; accepting one bad id here is how it reaches every projection
 * downstream, where each consumer then invents its own way to tolerate it.
 */
export async function setServiceZones(
  deps: DriverDependencies,
  waslaPublicId: string,
  input: SetServiceZonesInput,
): Promise<ServiceZone[]> {
  const profile = await loadProfile(deps, waslaPublicId);
  assertNotSuspended(profile);
  assertZonePreferences(input.zones);

  const ids = input.zones.map((zone) => zone.zoneId);
  const known = await deps.zoneCatalog.existing(ids);
  if (ids.some((zoneId) => !known.has(zoneId))) throw zoneUnknown();

  const now = deps.clock.now();
  const zones = await deps.zones.replace(waslaPublicId, input.zones, now);
  await deps.outbox.append(
    driverServiceZonesChanged(waslaPublicId, zones.map((zone) => zone.zoneId), {
      eventId: deps.ids.uuid(),
      occurredAt: now,
      traceId: input.traceId ?? null,
    }),
  );
  await recomputeEligibility(deps, waslaPublicId, {
    trigger: "zones_changed",
    traceId: input.traceId ?? null,
  });
  return zones;
}

/**
 * The driver declares himself available or offline.
 *
 * Two values, never three: `busy` is dispatch's word about a live commitment, and a
 * driver who could declare himself busy would be able to hide from the fairness
 * accounting while still holding an assignment.
 *
 * Declaring availability does NOT change eligibility, and that is why the trigger
 * exists anyway: the projection matching stores carries both axes, so a driver going
 * offline has to reach matching even though his verdict is unchanged.
 */
export async function declareAvailability(
  deps: DriverDependencies,
  waslaPublicId: string,
  declared: DeclaredAvailability,
  traceId: string | null = null,
): Promise<DriverProfile> {
  const profile = await loadProfile(deps, waslaPublicId);
  assertNotSuspended(profile);

  const now = deps.clock.now();
  const updated = await deps.profiles.update(waslaPublicId, { declaredAvailability: declared }, now);
  await deps.outbox.append(
    driverAvailabilityDeclared(updated, { eventId: deps.ids.uuid(), occurredAt: now, traceId }),
  );
  await recomputeEligibility(deps, waslaPublicId, { trigger: "availability_declared", traceId });
  return (await deps.profiles.find(waslaPublicId)) ?? updated;
}

/**
 * Suspend a profile. An administrative act, with a code.
 *
 * `verification_status` is deliberately left alone: expressing a suspension by
 * resetting verification would destroy the record of a verified driver being
 * blocked, and the appeal a week later would have nothing to read.
 */
export async function suspendDriver(
  deps: DriverDependencies,
  waslaPublicId: string,
  reasonCode: unknown,
  traceId: string | null = null,
): Promise<DriverProfile> {
  const profile = await loadProfile(deps, waslaPublicId);
  if (profile.status === "suspended") throw driverSuspended();
  const code = assertReasonCode(reasonCode, "reasonCode");

  const now = deps.clock.now();
  const updated = await deps.profiles.update(
    waslaPublicId,
    { status: "suspended", suspensionReasonCode: code },
    now,
  );
  await deps.outbox.append(
    driverSuspendedEvent(updated, code, { eventId: deps.ids.uuid(), occurredAt: now, traceId }),
  );
  await recomputeEligibility(deps, waslaPublicId, { trigger: "suspended", traceId });
  return (await deps.profiles.find(waslaPublicId)) ?? updated;
}

/**
 * Lift a suspension.
 *
 * The driver returns to whatever his documents actually justify — which may well be
 * `ineligible`. Reinstatement is not a promise of eligibility, and pretending it is
 * would let a reinstated driver with an expired licence back on the road.
 */
export async function reinstateDriver(
  deps: DriverDependencies,
  waslaPublicId: string,
  traceId: string | null = null,
): Promise<DriverProfile> {
  const profile = await loadProfile(deps, waslaPublicId);
  if (profile.status !== "suspended") throw driverNotSuspended();

  const now = deps.clock.now();
  const updated = await deps.profiles.update(
    waslaPublicId,
    { status: "active", suspensionReasonCode: null },
    now,
  );
  await deps.outbox.append(
    driverReinstated(updated, { eventId: deps.ids.uuid(), occurredAt: now, traceId }),
  );
  await recomputeEligibility(deps, waslaPublicId, { trigger: "reinstated", traceId });
  return (await deps.profiles.find(waslaPublicId)) ?? updated;
}
