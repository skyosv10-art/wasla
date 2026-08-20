/**
 * Outbound use case: drain the retry queue.
 *
 * Re-attempts queued deliveries whose backoff has elapsed, reusing the exact
 * same delivery row, idempotency key and stored body — a retry is a new
 * *attempt*, never a new message (contracts/errors.md → Retry Policy).
 *
 * The sweep itself is deliberately dumb: it decides nothing about retry limits
 * or backoff (that lives in `RetryPolicy`) and it does not schedule itself. A
 * scheduler (or a queue worker) calls it; that keeps this package free of timers
 * and therefore fully deterministic in tests.
 */

import { channelError } from "../domain/errors.js";
import type { DeliveryOutcome } from "../domain/model.js";
import { attemptDelivery } from "./send-message.js";
import type { OutboundDeps } from "./deps.js";

export interface RetryDueDeliveriesInput {
  /** Defaults to the injected clock — pass a value only to replay a moment. */
  readonly now?: string;
  /** Upper bound on deliveries handled in one sweep (back-pressure). */
  readonly limit?: number;
}

export interface RetryDueDeliveriesResult {
  readonly attempted: number;
  readonly sent: number;
  readonly requeued: number;
  readonly failed: number;
  readonly outcomes: readonly DeliveryOutcome[];
}

/** Default sweep size — small enough to stay well inside channel rate limits. */
export const DEFAULT_RETRY_BATCH = 25;

export async function retryDueDeliveries(
  deps: OutboundDeps,
  input: RetryDueDeliveriesInput = {},
): Promise<RetryDueDeliveriesResult> {
  const now = input.now ?? deps.clock.now();
  const limit = input.limit ?? DEFAULT_RETRY_BATCH;
  if (limit <= 0) {
    throw channelError("CHANNEL_INVALID_MESSAGE", "حجم دفعة إعادة المحاولة يجب أن يكون موجباً", {
      details: { limit },
    });
  }

  const due = await deps.deliveries.dueForRetry(now, limit);
  const outcomes: DeliveryOutcome[] = [];

  for (const record of due) {
    const stored = await deps.deliveries.loadDispatch(record.deliveryId);
    if (!stored) {
      // A queued delivery without a stored body cannot be honoured. Failing it
      // loudly (with the internal code) is safer than silently dropping it or
      // inventing a replacement message.
      const failedAt = deps.clock.now();
      const failed = await deps.deliveries.applyProgress(record.deliveryId, {
        status: "failed",
        attempts: record.attempts,
        nextAttemptAt: null,
        lastErrorCode: "CHANNEL_INTERNAL_ERROR",
        lastErrorAt: failedAt,
        sentAt: null,
        updatedAt: failedAt,
      });
      outcomes.push({
        deliveryId: failed.deliveryId,
        status: "failed",
        channel: failed.channel,
        chatRef: failed.chatRef,
        attempts: failed.attempts,
        errorCode: "CHANNEL_INTERNAL_ERROR",
      });
      continue;
    }

    outcomes.push(
      await attemptDelivery(
        deps,
        record,
        stored.dispatch,
        stored.bot === undefined ? undefined : { bot: stored.bot },
      ),
    );
  }

  return {
    attempted: outcomes.length,
    sent: outcomes.filter((outcome) => outcome.status === "sent").length,
    requeued: outcomes.filter((outcome) => outcome.status === "queued").length,
    failed: outcomes.filter((outcome) => outcome.status === "failed").length,
    outcomes,
  };
}
