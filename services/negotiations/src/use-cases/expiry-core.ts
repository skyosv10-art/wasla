/**
 * The expiry operations, in one place, used by BOTH the tick and every action.
 *
 * ## Why both (ADR-013 decision 5)
 *
 * The tick is what makes an abandoned negotiation end without anybody touching it.
 * But a tick alone means the truth is only as fresh as the last sweep, and a driver
 * accepting a price seconds after its deadline would succeed because no cron had
 * run yet — «the offer expired» would then depend on server load rather than on
 * time. So expiry is also evaluated at the moment of every action, against the same
 * functions the sweep uses.
 *
 * Sharing the implementation is the point: two copies of «is it expired» drift, and
 * the drift shows up as a round the API treats as alive and the sweep has already
 * buried, or the reverse.
 */

import * as events from "../domain/events.js";
import { dueMomentFor, isDue } from "../domain/expiry.js";
import type { NegotiationRound, NegotiationThread } from "../domain/model.js";
import { roundBudgetExhausted } from "../domain/policy.js";
import type { NegotiationPolicy } from "../domain/model.js";
import { threadExpired } from "../domain/errors.js";
import type { NegotiationDependencies } from "../ports.js";
import { closeThread, metaFrom } from "./shared.js";

/**
 * Expire the pending round if its deadline has passed, and report what remains
 * pending.
 *
 * `occurred_for` on the event is the round's **deadline**, not the moment the sweep
 * noticed — `dueMomentFor` exists for exactly this, and the distinction is what keeps
 * a late sweep from rewriting when the offer actually lapsed.
 */
export async function expirePendingRoundIfDue(
  deps: NegotiationDependencies,
  thread: NegotiationThread,
  at: string,
  options: { readonly traceId?: string | null } = {},
): Promise<{ readonly pending: NegotiationRound | null; readonly expired: boolean }> {
  const pending = await deps.rounds.findPending(thread.id);
  if (pending === null) return { pending: null, expired: false };
  if (!isDue(pending.expiresAt, at)) return { pending, expired: false };
  const expiredRound = await deps.rounds.resolve(thread.id, pending.roundNo, {
    state: "expired",
    // `null` by design, and enforced by `ck_negotiation_rounds_state_timestamp`:
    // nobody resolved this round, time did. Naming a party here would put a refusal
    // on a record where none happened.
    resolvedBy: null,
    respondedAt: at,
  });
  await deps.outbox.append(
    events.roundExpired(expiredRound, metaFrom(deps, options, at), {
      occurredFor: dueMomentFor(pending.expiresAt),
    }),
  );
  return { pending: null, expired: true };
}

/**
 * Settle the pending round **unconditionally**, because the thread is closing under it.
 *
 * Used by cancellation, where the order went away before the deadline arrived. The round
 * becomes `expired` and no party is named: `rejected` would record a refusal nobody made,
 * and leaving it `pending` would keep a round reading as «still awaiting an answer» on a
 * thread that is over — in every report, forever.
 *
 * `occurred_for` is the closing moment and not the round's deadline, because the deadline
 * never arrived; what actually ended this round is the cancellation.
 */
export async function settlePendingRoundOnClose(
  deps: NegotiationDependencies,
  thread: NegotiationThread,
  at: string,
  options: { readonly traceId?: string | null } = {},
): Promise<boolean> {
  const pending = await deps.rounds.findPending(thread.id);
  if (pending === null) return false;
  const settled = await deps.rounds.resolve(thread.id, pending.roundNo, {
    state: "expired",
    resolvedBy: null,
    respondedAt: at,
  });
  await deps.outbox.append(
    events.roundExpired(settled, metaFrom(deps, options, at), { occurredFor: at }),
  );
  return true;
}

/**
 * Close the thread if its own TTL has passed, and raise `THREAD_EXPIRED`.
 *
 * It closes before it throws: an action arriving after the deadline is the moment we
 * learned the thread is over, and answering «expired» while leaving the row open
 * would leave a thread that every request refuses and no report counts as finished.
 */
export async function assertThreadNotExpired(
  deps: NegotiationDependencies,
  thread: NegotiationThread,
  at: string,
  options: { readonly traceId?: string | null } = {},
): Promise<void> {
  if (!isDue(thread.expiresAt, at)) return;
  await expirePendingRoundIfDue(deps, thread, at, options);
  const fresh = (await deps.threads.find(thread.id)) ?? thread;
  await closeThread(deps, fresh, {
    state: "expired",
    reasonCode: "thread_expired",
    at,
    occurredFor: dueMomentFor(thread.expiresAt),
    traceId: options.traceId,
  });
  throw threadExpired();
}

/**
 * Close a thread whose round budget is spent and which has nothing pending.
 *
 * Deliberately NOT done inside `propose-round`: the party who used the last round
 * gets `MAX_ROUNDS_REACHED` and the thread stays open, because his counterparty may
 * still **accept** the offer already on the table. Closing on the spot would destroy
 * a live agreement to enforce a limit on proposals. The thread closes at the tick,
 * once the last round has been resolved and there is genuinely nothing left to
 * answer.
 */
export async function closeIfRoundBudgetSpent(
  deps: NegotiationDependencies,
  thread: NegotiationThread,
  policy: NegotiationPolicy,
  at: string,
  options: { readonly traceId?: string | null } = {},
): Promise<boolean> {
  if (thread.state !== "open") return false;
  if (!roundBudgetExhausted(policy, thread.roundCount)) return false;
  const pending = await deps.rounds.findPending(thread.id);
  if (pending !== null) return false;
  await closeThread(deps, thread, {
    state: "declined",
    reasonCode: "max_rounds_reached",
    at,
    // Not a deadline but a decision the platform made now: the budget was spent
    // earlier, yet «nothing more will be answered» becomes true only here.
    occurredFor: at,
    traceId: options.traceId,
  });
  return true;
}
