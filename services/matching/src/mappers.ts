/**
 * Domain ⇄ contract translation.
 *
 * One place, on purpose: the wire is snake_case and the domain is camelCase, and
 * scattering that conversion across a service is how a field silently stops being
 * serialised. The return types come from @wasla/contracts-matching, which is
 * generated from the OpenAPI document — so a contract change breaks a compile
 * here instead of a consumer in production.
 *
 * The privacy boundary is enforced by which mapper exists: `toCandidateResult`
 * (the dispatch-facing path) and `toDecision` (the audit path) both carry scores,
 * and NOTHING here maps a candidate into an event payload (ADR-011 decision 8).
 */

import type {
  Candidacy as CandidacyWire,
  CandidateResult,
  Decision as DecisionWire,
  RankedCandidate as RankedCandidateWire,
  Ruleset as RulesetWire,
} from "@wasla/contracts-matching";

import type {
  CandidacyView,
  MatchingDecision,
  RankedCandidate,
  Ruleset,
} from "./domain/model.js";
import type { EvaluateCandidatesResult } from "./use-cases/evaluate-candidates.js";

export function toRankedCandidate(candidate: RankedCandidate): RankedCandidateWire {
  return {
    rank: candidate.rank,
    driver_public_id: candidate.driverPublicId,
    score_bp: candidate.scoreBp,
    components: {
      zone_proximity_bp: candidate.components.zoneProximityBp,
      completion_bp: candidate.components.completionBp,
      acceptance_bp: candidate.components.acceptanceBp,
      fairness_bp: candidate.components.fairnessBp,
    },
    tiebreak_by: candidate.tiebreakBy,
  };
}

export function toCandidateResult(result: EvaluateCandidatesResult): CandidateResult {
  return {
    decision_id: result.decisionId,
    ruleset_version: result.rulesetVersion,
    evaluated_at: result.evaluatedAt,
    candidates: result.candidates.map(toRankedCandidate),
    counts: {
      considered: result.counts.considered,
      eligible: result.counts.eligible,
      returned: result.counts.returned,
    },
    // Present exactly when the list is empty — the contract requires the reason then.
    ...(result.emptyReasonCode === null ? {} : { empty_reason_code: result.emptyReasonCode }),
  };
}

export function toCandidacy(view: CandidacyView): CandidacyWire {
  return {
    driver_public_id: view.driverPublicId,
    availability_state: view.availabilityState,
    eligibility_state: view.eligibilityState,
    eligibility_source: view.eligibilitySource,
    service_kinds: [...view.serviceKinds],
    vehicle_class: view.vehicleClass,
    zone_ids: [...view.zoneIds],
    last_offered_at: view.lastOfferedAt,
    last_assigned_at: view.lastAssignedAt,
    offers_received: view.offersReceived,
    offers_accepted: view.offersAccepted,
    orders_completed: view.ordersCompleted,
    is_fresh: view.isFresh,
    updated_at: view.updatedAt,
    updated_by: view.updatedBy,
  };
}

export function toRuleset(ruleset: Ruleset): RulesetWire {
  return {
    version: ruleset.version,
    label: ruleset.label,
    weights: {
      eta: ruleset.weights.eta,
      distance: ruleset.weights.distance,
      zone_proximity: ruleset.weights.zoneProximity,
      completion: ruleset.weights.completion,
      rating: ruleset.weights.rating,
      acceptance: ruleset.weights.acceptance,
      fairness: ruleset.weights.fairness,
    },
    candidacy_freshness_seconds: ruleset.candidacyFreshnessSeconds,
    max_candidates: ruleset.maxCandidates,
    fairness_horizon_seconds: ruleset.fairnessHorizonSeconds,
    is_frozen: ruleset.isFrozen,
    created_at: ruleset.createdAt,
  };
}

/** The audit view: the only response shape that carries both ids and scores. */
export function toDecision(decision: MatchingDecision): DecisionWire {
  return {
    decision_id: decision.id,
    order_id: decision.orderId,
    order_public_id: decision.orderPublicId,
    dispatch_job_id: decision.dispatchJobId,
    ruleset_version: decision.rulesetVersion,
    requested_at: decision.requestedAt,
    evaluated_at: decision.evaluatedAt,
    counts: {
      considered: decision.counts.considered,
      eligible: decision.counts.eligible,
      returned: decision.counts.returned,
      excluded: decision.counts.excluded,
    },
    empty_reason_code: decision.emptyReasonCode,
    candidates: decision.candidates.map(toRankedCandidate),
  };
}
