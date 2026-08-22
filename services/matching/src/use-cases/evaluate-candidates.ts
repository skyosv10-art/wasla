/**
 * `POST /matching/candidates` — the one question this service answers.
 *
 * The shape of the operation is fixed by ADR-011: read, evaluate, write ONE audit
 * row, emit ONE aggregate-only event. No offer, no deadline, no order transition,
 * no availability change. If this function ever needed to call another service to
 * do its job, matching would have become a coordinator and dispatch would have
 * become decoration.
 *
 * Order of checks is a tested contract, not an implementation detail (the same
 * discipline as ORDER_CORE_DOMAIN §"ترتيب الفحص"):
 *   1. shape of the query (400 / 422 on closed lists),
 *   2. ruleset resolvable, frozen, weights summing to 100 (422),
 *   3. pickup zone exists in the hierarchy (422),
 *   4. hard filters in order (never an error — a 200 with a reason code),
 *   5. ranking + tie-break, then the audit row and the event.
 *
 * Step 3 precedes step 4 on purpose: an unknown pickup zone is a caller error and
 * must not be reported as `NO_ZONE_MATCH`, which would send an operator looking
 * for missing driver coverage instead of a bad zone id.
 */

import type { MatchingEmptyReasonCode } from "@wasla/contracts-matching";

import { matchingEvaluated } from "../domain/events.js";
import { applyHardFilters } from "../domain/filters.js";
import { zoneUnknown } from "../domain/errors.js";
import type {
  Candidacy,
  MatchingDecision,
  RankedCandidate,
  Ruleset,
  ZoneLineage,
} from "../domain/model.js";
import { assertRankable } from "../domain/ruleset.js";
import {
  rankCandidates,
  scoreComponents,
  weightedScoreBp,
  zoneProximityBp,
  type ScoredCandidate,
} from "../domain/scoring.js";
import {
  assertDriverPublicId,
  assertIntegerInRange,
  assertIsoTimestamp,
  assertOrderPublicId,
  assertServiceKind,
  assertUuid,
  assertVehicleClass,
} from "../domain/validation.js";
import type { MatchingDependencies } from "../ports.js";

export interface EvaluateCandidatesInput {
  readonly orderId: string;
  readonly orderPublicId: string;
  readonly orderType: string;
  readonly vehicleClass: string;
  readonly pickupZoneId: string;
  readonly excludedDriverIds?: readonly string[];
  readonly limit?: number;
  readonly rulesetVersion?: number;
  readonly dispatchJobId?: string | null;
  /** Explicit evaluation clock; the service clock is used when absent. */
  readonly evaluatedAt?: string;
  readonly requestedAt?: string;
  readonly traceId?: string | null;
}

export interface EvaluateCandidatesResult {
  readonly decisionId: string;
  readonly rulesetVersion: number;
  readonly evaluatedAt: string;
  readonly candidates: readonly RankedCandidate[];
  readonly counts: MatchingDecision["counts"];
  readonly emptyReasonCode: MatchingEmptyReasonCode | null;
  readonly decision: MatchingDecision;
}

export async function evaluateCandidates(
  deps: MatchingDependencies,
  input: EvaluateCandidatesInput,
): Promise<EvaluateCandidatesResult> {
  const traceId = input.traceId ?? undefined;

  // 1) shape
  const orderId = assertUuid(input.orderId, "order_id", traceId);
  const orderPublicId = assertOrderPublicId(input.orderPublicId, "order_public_id", traceId);
  const orderType = assertServiceKind(input.orderType, "order_type", traceId);
  const vehicleClass = assertVehicleClass(input.vehicleClass, "vehicle_class", traceId);
  const pickupZoneId = assertUuid(input.pickupZoneId, "pickup_zone_id", traceId);
  const dispatchJobId =
    input.dispatchJobId === undefined || input.dispatchJobId === null
      ? null
      : assertUuid(input.dispatchJobId, "dispatch_job_id", traceId);
  const excludedDriverIds = (input.excludedDriverIds ?? []).map((value, index) =>
    assertDriverPublicId(value, `excluded_driver_ids[${index}]`, traceId),
  );
  if (excludedDriverIds.length > 200) {
    assertIntegerInRange(excludedDriverIds.length, "excluded_driver_ids", 0, 200, traceId);
  }

  const nowIso = deps.clock.now();
  const evaluatedAt =
    input.evaluatedAt === undefined ? nowIso : assertIsoTimestamp(input.evaluatedAt, "evaluated_at", traceId);
  const requestedAt =
    input.requestedAt === undefined ? nowIso : assertIsoTimestamp(input.requestedAt, "requested_at", traceId);

  // 2) ruleset — resolvable, frozen, weights summing to 100
  const ruleset = await resolveRuleset(deps, input.rulesetVersion, traceId);
  const limit =
    input.limit === undefined
      ? ruleset.maxCandidates
      : Math.min(assertIntegerInRange(input.limit, "limit", 1, 200, traceId), ruleset.maxCandidates);

  // 3) pickup zone must exist in the hierarchy (422, not an empty-result code)
  const pickupLineages = await deps.zones.resolve([pickupZoneId]);
  const pickupLineage = pickupLineages.get(pickupZoneId);
  if (pickupLineage === undefined) {
    throw zoneUnknown("pickup_zone_id", traceId);
  }

  // 4) hard filters, in order, over every row that could take part
  const rows = await deps.candidacy.listForEvaluation();
  const servedLineages = await resolveServedLineages(deps, rows);
  const proximityCache = new Map<string, number | null>();
  const proximityFor = (candidacy: Candidacy): number | null => {
    const cached = proximityCache.get(candidacy.driverPublicId);
    if (cached !== undefined) return cached;
    const lineages = candidacy.zoneIds
      .map((zoneId) => servedLineages.get(zoneId))
      .filter((lineage): lineage is ZoneLineage => lineage !== undefined);
    const value = zoneProximityBp(pickupLineage, lineages);
    proximityCache.set(candidacy.driverPublicId, value);
    return value;
  };

  const filtered = applyHardFilters(rows, {
    orderType,
    vehicleClass,
    excludedDriverIds,
    evaluatedAt,
    candidacyFreshnessSeconds: ruleset.candidacyFreshnessSeconds,
    servesPickupZone: (candidacy) => proximityFor(candidacy) !== null,
  });

  // 5) ranking — integer scores, declared tie-break
  const scored: ScoredCandidate[] = filtered.survivors.map((candidacy) => {
    const components = scoreComponents(
      candidacy,
      proximityFor(candidacy) ?? 0,
      evaluatedAt,
      ruleset.fairnessHorizonSeconds,
    );
    return { candidacy, components, scoreBp: weightedScoreBp(components, ruleset.weights) };
  });
  const candidates = rankCandidates(scored, limit);

  const decision: MatchingDecision = {
    id: deps.ids.uuid(),
    orderId,
    orderPublicId,
    dispatchJobId,
    rulesetVersion: ruleset.version,
    requestedAt,
    evaluatedAt,
    orderType,
    vehicleClass,
    pickupZoneId,
    counts: {
      considered: filtered.consideredCount,
      eligible: filtered.eligibleCount,
      returned: candidates.length,
      // Rows actually removed by the caller's list — not the length of the list.
      // An id in the list with no candidacy row excluded nobody, and recording it
      // as an exclusion would invent a candidate that never existed.
      excluded: filtered.excludedCount,
    },
    // A truncating limit is not a reason for emptiness; only an empty list needs one.
    emptyReasonCode: candidates.length === 0 ? (filtered.emptyReasonCode ?? "NO_CANDIDACY_ROWS") : null,
    candidates,
    createdAt: nowIso,
  };

  const stored = await deps.decisions.append(decision);
  await deps.outbox.append(
    matchingEvaluated(stored, {
      eventId: deps.ids.uuid(),
      occurredAt: nowIso,
      traceId: input.traceId ?? null,
    }),
  );

  return {
    decisionId: stored.id,
    rulesetVersion: stored.rulesetVersion,
    evaluatedAt: stored.evaluatedAt,
    candidates: stored.candidates,
    counts: stored.counts,
    emptyReasonCode: stored.emptyReasonCode,
    decision: stored,
  };
}

/**
 * The requested version, or the newest frozen one.
 *
 * A service with no frozen ruleset is degraded, not broken by the caller: it is
 * reported as `MATCHING_RULESET_NOT_FOUND` for an explicit version and surfaces
 * through `/health` for the default case (MR 5/6).
 */
async function resolveRuleset(
  deps: MatchingDependencies,
  requestedVersion: number | undefined,
  traceId?: string,
): Promise<Ruleset> {
  if (requestedVersion === undefined) {
    const active = await deps.rulesets.findActive();
    return assertRankable(active, 0, traceId);
  }
  const version = assertIntegerInRange(requestedVersion, "ruleset_version", 1, 1_000_000, traceId);
  const found = await deps.rulesets.find(version);
  return assertRankable(found, version, traceId);
}

/** One batched hierarchy lookup for every zone mentioned by any candidacy row. */
async function resolveServedLineages(
  deps: MatchingDependencies,
  rows: readonly Candidacy[],
): Promise<Map<string, ZoneLineage>> {
  const zoneIds = new Set<string>();
  for (const row of rows) {
    for (const zoneId of row.zoneIds) zoneIds.add(zoneId);
  }
  if (zoneIds.size === 0) return new Map();
  return deps.zones.resolve([...zoneIds]);
}
