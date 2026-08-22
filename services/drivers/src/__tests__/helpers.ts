/**
 * Test fixtures.
 *
 * They build drivers through the REAL use cases rather than by writing rows into the
 * stores, so a fixture that stops being reachable through the public surface stops
 * compiling. A hand-built row can describe a state the service can never produce, and
 * a truth table proved over impossible states proves nothing.
 */

import {
  createInMemoryEnvironment,
  type InMemoryDriverEnvironment,
} from "../infrastructure/in-memory.js";
import { registerDriver } from "../use-cases/register-driver.js";
import { registerVehicle } from "../use-cases/manage-vehicles.js";
import { reviewDocument, submitDocument } from "../use-cases/manage-documents.js";
import { setServiceZones } from "../use-cases/manage-profile.js";
import type { DocumentType, DriverDocument, ServiceKind } from "../domain/model.js";

export const DRIVER = "WS-1000000001";
export const ZONE_A = "11111111-1111-4111-8111-111111111111";
export const ZONE_B = "22222222-2222-4222-8222-222222222222";
export const NOW = "2026-01-01T00:00:00.000Z";

let keyCounter = 0;
/** A distinct idempotency key per call: reuse would be testing the wrong rule. */
export function nextKey(prefix = "k"): string {
  keyCounter += 1;
  return `${prefix}-${keyCounter.toString().padStart(6, "0")}`;
}

export function environment(now = NOW): InMemoryDriverEnvironment {
  const env = createInMemoryEnvironment(now);
  env.zoneCatalog.seed(ZONE_A, ZONE_B);
  return env;
}

export interface DriverFixtureOptions {
  readonly serviceKinds?: readonly ServiceKind[];
  readonly withZone?: boolean;
  readonly withVehicle?: boolean;
}

/** A registered driver, optionally with one served zone and one primary vehicle. */
export async function seedDriver(
  env: InMemoryDriverEnvironment,
  options: DriverFixtureOptions = {},
): Promise<string> {
  await registerDriver(env, {
    waslaPublicId: DRIVER,
    displayName: "سائق تجربة",
    serviceKinds: options.serviceKinds ?? ["ride"],
  });
  if (options.withZone !== false) {
    await setServiceZones(env, DRIVER, { zones: [{ zoneId: ZONE_A, preferenceRank: 1 }] });
  }
  if (options.withVehicle !== false) {
    const vehicle = await registerVehicle(env, DRIVER, {
      vehicleClass: "sedan",
      idempotencyKey: nextKey("veh"),
      plateNumber: "ABC-1234",
    });
    return vehicle.id;
  }
  return "";
}

/** Submit a document and immediately verify it, the way a reviewer would. */
export async function verifiedDocument(
  env: InMemoryDriverEnvironment,
  documentType: DocumentType,
  options: { vehicleId?: string | null; expiresAt?: string | null } = {},
): Promise<DriverDocument> {
  const submitted = await submitDocument(env, DRIVER, {
    documentType,
    storageRef: `s3://wasla-docs/${documentType}.pdf`,
    idempotencyKey: nextKey("doc"),
    vehicleId: options.vehicleId ?? null,
    expiresAt: options.expiresAt ?? null,
  });
  return reviewDocument(env, DRIVER, submitted.id, {
    status: "verified",
    reviewedBy: "ops-1",
    ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt ?? null }),
  });
}

/**
 * A driver who satisfies EVERY condition — the baseline the truth table breaks one
 * condition at a time from. Built once, so a test that removes a zone is testing the
 * zone rule and nothing else.
 */
export async function eligibleDriver(
  env: InMemoryDriverEnvironment,
): Promise<{ vehicleId: string }> {
  const vehicleId = await seedDriver(env);
  await verifiedDocument(env, "national_id");
  await verifiedDocument(env, "driving_license", { expiresAt: "2027-01-01" });
  await verifiedDocument(env, "vehicle_registration", { vehicleId, expiresAt: "2027-06-01" });
  return { vehicleId };
}
