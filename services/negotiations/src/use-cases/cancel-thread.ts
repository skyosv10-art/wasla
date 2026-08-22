/**
 * `POST /negotiations/{threadId}/cancel` — the ORDER went away.
 *
 * ## Two reasons only, and neither of them is «he said no»
 *
 * `cancelled_by_dispatch` and `order_withdrawn`. A party refusing a price uses the
 * rejection route with `close_thread: true`, which records `declined_by_*`. The
 * separation is what lets the funnel tell «customers refuse our prices» from «our
 * orders keep disappearing» — two numbers with opposite fixes, and one column if they
 * are merged.
 *
 * ## An agreed thread is never cancelled
 *
 * `assertThreadTransition` refuses `agreed → cancelled` with `ALREADY_AGREED`. Once a
 * price is agreed the negotiation is history; withdrawing the order is a matter for
 * the order engine and its own cancellation, not a retroactive edit of what two people
 * settled on (ADR-013 decision 2 — this service never rewrites an agreement).
 */

import { threadNotFound } from "../domain/errors.js";
import type { NegotiationThread } from "../domain/model.js";
import { assertCancelReasonCode, assertUuid } from "../domain/validation.js";
import type { NegotiationDependencies } from "../ports.js";
import { settlePendingRoundOnClose } from "./expiry-core.js";
import { closeThread, guardIdempotency, type WriteOptions } from "./shared.js";

export interface CancelThreadInput {
  readonly reason_code: unknown;
}

export interface CancelThreadResult {
  readonly thread: NegotiationThread;
  readonly replay: boolean;
}

export async function cancelThread(
  deps: NegotiationDependencies,
  threadId: unknown,
  input: CancelThreadInput,
  options: WriteOptions = {},
): Promise<CancelThreadResult> {
  const id = assertUuid(threadId, "threadId");
  const reasonCode = assertCancelReasonCode(input.reason_code);

  const thread = await deps.threads.find(id);
  if (thread === null) throw threadNotFound();

  const guard = await guardIdempotency(deps, "cancel_thread", options.idempotencyKey, {
    threadId: id,
    reasonCode,
  });
  if (guard === "replay" && thread.state === "cancelled" && thread.closeReasonCode === reasonCode) {
    // Already cancelled for this exact reason. Answered rather than refused: a retry
    // after a lost response is not a second cancellation.
    return { thread, replay: true };
  }

  const at = deps.clock.now();
  // A pending round is settled first, and unconditionally — its deadline has usually NOT
  // arrived, because the order was withdrawn while somebody was still thinking. Left
  // `pending` it would read as «still awaiting an answer» on a thread that is over, in
  // every report, forever, and `ux_negotiation_rounds_one_pending` would keep holding the
  // slot. Note that a cancellation is NOT an expiry of the thread: the reason is recorded
  // as the caller gave it.
  await settlePendingRoundOnClose(deps, thread, at, options);
  const fresh = (await deps.threads.find(id)) ?? thread;

  const cancelled = await closeThread(deps, fresh, {
    state: "cancelled",
    reasonCode,
    at,
    occurredFor: at,
    traceId: options.traceId,
  });
  return { thread: cancelled, replay: false };
}
