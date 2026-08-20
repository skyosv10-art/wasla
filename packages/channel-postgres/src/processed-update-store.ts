/**
 * `ProcessedUpdateStorePort` on Postgres — inbound de-duplication that survives
 * a restart.
 *
 * The port requires `remember` to be **atomic**: the duplicate must be detected
 * by the store, not by a read-then-write race in the core. That is exactly what
 * `INSERT … ON CONFLICT DO NOTHING RETURNING id` on the contract's unique index
 * `ux_channel_updates_dedup (channel, bot, channel_update_id)` gives us — one
 * statement, one round trip, and two concurrent webhook deliveries of the same
 * update can never both win.
 */

import { and, eq } from "drizzle-orm";

import type { ProcessedUpdateRecord, ProcessedUpdateStorePort } from "@wasla/channel-core";
import type { BotKind, ChannelName } from "@wasla/contracts-channel";

import type { ChannelDb } from "./db.js";
import { channelUpdates } from "./schema.js";

export class PostgresProcessedUpdateStore implements ProcessedUpdateStorePort {
  constructor(private readonly db: ChannelDb) {}

  /**
   * Claim one update. Returns `false` when this `(channel, bot, updateId)` was
   * already claimed, which is the core's signal to skip processing and emit no
   * event.
   *
   * `processed_at` is set to the same instant as `received_at`: the port has no
   * "processing finished" callback, so the row records the claim. Adding a
   * completion step would change the port contract and is deliberately out of
   * scope here (documented in docs/02-architecture/CHANNEL_PERSISTENCE.md).
   */
  async remember(record: ProcessedUpdateRecord): Promise<boolean> {
    const receivedAt = new Date(record.receivedAt);
    const inserted = await this.db
      .insert(channelUpdates)
      .values({
        channel: record.channel,
        bot: record.bot,
        channelUpdateId: record.channelUpdateId,
        chatRef: record.chatRef,
        kind: record.kind,
        command: record.command ?? null,
        status: "processed",
        receivedAt,
        processedAt: receivedAt,
        traceId: record.traceId ?? null,
      })
      .onConflictDoNothing({
        target: [channelUpdates.channel, channelUpdates.bot, channelUpdates.channelUpdateId],
      })
      .returning({ id: channelUpdates.id });

    return inserted.length > 0;
  }

  async has(channel: ChannelName, bot: BotKind, channelUpdateId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: channelUpdates.id })
      .from(channelUpdates)
      .where(
        and(
          eq(channelUpdates.channel, channel),
          eq(channelUpdates.bot, bot),
          eq(channelUpdates.channelUpdateId, channelUpdateId),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }
}
