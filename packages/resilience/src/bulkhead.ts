/**
 * Bulkhead — limits the number of concurrent in-flight operations to a fixed
 * capacity. When the bulkhead is full, new calls are rejected (or queued).
 *
 * This is the "bounded concurrency" resilience pattern: a slow downstream on
 * one route cannot exhaust all connections and starve other routes.
 */

export interface BulkheadOptions {
  /** Maximum concurrent operations. Default: 10. */
  readonly maxConcurrent?: number;
  /** Max queue depth for waiting operations. 0 = reject immediately. Default: 0. */
  readonly maxQueue?: number;
}

export interface BulkheadStats {
  readonly available: number;
  readonly running: number;
  readonly queued: number;
}

export interface Bulkhead {
  /** Execute fn within the bulkhead. Rejects if full and queue is full. */
  execute<T>(fn: () => Promise<T>): Promise<T>;
  readonly stats: BulkheadStats;
}

interface QueueItem {
  run: () => void;
  reject: (err: Error) => void;
}

export function createBulkhead(options: BulkheadOptions = {}): Bulkhead {
  const maxConcurrent = options.maxConcurrent ?? 10;
  const maxQueue = options.maxQueue ?? 0;

  let running = 0;
  const queue: QueueItem[] = [];

  function pump(): void {
    while (running < maxConcurrent && queue.length > 0) {
      const item = queue.shift()!;
      running++;
      item.run();
    }
  }

  return {
    get stats(): BulkheadStats {
      return {
        available: Math.max(0, maxConcurrent - running),
        running,
        queued: queue.length,
      };
    },

    execute<T>(fn: () => Promise<T>): Promise<T> {
      // If there's room, run immediately
      if (running < maxConcurrent) {
        running++;
        return fn().finally(() => {
          running--;
          pump();
        });
      }

      // No room — try to queue
      if (queue.length >= maxQueue) {
        return Promise.reject(
          new BulkheadFullError(maxConcurrent, queue.length)
        );
      }

      return new Promise<T>((resolve, reject) => {
        const run = () => {
          fn()
            .then(resolve)
            .catch(reject)
            .finally(() => {
              running--;
              pump();
            });
        };
        queue.push({ run, reject });
      });
    },
  };
}

export class BulkheadFullError extends Error {
  constructor(
    readonly maxConcurrent: number,
    readonly queueDepth: number
  ) {
    super(`Bulkhead full: ${maxConcurrent} concurrent, ${queueDepth} queued`);
    this.name = "BulkheadFullError";
  }
}
