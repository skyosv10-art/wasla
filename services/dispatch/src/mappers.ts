/**
 * Domain ⇄ contract translation.
 *
 * The domain speaks camelCase and the API speaks snake_case, and the boundary is
 * explicit rather than a generic key-transform helper. A generic transformer would
 * happily forward a field the contract never declared — which is how
 * `payload_fingerprint` and `created_idempotency_key` would end up in a public
 * response, both of them internal bookkeeping that tells a caller nothing and hands an
 * attacker a way to probe our idempotency keys.
 *
 * `TickResult` is mapped down to exactly the five contract fields: the domain also
 * counts deferred jobs, which is operational truth for our own logs and not part of
 * anyone's API.
 */
import type {
  DispatchJob as ApiDispatchJob,
  DispatchOffer as ApiDispatchOffer,
  DispatchOfferList as ApiDispatchOfferList,
  DispatchRulesSnapshot as ApiDispatchRules,
  TickResult as ApiTickResult,
} from "@wasla/contracts-dispatch";

import type { DispatchJob, DispatchOffer, DispatchRules } from "./domain/model.js";
import type { TickOutcome } from "./use-cases/tick.js";

export function toApiRules(rules: DispatchRules): ApiDispatchRules {
  return {
    ruleset_version: rules.rulesetVersion,
    wave_size: rules.waveSize,
    offer_timeout_seconds: rules.offerTimeoutSeconds,
    max_waves: rules.maxWaves,
    escalation_timeout_seconds: rules.escalationTimeoutSeconds,
  };
}

export function toApiJob(job: DispatchJob): ApiDispatchJob {
  return {
    id: job.id,
    order_id: job.orderId,
    order_public_id: job.orderPublicId,
    zone_id: job.zoneId,
    order_type: job.orderType,
    vehicle_class: job.vehicleClass,
    status: job.status,
    status_reason_code: job.statusReasonCode,
    rules: toApiRules(job.rules),
    expires_at: job.expiresAt,
    escalation_expires_at: job.escalationExpiresAt,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}

export function toApiOffer(offer: DispatchOffer): ApiDispatchOffer {
  return {
    id: offer.id,
    job_id: offer.jobId,
    wave_id: offer.waveId,
    driver_public_id: offer.driverPublicId,
    status: offer.status,
    reason_code: offer.reasonCode,
    offered_at: offer.offeredAt,
    expires_at: offer.expiresAt,
    responded_at: offer.respondedAt,
    resolved_at: offer.resolvedAt,
    created_at: offer.createdAt,
  };
}

export function toApiOfferList(offers: readonly DispatchOffer[]): ApiDispatchOfferList {
  return { items: offers.map(toApiOffer) };
}

export function toApiTickResult(outcome: TickOutcome): ApiTickResult {
  return {
    tick_at: outcome.tickAt,
    timed_out_offers: outcome.timedOutOffers,
    opened_waves: outcome.openedWaves,
    escalated_jobs: outcome.escalatedJobs,
    exhausted_jobs: outcome.exhaustedJobs,
  };
}
