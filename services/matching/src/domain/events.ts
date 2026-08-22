/**
 * Event factories for the three matching events (contracts/events.json).
 *
 * One privacy rule governs this whole file (ADR-011 decision 8): **an evaluation
 * event carries counts, never candidate ids and never scores.** Candidate lists
 * and their scores are competitively sensitive information about drivers; they
 * live in the audit store, reachable through an operations path, and they never
 * cross a service boundary in a payload that a broker will fan out.
 *
 * A drift-guard test in @wasla/contracts-matching reads events.json from disk and
 * fails if any payload here grows a field the contract does not declare.
 */

import type {
  DriverAvailabilityChangedV1,
  DriverCandidacyUpdatedV1,
  MatchingDomainEvent,
  MatchingEvaluatedV1,
} from "@wasla/contracts-matching";
import { MATCHING_EVENT_TYPES } from "@wasla/contracts-matching";

import type {
  AvailabilityState,
  Candidacy,
  MatchingActorType,
  MatchingAvailabilityReasonCode,
  MatchingDecision,
} from "./model.js";

export type { MatchingDomainEvent };

interface EnvelopeInput {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly traceId: string | null;
}

/** The candidacy row as it stands after a full replacement (PUT). */
export function driverCandidacyUpdated(
  candidacy: Candidacy,
  envelope: EnvelopeInput,
): DriverCandidacyUpdatedV1 {
  return {
    event_id: envelope.eventId,
    event_type: MATCHING_EVENT_TYPES.DRIVER_CANDIDACY_UPDATED,
    event_version: "v1",
    occurred_at: envelope.occurredAt,
    producer: "matching-service",
    aggregate: { type: "driver_candidacy", id: candidacy.driverPublicId },
    trace_id: envelope.traceId,
    data: {
      driver_public_id: candidacy.driverPublicId,
      availability_state: candidacy.availabilityState,
      eligibility_state: candidacy.eligibilityState,
      eligibility_source: candidacy.eligibilitySource,
      service_kinds: [...candidacy.serviceKinds],
      vehicle_class: candidacy.vehicleClass,
      zone_ids: [...candidacy.zoneIds],
      updated_by: candidacy.updatedBy === "unknown" ? undefined : candidacy.updatedBy,
      updated_at: candidacy.updatedAt,
    },
  };
}

/**
 * The most frequent event in the system (§78 "Busy/free transitions").
 *
 * It carries both states because a consumer that only learns the new state
 * cannot tell a real change from a repeated declaration — and a driver bot that
 * cannot tell the difference will show its owner a status that flickers.
 */
export function driverAvailabilityChanged(
  input: {
    readonly driverPublicId: string;
    readonly fromState: AvailabilityState;
    readonly toState: AvailabilityState;
    readonly actorType: MatchingActorType | null;
    readonly reasonCode: MatchingAvailabilityReasonCode | null;
    readonly changedAt: string;
  },
  envelope: EnvelopeInput,
): DriverAvailabilityChangedV1 {
  return {
    event_id: envelope.eventId,
    event_type: MATCHING_EVENT_TYPES.DRIVER_AVAILABILITY_CHANGED,
    event_version: "v1",
    occurred_at: envelope.occurredAt,
    producer: "matching-service",
    aggregate: { type: "driver_candidacy", id: input.driverPublicId },
    trace_id: envelope.traceId,
    data: {
      driver_public_id: input.driverPublicId,
      from_state: input.fromState,
      to_state: input.toState,
      actor_type: input.actorType ?? undefined,
      reason_code: input.reasonCode ?? undefined,
      changed_at: input.changedAt,
    },
  };
}

/**
 * Aggregate-only evidence that an evaluation happened.
 *
 * Note what is absent and must stay absent: no `candidates`, no `score_bp`, no
 * `driver_public_id`. Whoever needs those reads the decision through the audit
 * path with the decision id this event does carry.
 */
export function matchingEvaluated(
  decision: MatchingDecision,
  envelope: EnvelopeInput,
): MatchingEvaluatedV1 {
  return {
    event_id: envelope.eventId,
    event_type: MATCHING_EVENT_TYPES.MATCHING_EVALUATED,
    event_version: "v1",
    occurred_at: envelope.occurredAt,
    producer: "matching-service",
    aggregate: { type: "matching_decision", id: decision.id },
    trace_id: envelope.traceId,
    data: {
      decision_id: decision.id,
      order_public_id: decision.orderPublicId,
      pickup_zone_id: decision.pickupZoneId,
      ruleset_version: decision.rulesetVersion,
      counts: {
        considered: decision.counts.considered,
        eligible: decision.counts.eligible,
        returned: decision.counts.returned,
        excluded: decision.counts.excluded,
      },
      empty_reason_code: decision.emptyReasonCode,
      evaluated_at: decision.evaluatedAt,
    },
  };
}
