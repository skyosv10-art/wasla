/**
 * One call that gives a composition root the whole durable set.
 *
 * The three stores always travel together — a bot with a persistent delivery
 * queue but an in-memory de-duplication set would lose exactly-once on restart —
 * so the root wires them as a unit and gets back the `close()` it must call on
 * shutdown. This keeps `packages/bot-runtime` free of pool bookkeeping.
 */

import type { OutboxPort, ProcessedUpdateStorePort, DeliveryStorePort } from "@wasla/channel-core";
import type { OutboxDrainRunner } from "@wasla/outbox";

import { createChannelDb, type ChannelDbConfig } from "./db.js";
import { PostgresDeliveryStore } from "./delivery-store.js";
import { PostgresChannelOutbox } from "./outbox.js";
import { PostgresProcessedUpdateStore } from "./processed-update-store.js";
import { PostgresChannelOutboxDrainRunner } from "./outbox-drain-runner.js";

export interface ChannelStores {
  readonly processedUpdates: ProcessedUpdateStorePort;
  readonly deliveries: DeliveryStorePort;
  readonly outbox: OutboxPort;
  /** Drain runner for the channel outbox (G7). Operator-driven, not part of the bot request path. */
  readonly outboxDrain?: OutboxDrainRunner;
  /** Release the connection pool (call once, on shutdown). */
  close(): Promise<void>;
}

/** Wire the three Postgres-backed channel stores over one pool. */
export function createChannelStores(config: ChannelDbConfig): ChannelStores {
  const { pool, db } = createChannelDb(config);

  return {
    processedUpdates: new PostgresProcessedUpdateStore(db),
    deliveries: new PostgresDeliveryStore(db),
    outbox: new PostgresChannelOutbox(db),
    outboxDrain: new PostgresChannelOutboxDrainRunner(db),
    close: async () => {
      await pool.end();
    },
  };
}
