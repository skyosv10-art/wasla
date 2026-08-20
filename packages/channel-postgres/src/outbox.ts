/**
 * `OutboxPort` on Postgres — domain events land in `channel_outbox`, never on a
 * broker directly (ADR-007 / schema.sql).
 *
 * The envelope is split across the contract's columns (`aggregate_id` = the
 * opaque `chat_ref`, `event_type`, `event_version`, `occurred_at`, `trace_id`)
 * with the event body in `payload`, so a relay can filter and order events
 * without parsing JSON. `published_at` stays NULL: publishing is a separate
 * concern (a relay, out of Phase 03 scope).
 */

import { asc, isNull } from "drizzle-orm";

import {
  CHANNEL_EVENT_AGGREGATE,
  CHANNEL_EVENT_PRODUCER,
  type ChannelDomainEvent,
  type OutboxPort,
} from "@wasla/channel-core";

import type { ChannelDb } from "./db.js";
import { channelOutbox } from "./schema.js";

export class PostgresChannelOutbox implements OutboxPort {
  constructor(private readonly db: ChannelDb) {}

  async append(event: ChannelDomainEvent): Promise<void> {
    await this.db
      .insert(channelOutbox)
      .values({
        // `event_id` is the primary key, so an append that is replayed (a retried
        // request, a resumed sweep) collapses into the row that already exists
        // rather than emitting the same domain event twice.
        id: event.event_id,
        aggregateType: CHANNEL_EVENT_AGGREGATE,
        aggregateId: event.aggregate.id,
        eventType: event.event_type,
        eventVersion: event.event_version,
        payload: event.payload,
        occurredAt: new Date(event.occurred_at),
        traceId: event.trace_id ?? null,
      })
      .onConflictDoNothing({ target: channelOutbox.id });
  }

  /**
   * Events still waiting for a relay, oldest first.
   *
   * Not part of `OutboxPort` (the port is append-only by design): this is the
   * read side a relay — and the integration suite — needs to assert the event
   * trail without reaching into SQL.
   */
  async unpublished(): Promise<ChannelDomainEvent[]> {
    const rows = await this.db
      .select()
      .from(channelOutbox)
      .where(isNull(channelOutbox.publishedAt))
      .orderBy(asc(channelOutbox.occurredAt), asc(channelOutbox.id));

    return rows.map(
      (row) =>
        ({
          event_id: row.id,
          event_type: row.eventType,
          event_version: row.eventVersion,
          occurred_at: row.occurredAt.toISOString(),
          producer: CHANNEL_EVENT_PRODUCER,
          aggregate: { type: CHANNEL_EVENT_AGGREGATE, id: row.aggregateId },
          ...(row.traceId === null ? {} : { trace_id: row.traceId }),
          payload: row.payload as Record<string, unknown>,
        }) as unknown as ChannelDomainEvent,
    );
  }
}
