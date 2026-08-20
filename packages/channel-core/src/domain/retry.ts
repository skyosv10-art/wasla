/**
 * Retry policy for outbound deliveries — the executable form of the published
 * policy table in contracts/errors.md:
 *
 *   retryable codes → 5 attempts max → 1s · 2s · 4s · 8s · 16s (+ jitter),
 *   and a channel-supplied cooldown always wins over the computed backoff.
 *
 * Jitter is injected, not generated: a deterministic jitter source makes the
 * schedule assertable in tests, while production injects a random one. A retry
 * never creates a new message — same delivery, same idempotency key.
 */

import { MAX_DELIVERY_ATTEMPTS } from "@wasla/contracts-channel";

/** A number in [0, 1) used to spread retries apart. */
export type JitterSource = () => number;

export interface RetryPolicyOptions {
  /** Delay before the first retry, in ms (doubles per attempt). */
  readonly baseDelayMs?: number;
  readonly maxAttempts?: number;
  /** Upper bound on the jitter added to a delay, as a fraction of it. */
  readonly jitterRatio?: number;
  readonly jitter?: JitterSource;
}

export interface RetryDecisionInput {
  /** Attempts already recorded, including the one that just failed. */
  readonly attempts: number;
  readonly retryable: boolean;
  readonly maxAttempts: number;
  /** Cooldown requested by the channel (seconds), when it provided one. */
  readonly retryAfterSeconds?: number;
}

export interface RetryDecision {
  readonly shouldRetry: boolean;
  /** Delay until the next attempt, in ms. Zero when not retrying. */
  readonly delayMs: number;
  /** Why the delay was chosen — useful in logs and in tests. */
  readonly source: "backoff" | "channel_cooldown" | "none";
}

/** A retry policy the use cases depend on (a port, injected like any other). */
export interface RetryPolicy {
  readonly maxAttempts: number;
  decide(input: RetryDecisionInput): RetryDecision;
}

/** No jitter — the deterministic default, used by tests and by the schedule table. */
export const NO_JITTER: JitterSource = () => 0;

/**
 * Exponential backoff policy: delay = base · 2^(attempts-1), plus jitter.
 *
 * `retryAfterSeconds` (a channel cooldown) replaces the computed delay whenever
 * it is longer, so we never hammer a channel that asked us to wait.
 */
export function exponentialBackoffPolicy(options: RetryPolicyOptions = {}): RetryPolicy {
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const maxAttempts = options.maxAttempts ?? MAX_DELIVERY_ATTEMPTS;
  const jitterRatio = options.jitterRatio ?? 0.2;
  const jitter = options.jitter ?? NO_JITTER;

  return {
    maxAttempts,
    decide({ attempts, retryable, maxAttempts: limit, retryAfterSeconds }): RetryDecision {
      const effectiveLimit = limit > 0 ? limit : maxAttempts;
      if (!retryable || attempts >= effectiveLimit) {
        return { shouldRetry: false, delayMs: 0, source: "none" };
      }

      const exponent = Math.max(0, attempts - 1);
      const backoff = baseDelayMs * 2 ** exponent;
      const withJitter = Math.round(backoff * (1 + jitterRatio * jitter()));
      const cooldown = retryAfterSeconds === undefined ? 0 : Math.round(retryAfterSeconds * 1_000);

      return cooldown > withJitter
        ? { shouldRetry: true, delayMs: cooldown, source: "channel_cooldown" }
        : { shouldRetry: true, delayMs: withJitter, source: "backoff" };
    },
  };
}

/**
 * The published backoff curve (ms) from contracts/errors.md.
 *
 * With `MAX_DELIVERY_ATTEMPTS = 5` only the first four delays can ever be used
 * (attempt 5 is the last one, so nothing is scheduled after it). The fifth
 * value is kept because it is the published curve, not a per-attempt promise —
 * raising `max_attempts` on a delivery row extends the schedule without
 * changing the policy.
 */
export const PUBLISHED_BACKOFF_SCHEDULE_MS: readonly number[] = [
  1_000, 2_000, 4_000, 8_000, 16_000,
] as const;
