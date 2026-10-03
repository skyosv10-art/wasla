/**
 * @wasla/resilience — Shared resilience patterns for WASLA services.
 *
 * Provides:
 * - CircuitBreaker: prevents cascading failures by tripping after N failures
 * - Bulkhead: limits concurrent in-flight operations (bounded concurrency)
 * - withTimeout: wraps a promise with a deadline
 * - withRetry: generic retry with exponential backoff + jitter
 *
 * Usage:
 *   import { createCircuitBreaker, createBulkhead, withTimeout, withRetry } from "@wasla/resilience";
 *
 *   const breaker = createCircuitBreaker({ failureThreshold: 5, cooldownMs: 30_000 });
 *   const bulkhead = createBulkhead({ maxConcurrent: 10 });
 *
 *   if (!breaker.before()) throw new Error("circuit open");
 *   try {
 *     const result = await bulkhead.execute(() =>
 *       withTimeout(someAsyncOp(), { timeoutMs: 5_000 })
 *     );
 *     breaker.onSuccess();
 *   } catch (err) {
 *     breaker.onFailure();
 *     throw err;
 *   }
 */

export {
  createCircuitBreaker,
  type CircuitBreaker,
  type CircuitState,
  type CircuitBreakerOptions,
  type Clock,
} from "./circuit-breaker.js";

export {
  createBulkhead,
  type Bulkhead,
  type BulkheadOptions,
  type BulkheadStats,
  BulkheadFullError,
} from "./bulkhead.js";

export {
  withTimeout,
  withTimeoutFn,
  type TimeoutOptions,
  TimeoutError,
} from "./timeout.js";

export {
  withRetry,
  type RetryOptions,
  type JitterSource,
} from "./retry.js";

export {
  PG_GUARD_DEFAULTS,
  DbUnavailableError,
  isDbUnavailableError,
  connectivityReason,
  withPgPoolDefaults,
  pgSslFromEnv,
  guardPgPool,
  pgGuardOf,
  installedPgGuards,
  attachDatabaseHealth,
  type PgPoolLike,
  type PgClientLike,
  type PgGuard,
  type PgPoolTimeouts,
  type PgSslConfig,
  type PgSslMode,
  type GuardPgPoolOptions,
  type DatabaseHealth,
  type DatabaseState,
  type HealthHookApp,
  type HealthHookReply,
  type AttachDatabaseHealthOptions,
} from "./pg-guard.js";
