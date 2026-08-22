/**
 * The vehicle lifecycle and the primary-vehicle rule.
 *
 * ```text
 *   (new) ──register──▶ active ──retire──▶ retired
 *                          ▲                  │
 *                          └──── (never) ─────┘
 * ```
 *
 * Retirement is **one-way**. Bringing a retired vehicle back would silently
 * revive whatever documents were attached to it — a registration verified two
 * years ago for a car that has since been sold — and nobody would be asked to look
 * at them again. A returning car is a new registration.
 *
 * Two invariants, both mirrored by database constraints so that neither depends on
 * this file being correct:
 *  - `ck_driver_vehicles_retired_not_primary`: a retired vehicle is never primary.
 *    Retiring the primary therefore CLEARS the flag, and the driver becomes
 *    ineligible with `NO_PRIMARY_VEHICLE` — visibly, with a reason, instead of
 *    staying eligible on a car he no longer owns.
 *  - `ux_driver_vehicles_one_primary`: at most one primary per driver. Promoting a
 *    vehicle therefore DEMOTES the previous primary in the same operation; a
 *    "promote" that leaves two primaries makes the eligibility calculator pick one
 *    by array order, which is a decision nobody made.
 */

import type { Vehicle, VehicleStatus } from "./model.js";
import { vehicleRetired } from "./errors.js";

export const VEHICLE_TRANSITIONS: Readonly<Record<VehicleStatus, readonly VehicleStatus[]>> =
  Object.freeze({
    active: Object.freeze(["retired"]),
    retired: Object.freeze([]),
  }) as Readonly<Record<VehicleStatus, readonly VehicleStatus[]>>;

export function canTransitionVehicle(from: VehicleStatus, to: VehicleStatus): boolean {
  return VEHICLE_TRANSITIONS[from].includes(to);
}

/** A retired vehicle accepts no write: not a patch, not a document, not a promotion. */
export function assertVehicleWritable(vehicle: Vehicle): void {
  if (vehicle.status === "retired") throw vehicleRetired();
}

/**
 * Apply retirement, clearing the primary flag in the same step.
 *
 * The two changes are one change: a sequence that retires first and clears second
 * has an instant in between where the row violates the CHECK constraint, and the
 * only reason it survives in memory is that nothing was watching.
 */
export function retire(vehicle: Vehicle, at: string): Vehicle {
  return { ...vehicle, status: "retired", isPrimary: false, updatedAt: at };
}

/**
 * The result of promoting one vehicle: the promoted row plus every row that had
 * to be demoted for the unique index to hold.
 */
export interface PrimaryReassignment {
  readonly promoted: Vehicle;
  readonly demoted: readonly Vehicle[];
}

export function promoteToPrimary(
  vehicle: Vehicle,
  siblings: readonly Vehicle[],
  at: string,
): PrimaryReassignment {
  assertVehicleWritable(vehicle);
  const demoted = siblings
    .filter((other) => other.id !== vehicle.id && other.isPrimary)
    .map((other) => ({ ...other, isPrimary: false, updatedAt: at }));
  return { promoted: { ...vehicle, isPrimary: true, updatedAt: at }, demoted };
}
