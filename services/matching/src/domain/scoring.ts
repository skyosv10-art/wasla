/**
 * Ranking: integer arithmetic, declared constants, explicit tie-break.
 *
 * Everything here is integer basis points out of 10,000 (MATCHING_DISPATCH §5).
 * A float score makes a genuine tie look like a difference — and then the same
 * two drivers can swap places between two identical evaluations, which makes a
 * fairness claim unprovable and a driver's complaint unexaminable.
 *
 * Four inputs carry weight in version 1: zone proximity, completion, acceptance
 * and fairness. ETA, distance and rating are weighted zero because the inputs do
 * not exist (no routing service, no coordinates, no reputation engine).
 */

import type {
  Candidacy,
  RankedCandidate,
  RulesetWeights,
  ScoreComponents,
  TiebreakReason,
  ZoneLineage,
} from "./model.js";
import { BP_SCALE } from "./model.js";

/**
 * Zone proximity ladder: the same zone, then a sibling under the same parent,
 * then a higher ancestor. The declared substitute for a distance the system
 * cannot measure — and the ladder is coarse ON PURPOSE, because a fabricated
 * fine-grained distance would be a lie with decimals.
 */
export const ZONE_PROXIMITY_BP = {
  same_zone: 10_000,
  same_district: 7_500,
  same_city: 5_000,
  same_region: 2_500,
  same_country: 1_000,
} as const;
export type ZoneProximityTier = keyof typeof ZONE_PROXIMITY_BP;

/**
 * Completion saturates at twenty finished orders.
 *
 * A declared constant, not a hidden curve: without a ceiling the oldest account
 * in the city wins every ranking forever, and a new driver could never earn a
 * first order. Twenty is enough to separate "has worked" from "is unknown"
 * without becoming a seniority system.
 */
export const COMPLETION_SATURATION_ORDERS = 20;

/**
 * A driver with no offer history scores neutral on acceptance, not zero.
 *
 * Zero would punish a driver for never having been offered anything — a deficit
 * the system created, not the driver — and would make the cold-start case
 * unwinnable. Full marks would be worse: it would reward having no record.
 */
export const ACCEPTANCE_NEUTRAL_BP = 5_000;

/** Deepest shared level between the pickup zone and a served zone. */
export function zoneProximityTier(
  pickup: ZoneLineage,
  served: ZoneLineage,
): ZoneProximityTier | null {
  if (served.zoneId === pickup.zoneId) return "same_zone";
  if (served.districtId === pickup.districtId) return "same_district";
  if (served.cityId === pickup.cityId) return "same_city";
  if (served.regionId === pickup.regionId) return "same_region";
  if (served.countryId === pickup.countryId) return "same_country";
  return null;
}

/**
 * The best proximity across all zones the driver serves, or `null` when none of
 * them shares even a country with the pickup zone — which is the stage-7 hard
 * filter, not a zero score. A zero score would keep an unreachable driver in the
 * list, ranked below others, and a wave would eventually offer them the order.
 */
export function zoneProximityBp(
  pickup: ZoneLineage,
  servedLineages: readonly ZoneLineage[],
): number | null {
  let best: number | null = null;
  for (const served of servedLineages) {
    const tier = zoneProximityTier(pickup, served);
    if (tier === null) continue;
    const value = ZONE_PROXIMITY_BP[tier];
    if (best === null || value > best) best = value;
  }
  return best;
}

/** Completed orders against the declared saturation ceiling. */
export function completionBp(candidacy: Candidacy): number {
  const capped = Math.min(Math.max(candidacy.ordersCompleted, 0), COMPLETION_SATURATION_ORDERS);
  return Math.floor((capped * BP_SCALE) / COMPLETION_SATURATION_ORDERS);
}

/** Accepted offers over received offers; neutral when there is no history at all. */
export function acceptanceBp(candidacy: Candidacy): number {
  if (candidacy.offersReceived <= 0) return ACCEPTANCE_NEUTRAL_BP;
  const accepted = Math.min(Math.max(candidacy.offersAccepted, 0), candidacy.offersReceived);
  return Math.floor((accepted * BP_SCALE) / candidacy.offersReceived);
}

/**
 * Time since the last offer OR assignment, capped by the fairness horizon.
 *
 * The cap is what keeps fairness from becoming the only input: without it, a
 * driver untouched for a month outranks everyone else regardless of anything
 * else forever. A driver never offered anything scores full marks — that is the
 * whole purpose of the input.
 */
export function fairnessBp(
  candidacy: Candidacy,
  evaluatedAt: string,
  fairnessHorizonSeconds: number,
): number {
  const evaluated = Date.parse(evaluatedAt);
  const stamps = [candidacy.lastOfferedAt, candidacy.lastAssignedAt]
    .filter((value): value is string => value !== null)
    .map((value) => Date.parse(value))
    .filter((value) => !Number.isNaN(value));
  if (Number.isNaN(evaluated) || stamps.length === 0) return BP_SCALE;
  const mostRecent = Math.max(...stamps);
  const elapsedSeconds = Math.floor((evaluated - mostRecent) / 1000);
  if (elapsedSeconds <= 0) return 0;
  const capped = Math.min(elapsedSeconds, fairnessHorizonSeconds);
  return Math.floor((capped * BP_SCALE) / fairnessHorizonSeconds);
}

/** All four components of one candidacy under one ruleset. */
export function scoreComponents(
  candidacy: Candidacy,
  zoneBp: number,
  evaluatedAt: string,
  fairnessHorizonSeconds: number,
): ScoreComponents {
  return {
    zoneProximityBp: zoneBp,
    completionBp: completionBp(candidacy),
    acceptanceBp: acceptanceBp(candidacy),
    fairnessBp: fairnessBp(candidacy, evaluatedAt, fairnessHorizonSeconds),
  };
}

/**
 * The weighted score, in basis points, by integer arithmetic only.
 *
 * Weights are percentage points summing to 100, so dividing the weighted sum by
 * 100 keeps the result inside [0, 10000] with no floating point anywhere on the
 * path. The zero-weighted inputs are multiplied by zero rather than omitted, so
 * the formula in the code matches the table in the document line for line.
 */
export function weightedScoreBp(components: ScoreComponents, weights: RulesetWeights): number {
  const weighted =
    weights.eta * 0 +
    weights.distance * 0 +
    weights.rating * 0 +
    weights.zoneProximity * components.zoneProximityBp +
    weights.completion * components.completionBp +
    weights.acceptance * components.acceptanceBp +
    weights.fairness * components.fairnessBp;
  return Math.floor(weighted / 100);
}

/** A candidacy paired with its computed score, before ordering. */
export interface ScoredCandidate {
  readonly candidacy: Candidacy;
  readonly scoreBp: number;
  readonly components: ScoreComponents;
}

/**
 * Declared tie-break: score, then the driver offered longest ago
 * (`last_offered_at`, where "never" is the oldest), then `driver_public_id`
 * lexicographically. Nothing random, nothing insertion-ordered.
 */
export function compareScored(left: ScoredCandidate, right: ScoredCandidate): number {
  if (left.scoreBp !== right.scoreBp) return right.scoreBp - left.scoreBp;
  const lastOffered = compareLastOffered(left.candidacy.lastOfferedAt, right.candidacy.lastOfferedAt);
  if (lastOffered !== 0) return lastOffered;
  // Reflexive on purpose: comparing a candidate with itself must be 0, otherwise
  // the comparator is not an ordering and `sort` is free to do anything with it.
  if (left.candidacy.driverPublicId === right.candidacy.driverPublicId) return 0;
  return left.candidacy.driverPublicId < right.candidacy.driverPublicId ? -1 : 1;
}

/** `null` means never offered, which sorts first — it is the oldest possible. */
function compareLastOffered(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs) || leftMs === rightMs) return 0;
  return leftMs - rightMs;
}

/**
 * Order the scored set and label how each position was decided.
 *
 * `tiebreakBy` is evidence, not decoration: `score` means the score alone placed
 * the candidate, `last_offered_at` means the score tied and the fairness stamp
 * broke it, `driver_public_id` means both tied and the id was the last resort.
 * A stored decision that cannot say which of the three happened cannot answer a
 * complaint about favouritism.
 */
export function rankCandidates(scored: readonly ScoredCandidate[], limit: number): RankedCandidate[] {
  const ordered = [...scored].sort(compareScored);
  const scoreCounts = new Map<number, number>();
  const stampCounts = new Map<string, number>();
  for (const item of ordered) {
    scoreCounts.set(item.scoreBp, (scoreCounts.get(item.scoreBp) ?? 0) + 1);
    const stampKey = `${item.scoreBp}|${item.candidacy.lastOfferedAt ?? "never"}`;
    stampCounts.set(stampKey, (stampCounts.get(stampKey) ?? 0) + 1);
  }

  return ordered.slice(0, Math.max(limit, 0)).map((item, index) => {
    const stampKey = `${item.scoreBp}|${item.candidacy.lastOfferedAt ?? "never"}`;
    const tiebreakBy: TiebreakReason =
      (scoreCounts.get(item.scoreBp) ?? 0) === 1
        ? "score"
        : (stampCounts.get(stampKey) ?? 0) === 1
          ? "last_offered_at"
          : "driver_public_id";
    return {
      rank: index + 1,
      driverPublicId: item.candidacy.driverPublicId,
      scoreBp: item.scoreBp,
      components: item.components,
      tiebreakBy,
    };
  });
}
