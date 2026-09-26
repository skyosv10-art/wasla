/**
 * In-memory relay checkpoint store for testing and local development.
 * Production uses Postgres (deferred to integration review).
 */

import type { RelayCheckpoint } from "../domain/consumed-events.js";
import type { RelayCheckpointStore, RelayDeadLetterStore, RelayConsumerLock } from "../ports.js";

export class InMemoryCheckpointStore implements RelayCheckpointStore {
  private checkpoints = new Map<string, RelayCheckpoint>();

  async getCheckpoint(consumerId: string): Promise<RelayCheckpoint | null> {
    return this.checkpoints.get(consumerId) ?? null;
  }

  async writeCheckpoint(consumerId: string, checkpoint: RelayCheckpoint): Promise<void> {
    this.checkpoints.set(consumerId, checkpoint);
  }

  /** Test helper — reset all checkpoints. */
  reset(): void {
    this.checkpoints.clear();
  }
}

/**
 * In-memory dead-letter store for testing and local development.
 */
export class InMemoryDeadLetterStore implements RelayDeadLetterStore {
  readonly deadLetters: Array<{
    consumerId: string;
    event: import("../domain/consumed-events.js").OrderOutboxRow;
    reason: string;
    attempts: number;
    deadLetteredAt: Date;
  }> = [];

  async writeDeadLetter(
    consumerId: string,
    event: import("../domain/consumed-events.js").OrderOutboxRow,
    reason: string,
    attempts: number,
  ): Promise<void> {
    this.deadLetters.push({
      consumerId,
      event,
      reason,
      attempts,
      deadLetteredAt: new Date(),
    });
  }

  /** Test helper — reset all dead letters. */
  reset(): void {
    this.deadLetters.length = 0;
  }
}

/**
 * In-memory consumer lock for testing. Uses a simple boolean flag —
 * no real concurrency control needed for tests.
 */
export class InMemoryConsumerLock implements RelayConsumerLock {
  private locked = new Set<string>();

  async withConsumerLock<T>(consumerId: string, fn: () => Promise<T>): Promise<T> {
    if (this.locked.has(consumerId)) {
      throw new Error(`consumer ${consumerId} is already locked`);
    }
    this.locked.add(consumerId);
    try {
      return await fn();
    } finally {
      this.locked.delete(consumerId);
    }
  }
}
