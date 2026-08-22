/**
 * Read the eligibility, and run the expiry tick.
 *
 * Both are the same operation seen from two sides: a recomputation. One is asked for
 * by a caller about one driver; the other is asked for by TIME about everyone whose
 * turn has come.
 */

import type { EligibilityState } from "../domain/model.js";
import { expiryInstant, unknownEligibility } from "../domain/eligibility.js";
import type { EligibilityDecision } from "../domain/eligibility.js";
import { LAUNCH_POLICY_VERSION } from "../domain/policy.js";
import type { DriverDependencies } from "../ports.js";
import { recomputeEligibility } from "./recompute-eligibility.js";

export interface EligibilityReadResult {
  readonly decision: EligibilityDecision;
  readonly changed: boolean;
  readonly previousState: EligibilityState | null;
}

/**
 * `GET /drivers/{id}/eligibility` — a read that RECOMPUTES.
 *
 * Yes, a read with a side effect, and deliberately: the alternative is a read that
 * discovers the verdict has changed and says nothing, leaving the log to claim the
 * driver is still eligible while the answer just handed to a caller says otherwise.
 * The side effect is bounded and idempotent — a log row and an event appear only if
 * the verdict actually moved, so repeated reads of an unchanged driver write nothing.
 *
 * A missing profile returns `unknown` and writes nothing. Fail-closed: `unknown` is
 * "we do not know, so nothing is offered to him", not "not checked yet, give him a
 * chance".
 */
export async function readEligibility(
  deps: DriverDependencies,
  waslaPublicId: string,
  traceId: string | null = null,
): Promise<EligibilityReadResult> {
  const profile = await deps.profiles.find(waslaPublicId);
  if (profile === null) {
    return {
      decision: unknownEligibility(LAUNCH_POLICY_VERSION, deps.clock.now()),
      changed: false,
      previousState: null,
    };
  }
  const result = await recomputeEligibility(deps, waslaPublicId, { trigger: "recompute", traceId });
  return { decision: result.decision, changed: result.changed, previousState: result.previousState };
}

export interface TickResult {
  readonly recheckedDrivers: number;
  readonly changedDrivers: number;
  readonly published: number;
  readonly publishFailures: number;
}

/** A ceiling, so one sweep can never become an unbounded scan of the whole table. */
export const DEFAULT_TICK_LIMIT = 500;

/**
 * The expiry tick: **a pulse, not a timer** (ADR-012 decision 5 · precedent ADR-011).
 *
 * This service starts no `setInterval` and owns no scheduler. Something outside calls
 * this — a cron, an operator, a test — and the reason is restartability: a timer
 * living inside a process loses every pending expiry when the process dies, and
 * nobody notices until a driver with an expired licence takes a passenger. The
 * durable part is `eligibility_recheck_at` in the database; the caller is replaceable.
 *
 * Wiring the periodic caller is Phase 09, and until then this is reachable through
 * `POST /drivers/eligibility/tick` (MR 5/6). That debt is recorded, not hidden.
 *
 * `occurredFor` is the EXPIRY instant and not `now`: a tick that runs six hours late
 * must not report that the licence expired six hours late. The audit of an expiry is
 * the one place that distinction has to survive.
 */
export async function runExpiryTick(
  deps: DriverDependencies,
  limit: number = DEFAULT_TICK_LIMIT,
): Promise<TickResult> {
  const now = deps.clock.now();
  const due = await deps.profiles.listDueForRecheck(now, limit);

  let changedDrivers = 0;
  let published = 0;
  let publishFailures = 0;

  for (const profile of due) {
    // The instant this driver's recheck came due — his own expiry moment, which is
    // what the event is effective for.
    const occurredFor = profile.eligibilityRecheckAt ?? now;
    const result = await recomputeEligibility(deps, profile.waslaPublicId, {
      trigger: "expiry_tick",
      occurredFor,
    });
    if (result.changed) changedDrivers += 1;
    if (result.publication !== null) {
      if (result.publication.outcome === "published") published += 1;
      else publishFailures += 1;
    }

    // A driver whose recheck came due and whose verdict did NOT change still has to
    // stop being due, or the next tick picks him up again forever. `recomputeEligibility`
    // recomputes the index from the documents, so this only needs to catch the case
    // where the index did not move on its own.
    const after = await deps.profiles.find(profile.waslaPublicId);
    if (after !== null && after.eligibilityRecheckAt !== null && after.eligibilityRecheckAt <= now) {
      await deps.profiles.setRecheckAt(profile.waslaPublicId, null, now);
    }
  }

  return {
    recheckedDrivers: due.length,
    changedDrivers,
    published,
    publishFailures,
  };
}

/**
 * The earliest expiry among a driver's verified documents, as a plain date.
 *
 * Exposed for the operations read path (MR 5/6) so a support agent can answer "when
 * does his licence run out?" without recomputing an eligibility verdict — a question
 * that must not have a side effect.
 */
export function earliestExpiry(expiryDates: readonly (string | null)[]): string | null {
  const dates = expiryDates.filter((date): date is string => date !== null);
  if (dates.length === 0) return null;
  return dates.reduce((earliest, date) => (expiryInstant(date) < expiryInstant(earliest) ? date : earliest));
}
