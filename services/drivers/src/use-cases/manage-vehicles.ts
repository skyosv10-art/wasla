/**
 * Vehicle writes: register, promote to primary, retire.
 *
 * The primary vehicle is the one eligibility is decided against, so every change
 * here can flip a verdict, and every one of them therefore ends in a recomputation.
 *
 * The registration is idempotent by key, because a mobile client on a bad connection
 * retries. Without the key, one tap on a train produces two cars and the driver has
 * to explain to support which one is real.
 */

import type { Vehicle } from "../domain/model.js";
import {
  driverNotFound,
  driverSuspended,
  idempotencyKeyReused,
  validationFailed,
  vehicleNotFound,
} from "../domain/errors.js";
import { assertIdempotencyKey, assertVehicleClass } from "../domain/validation.js";
import { promoteToPrimary, retire } from "../domain/vehicles.js";
import { driverVehicleRegistered, driverVehicleStatusChanged } from "../domain/events.js";
import type { DriverDependencies } from "../ports.js";
import { recomputeEligibility } from "./recompute-eligibility.js";

export interface RegisterVehicleInput {
  readonly vehicleClass: unknown;
  readonly idempotencyKey: unknown;
  readonly make?: string | null;
  readonly model?: string | null;
  readonly modelYear?: number | null;
  readonly color?: string | null;
  readonly plateNumber?: string | null;
  readonly isPrimary?: boolean;
  readonly traceId?: string | null;
}

/**
 * A fingerprint of the fields that DEFINE the vehicle.
 *
 * The plate is deliberately not hashed into it in cleartext form — it is the field
 * that identifies a car in the street — but it does participate, because two
 * registrations that differ only by plate are two different cars and must not share
 * a key. Length-and-class only would let a genuine second sedan look like a retry.
 */
function fingerprintVehicle(input: RegisterVehicleInput): string {
  return JSON.stringify([
    input.vehicleClass,
    input.make ?? null,
    input.model ?? null,
    input.modelYear ?? null,
    input.color ?? null,
    (input.plateNumber ?? "").length,
    input.plateNumber === null || input.plateNumber === undefined
      ? null
      : hashPlate(input.plateNumber),
    input.isPrimary ?? false,
  ]);
}

/**
 * A non-reversible digest of the plate, so the fingerprint can distinguish two cars
 * without storing a readable plate in an idempotency record that is not classified
 * as sensitive data. Not a cryptographic guarantee and does not need to be: the
 * question it answers is only "same string or different string?".
 */
function hashPlate(plate: string): number {
  let hash = 0;
  for (let index = 0; index < plate.length; index += 1) {
    hash = (hash * 31 + plate.charCodeAt(index)) | 0;
  }
  return hash;
}

export async function registerVehicle(
  deps: DriverDependencies,
  waslaPublicId: string,
  input: RegisterVehicleInput,
): Promise<Vehicle> {
  const profile = await deps.profiles.find(waslaPublicId);
  if (profile === null) throw driverNotFound();
  if (profile.status === "suspended") throw driverSuspended();

  const vehicleClass = assertVehicleClass(input.vehicleClass);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  if (input.modelYear !== null && input.modelYear !== undefined) {
    if (!Number.isInteger(input.modelYear) || input.modelYear < 1970 || input.modelYear > 2100) {
      throw validationFailed("modelYear", "سنة صنع بين 1970 و2100");
    }
  }

  const fingerprint = fingerprintVehicle(input);
  const memoryKey = `vehicle:${waslaPublicId}:${idempotencyKey}`;
  const remembered = await deps.idempotency.find(memoryKey);
  const existing = await deps.vehicles.findByIdempotencyKey(waslaPublicId, idempotencyKey);
  if (existing !== null) {
    // Same key, same payload → the retry succeeds and returns the same row.
    // Same key, different payload → 409, because silently overwriting is how one
    // driver's registration lands on another driver's car.
    if (remembered !== null && remembered !== fingerprint) throw idempotencyKeyReused();
    return existing;
  }

  const now = deps.clock.now();
  const fleet = await deps.vehicles.list(waslaPublicId);
  const activeFleet = fleet.filter((vehicle) => vehicle.status === "active");
  // The first active vehicle becomes primary whether or not the caller asked: a
  // driver with exactly one car and no primary flag is ineligible for a reason he
  // cannot see or fix from any screen we offer him.
  const isPrimary = input.isPrimary === true || activeFleet.length === 0;

  const demoted = isPrimary
    ? fleet.filter((vehicle) => vehicle.isPrimary).map((vehicle) => ({ ...vehicle, isPrimary: false, updatedAt: now }))
    : [];
  if (demoted.length > 0) await deps.vehicles.saveAll(demoted);

  const vehicle = await deps.vehicles.create({
    id: deps.ids.uuid(),
    waslaPublicId,
    vehicleClass,
    make: input.make ?? null,
    model: input.model ?? null,
    modelYear: input.modelYear ?? null,
    color: input.color ?? null,
    plateNumber: input.plateNumber ?? null,
    isPrimary,
    idempotencyKey,
    createdAt: now,
  });

  await deps.idempotency.remember(memoryKey, fingerprint);
  await deps.outbox.append(
    driverVehicleRegistered(vehicle, {
      eventId: deps.ids.uuid(),
      occurredAt: now,
      traceId: input.traceId ?? null,
    }),
  );
  await recomputeEligibility(deps, waslaPublicId, {
    trigger: "vehicle_changed",
    traceId: input.traceId ?? null,
  });
  return vehicle;
}

export interface PatchVehicleInput {
  readonly isPrimary?: boolean;
  readonly status?: "retired";
  readonly traceId?: string | null;
}

/**
 * Promote a vehicle to primary, or retire it.
 *
 * Both are expressed as one patch because they are mutually exclusive in practice
 * and because the retirement of a primary MUST clear the primary flag in the same
 * step (`ck_driver_vehicles_retired_not_primary`). Splitting them into two endpoints
 * invites the sequence "retire, then forget to reassign", which leaves a driver
 * ineligible with a garage full of cars.
 *
 * Only `retired` is accepted as a target status: reactivation is not a patch, it is a
 * new registration, because a car that has been out of service needs its papers
 * looked at again rather than silently revived.
 */
export async function patchVehicle(
  deps: DriverDependencies,
  waslaPublicId: string,
  vehicleId: string,
  input: PatchVehicleInput,
): Promise<Vehicle> {
  const profile = await deps.profiles.find(waslaPublicId);
  if (profile === null) throw driverNotFound();
  if (profile.status === "suspended") throw driverSuspended();

  const vehicle = await deps.vehicles.find(waslaPublicId, vehicleId);
  if (vehicle === null) throw vehicleNotFound();
  if (input.status !== undefined && input.status !== "retired") {
    throw validationFailed("status", "retired");
  }

  const now = deps.clock.now();
  const fleet = await deps.vehicles.list(waslaPublicId);
  let saved: Vehicle;

  if (input.status === "retired") {
    const [row] = await deps.vehicles.saveAll([retire(vehicle, now)]);
    saved = row ?? retire(vehicle, now);
    await deps.outbox.append(
      driverVehicleStatusChanged(saved, {
        eventId: deps.ids.uuid(),
        occurredAt: now,
        traceId: input.traceId ?? null,
      }),
    );
  } else if (input.isPrimary === true) {
    const reassignment = promoteToPrimary(vehicle, fleet, now);
    // Demotions first: the unique index tolerates zero primaries for an instant, and
    // never two. Writing the promotion first would fail on the real database and
    // pass in memory, which is exactly the class of difference this port exists to
    // prevent.
    if (reassignment.demoted.length > 0) await deps.vehicles.saveAll(reassignment.demoted);
    const [row] = await deps.vehicles.saveAll([reassignment.promoted]);
    saved = row ?? reassignment.promoted;
    await deps.outbox.append(
      driverVehicleStatusChanged(saved, {
        eventId: deps.ids.uuid(),
        occurredAt: now,
        traceId: input.traceId ?? null,
      }),
    );
  } else {
    // Nothing asked, nothing changed, and NO recomputation: an empty patch must not
    // produce a log row, or the audit trail fills with entries that mean "somebody
    // sent an empty body".
    return vehicle;
  }

  await recomputeEligibility(deps, waslaPublicId, {
    trigger: "vehicle_changed",
    traceId: input.traceId ?? null,
  });
  return saved;
}
