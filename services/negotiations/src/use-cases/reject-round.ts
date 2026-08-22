/**
 * `POST /negotiations/{threadId}/rounds/{roundNo}/reject` — refuse an amount.
 *
 * ## `close_thread` is declared, never inferred
 *
 * «I refuse and I will counter» and «I refuse and I am done» are different messages
 * to the other party, and only the person rejecting knows which one he means. So the
 * flag is required in the body and travels into the event as `thread_remains_open`
 * — a consumer that guessed from the thread state would guess wrong exactly on the
 * rejection that came with a counter-offer moments later.
 *
 * ## Rejecting is not cancelling
 *
 * A party walking away closes the thread as `declined` with
 * `declined_by_customer` / `declined_by_driver`. `cancelled_*` reasons belong to
 * `POST /cancel` and mean the ORDER went away, not that someone said no. Collapsing
 * the two makes the funnel unable to distinguish «customers refuse our prices» from
 * «our orders keep disappearing» — two problems with opposite fixes.
 */

import { roundExpired, roundNotFound, threadNotFound } from "../domain/errors.js";
import * as events from "../domain/events.js";
import { isDue } from "../domain/expiry.js";
import type { NegotiationMessage, NegotiationRound, NegotiationThread } from "../domain/model.js";
import { requireUsablePolicy } from "../domain/policy.js";
import {
  assertMayResolve,
  assertRoundPending,
  assertThreadOpen,
  declineReasonFor,
} from "../domain/state-machine.js";
import {
  assertLocale,
  assertOptionalNote,
  assertParty,
  assertRoundNo,
  assertUuid,
  assertBoolean,
} from "../domain/validation.js";
import type { NegotiationDependencies } from "../ports.js";
import {
  assertThreadNotExpired,
  closeIfRoundBudgetSpent,
  expirePendingRoundIfDue,
} from "./expiry-core.js";
import {
  appendMessage,
  closeThread,
  guardIdempotency,
  metaFrom,
  refreshNextTick,
  type WriteOptions,
} from "./shared.js";

export interface RejectRoundInput {
  readonly acting_party: unknown;
  readonly close_thread: unknown;
  readonly note?: unknown;
  readonly source_locale?: unknown;
}

export interface RejectRoundResult {
  readonly thread: NegotiationThread;
  readonly round: NegotiationRound;
  readonly threadClosed: boolean;
  readonly note: NegotiationMessage | null;
  readonly replay: boolean;
}

export async function rejectRound(
  deps: NegotiationDependencies,
  threadId: unknown,
  roundNo: unknown,
  input: RejectRoundInput,
  options: WriteOptions = {},
): Promise<RejectRoundResult> {
  const id = assertUuid(threadId, "threadId");
  const number = assertRoundNo(roundNo);
  const actingParty = assertParty(input.acting_party, "acting_party");
  const closeRequested = assertBoolean(input.close_thread, "close_thread");

  const thread = await deps.threads.find(id);
  if (thread === null) throw threadNotFound();

  const policy = requireUsablePolicy(
    await deps.policies.find(thread.policyVersion),
    thread.policyVersion,
  );
  const note = assertOptionalNote(input.note, policy.maxMessageLength);
  const sourceLocale = assertLocale(input.source_locale ?? "ar");

  // Guard before state, for the reason spelled out in `accept-round`: a rejection that
  // closed the thread and lost its response must not answer its own retry with
  // THREAD_CLOSED.
  const guard = await guardIdempotency(deps, "reject_round", options.idempotencyKey, {
    threadId: id,
    roundNo: number,
    actingParty,
    closeRequested,
    note,
    sourceLocale,
  });
  if (guard === "replay") {
    const existing = await deps.rounds.find(id, number);
    if (existing !== null && existing.state === "rejected") {
      const fresh = (await deps.threads.find(id)) ?? thread;
      return {
        thread: fresh,
        round: existing,
        threadClosed: fresh.state !== "open",
        note: null,
        replay: true,
      };
    }
  }

  assertThreadOpen(thread);

  const at = deps.clock.now();
  await assertThreadNotExpired(deps, thread, at, options);

  const round = await deps.rounds.find(id, number);
  if (round === null) throw roundNotFound();
  if (round.state === "pending" && isDue(round.expiresAt, at)) {
    await expirePendingRoundIfDue(deps, thread, at, options);
    // Refused rather than accepted-as-a-rejection: time already settled this round,
    // and recording a refusal on top would attribute to a party a decision he did
    // not get to make.
    throw roundExpired();
  }
  assertRoundPending(round);
  assertMayResolve(round, actingParty);

  const rejected = await deps.rounds.resolve(id, number, {
    state: "rejected",
    resolvedBy: actingParty,
    respondedAt: at,
  });
  await deps.outbox.append(
    events.roundRejected(rejected, metaFrom(deps, options, at), {
      rejectedBy: actingParty,
      threadRemainsOpen: !closeRequested,
    }),
  );

  const noteMessage =
    note === null
      ? null
      : await appendMessage(deps, thread, policy, {
          authorRole: actingParty,
          body: note,
          roundNo: number,
          sourceLocale,
          at,
          traceId: options.traceId,
        });

  if (closeRequested) {
    const closed = await closeThread(deps, thread, {
      state: "declined",
      reasonCode: declineReasonFor(actingParty),
      at,
      occurredFor: at,
      traceId: options.traceId,
    });
    return { thread: closed, round: rejected, threadClosed: true, note: noteMessage, replay: false };
  }

  // Nothing is pending now, so the only deadline left is the thread's own.
  const refreshed = await refreshNextTick(deps, thread, at);
  // If that was the last round the budget allowed, the thread closes now as
  // `max_rounds_reached`. Leaving it open would advertise a negotiation that every
  // proposal is about to be refused on — and it would eventually close as
  // `thread_expired`, blaming the clock for a budget that ran out.
  if (await closeIfRoundBudgetSpent(deps, refreshed, policy, at, options)) {
    const closed = (await deps.threads.find(id))!;
    return { thread: closed, round: rejected, threadClosed: true, note: noteMessage, replay: false };
  }
  return { thread: refreshed, round: rejected, threadClosed: false, note: noteMessage, replay: false };
}
