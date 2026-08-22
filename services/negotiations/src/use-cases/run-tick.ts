/**
 * `POST /negotiations/tick` — the sweep that makes time a real actor.
 *
 * ## Why a tick and not a background timer (ADR-013 decision 5)
 *
 * A timer inside the process is invisible: it cannot be replayed, it cannot be tested
 * without waiting, and it does different work depending on which instance happened to
 * be alive. A tick is an ordinary authenticated request with a counted result, so
 * «what did time do to our negotiations» has an answer with numbers in it — and the
 * whole suite drives it with a clock it moves by hand instead of with `sleep`.
 *
 * ## Idempotent by construction
 *
 * Every step is «find what is due, settle it». Running the tick twice in a row does the
 * work once and reports zeroes the second time. That is what allows a scheduler to
 * retry without coordination, and it is asserted in the tests rather than assumed.
 *
 * ## Order matters
 *
 * Rounds expire → threads expire → budget-spent threads close → hand-offs retry.
 * Rounds first, because a thread whose last round has just lapsed may then be closable
 * for a spent budget in the same tick; hand-offs last, because they are the only step
 * that talks to another service and must not be able to starve the local sweeps by
 * being slow.
 *
 * ## A failed hand-off is counted, never thrown
 *
 * `attemptPriceHandoff` does not throw for a hand-off failure, and this loop does not
 * abandon the sweep because one order engine call failed. `handoff_failures` in the
 * result is the visible number (ADR-013 decision 2).
 */

import { dueMomentFor } from "../domain/expiry.js";
import type { NegotiationTickResult } from "../domain/model.js";
import { requireUsablePolicy } from "../domain/policy.js";
import type { NegotiationDependencies } from "../ports.js";
import { closeIfRoundBudgetSpent, expirePendingRoundIfDue } from "./expiry-core.js";
import { attemptPriceHandoff } from "./handoff.js";
import { closeThread } from "./shared.js";

/**
 * How many rows one tick may touch per step.
 *
 * Bounded on purpose: an unbounded sweep is a request whose duration grows with the
 * platform, and the first time it exceeds the scheduler's timeout it stops running
 * altogether — silently, since a timeout is not a failed job in most schedulers.
 */
export const TICK_BATCH_LIMIT = 200;

export interface RunTickOptions {
  readonly limit?: number;
  readonly traceId?: string | null;
}

export async function runTick(
  deps: NegotiationDependencies,
  options: RunTickOptions = {},
): Promise<NegotiationTickResult> {
  const limit = options.limit ?? TICK_BATCH_LIMIT;
  const at = deps.clock.now();
  const traceId = options.traceId ?? null;

  let roundsExpired = 0;
  let threadsExpired = 0;
  let threadsClosedMaxRounds = 0;
  let handoffsAttempted = 0;
  let handoffsSucceeded = 0;
  let handoffFailures = 0;

  // ---- 1. Rounds whose deadline has passed -------------------------------------
  const dueRounds = await deps.rounds.listPendingDue(at, limit);
  for (const round of dueRounds) {
    const thread = await deps.threads.find(round.threadId);
    if (thread === null) continue;
    const { expired } = await expirePendingRoundIfDue(deps, thread, at, { traceId });
    if (expired) roundsExpired += 1;
    // The lapsed round may have been the last one the budget allowed. Checked right
    // here rather than left to step 3, because a thread with a spent budget and nothing
    // pending must close as `max_rounds_reached` — if it were left until its own TTL,
    // step 2 would close it as `thread_expired` and the funnel would blame the clock for
    // a negotiation that actually ran out of rounds.
    const afterExpiry = await deps.threads.find(round.threadId);
    if (afterExpiry !== null && afterExpiry.state === "open") {
      const policy = requireUsablePolicy(
        await deps.policies.find(afterExpiry.policyVersion),
        afterExpiry.policyVersion,
      );
      if (await closeIfRoundBudgetSpent(deps, afterExpiry, policy, at, { traceId })) {
        threadsClosedMaxRounds += 1;
      }
    }
  }

  // ---- 2. Threads whose own TTL has passed -------------------------------------
  const dueThreads = await deps.threads.listDueForTick(at, limit);
  for (const thread of dueThreads) {
    const fresh = await deps.threads.find(thread.id);
    if (fresh === null || fresh.state !== "open") continue;
    // `listDueForTick` returns threads due for ANY reason — a pending round's deadline
    // included. Only the ones past their own `expires_at` are closed here; the rest were
    // handled in step 1 and simply need their tick moment recomputed.
    if (new Date(fresh.expiresAt).getTime() > new Date(at).getTime()) {
      const pending = await deps.rounds.findPending(fresh.id);
      await deps.threads.update(
        fresh.id,
        { nextTickAt: pending?.expiresAt ?? fresh.expiresAt },
        at,
        fresh.version,
      );
      continue;
    }
    await closeThread(deps, fresh, {
      state: "expired",
      reasonCode: "thread_expired",
      at,
      // The moment expiry became true, not the moment the sweep noticed it. A tick
      // delayed by an outage must not rewrite when the negotiation actually ended.
      occurredFor: dueMomentFor(fresh.expiresAt),
      traceId,
    });
    threadsExpired += 1;
  }

  // ---- 3. Threads with a spent round budget and nothing pending ----------------
  for (const thread of dueThreads) {
    const fresh = await deps.threads.find(thread.id);
    if (fresh === null || fresh.state !== "open") continue;
    const policy = requireUsablePolicy(
      await deps.policies.find(fresh.policyVersion),
      fresh.policyVersion,
    );
    if (await closeIfRoundBudgetSpent(deps, fresh, policy, at, { traceId })) {
      threadsClosedMaxRounds += 1;
    }
  }

  // ---- 4. Price hand-offs awaiting a retry -------------------------------------
  const dueHandoffs = await deps.agreements.listHandoffDue(at, limit);
  for (const agreement of dueHandoffs) {
    handoffsAttempted += 1;
    const result = await attemptPriceHandoff(deps, agreement, { traceId });
    if (result.outcome === "accepted") handoffsSucceeded += 1;
    else handoffFailures += 1;
  }

  return {
    tickedAt: at,
    roundsExpired,
    threadsExpired,
    threadsClosedMaxRounds,
    handoffsAttempted,
    handoffsSucceeded,
    handoffFailures,
  };
}
