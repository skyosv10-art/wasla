/**
 * Profile use cases: read and upsert the customer role profile.
 *
 * A profile is a role, not an identity (ADR-009 §2): creating one never creates
 * a user, so the identity must already exist and is verified through a port
 * rather than a foreign key. The same person can hold a customer, driver and
 * partner profile at once (§7).
 */

import { CustomerError } from "../domain/errors.js";
import {
  customerProfileCreated,
  customerProfileUpdated,
} from "../domain/events.js";
import type {
  CustomerProfile,
  CustomerProfileField,
  CustomerProfilePatch,
} from "../domain/model.js";
import {
  assertWaslaPublicId,
  normalizeProfilePatch,
} from "../domain/validation.js";
import { eventContext, type UseCaseDeps } from "./deps.js";
import { requireActiveZone } from "./zones.js";

/** Read a profile. Absence is a 404, not an empty profile. */
export async function getCustomerProfile(
  deps: UseCaseDeps,
  input: { waslaPublicId: string },
): Promise<CustomerProfile> {
  const waslaPublicId = assertWaslaPublicId(input.waslaPublicId);
  const profile = await deps.repo.findProfile(waslaPublicId);
  if (!profile) {
    throw new CustomerError(
      "CUSTOMER_PROFILE_NOT_FOUND",
      "لا يوجد ملف عميل لهذا المعرّف",
    );
  }
  return profile;
}

export interface UpsertCustomerProfileInput {
  readonly waslaPublicId: string;
  readonly patch: CustomerProfilePatch;
}

export interface UpsertCustomerProfileResult {
  readonly profile: CustomerProfile;
  /** True when this call created the profile rather than updating one. */
  readonly created: boolean;
  /** Fields actually changed by an update (empty for a no-op update). */
  readonly changedFields: readonly CustomerProfileField[];
}

/**
 * Create or update a profile.
 *
 * Absent patch keys mean "leave as is", which is why the patch is inspected by
 * key presence rather than by value: sending `display_name: null` clears the
 * name, sending nothing keeps it.
 */
export async function upsertCustomerProfile(
  deps: UseCaseDeps,
  input: UpsertCustomerProfileInput,
): Promise<UpsertCustomerProfileResult> {
  const waslaPublicId = assertWaslaPublicId(input.waslaPublicId);
  const patch = normalizeProfilePatch(input.patch);

  if (!(await deps.identityLookup.identityExists(waslaPublicId))) {
    throw new CustomerError(
      "CUSTOMER_IDENTITY_NOT_FOUND",
      "الهوية المُشار إليها غير موجودة",
    );
  }

  // A default zone is a real reference the bot will reuse, so it is validated
  // like any other zone instead of being stored unchecked.
  if (patch.defaultZoneId !== undefined && patch.defaultZoneId !== null) {
    await requireActiveZone(deps.geography, patch.defaultZoneId);
  }

  const now = deps.clock.now();
  const existing = await deps.repo.findProfile(waslaPublicId);

  if (!existing) {
    const profile: CustomerProfile = {
      waslaPublicId,
      displayName: patch.displayName ?? null,
      preferredLocale: patch.preferredLocale ?? "ar",
      defaultZoneId: patch.defaultZoneId ?? null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    const saved = await deps.repo.saveProfile(profile);
    await deps.outbox.append(customerProfileCreated(saved, eventContext(deps)));
    return { profile: saved, created: true, changedFields: [] };
  }

  const changedFields: CustomerProfileField[] = [];
  if (patch.displayName !== undefined && patch.displayName !== existing.displayName) {
    changedFields.push("display_name");
  }
  if (
    patch.preferredLocale !== undefined &&
    patch.preferredLocale !== existing.preferredLocale
  ) {
    changedFields.push("preferred_locale");
  }
  if (
    patch.defaultZoneId !== undefined &&
    patch.defaultZoneId !== existing.defaultZoneId
  ) {
    changedFields.push("default_zone_id");
  }

  // A request that changes nothing is not an error and not an event: publishing
  // `profile.updated` with an empty change list would tell consumers a lie and
  // break the contract's non-empty `changed_fields`.
  if (changedFields.length === 0) {
    return { profile: existing, created: false, changedFields: [] };
  }

  const updated: CustomerProfile = {
    ...existing,
    displayName:
      patch.displayName !== undefined ? patch.displayName : existing.displayName,
    preferredLocale: patch.preferredLocale ?? existing.preferredLocale,
    defaultZoneId:
      patch.defaultZoneId !== undefined
        ? patch.defaultZoneId
        : existing.defaultZoneId,
    updatedAt: now,
  };
  const saved = await deps.repo.saveProfile(updated);
  await deps.outbox.append(
    customerProfileUpdated(saved, changedFields, eventContext(deps)),
  );
  return { profile: saved, created: false, changedFields };
}
