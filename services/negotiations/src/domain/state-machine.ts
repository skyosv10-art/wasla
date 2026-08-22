/**
 * The negotiation state machines — thread and round.
 *
 * ## Why the transitions live here and not in the database
 *
 * Precedent: ADR-010 decision 2. A `CHECK` constraint cannot see the previous row,
 * so enforcing «`agreed` may not become `open`» in Postgres requires a trigger —
 * and a trigger hides the rule from the in-memory store, which means the exit gate
 * proves one behaviour in memory and a different one in Postgres. So the
 * **transition graph** is here, in one place both adapters route through, while the
 * database keeps the invariants it CAN state without knowing history:
 * `ck_negotiation_threads_open_is_clean`, `ck_negotiation_threads_closed_has_reason`,
 * `ck_negotiation_threads_agreed_names_round`,
 * `ck_negotiation_rounds_no_self_resolution`, `ux_negotiation_rounds_one_pending`,
 * `ux_negotiation_rounds_one_accepted`.
 *
 * That split is the whole design: **the domain owns history, the database owns
 * coherence.** When they disagree the database wins and the bug is here.
 *
 * ## The three rules this file exists to make unreachable
 *
 *   1. **No second agreement.** `agreed` is terminal, and only one round per thread
 *      may be `accepted`.
 *   2. **No self-resolution.** The party who proposed an amount may not accept it.
 *      An offer accepted by its own author is an announcement, not a deal
 *      (ADR-013 decision 3).
 *   3. **Turn-taking.** A party may not propose while his own proposal is pending.
 *      Without it one side walks his own price down alone and spends the round
 *      budget on a monologue, so the counterparty's first real reply arrives after
 *      `max_rounds`.
 */

import {
  alreadyAgreed,
  roundNotPending,
  selfAcceptForbidden,
  threadClosed,
  turnViolation,
  validationFailed,
} from "./errors.js";
import {
  counterparty,
  type NegotiationCloseReasonCode,
  type NegotiationParty,
  type NegotiationRound,
  type NegotiationRoundState,
  type NegotiationThread,
  type NegotiationThreadState,
} from "./model.js";

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

/**
 * The complete thread graph. `open` is the only non-terminal state, deliberately:
 * a negotiation that could be reopened would make «what did we agree on» a question
 * with a history instead of an answer.
 */
export const THREAD_TRANSITIONS: Readonly<Record<NegotiationThreadState, readonly NegotiationThreadState[]>> =
  Object.freeze({
    open: Object.freeze(["agreed", "declined", "expired", "cancelled"] as const),
    agreed: Object.freeze([] as const),
    declined: Object.freeze([] as const),
    expired: Object.freeze([] as const),
    cancelled: Object.freeze([] as const),
  });

/**
 * The close reason each terminal state may carry.
 *
 * Mirrors `ck_negotiation_threads_agreed_names_round` and the `close_reason_code`
 * enumeration. A state and a reason that contradict each other — `declined` closed
 * for `agreed`, say — is not a cosmetic defect: it is a row the funnel will count
 * twice, in opposite columns.
 */
export const THREAD_CLOSE_REASONS: Readonly<
  Record<Exclude<NegotiationThreadState, "open">, readonly NegotiationCloseReasonCode[]>
> = Object.freeze({
  agreed: Object.freeze(["agreed"] as const),
  declined: Object.freeze(["declined_by_customer", "declined_by_driver", "max_rounds_reached"] as const),
  expired: Object.freeze(["thread_expired"] as const),
  cancelled: Object.freeze(["cancelled_by_dispatch", "order_withdrawn"] as const),
});

export function canTransitionThread(
  from: NegotiationThreadState,
  to: NegotiationThreadState,
): boolean {
  return THREAD_TRANSITIONS[from].includes(to);
}

/**
 * Assert a thread transition, raising the code the API publishes for it.
 *
 * `agreed → anything` raises `NEGOTIATION_ALREADY_AGREED` rather than the generic
 * closed-thread conflict, because the two need different words to the user: one
 * says «this is over», the other says «this succeeded and you are late».
 */
export function assertThreadTransition(
  thread: NegotiationThread,
  to: NegotiationThreadState,
  reasonCode: NegotiationCloseReasonCode,
): void {
  if (thread.state === "agreed") throw alreadyAgreed();
  if (!canTransitionThread(thread.state, to)) {
    throw threadClosed(thread.state, thread.closeReasonCode);
  }
  if (to !== "open" && !THREAD_CLOSE_REASONS[to].includes(reasonCode)) {
    throw validationFailed("close_reason_code", THREAD_CLOSE_REASONS[to].join(" | "));
  }
}

/**
 * The thread must be open for this action to mean anything.
 *
 * Separated from `assertThreadTransition` because a read, a message and a proposal
 * all need «is it still open?» without proposing a destination state.
 */
export function assertThreadOpen(thread: NegotiationThread): void {
  if (thread.state === "agreed") throw alreadyAgreed();
  if (thread.state !== "open") throw threadClosed(thread.state, thread.closeReasonCode);
}

/** Is this public id one of the thread's two parties? */
export function partyOf(
  thread: NegotiationThread,
  publicId: string,
): NegotiationParty | null {
  if (publicId === thread.customerPublicId) return "customer";
  if (publicId === thread.driverPublicId) return "driver";
  return null;
}

// ---------------------------------------------------------------------------
// Round
// ---------------------------------------------------------------------------

/**
 * The complete round graph.
 *
 * `superseded` exists so a counter-offer does not have to lie about what happened
 * to the offer it answers. Calling it `rejected` would be false — the party did not
 * refuse the price, he replaced the conversation's subject — and the difference is
 * the difference between «he said no» and «he said how about this» in every funnel
 * built on these rows.
 */
export const ROUND_TRANSITIONS: Readonly<Record<NegotiationRoundState, readonly NegotiationRoundState[]>> =
  Object.freeze({
    pending: Object.freeze(["accepted", "rejected", "superseded", "expired"] as const),
    accepted: Object.freeze([] as const),
    rejected: Object.freeze([] as const),
    superseded: Object.freeze([] as const),
    expired: Object.freeze([] as const),
  });

export function canTransitionRound(
  from: NegotiationRoundState,
  to: NegotiationRoundState,
): boolean {
  return ROUND_TRANSITIONS[from].includes(to);
}

/** States in which a round still awaits an answer. */
export function isRoundPending(round: NegotiationRound): boolean {
  return round.state === "pending";
}

export function assertRoundPending(round: NegotiationRound): void {
  if (!isRoundPending(round)) throw roundNotPending(round.state);
}

/**
 * Who may settle this round.
 *
 * The counterparty of whoever proposed it — never the proposer. Enforced here AND
 * by `ck_negotiation_rounds_no_self_resolution` in the DDL, and the constraint is
 * named in the error's `details` so a reader can find the second line of defence
 * instead of assuming the rule lives only in TypeScript.
 */
export function assertMayResolve(round: NegotiationRound, actingParty: NegotiationParty): void {
  if (actingParty === round.proposedBy) throw selfAcceptForbidden();
}

/**
 * Whose turn it is to propose.
 *
 * `null` means either party may — there is no pending round, so nobody is waiting.
 * Otherwise it is the counterparty of the pending proposal's author.
 */
export function turnBelongsTo(pending: NegotiationRound | null): NegotiationParty | null {
  return pending === null ? null : counterparty(pending.proposedBy);
}

/**
 * Turn-taking, asserted.
 *
 * A party proposing while his own offer is still pending is refused. Note the
 * asymmetry with `assertMayResolve`: proposing **against** a pending offer is
 * legal and is precisely how a counter-offer works — it supersedes the offer it
 * answers. What is refused is talking twice in a row.
 */
export function assertMayPropose(
  pending: NegotiationRound | null,
  proposingParty: NegotiationParty,
): void {
  const turn = turnBelongsTo(pending);
  if (turn !== null && turn !== proposingParty) throw turnViolation(turn);
}

/**
 * The close reason for a rejection, by the party who rejected.
 *
 * A function and not a constant map at the call site, so the two codes cannot drift
 * apart from the parties they describe — `declined_by_customer` on a driver's
 * rejection is a row that reverses the blame in every report built on it.
 */
export function declineReasonFor(party: NegotiationParty): NegotiationCloseReasonCode {
  return party === "customer" ? "declined_by_customer" : "declined_by_driver";
}
