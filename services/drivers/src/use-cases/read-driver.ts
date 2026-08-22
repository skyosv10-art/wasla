/**
 * The read side of the driver profile (Phase 05 · MR 4/6).
 *
 * ## Why these are use cases and not four calls to a repository from the routes
 *
 * Every one of them answers `404` for a driver that does not exist, and that is a
 * DOMAIN rule with a published justification (`contracts/errors.md`: «لماذا `404` لا
 * `403`»). The subresource repositories cannot express it — `zones.list`,
 * `vehicles.list` and `documents.list` all return `[]` for an unknown driver, because
 * "no rows" is the honest answer to a query. Putting the existence check in the route
 * would spread one rule across four handlers and make the transport the place where
 * "does this driver exist?" is decided; the fifth handler written next year would
 * quietly answer `200 {"vehicles": []}` for a typo in an id, and the operator reading
 * it would conclude the driver owns no car.
 *
 * ## Why they read and do not recompute
 *
 * Unlike `readEligibility` — which recomputes deliberately, and therefore needs a
 * write-capable runner — these four only read. They open no transaction, log nothing,
 * and publish nothing, so `runner.read` is enough and a reader can never be the reason
 * an eligibility log row appeared.
 */

import { driverNotFound } from "../domain/errors.js";
import type { DriverDocument, DriverProfile, ServiceZone, Vehicle } from "../domain/model.js";
import type { DriverDependencies } from "../ports.js";

/** The profile, or `DRIVER_NOT_FOUND` — the existence check the others reuse. */
export async function readDriverProfile(
  deps: DriverDependencies,
  waslaPublicId: string,
): Promise<DriverProfile> {
  const profile = await deps.profiles.find(waslaPublicId);
  if (profile === null) throw driverNotFound();
  return profile;
}

export async function listDriverZones(
  deps: DriverDependencies,
  waslaPublicId: string,
): Promise<ServiceZone[]> {
  await readDriverProfile(deps, waslaPublicId);
  return deps.zones.list(waslaPublicId);
}

export async function listDriverVehicles(
  deps: DriverDependencies,
  waslaPublicId: string,
): Promise<Vehicle[]> {
  await readDriverProfile(deps, waslaPublicId);
  return deps.vehicles.list(waslaPublicId);
}

/**
 * All documents, INCLUDING superseded ones.
 *
 * The contract says so («بما فيها المستبدلة حتى يبقى التدقيق قابلاً للقراءة») and the
 * reason is the audit: a rejected licence that was replaced is the whole explanation of
 * why the driver was ineligible last week, and a list that hides it makes the log
 * unreadable to the only person who ever needs it.
 */
export async function listDriverDocuments(
  deps: DriverDependencies,
  waslaPublicId: string,
): Promise<DriverDocument[]> {
  await readDriverProfile(deps, waslaPublicId);
  return deps.documents.list(waslaPublicId);
}
