/**
 * `POST /negotiations/{threadId}/rounds` — propose an amount, or counter one.
 *
 * ## `expected_round_no` is not decoration
 *
 * A counter-offer is written against a screen the proposer was looking at. If the
 * counterparty proposed in the meantime, the number being answered is no longer the
 * number on the table, and writing the counter anyway means one party negotiated
 * against a price the other had already withdrawn. `ROUND_STALE` sends him back to
 * read first, which is the whole reason the field is required rather than optional.
 *
 * ## Superseding, not rejecting
 *
 * Countering a pending offer moves it to `superseded` and never to `rejected`. The
 * party did not refuse the price, he replaced the subject of the conversation — and
 * every funnel built on these rows would read «he said no» where he said «how about
 * this» (`ROUND_TRANSITIONS`, state-machine).
 *
 * ## The budget counts creations, not survivors
 *
 * `round_count` increments per round created, and an expired round is never refunded.
 * See `roundBudgetExhausted`: an expired offer consumed the counterparty's attention
 * for its whole TTL, and a refund would make `max_rounds` a limit on patience.
 */

import { amountOutOfBounds, currencyMismatch, maxRoundsReached, roundStale, threadNotFound } from "../domain/errors.js";
import * as events from "../domain/events.js";
import { addSeconds, earlier } from "../domain/expiry.js";
import { assertAmountMinor, assertCurrency } from "../domain/money.js";
import type { NegotiationMessage, NegotiationRound, NegotiationThread } from "../domain/model.js";
import { amountWithinBounds, requireUsablePolicy, roundBudgetExhausted } from "../domain/policy.js";
import { assertMayPropose, assertThreadOpen } from "../domain/state-machine.js";
import {
  assertExpectedRoundNo,
  assertLocale,
  assertOptionalNote,
  assertParty,
  assertUuid,
} from "../domain/validation.js";
import type { NegotiationDependencies } from "../ports.js";
import { assertThreadNotExpired, expirePendingRoundIfDue } from "./expiry-core.js";
import { appendMessage, guardIdempotency, metaFrom, refreshNextTick, type WriteOptions } from "./shared.js";

export interface ProposeRoundInput {
  readonly proposed_by: unknown;
  readonly amount_minor: unknown;
  readonly currency: unknown;
  readonly expected_round_no: unknown;
  readonly note?: unknown;
  readonly source_locale?: unknown;
}

export interface ProposeRoundResult {
  readonly thread: NegotiationThread;
  readonly round: NegotiationRound;
  readonly supersededRoundNo: number | null;
  readonly note: NegotiationMessage | null;
  readonly replay: boolean;
}

export async function proposeRound(
  deps: NegotiationDependencies,
  threadId: unknown,
  input: ProposeRoundInput,
  options: WriteOptions = {},
): Promise<ProposeRoundResult> {
  const id = assertUuid(threadId, "threadId");
  const proposedBy = assertParty(input.proposed_by, "proposed_by");
  const amountMinor = assertAmountMinor(input.amount_minor);
  const currency = assertCurrency(input.currency);
  const expectedRoundNo = assertExpectedRoundNo(input.expected_round_no);
  const sourceLocale = assertLocale(input.source_locale ?? "ar");

  const thread = await deps.threads.find(id);
  if (thread === null) throw threadNotFound();

  const policy = requireUsablePolicy(
    await deps.policies.find(thread.policyVersion),
    thread.policyVersion,
  );
  const note = assertOptionalNote(input.note, policy.maxMessageLength);

  if (currency !== thread.currency) throw currencyMismatch(thread.currency);
  if (!amountWithinBounds(policy, amountMinor)) {
    throw amountOutOfBounds(policy.minAmountMinor, policy.maxAmountMinor);
  }

  // Guard before state, as in `accept-round`: a proposal that spent the last round and
  // closed the thread must recognise its own retry instead of answering THREAD_CLOSED.
  const guard = await guardIdempotency(deps, "propose_round", options.idempotencyKey, {
    threadId: id,
    proposedBy,
    amountMinor,
    currency,
    expectedRoundNo,
    note,
    sourceLocale,
  });
  if (guard === "replay") {
    // The round this exact request already created, answered again rather than
    // duplicated. Matched on the expected round number so a replay cannot be
    // confused with a later, different proposal by the same party.
    const existing = await deps.rounds.find(id, expectedRoundNo + 1);
    if (existing !== null && existing.proposedBy === proposedBy) {
      return {
        thread,
        round: existing,
        supersededRoundNo: expectedRoundNo === 0 ? null : expectedRoundNo,
        note: null,
        replay: true,
      };
    }
  }

  assertThreadOpen(thread);

  const at = deps.clock.now();
  // Time next: a proposal arriving after the thread's TTL must not create a round in a
  // negotiation that is already over.
  await assertThreadNotExpired(deps, thread, at, options);

  // A round already past its deadline is expired before turn-taking is judged:
  // otherwise a stale pending offer would keep blocking the party whose turn it
  // has in fact become.
  const { pending } = await expirePendingRoundIfDue(deps, thread, at, options);
  const current = (await deps.threads.find(id)) ?? thread;

  if (expectedRoundNo !== current.currentRoundNo) {
    throw roundStale(expectedRoundNo, current.currentRoundNo);
  }
  assertMayPropose(pending, proposedBy);
  if (roundBudgetExhausted(policy, current.roundCount)) {
    // Refused, and the thread stays open: the offer already on the table can still
    // be accepted. See `closeIfRoundBudgetSpent` for why closing here would be wrong.
    throw maxRoundsReached(policy.maxRounds);
  }

  let supersededRoundNo: number | null = null;
  if (pending !== null) {
    await deps.rounds.resolve(id, pending.roundNo, {
      state: "superseded",
      resolvedBy: null,
      respondedAt: at,
    });
    supersededRoundNo = pending.roundNo;
  }

  const roundNo = current.currentRoundNo + 1;
  const round = await deps.rounds.create({
    id: deps.ids.uuid(),
    threadId: id,
    roundNo,
    proposedBy,
    amountMinor,
    currency,
    // A round never outlives its thread. Without the clamp, the last round of a
    // nearly-expired thread would advertise a deadline the thread cannot honour,
    // and a driver would watch a countdown that means nothing.
    expiresAt: earlier(addSeconds(at, policy.roundTtlSeconds), current.expiresAt)!,
    createdAt: at,
  });

  const updated = await deps.threads.update(
    id,
    { roundCount: current.roundCount + 1, currentRoundNo: roundNo },
    at,
    current.version,
  );
  await deps.outbox.append(
    events.roundProposed(round, metaFrom(deps, options, at), { supersedesRoundNo: supersededRoundNo }),
  );

  const withTick = await refreshNextTick(deps, updated, at);
  const noteMessage =
    note === null
      ? null
      : await appendMessage(deps, withTick, policy, {
          authorRole: proposedBy,
          body: note,
          roundNo,
          sourceLocale,
          at,
          traceId: options.traceId,
        });

  return { thread: withTick, round, supersededRoundNo, note: noteMessage, replay: false };
}
