/**
 * Circuit Breaker — prevents cascading failures by tripping after N consecutive
 * failures, then rejecting all calls until a cooldown period has elapsed.
 *
 * States: CLOSED → OPEN → HALF_OPEN → CLOSED (or → OPEN on failure)
 *
 * In CLOSED state, all calls pass through and are counted.
 * In OPEN state, all calls are rejected immediately without invoking the handler.
 * In HALF_OPEN state, a single trial call is allowed; success → CLOSED, failure → OPEN.
 *
 * The breaker is a pure decision function over an injected clock and failure
 * counter — no timers, no background work. The caller checks `before()` and
 * reports `after()`.
 */

/** A number that always increases — Date.now() or a test double. */
export type Clock = () => number;

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  /** Failures before the breaker trips. Default: 5. */
  readonly failureThreshold?: number;
  /** ms the breaker stays open before trying a half-open probe. Default: 30_000. */
  readonly cooldownMs?: number;
  readonly clock?: Clock;
}

export interface CircuitBreaker {
  readonly state: CircuitState;
  readonly failureCount: number;
  /** Returns false if the breaker is OPEN and the call should be rejected. */
  before(): boolean;
  /** Report a success — resets the failure count, closes the breaker. */
  onSuccess(): void;
  /** Report a failure — increments the counter, may trip the breaker. */
  onFailure(): void;
  /** Reset the breaker to closed (for testing or admin reset). */
  reset(): void;
}

export function createCircuitBreaker(options: CircuitBreakerOptions = {}): CircuitBreaker {
  const failureThreshold = options.failureThreshold ?? 5;
  const cooldownMs = options.cooldownMs ?? 30_000;
  const clock = options.clock ?? (() => Date.now());

  let state: CircuitState = "closed";
  let failureCount = 0;
  let openedAt = 0;

  function transitionTo(newState: CircuitState) {
    state = newState;
    if (newState === "open") {
      openedAt = clock();
    }
    if (newState === "closed") {
      failureCount = 0;
    }
  }

  return {
    get state() { return state; },
    get failureCount() { return failureCount; },

    before(): boolean {
      if (state === "closed") return true;
      if (state === "open") {
        if (clock() - openedAt >= cooldownMs) {
          transitionTo("half_open");
          return true; // allow one probe call
        }
        return false; // still open
      }
      // half_open: allow the single probe call
      return true;
    },

    onSuccess(): void {
      if (state === "half_open") {
        transitionTo("closed");
      } else if (state === "closed") {
        failureCount = 0;
      }
    },

    onFailure(): void {
      failureCount++;
      if (state === "half_open") {
        // probe failed — back to open
        transitionTo("open");
      } else if (state === "closed" && failureCount >= failureThreshold) {
        transitionTo("open");
      }
    },

    reset(): void {
      transitionTo("closed");
    },
  };
}
