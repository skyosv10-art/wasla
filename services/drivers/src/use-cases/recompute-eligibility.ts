/**
 * The recomputation pipeline — the single path through which eligibility is ever
 * decided, logged, and published.
 *
 * Every other use case ends here. There is exactly one implementation on purpose:
 * a second place that decides eligibility is a second answer, and the first
 * question anyone asks after an incident is "which one ran?".
 *
 * The order of steps is the contract:
 *   1. read the frozen policy the profile is pinned to,
 *   2. gather the snapshot ONCE (so all reasons describe one instant),
 *   3. evaluate — a pure function,
 *   4. store the derived recheck index,
 *   5. if the answer or its reasons changed: append the log row AND the event, in
 *      the same logical operation, so there is no silent change,
 *   6. publish the projection to matching only when a publication would carry
 *      new information, and record the attempt either way.
 */

import type {
  CandidacyPublication,
  DriverSnapshot,
  EligibilityState,
  EligibilityTrigger,
  ProjectedAvailability,
  ServiceKind,
  VehicleClass,
} from "../domain/model.js";
import type { EligibilityDecision } from "../domain/eligibility.js";
import {
  evaluateEligibility,
  findPrimaryVehicle,
  unknownEligibility,
} from "../domain/eligibility.js";
import { driverEligibilityChanged } from "../domain/events.js";
import { eligibilityChanged } from "../domain/eligibility.js";
import { LAUNCH_POLICY_VERSION, requireUsablePolicy } from "../domain/policy.js";
import type { DriverDependencies } from "../ports.js";

/**
 * Triggers whose event changes the PROJECTION payload even when the eligibility
 * verdict is unchanged.
 *
 * `expiry_tick` and `document_submitted` are deliberately absent: neither changes
 * anything matching stores unless the verdict itself moved, and republishing every
 * unchanged driver on every tick would turn a maintenance sweep into a load test
 * against a service that did nothing wrong.
 */
const PROJECTION_AFFECTING_TRIGGERS: readonly EligibilityTrigger[] = [
  "profile_changed",
  "zones_changed",
  "vehicle_changed",
  "availability_declared",
  "suspended",
  "reinstated",
];

export interface RecomputeOptions {
  readonly trigger: EligibilityTrigger;
  /**
   * The instant the change is EFFECTIVE for, when it differs from now — only the
   * expiry tick passes it (see domain/events.ts).
   */
  readonly occurredFor?: string;
  readonly traceId?: string | null;
  /** Force a publication attempt even if nothing appears to have changed. */
  readonly forcePublish?: boolean;
}

export interface RecomputeResult {
  readonly decision: EligibilityDecision;
  readonly previousState: EligibilityState | null;
  readonly changed: boolean;
  readonly publication: CandidacyPublication | null;
}

export async function loadSnapshot(
  deps: DriverDependencies,
  waslaPublicId: string,
): Promise<DriverSnapshot | null> {
  const profile = await deps.profiles.find(waslaPublicId);
  if (profile === null) return null;
  const [zones, vehicles, documents] = await Promise.all([
    deps.zones.list(waslaPublicId),
    deps.vehicles.list(waslaPublicId),
    deps.documents.list(waslaPublicId),
  ]);
  return { profile, zones, vehicles, documents };
}

/**
 * The availability value to publish.
 *
 * `busy` belongs to dispatch through matching (ADR-012 decision 4). This service
 * may make a driver LESS available than matching believes, never more: a driver
 * who says "I am free" while a live commitment is open would otherwise be offered
 * a second order, and the second passenger pays for that.
 */
export function projectedAvailability(
  declared: "available" | "offline",
  current: ProjectedAvailability | null,
): ProjectedAvailability {
  if (declared === "available" && current === "busy") return "busy";
  return declared;
}

export async function recomputeEligibility(
  deps: DriverDependencies,
  waslaPublicId: string,
  options: RecomputeOptions,
): Promise<RecomputeResult> {
  const now = deps.clock.now();
  const snapshot = await loadSnapshot(deps, waslaPublicId);

  // No profile: `unknown`, fail-closed, and NOTHING is written. A log row for a
  // driver who does not exist would create a profile-shaped hole in the audit.
  if (snapshot === null) {
    return {
      decision: unknownEligibility(LAUNCH_POLICY_VERSION, now),
      previousState: null,
      changed: false,
      publication: null,
    };
  }

  const version = snapshot.profile.eligibilityPolicyVersion;
  const policy = requireUsablePolicy(await deps.policies.find(version), version);
  const decision = evaluateEligibility(snapshot, policy, now);

  if (snapshot.profile.eligibilityRecheckAt !== decision.recheckAt) {
    await deps.profiles.setRecheckAt(waslaPublicId, decision.recheckAt, now);
  }

  const previous = await deps.eligibilityLog.latest(waslaPublicId);
  const previousState = previous?.toState ?? null;
  const changed = eligibilityChanged(previousState, previous?.reasons ?? [], decision);

  if (changed) {
    await deps.eligibilityLog.append({
      waslaPublicId,
      fromState: previousState,
      toState: decision.state,
      reasons: decision.reasonCodes,
      policyVersion: decision.policyVersion,
      trigger: options.trigger,
      evaluatedAt: now,
    });
    await deps.outbox.append(
      driverEligibilityChanged(waslaPublicId, previousState, decision, options.trigger, {
        eventId: deps.ids.uuid(),
        occurredAt: now,
        traceId: options.traceId ?? null,
        ...(options.occurredFor === undefined ? {} : { occurredFor: options.occurredFor }),
      }),
    );
  }

  const shouldPublish =
    options.forcePublish === true ||
    changed ||
    snapshot.profile.lastPublishedState === null ||
    PROJECTION_AFFECTING_TRIGGERS.includes(options.trigger);

  const publication = shouldPublish
    ? await publishCandidacy(deps, waslaPublicId, decision, now, options.traceId ?? null)
    : null;

  return { decision, previousState, changed, publication };
}

/**
 * Push the projection to matching and RECORD the attempt.
 *
 * The record comes first in importance, not in time: a month later the question is
 * "why was this order offered to this driver?", and the answer starts from
 * `driver_candidacy_publications` rather than from anyone's memory.
 *
 * A failed publication does NOT roll back the local change. The local state is
 * true — the document really was verified — and refusing our own write because a
 * service behind us is down would make our correctness depend on their uptime. The
 * drift is instead made visible: `last_published_state` stays behind, and the
 * failed attempt is on the record with its code.
 *
 * ## The read is inside the guard, and that is a fix, not a style choice (MR 5/6)
 *
 * `candidacy.read` used to run before the `try`. With the unconfigured port — which
 * cannot fail — that was invisible; with the real HTTP port it meant an outage in
 * matching would throw out of here, out of `recomputeEligibility`, and out of every
 * write use case, so a verified document would be refused with 503 because a service
 * BEHIND us was down. That is precisely the coupling ADR-012 decision 3 forbids.
 *
 * A failed read therefore aborts the publication instead of proceeding without it:
 * without the current value we cannot honour «never upgrade a `busy` row», and
 * publishing `available` over a live commitment would offer a second order to a
 * driver already carrying one. The recorded row keeps the DECLARED availability,
 * because that is what we would have sent — an honest description of an attempt that
 * never left the process.
 */
async function publishCandidacy(
  deps: DriverDependencies,
  waslaPublicId: string,
  decision: EligibilityDecision,
  now: string,
  traceId: string | null = null,
): Promise<CandidacyPublication> {
  const snapshot = await loadSnapshot(deps, waslaPublicId);
  if (snapshot === null) throw new Error("publishCandidacy requires an existing profile");

  const primary = findPrimaryVehicle(snapshot.vehicles);
  const declared = snapshot.profile.declaredAvailability;
  const base = {
    waslaPublicId,
    eligibilityState: decision.state,
    serviceKinds: [...snapshot.profile.serviceKinds] as readonly ServiceKind[],
    zoneIds: snapshot.zones.map((zone) => zone.zoneId),
    vehicleClass: (primary?.vehicleClass ?? null) as VehicleClass | null,
  };

  let outcome: CandidacyPublication["outcome"] = "published";
  let failureCode: string | null = null;
  let availabilityState = declared as CandidacyPublication["availabilityState"];
  try {
    const current = await deps.candidacy.read(waslaPublicId);
    availabilityState = projectedAvailability(declared, current?.availabilityState ?? null);
    const result = await deps.candidacy.publish({ ...base, availabilityState }, { traceId });
    if (!result.accepted) {
      // Matching answered and refused: that is a `rejected` attempt with the code
      // it gave us, which is a different fact from "we could not reach it".
      outcome = "rejected";
      failureCode = result.failureCode ?? "MATCHING_REJECTED";
    }
  } catch {
    // Transport failure on either call. `unavailable`, and the reason is ours to
    // name — we did not get an answer, so we must not invent one on matching's behalf.
    outcome = "unavailable";
    failureCode = "MATCHING_UNREACHABLE";
  }

  const publication = await deps.publications.append({
    ...base,
    availabilityState,
    outcome,
    failureCode,
    attemptedAt: now,
  });

  if (outcome === "published") {
    await deps.profiles.recordPublication(waslaPublicId, decision.state, now);
  }

  return publication;
}
