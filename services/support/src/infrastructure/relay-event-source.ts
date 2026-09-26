/**
 * In-memory order event source for testing the relay consumer.
 * Production reads from `order_outbox` (Postgres adapter deferred).
 */

import type { OrderOutboxRow, RelayCheckpoint } from "../domain/consumed-events.js";
import type { OrderEventSource } from "../ports.js";
import { isBefore } from "../domain/consumed-events.js";

export class InMemoryOrderEventSource implements OrderEventSource {
  private rows: OrderOutboxRow[] = [];

  constructor(rows: OrderOutboxRow[] = []) {
    this.rows = [...rows].sort((a, b) => {
      if (a.occurred_at < b.occurred_at) return -1;
      if (a.occurred_at > b.occurred_at) return 1;
      return a.event_id < b.event_id ? -1 : 1;
    });
  }

  async readAfter(
    checkpoint: RelayCheckpoint | null,
    limit: number,
  ): Promise<readonly OrderOutboxRow[]> {
    const cp = checkpoint ?? {
      last_occurred_at: new Date(0).toISOString(),
      last_event_id: "00000000-0000-0000-0000-000000000000",
    };

    return this.rows
      .filter((row) => {
        const rowCp: RelayCheckpoint = {
          last_occurred_at: row.occurred_at,
          last_event_id: row.event_id,
        };
        // Strictly after the checkpoint
        return !isBefore(rowCp, cp) && (
          rowCp.last_occurred_at !== cp.last_occurred_at ||
          rowCp.last_event_id !== cp.last_event_id
        );
      })
      .slice(0, limit);
  }

  /** Test helper — add rows. */
  addRows(rows: OrderOutboxRow[]): void {
    this.rows.push(...rows);
    this.rows.sort((a, b) => {
      if (a.occurred_at < b.occurred_at) return -1;
      if (a.occurred_at > b.occurred_at) return 1;
      return a.event_id < b.event_id ? -1 : 1;
    });
  }

  /** Test helper — reset. */
  reset(): void {
    this.rows = [];
  }
}
