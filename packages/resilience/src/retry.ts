/**
 * Retry — generic retry with exponential backoff and optional jitter.
 *
 * Extracted from packages/channel-core/src/domain/retry.ts as a general-purpose
 * utility. The channel-core version remains the authoritative source for
 * channel delivery; this is for general service-to-service calls.
 */

export type JitterSource = () => number;

export interface RetryOptions {
  /** Max attempts including the first. Default: 3. */
  readonly maxAttempts?: number;
  /** Base delay in ms, doubled per attempt. Default: 500. */
  readonly baseDelayMs?: number;
  /** Upper bound on jitter as a fraction of the delay. Default: 0.2. */
  readonly jitterRatio?: number;
  readonly jitter?: JitterSource;
  /** Predicate to decide if an error is retryable. Default: always retryable. */
  readonly isRetryable?: (err: unknown) => boolean;
}

const NO_JITTER: JitterSource = () => 0;

/**
 * Execute fn with retry. On failure, waits the computed backoff and retries.
 * Rejects with the last error if all attempts are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const jitterRatio = options.jitterRatio ?? 0.2;
  const jitter = options.jitter ?? NO_JITTER;
  const isRetryable = options.isRetryable ?? (() => true);

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= maxAttempts || !isRetryable(err)) {
        throw err;
      }

      const exponent = Math.max(0, attempt - 1);
      const backoff = baseDelayMs * 2 ** exponent;
      const withJitter = Math.round(backoff * (1 + jitterRatio * jitter()));

      await new Promise((resolve) => setTimeout(resolve, withJitter));
    }
  }

  // Should not reach here, but TypeScript needs it
  throw lastError;
}
