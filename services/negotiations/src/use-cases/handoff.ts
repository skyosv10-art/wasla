/**
 * Handing the agreed price to the order engine — the one outbound write.
 *
 * ## The rule this file exists to protect (ADR-013 decision 2)
 *
 * **A failed hand-off never invalidates the agreement.** Two people agreed on a
 * price; a network between two of our own services has no standing to retract that.
 * So every path below ends with the agreement intact and the failure recorded, and
 * nothing here throws into the caller that accepted the round. There is deliberately
 * no error code in the published catalogue for a failed hand-off, and no `502` and
 * no `bad_gateway` class in this service at all.
 *
 * ## Three outcomes, two of them terminal
 *
 *   - `accepted` → `handoff_state = handed_off`, retry cleared. Done.
 *   - `rejected` → the order engine **decided** no. Terminal: `handoff_state =
 *     rejected`, no retry scheduled. Retrying a decision just asks the same question
 *     until someone notices the traffic.
 *   - `unavailable` (the port threw) → an outage, not an answer. Retried with backoff
 *     until `MAX_HANDOFF_ATTEMPTS`, then `abandoned` — a state that means «a human
 *     must look», not «it never happened».
 *
 * ## Every attempt is recorded before its result is known
 *
 * `handoffs.begin` writes the row, then `complete` fills the outcome. An attempt that
 * crashes mid-call therefore survives as `outcome = null` instead of vanishing.
 * Precedent: `driver_candidacy_publications` in Phase 05 · MR 5/6, where recording
 * only successes produced a clean audit trail over a silent drift.
 */

import * as events from "../domain/events.js";
import { addSeconds } from "../domain/expiry.js";
import type { NegotiationAgreement } from "../domain/model.js";
import type { NegotiationDependencies } from "../ports.js";
import { metaFrom } from "./shared.js";

/** Attempts before the agreement is parked for human attention. */
export const MAX_HANDOFF_ATTEMPTS = 5;

/**
 * Backoff before the next attempt, in seconds.
 *
 * Doubling from 30s (30 · 60 · 120 · 240) rather than a fixed delay: a service that
 * is down stays down for minutes, and a constant retry adds load exactly while it is
 * recovering. Bounded by the attempt cap, so the sequence cannot grow unbounded.
 */
export function handoffBackoffSeconds(attemptNo: number): number {
  return 30 * 2 ** Math.max(0, attemptNo - 1);
}

export interface HandoffAttemptResult {
  readonly agreement: NegotiationAgreement;
  readonly outcome: "accepted" | "rejected" | "unavailable";
  readonly retryScheduled: boolean;
}

/**
 * Attempt one hand-off for one agreement.
 *
 * Never throws for a hand-off failure — that is the contract. It returns what
 * happened, and the caller (an accept, or the tick) records counters from it.
 */
export async function attemptPriceHandoff(
  deps: NegotiationDependencies,
  agreement: NegotiationAgreement,
  options: { readonly traceId?: string | null } = {},
): Promise<HandoffAttemptResult> {
  const at = deps.clock.now();
  const attemptNo = agreement.handoffAttempts + 1;
  const record = await deps.handoffs.begin({
    id: deps.ids.uuid(),
    threadId: agreement.threadId,
    attemptNo,
    amountMinor: agreement.amountMinor,
    currency: agreement.currency,
    requestedAt: at,
  });

  let outcome: "accepted" | "rejected" | "unavailable";
  let responseStatus: number | null = null;
  let errorCode: string | null = null;
  try {
    const result = await deps.agreedPrice.handOff(
      {
        orderPublicId: agreement.orderPublicId,
        threadId: agreement.threadId,
        driverPublicId: agreement.driverPublicId,
        amountMinor: agreement.amountMinor,
        currency: agreement.currency,
        agreedAt: agreement.agreedAt,
        attemptNo,
      },
      { traceId: options.traceId ?? null },
    );
    outcome = result.outcome;
    responseStatus = result.responseStatus;
    errorCode = result.errorCode;
  } catch (error) {
    // A transport failure. Named `unavailable` and given an error code here rather
    // than left null, because `ck_negotiation_price_handoffs_failure_named` refuses
    // an unexplained failure — a row saying only «it did not work» cannot be triaged.
    outcome = "unavailable";
    errorCode = error instanceof Error ? "HANDOFF_TRANSPORT_ERROR" : "HANDOFF_UNKNOWN_ERROR";
  }

  await deps.handoffs.complete(record.id, {
    outcome,
    responseStatus,
    errorCode: outcome === "accepted" ? null : (errorCode ?? "HANDOFF_UNKNOWN_ERROR"),
    completedAt: at,
  });

  if (outcome === "accepted") {
    const updated = await deps.agreements.update(
      agreement.threadId,
      {
        handoffState: "handed_off",
        handoffAttempts: attemptNo,
        handedOffAt: at,
        nextHandoffAt: null,
        lastErrorCode: null,
      },
      at,
    );
    await deps.outbox.append(
      events.agreedPriceHandedOff(updated, metaFrom(deps, options, at), {
        attemptNo,
        occurredFor: at,
      }),
    );
    return { agreement: updated, outcome, retryScheduled: false };
  }

  const terminal = outcome === "rejected" || attemptNo >= MAX_HANDOFF_ATTEMPTS;
  const updated = await deps.agreements.update(
    agreement.threadId,
    {
      handoffState: outcome === "rejected" ? "rejected" : terminal ? "abandoned" : "pending",
      handoffAttempts: attemptNo,
      // Cleared on any terminal state — `ck_negotiation_agreements_terminal_no_retry`
      // refuses a retry moment on a row nothing will retry.
      nextHandoffAt: terminal ? null : addSeconds(at, handoffBackoffSeconds(attemptNo)),
      lastErrorCode: errorCode ?? "HANDOFF_UNKNOWN_ERROR",
    },
    at,
  );
  await deps.outbox.append(
    events.priceHandoffFailed(updated, metaFrom(deps, options, at), {
      attemptNo,
      outcome,
      errorCode: errorCode ?? "HANDOFF_UNKNOWN_ERROR",
      retryScheduled: !terminal,
    }),
  );
  return { agreement: updated, outcome, retryScheduled: !terminal };
}
