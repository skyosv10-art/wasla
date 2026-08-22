/**
 * All time arithmetic in one place.
 *
 * Deadlines are **stored**, not scheduled. Nothing in this service holds a timer:
 * every job, wave and offer carries the instant it becomes due, computed once from
 * an injected clock, and a tick compares those stored instants to the clock it was
 * given. That is the whole reason a restart, a redeploy or a paused container
 * cannot lose a timeout — there is nothing in memory to lose.
 *
 * Rejected alternative: `setTimeout` per offer. It is shorter to write and it
 * loses every pending timeout on restart, silently, at the exact moment a
 * deployment is most likely to be happening.
 */
import type { DispatchRules } from "./model.js";

export interface JobDeadlines {
  readonly expiresAt: string;
  readonly escalationExpiresAt: string;
}

/** Add whole seconds to an instant, returning canonical UTC ISO-8601. */
export function addSeconds(instant: string, seconds: number): string {
  return new Date(Date.parse(instant) + seconds * 1000).toISOString();
}

/**
 * The two stored job deadlines.
 *
 * `expiresAt` is the end of the automatic window: the whole wave budget, i.e.
 * `maxWaves × offerTimeoutSeconds` from creation. It is a ceiling, not a
 * prediction — if ticks are delayed, the job escalates to the community at this
 * instant instead of quietly starting a fresh wave long after the customer
 * stopped watching.
 *
 * `escalationExpiresAt` is that ceiling plus the escalation budget, which
 * satisfies `ck_dispatch_jobs_deadline_order` (`escalation >= expires`) by
 * construction rather than by hoping a caller passes ordered values.
 */
export function computeJobDeadlines(createdAt: string, rules: DispatchRules): JobDeadlines {
  const expiresAt = addSeconds(createdAt, rules.maxWaves * rules.offerTimeoutSeconds);
  return {
    expiresAt,
    escalationExpiresAt: addSeconds(expiresAt, rules.escalationTimeoutSeconds),
  };
}

/**
 * An offer's deadline, from the job's frozen snapshot.
 *
 * Taken from the snapshot rather than from live configuration so that changing the
 * timeout mid-flight cannot move a deadline a driver is already counting down
 * against.
 */
export function computeOfferDeadline(offeredAt: string, rules: DispatchRules): string {
  return addSeconds(offeredAt, rules.offerTimeoutSeconds);
}

/**
 * Has a stored deadline arrived?
 *
 * `now >= deadline`, inclusive: a deadline that has exactly arrived has arrived.
 * The strict form would leave an offer alive for one more whole tick interval at
 * the boundary, which is a real difference to a driver watching a countdown reach
 * zero. Both sides of the boundary are tested.
 */
export function isDue(deadline: string, now: string): boolean {
  return Date.parse(now) >= Date.parse(deadline);
}
