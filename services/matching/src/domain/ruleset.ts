/**
 * Ruleset version 1 — the seeded, frozen weights, and the guards around them.
 *
 * This file is the code-side mirror of the seed INSERT in
 * services/matching/contracts/schema.sql and of the table in
 * docs/03-domain/MATCHING_DISPATCH.md §5. A drift guard test reads BOTH sources
 * from disk and compares them to `RULESET_V1`, so a weight can never be changed
 * in one place only: if the numbers disagree, the suite fails and the code is
 * the thing that is wrong (MATCHING_DISPATCH.md preamble).
 *
 * The declared zeros are the point (decision 6): ETA, distance and rating are
 * present with weight 0 because the inputs do not exist in this repository yet.
 * Deleting them would say "nobody thought about this"; keeping them at zero says
 * "we measured this and it weighs nothing today". A weight on a missing input
 * produces a constant masquerading as intelligence.
 */

import type { Ruleset, RulesetWeights } from "./model.js";
import { rulesetNotFound, rulesetNotFrozen, rulesetWeightsInvalid } from "./errors.js";

/** The sum every ruleset must reach exactly, in integer percentage points. */
export const WEIGHTS_SUM = 100;

/** The version this phase ranks with. */
export const RULESET_V1_VERSION = 1;

export const RULESET_V1_WEIGHTS: RulesetWeights = {
  eta: 0,
  distance: 0,
  zoneProximity: 40,
  completion: 20,
  rating: 0,
  acceptance: 20,
  fairness: 20,
};

/**
 * Version 1 exactly as seeded by schema.sql.
 *
 * `createdAt`/`frozenAt` are left as the epoch sentinel because the seeded row
 * gets its real timestamps from `now()` in the database; the domain copy exists
 * so the pure core can rank with no storage at all (MR 2/6), and MR 3/6 will
 * read the real row. The numbers — the only part that changes a ranking — are
 * identical, and that is what the drift guard checks.
 */
export const RULESET_V1: Ruleset = {
  version: RULESET_V1_VERSION,
  label: "phase07-mvp-zone-and-fairness",
  weights: RULESET_V1_WEIGHTS,
  candidacyFreshnessSeconds: 120,
  maxCandidates: 20,
  fairnessHorizonSeconds: 3600,
  isFrozen: true,
  createdAt: "1970-01-01T00:00:00.000Z",
  frozenAt: "1970-01-01T00:00:00.000Z",
};

/** The seeded catalogue the in-memory ruleset store starts from. */
export const SEEDED_RULESETS: readonly Ruleset[] = [RULESET_V1];

export function weightsSum(weights: RulesetWeights): number {
  return (
    weights.eta +
    weights.distance +
    weights.zoneProximity +
    weights.completion +
    weights.rating +
    weights.acceptance +
    weights.fairness
  );
}

/**
 * The two conditions a ruleset must satisfy before it may order drivers:
 * frozen, and summing to 100. Both are also constraints in the database — a
 * guard worth having twice, because one of the two failures silently reorders
 * every driver in the country.
 */
export function assertRankable(ruleset: Ruleset | null, requestedVersion: number, traceId?: string): Ruleset {
  if (ruleset === null) {
    throw rulesetNotFound(requestedVersion, traceId);
  }
  const sum = weightsSum(ruleset.weights);
  if (sum !== WEIGHTS_SUM) {
    throw rulesetWeightsInvalid(ruleset.version, sum, traceId);
  }
  if (!ruleset.isFrozen) {
    throw rulesetNotFrozen(ruleset.version, traceId);
  }
  return ruleset;
}
