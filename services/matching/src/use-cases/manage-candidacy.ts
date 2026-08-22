/**
 * Candidacy writes and reads: `PUT /candidacy/{id}`,
 * `POST /candidacy/{id}/availability`, `GET /candidacy/{id}`.
 *
 * Three decisions live here:
 *
 *  - **Replacement, not merge.** The row is a projection; merging half of it
 *    yields combinations nobody declared (today's availability with last week's
 *    zones), and afterwards nothing distinguishes such a row from a correct one.
 *  - **Availability is an attribute of an existing candidacy.** A driver with no
 *    row gets 404, never an implicit create: a row born from an availability call
 *    would be a candidate with no eligibility and no zones — exactly the "unknown
 *    is a candidate" failure the whole model forbids.
 *  - **`updatedAt` is written by the service.** It is the deciding column of the
 *    freshness filter; a caller able to set it could make a stale row look fresh
 *    and win offers it should not receive.
 */

import { candidacyNotFound, idempotencyKeyReused, zoneUnknown } from "../domain/errors.js";
import { driverAvailabilityChanged, driverCandidacyUpdated } from "../domain/events.js";
import { isFresh } from "../domain/filters.js";
import type {
  AvailabilityState,
  Candidacy,
  CandidacyView,
  MatchingAvailabilityReasonCode,
  ServiceKind,
} from "../domain/model.js";
import {
  assertActorType,
  assertAvailabilityState,
  assertDriverPublicId,
  assertEligibilitySource,
  assertEligibilityState,
  assertIdempotencyKey,
  assertServiceKind,
  assertUuid,
  assertVehicleClass,
  fingerprint,
  validationFailed,
  writerFromActor,
} from "../domain/validation.js";
import type { MatchingDependencies } from "../ports.js";

export interface UpsertCandidacyRequest {
  readonly driverPublicId: string;
  readonly availabilityState: string;
  readonly eligibilityState: string;
  readonly eligibilitySource?: string;
  readonly serviceKinds: readonly string[];
  readonly vehicleClass?: string | null;
  readonly zoneIds: readonly string[];
  readonly actorType?: string;
  readonly idempotencyKey: string;
  readonly traceId?: string | null;
}

export async function upsertCandidacy(
  deps: MatchingDependencies,
  request: UpsertCandidacyRequest,
): Promise<Candidacy> {
  const traceId = request.traceId ?? undefined;
  const driverPublicId = assertDriverPublicId(request.driverPublicId, "driverPublicId", traceId);
  const key = assertIdempotencyKey(request.idempotencyKey, traceId);
  const availabilityState = assertAvailabilityState(
    request.availabilityState,
    "availability_state",
    traceId,
  );
  const eligibilityState = assertEligibilityState(request.eligibilityState, "eligibility_state", traceId);
  const eligibilitySource = assertEligibilitySource(
    request.eligibilitySource ?? "claimed",
    "eligibility_source",
    traceId,
  );
  if (request.serviceKinds.length === 0) {
    throw validationFailed("service_kinds", "at least one service kind", traceId);
  }
  const serviceKinds: ServiceKind[] = request.serviceKinds.map((value, index) =>
    assertServiceKind(value, `service_kinds[${index}]`, traceId),
  );
  const vehicleClass =
    request.vehicleClass === undefined || request.vehicleClass === null
      ? null
      : assertVehicleClass(request.vehicleClass, "vehicle_class", traceId);
  if (request.zoneIds.length === 0 || request.zoneIds.length > 64) {
    throw validationFailed("zone_ids", "1..64 zone ids", traceId);
  }
  const zoneIds = request.zoneIds.map((value, index) =>
    assertUuid(value, `zone_ids[${index}]`, traceId),
  );
  const actorType = assertActorType(request.actorType ?? "driver_bot", "actor_type", traceId);

  // Every declared zone must exist: a row that claims coverage the hierarchy does
  // not know would silently narrow to nothing at evaluation time, and the driver
  // would never learn why they receive no offers.
  const resolved = await deps.zones.resolve(zoneIds);
  for (const [index, zoneId] of zoneIds.entries()) {
    if (!resolved.has(zoneId)) throw zoneUnknown(`zone_ids[${index}]`, traceId);
  }

  const payloadFingerprint = fingerprint({
    driverPublicId,
    availabilityState,
    eligibilityState,
    eligibilitySource,
    serviceKinds,
    vehicleClass,
    zoneIds,
    actorType,
  });
  const remembered = await deps.idempotency.find(key);
  if (remembered !== null) {
    if (remembered !== payloadFingerprint) throw idempotencyKeyReused(traceId);
    const existing = await deps.candidacy.find(driverPublicId);
    // A retry returns the stored row and appends NO second event.
    if (existing !== null) return existing;
  }

  const updatedAt = deps.clock.now();
  const stored = await deps.candidacy.replace({
    driverPublicId,
    availabilityState,
    eligibilityState,
    eligibilitySource,
    serviceKinds,
    vehicleClass,
    zoneIds,
    updatedBy: writerFromActor(actorType),
    updatedAt,
  });
  await deps.idempotency.remember(key, payloadFingerprint);
  await deps.outbox.append(
    driverCandidacyUpdated(stored, {
      eventId: deps.ids.uuid(),
      occurredAt: updatedAt,
      traceId: request.traceId ?? null,
    }),
  );
  return stored;
}

export interface ChangeAvailabilityRequest {
  readonly driverPublicId: string;
  readonly availabilityState: string;
  readonly actorType?: string;
  readonly reasonCode?: MatchingAvailabilityReasonCode | null;
  readonly idempotencyKey: string;
  readonly traceId?: string | null;
}

/**
 * The narrow path for the most frequent write in the system.
 *
 * A no-op change (already `busy`, told again) still returns 200 and still records
 * nothing new: the state prevents the second effect, not a counter. But a real
 * change always emits the event with both states, because a consumer that only
 * sees the destination cannot tell a change from a repetition.
 */
export async function changeAvailability(
  deps: MatchingDependencies,
  request: ChangeAvailabilityRequest,
): Promise<Candidacy> {
  const traceId = request.traceId ?? undefined;
  const driverPublicId = assertDriverPublicId(request.driverPublicId, "driverPublicId", traceId);
  const key = assertIdempotencyKey(request.idempotencyKey, traceId);
  const toState: AvailabilityState = assertAvailabilityState(
    request.availabilityState,
    "availability_state",
    traceId,
  );
  const actorType = assertActorType(request.actorType ?? "driver_bot", "actor_type", traceId);

  const existing = await deps.candidacy.find(driverPublicId);
  if (existing === null) throw candidacyNotFound(traceId);

  const payloadFingerprint = fingerprint({ driverPublicId, toState, actorType });
  const remembered = await deps.idempotency.find(key);
  if (remembered !== null) {
    if (remembered !== payloadFingerprint) throw idempotencyKeyReused(traceId);
    return existing;
  }

  const changedAt = deps.clock.now();
  const stored = await deps.candidacy.setAvailability(driverPublicId, toState, changedAt);
  await deps.idempotency.remember(key, payloadFingerprint);
  if (existing.availabilityState !== toState) {
    await deps.outbox.append(
      driverAvailabilityChanged(
        {
          driverPublicId,
          fromState: existing.availabilityState,
          toState,
          actorType,
          reasonCode: request.reasonCode ?? null,
          changedAt,
        },
        { eventId: deps.ids.uuid(), occurredAt: changedAt, traceId: request.traceId ?? null },
      ),
    );
  }
  return stored;
}

/**
 * Read one candidacy row with `is_fresh` COMPUTED, never stored.
 *
 * A stored freshness flag starts lying the moment the clock moves, all by itself
 * and with nobody writing anything.
 */
export async function readCandidacy(
  deps: MatchingDependencies,
  driverPublicId: string,
  traceId?: string,
): Promise<CandidacyView> {
  const id = assertDriverPublicId(driverPublicId, "driverPublicId", traceId);
  const row = await deps.candidacy.find(id);
  if (row === null) throw candidacyNotFound(traceId);
  const active = await deps.rulesets.findActive();
  const freshnessSeconds = active?.candidacyFreshnessSeconds ?? 120;
  return { ...row, isFresh: isFresh(row, deps.clock.now(), freshnessSeconds) };
}
