/**
 * Timeout — wraps a promise with a deadline. If the promise does not settle
 * within the timeout, a TimeoutError is thrown and the underlying operation
 * is abandoned (the promise is not cancelled — JavaScript does not support
 * that — but the caller is unblocked).
 */

export interface TimeoutOptions {
  /** Deadline in ms. */
  readonly timeoutMs: number;
  /** Custom error message. Default: "Operation timed out after {ms}ms". */
  readonly message?: string;
}

export class TimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Wraps a promise with a timeout. If the promise does not settle within
 * `timeoutMs`, rejects with TimeoutError.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  options: TimeoutOptions
): Promise<T> {
  const { timeoutMs, message } = options;

  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(timeoutMs));
    }, timeoutMs);
    // Unref the timer so it doesn't keep the process alive
    timer.unref?.();
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Execute a function with a timeout.
 */
export function withTimeoutFn<T>(
  fn: () => Promise<T>,
  options: TimeoutOptions
): Promise<T> {
  return withTimeout(fn(), options);
}
