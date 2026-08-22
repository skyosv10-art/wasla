/**
 * `POST /negotiations/{threadId}/rounds/{roundNo}/accept` — the agreement.
 *
 * ## Acceptance is explicit, and only of a numbered round
 *
 * There is no «accept the current price» route and no acceptance inferred from
 * silence. The round number is in the URL because the thing being agreed to must be
 * identifiable afterwards: «he accepted» is not an answer to «accepted what», and a
 * fare dispute is exactly where that question gets asked (ADR-013 decision 3).
 *
 * ## Nobody accepts his own offer
 *
 * Refused here by `assertMayResolve` and again by
 * `ck_negotiation_rounds_no_self_resolution` in the DDL. Two layers because a single
 * layer in application code is one refactor away from a self-priced order.
 *
 * ## The hand-off runs after the agreement is durable, and cannot undo it
 *
 * The agreement row is written and `negotiations.agreed` is emitted BEFORE the price
 * ever leaves for the order engine. `attemptPriceHandoff` never throws, and the
 * caller must not turn its failure into a failed response: telling two people who
 * agreed that they did not — while one of them is already driving — is the concrete
 * failure this ordering prevents (ADR-013 decision 2).
 */

import { roundExpired, roundNotFound, threadNotFound } from "../domain/errors.js";
import * as events from "../domain/events.js";
import { isDue } from "../domain/expiry.js";
import type {
  NegotiationAgreement,
  NegotiationMessage,
  NegotiationRound,
  NegotiationThread,
} from "../domain/model.js";
import { requireUsablePolicy } from "../domain/policy.js";
import { assertMayResolve, assertRoundPending, assertThreadOpen } from "../domain/state-machine.js";
import {
  assertLocale,
  assertOptionalNote,
  assertParty,
  assertRoundNo,
  assertUuid,
} from "../domain/validation.js";
import type { NegotiationDependencies } from "../ports.js";
import { assertThreadNotExpired, expirePendingRoundIfDue } from "./expiry-core.js";
import { attemptPriceHandoff, type HandoffAttemptResult } from "./handoff.js";
import { appendMessage, guardIdempotency, metaFrom, type WriteOptions } from "./shared.js";

export interface AcceptRoundInput {
  readonly acting_party: unknown;
  readonly note?: unknown;
  readonly source_locale?: unknown;
}

export interface AcceptRoundResult {
  readonly thread: NegotiationThread;
  readonly round: NegotiationRound;
  readonly agreement: NegotiationAgreement;
  readonly handoff: HandoffAttemptResult | null;
  readonly note: NegotiationMessage | null;
  readonly replay: boolean;
}

export async function acceptRound(
  deps: NegotiationDependencies,
  threadId: unknown,
  roundNo: unknown,
  input: AcceptRoundInput,
  options: WriteOptions = {},
): Promise<AcceptRoundResult> {
  const id = assertUuid(threadId, "threadId");
  const number = assertRoundNo(roundNo);
  const actingParty = assertParty(input.acting_party, "acting_party");

  const thread = await deps.threads.find(id);
  if (thread === null) throw threadNotFound();

  const policy = requireUsablePolicy(
    await deps.policies.find(thread.policyVersion),
    thread.policyVersion,
  );
  const note = assertOptionalNote(input.note, policy.maxMessageLength);
  const sourceLocale = assertLocale(input.source_locale ?? "ar");

  // The idempotency guard runs BEFORE the state checks, and the order is not cosmetic.
  // An accept that succeeded and whose response was lost leaves the thread `agreed`, so
  // asserting the state first would answer the client's retry with ALREADY_AGREED — a
  // 409 for a request that in fact worked, sending him to look for a bug that is not
  // there. The guard recognises his own key and hands back the agreement he already has.
  const guard = await guardIdempotency(deps, "accept_round", options.idempotencyKey, {
    threadId: id,
    roundNo: number,
    actingParty,
    note,
    sourceLocale,
  });
  if (guard === "replay") {
    const existingAgreement = await deps.agreements.find(id);
    const existingRound = await deps.rounds.find(id, number);
    if (existingAgreement !== null && existingRound !== null) {
      // No second hand-off on a replay: the price already left, and a duplicate
      // attempt would be a second write to the order engine for one agreement.
      return {
        thread,
        round: existingRound,
        agreement: existingAgreement,
        handoff: null,
        note: null,
        replay: true,
      };
    }
  }

  // `agreed` raises ALREADY_AGREED and not «closed», so a genuine second accept — a
  // different key — reads as «this succeeded and you are late» rather than «this is over».
  assertThreadOpen(thread);

  const at = deps.clock.now();
  await assertThreadNotExpired(deps, thread, at, options);

  const round = await deps.rounds.find(id, number);
  if (round === null) throw roundNotFound();
  if (round.state === "pending" && isDue(round.expiresAt, at)) {
    // The deadline passed before this request arrived. Expired first so the row tells
    // the truth, then refused — accepting a lapsed offer would let a late tap price
    // an order at a number the other party had stopped standing behind.
    await expirePendingRoundIfDue(deps, thread, at, options);
    throw roundExpired();
  }
  assertRoundPending(round);
  assertMayResolve(round, actingParty);

  const accepted = await deps.rounds.resolve(id, number, {
    state: "accepted",
    resolvedBy: actingParty,
    respondedAt: at,
  });

  const agreedThread = await deps.threads.update(
    id,
    {
      state: "agreed",
      closeReasonCode: "agreed",
      agreedRoundNo: number,
      closedAt: at,
      // A concluded negotiation waits for nothing, and the tick's partial index only
      // covers open threads (`ck_negotiation_threads_closed_has_reason`).
      nextTickAt: null,
    },
    at,
    thread.version,
  );

  const agreement = await deps.agreements.create({
    threadId: id,
    orderPublicId: thread.orderPublicId,
    driverPublicId: thread.driverPublicId,
    roundNo: number,
    amountMinor: accepted.amountMinor,
    currency: accepted.currency,
    acceptedBy: actingParty,
    policyVersion: thread.policyVersion,
    agreedAt: at,
    // Due immediately: the first attempt happens in this same call, and this value is
    // what makes the tick pick the agreement up if the process dies before it does.
    nextHandoffAt: at,
  });

  await deps.outbox.append(events.agreed(agreedThread, agreement, metaFrom(deps, options, at)));

  const noteMessage =
    note === null
      ? null
      : await appendMessage(deps, agreedThread, policy, {
          authorRole: actingParty,
          body: note,
          roundNo: number,
          sourceLocale,
          at,
          traceId: options.traceId,
        });

  const handoff = await attemptPriceHandoff(deps, agreement, options);

  return {
    thread: agreedThread,
    round: accepted,
    // The agreement AFTER the attempt, so the caller reports the real
    // `handoff_state` instead of a `pending` that is already stale.
    agreement: handoff.agreement,
    handoff,
    note: noteMessage,
    replay: false,
  };
}
