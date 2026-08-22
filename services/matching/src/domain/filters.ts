/**
 * The eight hard filters — applied in a deliberate order (MATCHING_DISPATCH §4).
 *
 * Two decisions are encoded here and nowhere else:
 *
 *  1. **The FIRST cause that stopped the path is reported, not the last.** The
 *     operator needs to know where the deficit began: "nobody is available" and
 *     "everybody available is stale" send two different people to two different
 *     places. Reporting the last surviving filter would blame geography for an
 *     activation problem.
 *  2. **The unknown is not a candidate (fail-closed).** No row, a non-`eligible`
 *     row, or a row older than the freshness window all remove the driver before
 *     any arithmetic. "Available two hours ago" is not availability information,
 *     and being generous here spends a real deadline on a sleeping driver while a
 *     customer waits for no reason.
 *
 * The stage table below is the single source of the order and of the deficit
 * codes; the loop walks it. Adding a filter without a code is impossible by
 * construction, and a code outside the catalogue fails the contract guard.
 */

import type { MatchingEmptyReasonCode } from "@wasla/contracts-matching";

import type { Candidacy, ServiceKind, VehicleClass } from "./model.js";

/** One stage: its ordinal, its name, and the code it reports when it empties the set. */
export interface HardFilterStage {
  readonly step: number;
  readonly name: string;
  readonly emptyReasonCode: MatchingEmptyReasonCode;
}

export const HARD_FILTER_STAGES: readonly HardFilterStage[] = [
  { step: 1, name: "candidacy_rows_exist", emptyReasonCode: "NO_CANDIDACY_ROWS" },
  { step: 2, name: "availability_available", emptyReasonCode: "NO_AVAILABLE_DRIVERS" },
  { step: 3, name: "eligibility_eligible", emptyReasonCode: "NO_ELIGIBLE_DRIVERS" },
  { step: 4, name: "candidacy_fresh", emptyReasonCode: "NO_FRESH_CANDIDACY" },
  { step: 5, name: "service_kind_accepted", emptyReasonCode: "NO_SERVICE_MATCH" },
  { step: 6, name: "vehicle_class_matches", emptyReasonCode: "NO_VEHICLE_MATCH" },
  { step: 7, name: "zone_served_by_hierarchy", emptyReasonCode: "NO_ZONE_MATCH" },
  { step: 8, name: "not_excluded_by_caller", emptyReasonCode: "ALL_CANDIDATES_EXCLUDED" },
];

/** What the filters need to know about the order and the ruleset parameters. */
export interface HardFilterRequest {
  readonly orderType: ServiceKind;
  readonly vehicleClass: VehicleClass;
  readonly excludedDriverIds: readonly string[];
  /** The explicit evaluation clock — never `now()` inside the filter. */
  readonly evaluatedAt: string;
  readonly candidacyFreshnessSeconds: number;
  /**
   * Whether this candidacy serves the pickup zone, by hierarchy not by equality.
   *
   * Injected rather than computed here: resolving a zone path is a port call
   * (geography, ADR-006), and the filter must stay a pure function over data.
   */
  readonly servesPickupZone: (candidacy: Candidacy) => boolean;
}

export interface HardFilterOutcome {
  /** Rows that passed all eight stages, in input order (ranking sorts later). */
  readonly survivors: readonly Candidacy[];
  /** Rows examined. */
  readonly consideredCount: number;
  /** Rows that passed all eight stages. */
  readonly eligibleCount: number;
  /** Rows removed by stage 8 specifically — the caller's exclusion list. */
  readonly excludedCount: number;
  /** The first stage that emptied the set, or `null` when survivors remain. */
  readonly emptyReasonCode: MatchingEmptyReasonCode | null;
  /** Survivor count after each stage, keyed by stage name — for tests and audit. */
  readonly stageSurvivors: Readonly<Record<string, number>>;
}

/**
 * `updated_at` is inside the freshness window relative to the evaluation clock.
 *
 * A row stamped in the future is treated as fresh: clock skew between a bot and
 * the service is an operations problem, and dropping a driver for it would make
 * a skewed clock look like an empty city.
 */
export function isFresh(
  candidacy: Candidacy,
  evaluatedAt: string,
  candidacyFreshnessSeconds: number,
): boolean {
  const evaluated = Date.parse(evaluatedAt);
  const updated = Date.parse(candidacy.updatedAt);
  if (Number.isNaN(evaluated) || Number.isNaN(updated)) return false;
  const ageMs = evaluated - updated;
  if (ageMs <= 0) return true;
  return ageMs <= candidacyFreshnessSeconds * 1000;
}

/** Apply the eight stages in order and report the first cause of an empty set. */
export function applyHardFilters(
  rows: readonly Candidacy[],
  request: HardFilterRequest,
): HardFilterOutcome {
  const excluded = new Set(request.excludedDriverIds);
  const stageSurvivors: Record<string, number> = {};

  const predicates: readonly ((candidacy: Candidacy) => boolean)[] = [
    () => true, // stage 1 is about the set being non-empty, not about a row
    (candidacy) => candidacy.availabilityState === "available",
    (candidacy) => candidacy.eligibilityState === "eligible",
    (candidacy) => isFresh(candidacy, request.evaluatedAt, request.candidacyFreshnessSeconds),
    (candidacy) => candidacy.serviceKinds.includes(request.orderType),
    (candidacy) => candidacy.vehicleClass === request.vehicleClass,
    (candidacy) => request.servesPickupZone(candidacy),
    (candidacy) => !excluded.has(candidacy.driverPublicId),
  ];

  let current: readonly Candidacy[] = rows;
  let emptyReasonCode: MatchingEmptyReasonCode | null = null;
  let excludedCount = 0;

  for (let index = 0; index < HARD_FILTER_STAGES.length; index += 1) {
    const stage = HARD_FILTER_STAGES[index]!;
    const predicate = predicates[index]!;
    const before = current.length;
    current = current.filter(predicate);
    if (stage.step === 8) excludedCount = before - current.length;
    stageSurvivors[stage.name] = current.length;
    if (current.length === 0) {
      emptyReasonCode = stage.emptyReasonCode;
      // The first cause wins: later stages cannot fail a set that is already empty.
      for (let rest = index + 1; rest < HARD_FILTER_STAGES.length; rest += 1) {
        stageSurvivors[HARD_FILTER_STAGES[rest]!.name] = 0;
      }
      break;
    }
  }

  return {
    survivors: current,
    consideredCount: rows.length,
    eligibleCount: current.length,
    excludedCount,
    emptyReasonCode,
    stageSurvivors,
  };
}
