/**
 * Matching Domain Event types — hand-derived from
 * services/matching/contracts/events.json (JSON Schema 2020-12).
 *
 * Drift guards read the canonical schema at test time. ADR-011 decision 8 keeps
 * candidate ids and scores in the audit store, never in an event payload.
 */
export type MatchingAggregateType = "driver_candidacy" | "matching_decision";
export type MatchingActorType = "driver_bot" | "admin" | "driver_core" | "dispatch" | "test";
export type AvailabilityState = "available" | "busy" | "offline";
export type EligibilityState = "eligible" | "ineligible" | "suspended" | "unknown";
export type MatchingReasonCode = string;

export interface MatchingEventEnvelope {
  event_id: string;
  event_type: string;
  event_version: string;
  occurred_at: string;
  producer: "matching-service";
  aggregate: { type: MatchingAggregateType; id: string };
  trace_id?: string | null;
}

export interface DriverCandidacyUpdatedV1 extends MatchingEventEnvelope {
  event_type: "matching.candidacy_updated";
  event_version: "v1";
  data: {
    driver_public_id: string;
    availability_state: AvailabilityState;
    eligibility_state: EligibilityState;
    eligibility_source: "claimed" | "driver_core";
    service_kinds: Array<"ride" | "delivery">;
    vehicle_class?: string | null;
    zone_ids: string[];
    updated_by?: MatchingActorType;
    updated_at: string;
  };
}

export interface DriverAvailabilityChangedV1 extends MatchingEventEnvelope {
  event_type: "matching.availability_changed";
  event_version: "v1";
  data: {
    driver_public_id: string;
    from_state: AvailabilityState;
    to_state: AvailabilityState;
    actor_type?: MatchingActorType;
    reason_code?: MatchingReasonCode;
    changed_at: string;
  };
}

/** Evaluation evidence is aggregate-only: candidate ids and scores never leave matching. */
export interface MatchingEvaluatedV1 extends MatchingEventEnvelope {
  event_type: "matching.evaluated";
  event_version: "v1";
  data: {
    decision_id: string;
    order_public_id: string;
    pickup_zone_id?: string;
    ruleset_version: number;
    counts: { considered: number; eligible: number; returned: number; excluded?: number };
    empty_reason_code?: MatchingReasonCode | null;
    evaluated_at: string;
  };
}

export type MatchingDomainEvent =
  | DriverCandidacyUpdatedV1
  | DriverAvailabilityChangedV1
  | MatchingEvaluatedV1;

export const MATCHING_EVENT_TYPES = {
  DRIVER_CANDIDACY_UPDATED: "matching.candidacy_updated",
  DRIVER_AVAILABILITY_CHANGED: "matching.availability_changed",
  MATCHING_EVALUATED: "matching.evaluated",
} as const;

export type MatchingEventType = (typeof MATCHING_EVENT_TYPES)[keyof typeof MATCHING_EVENT_TYPES];
