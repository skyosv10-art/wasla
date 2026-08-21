/**
 * Zone resolution shared by the place and order-request use cases.
 *
 * Every zone a customer references is checked for existence and activity before
 * anything is written. The two failures have separate codes because they mean
 * different things to the customer: a wrong zone is a mistake to correct, an
 * inactive zone is a place the system does not serve yet.
 */

import { CustomerError } from "../domain/errors.js";
import type { ZoneReference } from "../domain/model.js";
import type { GeographyPort } from "../ports.js";

/** Resolve one zone, or fail with the documented code. */
export async function requireActiveZone(
  geography: GeographyPort,
  zoneId: string,
): Promise<ZoneReference> {
  const zone = await geography.findZone(zoneId);
  if (!zone) {
    throw new CustomerError(
      "CUSTOMER_ZONE_NOT_FOUND",
      "المنطقة الفرعية غير موجودة",
    );
  }
  if (zone.status !== "active") {
    throw new CustomerError("CUSTOMER_ZONE_INACTIVE", "المنطقة الفرعية غير نشطة");
  }
  return zone;
}

/**
 * Resolve several zones, preserving input order.
 *
 * Sequential on purpose: the first invalid zone is the one the customer should
 * hear about, and a parallel fan-out would make which error surfaces depend on
 * network timing.
 */
export async function requireActiveZones(
  geography: GeographyPort,
  zoneIds: readonly string[],
): Promise<ZoneReference[]> {
  const resolved: ZoneReference[] = [];
  for (const zoneId of zoneIds) {
    resolved.push(await requireActiveZone(geography, zoneId));
  }
  return resolved;
}
