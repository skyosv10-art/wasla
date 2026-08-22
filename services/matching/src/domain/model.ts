/**
 * Matching domain model (Phase 07 · MR 2/6).
 *
 * In-service shapes: camelCase, no transport concerns, no SQL concerns. They
 * mirror the published contracts one-to-one in meaning:
 *  - the API DTOs live in @wasla/contracts-matching (generated from OpenAPI),
 *  - the storage columns live in services/matching/contracts/schema.sql,
 *  - `../mappers.ts` translates between the three.
 *
 * Boundary reminders (ADR-011):
 *  - nothing here knows an offer, a wave or a deadline. Those belong to
 *    `services/dispatch`; matching answers "who fits, and in which order?" as a
 *    function over data (decision 1).
 *  - `driverPublicId` is opaque: no name, no phone, no document, no vehicle
 *    description, no coordinates. Zones are ids in a hierarchy (ADR-006).
 *  - eligibility is CLAIMED, not verified, until Phase 05 — which is why
 *    `eligibilitySource` travels with every row (decision 2).
 */

import type {
  MatchingAvailabilityReasonCode,
  MatchingEmptyReasonCode,
} from "@wasla/contracts-matching";

export type { MatchingAvailabilityReasonCode, MatchingEmptyReasonCode };

/** Score scale: integer basis points out of ten thousand, never a float. */
export const BP_SCALE = 10_000;

export const AVAILABILITY_STATES = ["available", "busy", "offline"] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

export const ELIGIBILITY_STATES = ["eligible", "ineligible", "suspended", "unknown"] as const;
export type EligibilityState = (typeof ELIGIBILITY_STATES)[number];

export const ELIGIBILITY_SOURCES = ["claimed", "driver_core"] as const;
export type EligibilitySource = (typeof ELIGIBILITY_SOURCES)[number];

export const SERVICE_KINDS = ["ride", "delivery"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

/** Closed list, character-for-character identical to the order contract (ADR-009 §7). */
export const VEHICLE_CLASSES = [
  "sedan",
  "suv",
  "van",
  "pickup",
  "motorcycle",
  "truck_small",
] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

/** Who performed the operation — an actor code, never a user id or a chat id. */
export const MATCHING_ACTOR_TYPES = ["driver_bot", "admin", "driver_core", "dispatch", "test"] as const;
export type MatchingActorType = (typeof MATCHING_ACTOR_TYPES)[number];

/** `updated_by` values allowed by schema.sql (`unknown` is the stored default). */
export const CANDIDACY_WRITERS = ["driver_bot", "admin", "driver_core", "test", "unknown"] as const;
export type CandidacyWriter = (typeof CANDIDACY_WRITERS)[number];

export const TIEBREAK_REASONS = ["score", "last_offered_at", "driver_public_id"] as const;
export type TiebreakReason = (typeof TIEBREAK_REASONS)[number];

/** `^WS-[0-9]{10}$` — mirrors the CHECK on `driver_candidacy.driver_public_id`. */
export const DRIVER_PUBLIC_ID_PATTERN = /^WS-[0-9]{10}$/;
/** `^ORD-[0-9]{10}$` — mirrors the CHECK on `matching_decisions.order_public_id`. */
export const ORDER_PUBLIC_ID_PATTERN = /^ORD-[0-9]{10}$/;

/**
 * The candidacy projection: one row per driver, keyed by the public id.
 *
 * A projection, not a profile: it carries only what the hard filters and the
 * ranking need. Anything richer waits for Phase 05 instead of leaking a driver
 * profile into this service through the back door.
 */
export interface Candidacy {
  readonly driverPublicId: string;
  readonly availabilityState: AvailabilityState;
  readonly eligibilityState: EligibilityState;
  readonly eligibilitySource: EligibilitySource;
  readonly serviceKinds: readonly ServiceKind[];
  readonly vehicleClass: VehicleClass | null;
  readonly zoneIds: readonly string[];
  readonly lastOfferedAt: string | null;
  readonly lastAssignedAt: string | null;
  readonly offersReceived: number;
  readonly offersAccepted: number;
  readonly ordersCompleted: number;
  readonly updatedAt: string;
  readonly createdAt: string;
  readonly updatedBy: CandidacyWriter;
}

/** Integer percentage points; the seven of them sum to exactly 100. */
export interface RulesetWeights {
  readonly eta: number;
  readonly distance: number;
  readonly zoneProximity: number;
  readonly completion: number;
  readonly rating: number;
  readonly acceptance: number;
  readonly fairness: number;
}

/**
 * A numbered, freezable ruleset. Weights are data, not code (decision 6):
 * changing the ordering means a new version, so yesterday's decision stays
 * explainable by yesterday's rules.
 */
export interface Ruleset {
  readonly version: number;
  readonly label: string;
  readonly weights: RulesetWeights;
  readonly candidacyFreshnessSeconds: number;
  readonly maxCandidates: number;
  readonly fairnessHorizonSeconds: number;
  readonly isFrozen: boolean;
  readonly createdAt: string;
  readonly frozenAt: string | null;
}

/**
 * The zone hierarchy path of one zone (ADR-006).
 *
 * Proximity is computed from the deepest shared ancestor, so the ranking needs
 * the whole path — not a distance, which the system does not have and must not
 * pretend to have.
 */
export interface ZoneLineage {
  readonly zoneId: string;
  readonly districtId: string;
  readonly cityId: string;
  readonly regionId: string;
  readonly countryId: string;
}

/** The four live score inputs of ruleset version 1, each in basis points. */
export interface ScoreComponents {
  readonly zoneProximityBp: number;
  readonly completionBp: number;
  readonly acceptanceBp: number;
  readonly fairnessBp: number;
}

/** One ranked candidate: position, opaque id, integer score, and how it was placed. */
export interface RankedCandidate {
  readonly rank: number;
  readonly driverPublicId: string;
  readonly scoreBp: number;
  readonly components: ScoreComponents;
  readonly tiebreakBy: TiebreakReason;
}

/** The three counts that explain an empty result without guessing. */
export interface MatchingCounts {
  readonly considered: number;
  readonly eligible: number;
  readonly returned: number;
  readonly excluded: number;
}

/** The facts of an order that enter the hard filters. No user-written text ever. */
export interface CandidateQueryFacts {
  readonly orderId: string;
  readonly orderPublicId: string;
  readonly orderType: ServiceKind;
  readonly vehicleClass: VehicleClass;
  readonly pickupZoneId: string;
  readonly excludedDriverIds: readonly string[];
  readonly dispatchJobId: string | null;
}

/**
 * The audit row that answers "why this driver, and not that one?" a month later.
 *
 * Competitively sensitive (decision 8): candidate ids and scores live here and
 * never enter an event payload or a public response.
 */
export interface MatchingDecision {
  readonly id: string;
  readonly orderId: string;
  readonly orderPublicId: string;
  readonly dispatchJobId: string | null;
  readonly rulesetVersion: number;
  readonly requestedAt: string;
  readonly evaluatedAt: string;
  readonly orderType: ServiceKind;
  readonly vehicleClass: VehicleClass;
  readonly pickupZoneId: string;
  readonly counts: MatchingCounts;
  readonly emptyReasonCode: MatchingEmptyReasonCode | null;
  readonly candidates: readonly RankedCandidate[];
  readonly createdAt: string;
}

/** A candidacy row as the reader needs it: freshness is computed, never stored. */
export interface CandidacyView extends Candidacy {
  readonly isFresh: boolean;
}
