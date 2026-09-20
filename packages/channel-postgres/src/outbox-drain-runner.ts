/**
 * `OutboxDrainRunner` for the channel outbox on PostgreSQL.
 *
 * Wraps `ChannelDb.transaction()` so that claim + deliver + mark-published run
 * in one transaction. `SKIP LOCKED` holds its locks until commit, so the
 * transaction boundary must span all three steps.
 *
 * This runner is deliberately separate from the channel stores: the drain is
 * an operator-driven concern (ADR-042), not part of the bot's request path.
 *
 * Scope: package · channel-postgres
 * Last Updated: 2026-09-20
 * Status: Active
 * Related Code: @wasla/outbox · ADR-042
 */

import type { OutboxDrainRunner, OutboxDrainStore } from "@wasla/outbox";

import type { ChannelDb } from "./db.js";
import { ChannelOutboxDrainStore } from "./outbox-drain-store.js";

export class PostgresChannelOutboxDrainRunner implements OutboxDrainRunner {
  constructor(private readonly db: ChannelDb) {}

  async drain<T>(work: (store: OutboxDrainStore) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) =>
      work(new ChannelOutboxDrainStore(tx)),
    );
  }
}
